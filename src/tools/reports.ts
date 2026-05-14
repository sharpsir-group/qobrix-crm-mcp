import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TimeSeriesSchema } from "../schemas.js";
import { paginateAll } from "./analytics.js";
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
}
