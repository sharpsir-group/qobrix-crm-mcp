import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DaysOnMarketSchema, TimeSeriesSchema } from "../schemas.js";
import {
  ALWAYS_RESOLVE_KEYS,
  paginateAll,
  resolveId,
} from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

type Bucket = "day" | "week" | "month" | "quarter" | "year";
type Metric = "count" | "sum" | "avg" | "min" | "max";

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

const DEFAULT_DATE_FIELD: Record<string, string> = {
  contracts: "date_of_contract",
  opportunities: "created",
  properties: "created",
  contacts: "created",
  agents: "created",
  tasks: "created",
  "property-viewings": "created",
  projects: "created",
  offers: "created",
  calls: "created",
  meetings: "created",
  "email-messages": "created",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseISO(s: string): Date {
  // YYYY-MM-DD or full ISO.
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : new Date(NaN);
}

function startOfWeek(d: Date): Date {
  // ISO week starts Monday.
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = out.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  out.setUTCDate(out.getUTCDate() + offset);
  return out;
}

function bucketStart(d: Date, unit: Bucket): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (unit) {
    case "day":
      return new Date(Date.UTC(y, m, d.getUTCDate()));
    case "week":
      return startOfWeek(d);
    case "month":
      return new Date(Date.UTC(y, m, 1));
    case "quarter":
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(y, 0, 1));
  }
}

function bucketEndExclusive(start: Date, unit: Bucket): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const dt = start.getUTCDate();
  switch (unit) {
    case "day":
      return new Date(Date.UTC(y, m, dt + 1));
    case "week":
      return new Date(Date.UTC(y, m, dt + 7));
    case "month":
      return new Date(Date.UTC(y, m + 1, 1));
    case "quarter":
      return new Date(Date.UTC(y, m + 3, 1));
    case "year":
      return new Date(Date.UTC(y + 1, 0, 1));
  }
}

function bucketLabel(start: Date, unit: Bucket): string {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + 1;
  const dt = start.getUTCDate();
  switch (unit) {
    case "day":
      return isoDate(start);
    case "week":
      return `${isoDate(start)}/W`; // week beginning
    case "month":
      return `${y}-${String(m).padStart(2, "0")}`;
    case "quarter":
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    case "year":
      return `${y}`;
  }
}

