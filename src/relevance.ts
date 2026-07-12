/**
 * Client-side relevance scoring for property/project search.
 *
 * Hard filter stays in the Qobrix `search` DSL (server-side precision).
 * Soft `boost[]` criteria are scored in-process over a scanned candidate pool
 * (recall + ranking → higher F1 at top-N).
 *
 * All upstream reads go through QobrixClient.list() → request() → cache.
 */

import { getClient } from "./client.js";
import type { ListOpts, QobrixPaginatedResponse } from "./types.js";

export const BOOST_OPS = [
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "contains",
  "starts_with",
  "ends_with",
] as const;

export type BoostOp = (typeof BOOST_OPS)[number];

export type BoostClause = {
  field: string;
  op: BoostOp;
  /** Scalar, list (for `in`), or "min..max" string (for range via `in`). */
  value: string | number | boolean | Array<string | number | boolean>;
  weight?: number;
};

export type ScoredRow = Record<string, unknown> & {
  _relevance: number;
  _matched: string[];
};

export type RelevanceSearchOpts = {
  /** Qobrix API resource path (e.g. "properties", "opportunities", "property-viewings"). */
  resource: string;
  search?: string;
  boost?: BoostClause[];
  /** Final top-N to return (default 10, max 100). */
  limit?: number;
  /** Candidate pool size when boosting (default 100, hard cap 500). */
  max_scan?: number;
  page?: number;
  sort?: string;
  fields?: string[];
  media?: boolean;
  expand?: boolean;
};

const PAGE_SIZE = 100;
const HARD_CAP_SCAN = 500;
const DEFAULT_LIMIT = 10;
const DEFAULT_MAX_SCAN_WITH_BOOST = 100;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function parseRange(value: unknown): { min: number; max: number } | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { min: Number(m[1]), max: Number(m[2]) };
}

function normalizeList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed.replace(/'/g, '"'));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* fall through */
      }
    }
    return [value];
  }
  return [value];
}

/** Evaluate one boost clause against a row. */
export function evalClause(
  row: Record<string, unknown>,
  clause: BoostClause
): boolean {
  const actual = row[clause.field];
  const { op, value } = clause;

  switch (op) {
    case "==": {
      if (typeof value === "boolean") return actual === value;
      const an = asNumber(actual);
      const vn = asNumber(value);
      if (an !== null && vn !== null) return an === vn;
      return asString(actual).toLowerCase() === asString(value).toLowerCase();
    }
    case "!=": {
      if (typeof value === "boolean") return actual !== value;
      const an = asNumber(actual);
      const vn = asNumber(value);
      if (an !== null && vn !== null) return an !== vn;
      return asString(actual).toLowerCase() !== asString(value).toLowerCase();
    }
    case "<":
    case ">":
    case "<=":
    case ">=": {
      const an = asNumber(actual);
      const vn = asNumber(value);
      if (an === null || vn === null) return false;
      if (op === "<") return an < vn;
      if (op === ">") return an > vn;
      if (op === "<=") return an <= vn;
      return an >= vn;
    }
    case "in": {
      const range = parseRange(value);
      if (range) {
        const an = asNumber(actual);
        if (an === null) return false;
        return an >= range.min && an <= range.max;
      }
      const list = normalizeList(value).map((x) => asString(x).toLowerCase());
      return list.includes(asString(actual).toLowerCase());
    }
    case "contains":
      return asString(actual)
        .toLowerCase()
        .includes(asString(value).toLowerCase());
    case "starts_with":
      return asString(actual)
        .toLowerCase()
        .startsWith(asString(value).toLowerCase());
    case "ends_with":
      return asString(actual)
        .toLowerCase()
        .endsWith(asString(value).toLowerCase());
    default:
      return false;
  }
}

/**
 * When a caller restricts fields[], scored fields must still be fetched or
 * boost clauses read undefined and ranking silently breaks. Union every boost
 * field (plus id) into the projection. Returns the input unchanged when no
 * projection was requested (undefined/empty ⇒ full row already fetched).
 */
