import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  AggregateSchema,
  CountSchema,
  TopRecordsSchema,
  TopValuesSchema,
} from "../schemas.js";
import { errorResult, formatResult } from "./index.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // safety cap: 20 000 records

// Foreign-key fields that we always try to resolve to a readable label
// when emitting top-record rows. Keep this conservative — anything not here
// is opt-in via the per-call `resolve` argument.
export const ALWAYS_RESOLVE_KEYS: ReadonlySet<string> = new Set([
  "property_id",
  "agent",
  "owner",
  "assigned_to",
  "commission_to",
  "commission_to_2",
  "contact_name",
  "salesperson",
  "seller",
  "project",
  "developer_id",
  "campaign_id",
]);

// Mapping of FK field name -> Qobrix resource where the target lives.
const FK_RESOLVER_ROUTES: Record<string, string> = {
  // Contacts-backed
  developer_id: "contacts",
  seller: "contacts",
  contact_name: "contacts",
  contact_id: "contacts",
  name_of_lawyer_related_to_buyer: "contacts",
  name_of_lawyer_seller: "contacts",
  bank: "contacts",
  // Agents-backed
  agent: "agents",
  commission_to_2: "agents",
  // Projects-backed
  project: "projects",
  // Campaigns-backed (rarely available, but harmless)
  campaign_id: "campaigns",
  // Users-backed
  owner: "users",
  salesperson: "users",
  assigned_to: "users",
  commission_to: "users",
  created_by: "users",
  modified_by: "users",
  // Properties-backed (special, richer label)
  property_id: "properties",
};

// Small per-process cache so a paginated scan that resolves the same FK
// many times doesn't hammer the API. Keyed by `${resource}:${id}`.
const _resolveCache = new Map<string, unknown | null>();

/**
 * Resolve a single FK value into either a string label (for non-property FKs)
 * or a small object (for properties) suitable for display.
 *
 * Returns `null` when we have no route for that key, or the API lookup fails.
 */