function enumerateBuckets(from: Date, to: Date, unit: Bucket): Date[] {
  const buckets: Date[] = [];
  let cur = bucketStart(from, unit);
  while (cur < to) {
    buckets.push(cur);
    cur = bucketEndExclusive(cur, unit);
  }
  return buckets;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface WindowResolved {
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
}

function resolveWindow(args: {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
}): WindowResolved {
  if (args.since_days != null) {
    const now = new Date();
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const from = new Date(to.getTime() - args.since_days * 86400000);
    return { from, to, fromIso: isoDate(from), toIso: isoDate(to) };
  }
  if (args.year != null) {
    const from = new Date(Date.UTC(args.year, 0, 1));
    const to = new Date(Date.UTC(args.year + 1, 0, 1));
    return { from, to, fromIso: isoDate(from), toIso: isoDate(to) };
  }
  if (args.from && args.to) {
    return {
      from: parseISO(args.from),
      to: parseISO(args.to),
      fromIso: args.from,
      toIso: args.to,
    };
  }
  // Sensible default: trailing 365 days.
  const now = new Date();
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = new Date(to.getTime() - 365 * 86400000);
  return { from, to, fromIso: isoDate(from), toIso: isoDate(to) };
}

interface SeriesBucket {
  label: string;
  start: string;
  end: string;
  count: number;
  n_with_value: number;
  value: number | null;
}

interface RunSeriesArgs {
  resource: string;
  bucket: Bucket;
  metric: Metric;
  field?: string;
  dateField: string;
  window: WindowResolved;
  search?: string;
}

async function runSeries(args: RunSeriesArgs): Promise<{
  buckets: SeriesBucket[];
  total_matched: number;
  total_scanned: number;
  capped: boolean;
  effective_search: string;
}> {
  const dateClause =
    `${args.dateField} >= "${args.window.fromIso}" and ` +
    `${args.dateField} < "${args.window.toIso}"`;
  const search = args.search
    ? `${dateClause} and (${args.search})`
    : dateClause;

  const scanFields = args.metric === "count"
    ? ["id", args.dateField]
    : ["id", args.dateField, args.field as string];

  const scan = await paginateAll({
    resource: args.resource,
    search,
    fields: scanFields,
    expand: false,
  });

  // Build empty buckets first so missing periods are explicit zeros.
  const bucketStarts = enumerateBuckets(args.window.from, args.window.to, args.bucket);
  const map = new Map<
    number,
    { start: Date; end: Date; count: number; values: number[] }
  >();
  for (const s of bucketStarts) {
    map.set(s.getTime(), {
      start: s,
      end: bucketEndExclusive(s, args.bucket),
      count: 0,
      values: [],
    });
  }

  for (const row of scan.rows) {
    const raw = row[args.dateField];
    if (typeof raw !== "string") continue;
    const d = parseISO(raw);
    if (Number.isNaN(d.getTime())) continue;
    const bs = bucketStart(d, args.bucket).getTime();
    const slot = map.get(bs);
    if (!slot) continue;
    slot.count++;
    if (args.metric !== "count" && args.field) {
      const v = num(row[args.field]);
      if (v != null) slot.values.push(v);
    }
  }

  const buckets: SeriesBucket[] = bucketStarts.map((s) => {
    const slot = map.get(s.getTime())!;
    let value: number | null;
    if (args.metric === "count") {
      value = slot.count;
    } else if (slot.values.length === 0) {
      value = null;
    } else {
      switch (args.metric) {
        case "sum":
          value = slot.values.reduce((a, b) => a + b, 0);
          break;
        case "avg":
          value =
            slot.values.reduce((a, b) => a + b, 0) / slot.values.length;
          break;
        case "min":
          value = Math.min(...slot.values);
          break;
        case "max":
          value = Math.max(...slot.values);
          break;
      }
    }
    return {
      label: bucketLabel(s, args.bucket),
      start: isoDate(slot.start),
      end: isoDate(slot.end),
      count: slot.count,
      n_with_value: slot.values.length,
      value,
    };
  });

  return {
    buckets,
    total_matched: scan.totalMatched,
    total_scanned: scan.totalScanned,
    capped: scan.capped,
    effective_search: search,
  };
}

// ---------------------------------------------------------------------------
// Core implementation (exported for tests + tool wrapper)
// ---------------------------------------------------------------------------

export interface TimeSeriesArgs {
  resource: string;
  bucket?: Bucket;
  metric?: Metric;
  field?: string;
  date_field?: string;
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  search?: string;
  compare_to_prior?: boolean;
}

export async function runTimeseries(
  args: TimeSeriesArgs
): Promise<Record<string, unknown>> {
  const bucket: Bucket = args.bucket ?? "month";
  const metric: Metric = args.metric ?? "count";
  if (metric !== "count" && !args.field) {
    throw new Error(
      `metric='${metric}' requires a numeric 'field' argument`
    );
  }
  const dateField =
    args.date_field ??
    DEFAULT_DATE_FIELD[args.resource] ??
    "created";
  const window = resolveWindow(args);

  const primary = await runSeries({
    resource: args.resource,
    bucket,
    metric,
    field: args.field,
    dateField,
    window,
    search: args.search,
  });

  const rollUp = (
    buckets: SeriesBucket[]
  ): number | null =>
    buckets.reduce<number | null>((acc, b) => {
      if (metric === "count") {
        return (acc ?? 0) + (b.value as number);
      }
      if (b.value == null) return acc;
      if (acc == null) return b.value;
      if (metric === "min") return Math.min(acc, b.value);
      if (metric === "max") return Math.max(acc, b.value);
      return acc + b.value;
    }, metric === "count" ? 0 : null);

  const total = rollUp(primary.buckets);

  const result: Record<string, unknown> = {
    resource: args.resource,
    bucket,
    metric,
    field: args.field ?? null,
    date_field: dateField,
    window: { from: window.fromIso, to: window.toIso },
    effective_search: primary.effective_search,
    total,
    n_buckets: primary.buckets.length,
    total_matched: primary.total_matched,
    capped: primary.capped,
    buckets: primary.buckets,
  };

  if (args.compare_to_prior) {
    const spanMs = window.to.getTime() - window.from.getTime();
    const priorFrom = new Date(window.from.getTime() - spanMs);
    const priorTo = window.from;
    const priorWindow: WindowResolved = {
      from: priorFrom,
      to: priorTo,
      fromIso: isoDate(priorFrom),
      toIso: isoDate(priorTo),
    };
    const prior = await runSeries({
      resource: args.resource,
      bucket,
      metric,
      field: args.field,
      dateField,
      window: priorWindow,
      search: args.search,
    });
    const priorTotal = rollUp(prior.buckets);
    const yoy =
      typeof total === "number" &&
      typeof priorTotal === "number" &&
      priorTotal !== 0
        ? ((total - priorTotal) / priorTotal) * 100
        : null;
    result.prior = {
      window: { from: priorWindow.fromIso, to: priorWindow.toIso },
      total: priorTotal,
      n_buckets: prior.buckets.length,
      buckets: prior.buckets,
    };
    result.yoy_pct = yoy;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Days on market
// ---------------------------------------------------------------------------

type DomKind = "sold" | "reserved" | "any_closed";
type DomListingField = "listing_date" | "website_listing_date" | "created";
type DomCloseField = "date_of_contract" | "date_of_reservation";

export interface DaysOnMarketArgs {
  kind?: DomKind;
  listing_date_field?: DomListingField;
  close_date_field?: DomCloseField;
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  group_by?: string | string[];
  top?: number;
  include_outliers?: boolean;
}

function kindContractSearch(kind: DomKind): string {
  switch (kind) {
    case "sold":
      return 'contract_type == "cos" and contract_status == "agreed"';
    case "reserved":
      return 'contract_status == "reserved"';
    case "any_closed":
      return 'contract_status in ["agreed","reserved"]';
  }
}

function defaultCloseField(kind: DomKind): DomCloseField {
  return kind === "reserved" ? "date_of_reservation" : "date_of_contract";
}

const CHUNK_IDS = 50;

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

interface DomStats {
  count: number;
  mean_days: number | null;
  median_days: number | null;
  p75_days: number | null;
  p90_days: number | null;
  min_days: number | null;
  max_days: number | null;
}

function statsFor(values: number[]): DomStats {
  if (values.length === 0) {
    return {
      count: 0,
      mean_days: null,
      median_days: null,
      p75_days: null,
      p90_days: null,
      min_days: null,
      max_days: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    mean_days: sum / sorted.length,
    median_days: quantile(sorted, 0.5),
    p75_days: quantile(sorted, 0.75),
    p90_days: quantile(sorted, 0.9),
    min_days: sorted[0],
    max_days: sorted[sorted.length - 1],
  };
}

export async function runDaysOnMarket(
  args: DaysOnMarketArgs
): Promise<Record<string, unknown>> {
  const kind: DomKind = args.kind ?? "sold";
  const listingPref: DomListingField = args.listing_date_field ?? "listing_date";
  const closeField: DomCloseField = args.close_date_field ?? defaultCloseField(kind);
  const top = args.top ?? 10;
  const dims: string[] | null = args.group_by == null
    ? null
    : Array.isArray(args.group_by)
      ? args.group_by
      : [args.group_by];

  // Date window expressed in Qobrix search syntax for the contract scan.
  const winParts: string[] = [];
  if (args.since_days != null) {
    winParts.push(`${closeField} >= DAYS_AGO(${args.since_days})`);
  } else if (args.year != null) {
    winParts.push(`${closeField} >= "${args.year}-01-01"`);
    winParts.push(`${closeField} < "${args.year + 1}-01-01"`);
  } else {
    if (args.from) winParts.push(`${closeField} >= "${args.from}"`);
    if (args.to) winParts.push(`${closeField} < "${args.to}"`);
  }
  const search = [kindContractSearch(kind), ...winParts].join(" and ");

  const contractFields = [
    "id",
    "ref",
    "property_id",
    "date_of_contract",
    "date_of_reservation",
    "final_selling_price_amount",
    "final_rental_price_amount",
    "contract_type",
    "contract_status",
  ];
  const scan = await paginateAll({
    resource: "contracts",
    search,
    fields: contractFields,
    expand: false,
  });

  // Collect unique property IDs.
  const propIds = new Set<string>();
  for (const row of scan.rows) {
    const pid = row.property_id;
    if (typeof pid === "string" && pid) propIds.add(pid);
  }

  // Fetch the property side, chunked.
  const PROP_FIELDS = [
    "id",
    "listing_date",
    "website_listing_date",
    "created",
    "property_type",
    "city",
    "country",
    "agent",
    "name",
    "ref",
  ];
  const propMap = new Map<string, Record<string, unknown>>();
  const ids = [...propIds];
  for (let i = 0; i < ids.length; i += CHUNK_IDS) {
    const chunk = ids.slice(i, i + CHUNK_IDS);
    if (chunk.length === 0) continue;
    const list = chunk.map((id) => `"${id}"`).join(",");
    try {
      const ps = await paginateAll({
        resource: "properties",
        search: `id in [${list}]`,
        fields: PROP_FIELDS,
        expand: false,
      });
      for (const p of ps.rows) {
        const id = p.id;
        if (typeof id === "string") propMap.set(id, p);
      }
    } catch {
      // ignore chunk failure; affected rows will be counted as missing.
    }
  }

  function pickListingDate(prop: Record<string, unknown>): string | null {
    const order: DomListingField[] = [listingPref];
    for (const f of ["listing_date", "website_listing_date", "created"] as DomListingField[]) {
      if (!order.includes(f)) order.push(f);
    }
    for (const f of order) {
      const v = prop[f];
      if (typeof v === "string" && v) return v;
    }
    return null;
  }

  function daysBetween(a: string, b: string): number | null {
    const at = Date.parse(a);
    const bt = Date.parse(b);
    if (!Number.isFinite(at) || !Number.isFinite(bt)) return null;
    return Math.floor((bt - at) / 86400000);
  }

  interface JoinedRow {
    contract_id: string;
    ref: unknown;
    property_id: string | null;
    property_name: unknown;
    close_date: string;
    listing_date: string;
    days: number;
    amount: number | null;
    dims?: string[];
  }

  const rows: JoinedRow[] = [];
  let missingListing = 0;
  let missingProperty = 0;
  let missingCloseDate = 0;

  for (const row of scan.rows) {
    const contractId = typeof row.id === "string" ? row.id : null;
    if (!contractId) continue;
    const closeRaw = row[closeField];
    if (typeof closeRaw !== "string" || !closeRaw) {
      missingCloseDate++;
      continue;
    }
    const pid = row.property_id;
    if (typeof pid !== "string" || !pid) {
      missingProperty++;
      continue;
    }
    const prop = propMap.get(pid);
    if (!prop) {
      missingProperty++;
      continue;
    }
    const listingDate = pickListingDate(prop);
    if (!listingDate) {
      missingListing++;
      continue;
    }
    const days = daysBetween(listingDate, closeRaw);
    if (days == null || days < 0) {
      missingListing++;
      continue;
    }

    let dimVals: string[] | undefined;
    if (dims) {
      const keys: string[] = [];
      let skip = false;
      for (const d of dims) {
        const v = prop[d] ?? row[d];
        if (v == null || v === "") {
          skip = true;
          break;
        }
        keys.push(String(v));
      }
      if (!skip) dimVals = keys;
    }

    const amount =
      (typeof row.final_selling_price_amount === "number"
        ? row.final_selling_price_amount
        : null) ??
      (typeof row.final_rental_price_amount === "number"
        ? row.final_rental_price_amount
        : null);

    rows.push({
      contract_id: contractId,
      ref: row.ref ?? null,
      property_id: pid,
      property_name: prop.name ?? prop.ref ?? null,
      close_date: closeRaw,
      listing_date: listingDate,
      days,
      amount,
      dims: dimVals,
    });
  }

  const overall = statsFor(rows.map((r) => r.days));

  let byGroup:
    | Array<{
        group_value?: string;
        group_keys?: string[];
        group_name?: unknown;
        group_names?: unknown[];
        stats: DomStats;
      }>
    | undefined;
  if (dims) {
    const SEP = "\u0001";
    const buckets = new Map<string, { keys: string[]; values: number[] }>();
    for (const r of rows) {
      if (!r.dims) continue;
      const k = r.dims.join(SEP);
      let b = buckets.get(k);
      if (!b) {
        b = { keys: r.dims, values: [] };
        buckets.set(k, b);
      }
      b.values.push(r.days);
    }
    const isSingle = dims.length === 1;
    const bucketRows = [...buckets.values()].map((b) => {
      const out: {
        group_value?: string;
        group_keys?: string[];
        group_name?: unknown;
        group_names?: unknown[];
        stats: DomStats;
      } = { stats: statsFor(b.values) };
      if (isSingle) out.group_value = b.keys[0];
      else out.group_keys = b.keys;
      return out;
    });
    bucketRows.sort(
      (a, b) => (b.stats.median_days ?? -1) - (a.stats.median_days ?? -1)
    );
    const slice = bucketRows.slice(0, top);

    const dimsWithResolver = dims.filter((d) => ALWAYS_RESOLVE_KEYS.has(d));
    if (dimsWithResolver.length > 0) {
      for (const b of slice) {
        const keys = isSingle
          ? [b.group_value as string]
          : (b.group_keys as string[]);
        const names: unknown[] = [];
        for (let i = 0; i < dims.length; i++) {
          names.push(await resolveId(dims[i], keys[i]));
        }
        if (isSingle) {
          if (names[0] != null) b.group_name = names[0];
        } else {
          b.group_names = names;
        }
      }
    }

    byGroup = slice;
  }

  let outliers:
    | { longest: JoinedRow[]; shortest: JoinedRow[] }
    | undefined;
  if (args.include_outliers && rows.length > 0) {
    const sorted = [...rows].sort((a, b) => a.days - b.days);
    outliers = {
      shortest: sorted.slice(0, 5),
      longest: sorted.slice(-5).reverse(),
    };
  }

  return {
    kind,
    listing_date_field: listingPref,
    close_date_field: closeField,
    window: {
      year: args.year ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      since_days: args.since_days ?? null,
    },
    total_contracts_in_window: scan.totalMatched,
    n_with_listing_date: rows.length,
    n_missing_listing_date: missingListing,
    n_missing_property: missingProperty,
    n_missing_close_date: missingCloseDate,
    overall,
    by_group: byGroup,
    outliers,
    capped: scan.capped,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerReportTools(server: McpServer): void {
  server.tool(
    "qobrix_timeseries",
    "Time-bucketed metric (count / sum / avg / min / max) over any resource. " +
    "Paginates once over the window, buckets in-process by day/week/month/quarter/year " +
    "(default 'month'). Per-resource default date_field: contracts→date_of_contract, " +
    "opportunities/properties/calls/etc.→created. Use search to filter (e.g. only closed sales). " +
    "Set compare_to_prior=true to also fetch the prior identical-length window for YoY %. " +
    "Example uses: " +
    "Monthly 2026 closed-sale volume with YoY: resource='contracts', metric='sum', " +
    "field='final_selling_price_amount', year=2026, " +
    "search='contract_type == \"cos\" and contract_status == \"agreed\"', compare_to_prior=true. " +
    "Weekly lead intake last 90 days: resource='opportunities', bucket='week', metric='count', " +
    "since_days=90. " +
    "Quarterly listing additions 2026: resource='properties', bucket='quarter', year=2026, " +
    "metric='count'.",
    TimeSeriesSchema.shape,
    async (args) => {
      try {
        const result = await runTimeseries(args as TimeSeriesArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_days_on_market",
    "Days-on-market analytics. Joins Contracts to Properties on property_id and computes " +
    "the (close_date - listing_date) duration in days, then aggregates count / mean / median / " +
    "p75 / p90 / min / max. Defaults: kind='sold' (cos + agreed), listing_date_field='listing_date' " +
    "with per-row fallback to website_listing_date then created. Use group_by to break down by " +
    "property_type, city, agent, or commission_to_2 (broker). Set include_outliers=true for the " +
    "5 longest and 5 shortest deals. " +
    "Example uses: " +
    "Overall DOM for 2026 sales: { kind: 'sold', year: 2026 }. " +
    "DOM by property type: { kind: 'sold', year: 2026, group_by: 'property_type' }. " +
    "DOM by city (with outliers): { year: 2026, group_by: 'city', include_outliers: true }. " +
    "Reservation cycle: { kind: 'reserved', year: 2026 }.",
    DaysOnMarketSchema.shape,
    async (args) => {
      try {
        const result = await runDaysOnMarket(args as DaysOnMarketArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