export function mergeBoostFields(
  fields: string[] | undefined,
  boost: BoostClause[]
): string[] | undefined {
  if (!fields || fields.length === 0) return fields;
  const needed = new Set(fields);
  needed.add("id");
  for (const clause of boost) needed.add(clause.field);
  return [...needed];
}

export function scoreRow(
  row: Record<string, unknown>,
  boost: BoostClause[]
): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const clause of boost) {
    const weight = clause.weight ?? 1;
    if (evalClause(row, clause)) {
      score += weight;
      matched.push(`${clause.field} ${clause.op} ${JSON.stringify(clause.value)}`);
    }
  }
  return { score, matched };
}

/**
 * Page through cached list responses until maxScan rows are collected.
 * Uses client.list() only — never requestFresh — so every page is cacheable.
 */
export async function collectCandidates(
  resource: string,
  opts: {
    search?: string;
    maxScan: number;
    sort?: string;
    fields?: string[];
    media?: boolean;
    expand?: boolean;
  }
): Promise<{ rows: Record<string, unknown>[]; scanned: number; pages: number }> {
  const client = getClient();
  const maxScan = Math.min(Math.max(1, opts.maxScan), HARD_CAP_SCAN);
  const rows: Record<string, unknown>[] = [];
  let page = 1;
  let pages = 0;

  while (rows.length < maxScan) {
    const remaining = maxScan - rows.length;
    const limit = Math.min(PAGE_SIZE, remaining);
    const listOpts: ListOpts = {
      limit,
      page,
      search: opts.search,
      sort: opts.sort,
      fields: opts.fields,
      media: opts.media,
      expand: opts.expand,
    };
    const result = await client.list(resource, listOpts);
    pages++;
    const batch = (result.data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length === 0 || !result.pagination?.has_next_page) break;
    page++;
  }

  return { rows: rows.slice(0, maxScan), scanned: Math.min(rows.length, maxScan), pages };
}

export async function relevanceSearch(
  opts: RelevanceSearchOpts
): Promise<{
  data: ScoredRow[] | Record<string, unknown>[];
  pagination: QobrixPaginatedResponse["pagination"] & {
    scanned?: number;
    pages_fetched?: number;
    max_scan?: number;
    boost_count?: number;
    mode: "fast" | "ranked";
  };
}> {
  const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), 100);
  const boost = opts.boost ?? [];
  const hasBoost = boost.length > 0;

  if (!hasBoost) {
    const result = await getClient().list(opts.resource, {
      search: opts.search,
      limit,
      page: opts.page ?? 1,
      sort: opts.sort,
      fields: opts.fields,
      media: opts.media,
      expand: opts.expand,
    });
    return {
      data: result.data,
      pagination: {
        ...result.pagination,
        mode: "fast",
      },
    };
  }

  const maxScan = Math.min(
    Math.max(limit, opts.max_scan ?? DEFAULT_MAX_SCAN_WITH_BOOST),
    HARD_CAP_SCAN
  );

  const { rows, scanned, pages } = await collectCandidates(opts.resource, {
    search: opts.search,
    maxScan,
    // sort determines which rows enter the max_scan window when matches exceed
    // the pool; ranking then reorders the fetched candidates by _relevance.
    sort: opts.sort,
    fields: mergeBoostFields(opts.fields, boost),
    media: opts.media,
    expand: opts.expand,
  });

  const scored: ScoredRow[] = rows.map((row) => {
    const { score, matched } = scoreRow(row, boost);
    return {
      ...row,
      _relevance: score,
      _matched: matched,
    };
  });

  // Array.prototype.sort is stable (ES2019+): equal-score rows keep the server
  // order (opts.sort or Qobrix default), so ties are deterministic.
  scored.sort((a, b) => b._relevance - a._relevance);

  const top = scored.slice(0, limit);

  return {
    data: top,
    pagination: {
      count: top.length,
      current_page: 1,
      // Ranked mode returns a single top-N page and ignores `page`; raise
      // max_scan (not page) to widen the candidate pool.
      has_next_page: false,
      has_prev_page: false,
      page_count: 1,
      limit,
      scanned,
      pages_fetched: pages,
      max_scan: maxScan,
      boost_count: boost.length,
      mode: "ranked",
    },
  };
}