export async function resolveId(
  kind: string,
  id: string
): Promise<unknown | null> {
  if (!id) return null;
  const resource = FK_RESOLVER_ROUTES[kind];
  if (!resource) return null;

  const cacheKey = `${resource}:${id}`;
  if (_resolveCache.has(cacheKey)) return _resolveCache.get(cacheKey) ?? null;

  try {
    const client = getClient();
    const result = await client.get(resource, id, { expand: false });
    const data = result.data as Record<string, unknown>;

    let label: unknown;
    if (resource === "properties") {
      label = {
        id,
        ref: data.reference_number ?? data.ref ?? null,
        name: data.name ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        property_type: data.property_type ?? null,
        bedrooms: data.bedrooms ?? null,
      };
    } else {
      label =
        (data.name as string | undefined) ??
        (data.username as string | undefined) ??
        (data.title as string | undefined) ??
        null;
    }

    _resolveCache.set(cacheKey, label);
    return label;
  } catch {
    _resolveCache.set(cacheKey, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers shared with deals.ts
// ---------------------------------------------------------------------------

interface PaginateAllOpts {
  resource: string;
  search?: string;
  fields?: string[];
  include?: string[];
  expand?: boolean;
}

interface PaginatedScan {
  rows: Array<Record<string, unknown>>;
  totalMatched: number;
  totalScanned: number;
  capped: boolean;
  pagesFetched: number;
}

/**
 * Page through a Qobrix list endpoint with a hard cap (`MAX_PAGES` × `PAGE_SIZE`).
 * Returns the raw rows; callers do their own filter/sort/aggregate in-process.
 */
export async function paginateAll(
  opts: PaginateAllOpts
): Promise<PaginatedScan> {
  const client = getClient();
  const rows: Array<Record<string, unknown>> = [];
  let totalMatched = 0;
  let page = 1;
  let pageCount = 1;

  while (page <= pageCount && page <= MAX_PAGES) {
    const result = await client.list(opts.resource, {
      search: opts.search,
      limit: PAGE_SIZE,
      page,
      fields: opts.fields,
      include: opts.include,
      expand: opts.expand ?? false,
    });

    pageCount = result.pagination.page_count;
    totalMatched = result.pagination.count;

    for (const row of result.data) {
      rows.push(row as Record<string, unknown>);
    }
    page++;
  }

  return {
    rows,
    totalMatched,
    totalScanned: rows.length,
    capped: page > MAX_PAGES && pageCount > MAX_PAGES,
    pagesFetched: page - 1,
  };
}

/**
 * For each row, resolve the union of `ALWAYS_RESOLVE_KEYS` and `extraKeys`
 * that are actually present on that row. Mutates the row in place by adding
 * `<field>_resolved` siblings (and `property` for `property_id`).
 */
export async function resolveCommonFks(
  rows: Array<Record<string, unknown>>,
  extraKeys: Iterable<string> = []
): Promise<void> {
  const keys = new Set<string>([
    ...ALWAYS_RESOLVE_KEYS,
    ...Array.from(extraKeys),
  ]);

  for (const row of rows) {
    for (const k of keys) {
      const raw = row[k];
      if (raw == null || raw === "") continue;
      const resolved = await resolveId(k, String(raw));
      if (resolved == null) continue;
      if (k === "property_id") {
        row.property = resolved;
      } else {
        row[`${k}_resolved`] = resolved;
      }
    }
  }
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toSortableOrNull(v: unknown): number | null {
  // Try numeric first, then ISO date timestamp.
  const num = toNumberOrNull(v);
  if (num != null) return num;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export interface TopRecordsArgs {
  resource: string;
  sort_by: string;
  desc?: boolean;
  top?: number;
  search?: string;
  fields?: string[];
  include?: string[];
  resolve?: string[];
}

export interface TopRecordsResult {
  resource: string;
  sort_by: string;
  desc: boolean;
  search: string;
  total_matched: number;
  total_scanned: number;
  with_value: number;
  capped: boolean;
  rows: Array<Record<string, unknown>>;
}

/**
 * Shared "top-N records sorted by numeric/date field, with FK resolution"
 * implementation. Reused by `qobrix_top_records` and `qobrix_deals`.
 */
export async function topRecords(args: TopRecordsArgs): Promise<TopRecordsResult> {
  const desc = args.desc ?? true;
  const top = args.top ?? 10;

  // We need at least id + sort_by; if the caller passed a projection,
  // make sure those plus all the always-resolve keys are included so
  // resolution actually works.
  let fields: string[] | undefined;
  if (args.fields && args.fields.length > 0) {
    const merged = new Set<string>(args.fields);
    merged.add("id");
    merged.add(args.sort_by);
    for (const k of ALWAYS_RESOLVE_KEYS) merged.add(k);
    for (const k of args.resolve ?? []) merged.add(k);
    fields = Array.from(merged);
  }

  const scan = await paginateAll({
    resource: args.resource,
    search: args.search,
    fields,
    include: args.include,
    expand: false,
  });

  const withValue: Array<{ row: Record<string, unknown>; key: number }> = [];
  for (const row of scan.rows) {
    const v = row[args.sort_by];
    const key = toSortableOrNull(v);
    if (key == null) continue;
    withValue.push({ row, key });
  }

  withValue.sort((a, b) => (desc ? b.key - a.key : a.key - b.key));
  const slice = withValue.slice(0, top).map((x) => x.row);

  await resolveCommonFks(slice, args.resolve ?? []);

  return {
    resource: args.resource,
    sort_by: args.sort_by,
    desc,
    search: args.search ?? "(all)",
    total_matched: scan.totalMatched,
    total_scanned: scan.totalScanned,
    with_value: withValue.length,
    capped: scan.capped,
    rows: slice,
  };
}

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

export function registerAnalyticsTools(server: McpServer): void {
  server.tool(
    "qobrix_count",
    "Count records matching a search expression — returns just the total count, no data payload. " +
    "Faster and lighter than fetching records when you only need a number. " +
    "Example uses: " +
    "Total active sale listings: resource='properties', search='status == \"available\" and sale_rent == \"for_sale\"'. " +
    "Q1 closed-won opportunities: resource='opportunities', search='status == \"closed_won\" and last_status_change >= \"2026-01-01\" and last_status_change < \"2026-04-01\"'. " +
    "Contacts created this month: resource='contacts', search='created >= THIS_MONTH'.",
    CountSchema.shape,
    async ({ resource, search }) => {
      try {
        const result = await getClient().list(resource, {
          search,
          limit: 1,
          fields: ["id"],
          expand: false,
        });
        return formatResult({
          resource,
          search: search ?? "(all)",
          count: result.pagination.count,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_top_values",
    "Aggregate records by a field and return the top N most-frequent values with counts. " +
    "This tool paginates through all matching records server-side — no client-side scripting needed. " +
    "Caps at 20,000 records for safety; use a search filter to narrow large datasets. " +
    "Example uses: " +
    "Top listing developers: resource='properties', field='developer_id', search='status == \"available\" and sale_rent == \"for_sale\"', resolve=true. " +
    "Lead sources: resource='opportunities', field='source', search='created >= \"2026-01-01\"'. " +
    "Agent workload: resource='opportunities', field='owner', search='status == \"open\"', resolve=true. " +
    "Property type mix: resource='properties', field='property_type', search='status == \"available\"'. " +
    "Set resolve=true to convert UUIDs (developer_id, agent, owner, etc.) to human-readable names.",
    TopValuesSchema.shape,
    async ({ resource, field, search, top, resolve }) => {
      try {
        const client = getClient();
        const n = top ?? 10;
        const freq = new Map<string, number>();
        let totalScanned = 0;
        let totalMatched = 0;
        let page = 1;
        let pageCount = 1;

        while (page <= pageCount && page <= MAX_PAGES) {
          const result = await client.list(resource, {
            search,
            limit: PAGE_SIZE,
            page,
            fields: ["id", field],
            expand: false,
          });

          pageCount = result.pagination.page_count;
          totalMatched = result.pagination.count;

          for (const row of result.data) {
            const val = (row as Record<string, unknown>)[field];
            if (val != null && val !== "") {
              const key = String(val);
              freq.set(key, (freq.get(key) || 0) + 1);
            }
            totalScanned++;
          }

          page++;
        }

        const sorted = [...freq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, n);

        const results: Array<{
          value: string;
          count: number;
          name?: unknown;
        }> = [];

        for (const [value, count] of sorted) {
          const entry: { value: string; count: number; name?: unknown } = {
            value,
            count,
          };
          if (resolve) {
            const name = await resolveId(field, value);
            if (name) entry.name = name;
          }
          results.push(entry);
        }

        return formatResult({
          resource,
          field,
          search: search ?? "(all)",
          total_matched: totalMatched,
          total_scanned: totalScanned,
          unique_values: freq.size,
          capped: page > MAX_PAGES,
          top: results,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_top_records",
    "Top-N rows of any resource sorted by a numeric or ISO-date field. " +
    "Paginates server-side (cap 20,000 rows), sorts in-process, and resolves common FK " +
    "fields (property_id, agent, owner, assigned_to, commission_to, commission_to_2, " +
    "contact_name, salesperson, seller, project, developer_id, campaign_id) into readable " +
    "names so the agent doesn't have to chain lookups. " +
    "Use this when Qobrix's `sort` query param is silently ignored (common for nullable / " +
    "computed numeric fields like contracts.final_selling_price_amount or " +
    "opportunities.budget). Example uses: " +
    "Top 2026 closed sales: resource='contracts', sort_by='final_selling_price_amount', " +
    "search='contract_type == \"cos\" and contract_status == \"agreed\" and date_of_contract >= \"2026-01-01\" and date_of_contract < \"2027-01-01\"'. " +
    "Largest active listings: resource='properties', sort_by='list_selling_price_amount', " +
    "search='status == \"available\" and sale_rent == \"for_sale\"'. " +
    "Most recently modified leads: resource='opportunities', sort_by='modified'.",
    TopRecordsSchema.shape,
    async (args) => {
      try {
        const result = await topRecords(args);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_aggregate",
    "Sum / avg / min / max / count of a numeric field across all matching records — " +
    "optionally grouped by another field (top-N buckets). Paginates server-side (cap " +
    "20,000 rows) and computes in-process, which is how to get totals on Qobrix fields " +
    "the API won't sort. Example uses: " +
    "Total 2026 closed-sale volume: resource='contracts', field='final_selling_price_amount', " +
    "op='sum', search='contract_type == \"cos\" and contract_status == \"agreed\" and date_of_contract >= \"2026-01-01\" and date_of_contract < \"2027-01-01\"'. " +
    "Agent leaderboard by volume: same search, group_by='commission_to_2', top=5. " +
    "Average list price by property type: resource='properties', field='list_selling_price_amount', " +
    "op='avg', group_by='property_type', search='status == \"available\"'.",
    AggregateSchema.shape,
    async ({ resource, field, op, search, group_by, top, resolve }) => {
      try {
        const groupDims: string[] | null = group_by == null
          ? null
          : Array.isArray(group_by)
            ? group_by
            : [group_by];

        const scan = await paginateAll({
          resource,
          search,
          fields: groupDims ? ["id", field, ...groupDims] : ["id", field],
          expand: false,
        });

        if (!groupDims) {
          const values: number[] = [];
          for (const row of scan.rows) {
            const n = toNumberOrNull(row[field]);
            if (n != null) values.push(n);
          }
          const stats = computeStats(values, op);
          return formatResult({
            resource,
            field,
            op,
            search: search ?? "(all)",
            total_matched: scan.totalMatched,
            total_scanned: scan.totalScanned,
            n_with_value: values.length,
            capped: scan.capped,
            ...stats,
          });
        }

        // Grouped (single or multi-dim).
        const KEY_SEP = "\u0001"; // unlikely tuple separator
        const buckets = new Map<
          string,
          { keys: string[]; values: number[]; count: number }
        >();
        for (const row of scan.rows) {
          const keys: string[] = [];
          let anyEmpty = false;
          for (const dim of groupDims) {
            const v = row[dim];
            if (v == null || v === "") {
              anyEmpty = true;
              break;
            }
            keys.push(String(v));
          }
          if (anyEmpty) continue;
          const tupleKey = keys.join(KEY_SEP);
          let bucket = buckets.get(tupleKey);
          if (!bucket) {
            bucket = { keys, values: [], count: 0 };
            buckets.set(tupleKey, bucket);
          }
          bucket.count++;
          const n = toNumberOrNull(row[field]);
          if (n != null) bucket.values.push(n);
        }

        const isSingleDim = groupDims.length === 1;
        const bucketRows = [...buckets.values()].map((bucket) => {
          const stats = computeStats(bucket.values, op);
          const base: Record<string, unknown> = {
            n_rows: bucket.count,
            n_with_value: bucket.values.length,
            ...stats,
          };
          if (isSingleDim) {
            base.group_value = bucket.keys[0];
          } else {
            base.group_keys = bucket.keys;
          }
          return base;
        });

        const sortKey = op === "count" ? "count" : op;
        bucketRows.sort((a, b) => {
          const av = a[sortKey] as number | null;
          const bv = b[sortKey] as number | null;
          return (bv ?? -Infinity) - (av ?? -Infinity);
        });

        const limit = top ?? 10;
        const slice = bucketRows.slice(0, limit);

        const dimsWithResolver = groupDims.filter((d) =>
          ALWAYS_RESOLVE_KEYS.has(d)
        );
        const shouldResolve = resolve ?? dimsWithResolver.length > 0;
        if (shouldResolve) {
          for (const b of slice) {
            const keys = isSingleDim
              ? [b.group_value as string]
              : (b.group_keys as string[]);
            const names: unknown[] = [];
            for (let i = 0; i < groupDims.length; i++) {
              const dim = groupDims[i];
              const raw = keys[i];
              names.push(await resolveId(dim, raw));
            }
            if (isSingleDim) {
              if (names[0] != null) b.group_name = names[0];
            } else {
              b.group_names = names;
            }
          }
        }

        return formatResult({
          resource,
          field,
          op,
          group_by: isSingleDim ? groupDims[0] : groupDims,
          search: search ?? "(all)",
          total_matched: scan.totalMatched,
          total_scanned: scan.totalScanned,
          unique_groups: buckets.size,
          capped: scan.capped,
          top: slice,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}

function computeStats(
  values: number[],
  op: "sum" | "avg" | "min" | "max" | "count"
): Record<string, number | null> {
  const count = values.length;
  if (op === "count") {
    return { count };
  }
  if (count === 0) {
    return { sum: 0, avg: null, min: null, max: null, count: 0 };
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const avg = sum / count;
  // Always include the full set so the agent can use whichever it needs.
  return { sum, avg, min, max, count };
}
