import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DealsSchema } from "../schemas.js";
import {
  paginateAll,
  resolveCommonFks,
} from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

// ---------------------------------------------------------------------------
// Defaults & maps
// ---------------------------------------------------------------------------

type Kind = "sale" | "rental" | "listing" | "any_revenue" | "any";
type SortAxis = "price" | "commission" | "date";
type DateField =
  | "date_of_contract"
  | "date_of_reservation"
  | "start_date"
  | "end_date"
  | "created"
  | "modified";

const KIND_TYPES: Record<Kind, string[] | null> = {
  sale: ["cos"],
  rental: ["tenancy_agreement"],
  listing: ["listing_for_sale", "listing_for_rent"],
  any_revenue: ["cos", "tenancy_agreement"],
  any: null,
};

const KIND_DATE_DEFAULT: Record<Kind, DateField> = {
  sale: "date_of_contract",
  rental: "start_date",
  listing: "created",
  any_revenue: "date_of_contract",
  any: "date_of_contract",
};

// Per-kind "natural" price field used for money-window filters and the
// default sort axis.
function priceFieldFor(kind: Kind): "final_selling_price_amount" | "final_rental_price_amount" | null {
  if (kind === "sale") return "final_selling_price_amount";
  if (kind === "rental") return "final_rental_price_amount";
  return null; // mixed / any: coalesce per-row
}

// Extra FK fields specific to deal rows that the analytics resolver wouldn't
// pick up by default.
const DEAL_RESOLVE_KEYS = [
  "name_of_lawyer_related_to_buyer",
  "name_of_lawyer_seller",
  "bank",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quoteList(values: string[]): string {
  return values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(",");
}

function partyValueExpr(raw: string): string {
  // "CURRENT_USER" is a Qobrix special var (unquoted); UUIDs are strings.
  if (raw === "CURRENT_USER") return "CURRENT_USER";
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function dateWindow(args: {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  date_field: DateField;
}): string | null {
  const { year, from, to, since_days, date_field } = args;
  if (since_days != null) {
    return `${date_field} >= DAYS_AGO(${since_days})`;
  }
  if (year != null) {
    const lo = `${year}-01-01`;
    const hi = `${year + 1}-01-01`;
    return `${date_field} >= "${lo}" and ${date_field} < "${hi}"`;
  }
  const parts: string[] = [];
  if (from) parts.push(`${date_field} >= "${from}"`);
  if (to) parts.push(`${date_field} < "${to}"`);
  return parts.length ? parts.join(" and ") : null;
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

function coalescePrice(row: Record<string, unknown>): number | null {
  return (
    num(row.final_selling_price_amount) ?? num(row.final_rental_price_amount)
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// Core implementation (exported for tests + tool wrapper)
// ---------------------------------------------------------------------------

export interface DealsArgs {
  kind?: Kind;
  contract_types?: string[];
  contract_statuses?: string[];
  include_reserved?: boolean;
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  date_field?: DateField;
  min_price?: number;
  max_price?: number;
  assigned_to?: string;
  commission_to?: string;
  commission_to_2?: string;
  agent?: string;
  search?: string;
  by?: SortAxis;
  desc?: boolean;
  top?: number;
}

export async function runDeals(args: DealsArgs): Promise<Record<string, unknown>> {
  const kind: Kind = args.kind ?? "sale";
  const desc = args.desc ?? true;
  const top = args.top ?? 10;
  const sortAxis: SortAxis = args.by ?? "price";

  // Resolve effective filters.
  const contractTypes = args.contract_types ?? KIND_TYPES[kind] ?? null;

  const statusesBase = args.contract_statuses ?? ["agreed"];
  const statusSet = new Set<string>(statusesBase);
  if (args.include_reserved) statusSet.add("reserved");
  const contractStatuses = Array.from(statusSet);

  const dateField: DateField = args.date_field ?? KIND_DATE_DEFAULT[kind];

  const naturalPriceField = priceFieldFor(kind);

  // Build Qobrix search expression.
  const clauses: string[] = [];

  if (contractTypes && contractTypes.length > 0) {
    clauses.push(`contract_type in [${quoteList(contractTypes)}]`);
  }
  if (contractStatuses.length > 0) {
    clauses.push(`contract_status in [${quoteList(contractStatuses)}]`);
  }

  const dw = dateWindow({
    year: args.year,
    from: args.from,
    to: args.to,
    since_days: args.since_days,
    date_field: dateField,
  });
  if (dw) clauses.push(dw);

  // Price window: when kind has a single natural field, use it. Otherwise
  // accept either side of the coalesce (selling OR rental) via an OR.
  if (args.min_price != null || args.max_price != null) {
    if (naturalPriceField) {
      if (args.min_price != null) {
        clauses.push(`${naturalPriceField} >= ${args.min_price}`);
      }
      if (args.max_price != null) {
        clauses.push(`${naturalPriceField} <= ${args.max_price}`);
      }
    } else {
      const orParts: string[] = [];
      for (const f of [
        "final_selling_price_amount",
        "final_rental_price_amount",
      ]) {
        const sub: string[] = [];
        if (args.min_price != null) sub.push(`${f} >= ${args.min_price}`);
        if (args.max_price != null) sub.push(`${f} <= ${args.max_price}`);
        if (sub.length) orParts.push(`(${sub.join(" and ")})`);
      }
      if (orParts.length) clauses.push(`(${orParts.join(" or ")})`);
    }
  }

  // Party filters.
  if (args.assigned_to)
    clauses.push(`assigned_to == ${partyValueExpr(args.assigned_to)}`);
  if (args.commission_to)
    clauses.push(`commission_to == ${partyValueExpr(args.commission_to)}`);
  if (args.commission_to_2)
    clauses.push(`commission_to_2 == ${partyValueExpr(args.commission_to_2)}`);
  if (args.agent && !args.commission_to_2)
    clauses.push(`commission_to_2 == ${partyValueExpr(args.agent)}`);

  if (args.search) clauses.push(`(${args.search})`);

  const search = clauses.length ? clauses.join(" and ") : undefined;

  // Pull the full filtered set so the summary covers all of it, not just
  // the top-N slice.
  const scan = await paginateAll({
    resource: "contracts",
    search,
    expand: false,
  });

  // Build the sort key per row.
  const sortField = (() => {
    if (sortAxis === "commission") return "commission_value_amount";
    if (sortAxis === "date") return dateField;
    // price: use natural field when available; for mixed kinds, coalesce.
    return naturalPriceField; // null → coalesce
  })();

  const keyed: Array<{ row: Record<string, unknown>; key: number }> = [];
  for (const row of scan.rows) {
    let key: number | null;
    if (sortAxis === "date") {
      const v = row[dateField];
      key = typeof v === "string" ? Date.parse(v) : null;
      if (key != null && !Number.isFinite(key)) key = null;
    } else if (sortField) {
      key = num(row[sortField]);
    } else {
      key = coalescePrice(row);
    }
    if (key == null) continue;
    keyed.push({ row, key });
  }

  keyed.sort((a, b) => (desc ? b.key - a.key : a.key - b.key));
  const slice = keyed.slice(0, top);
  const sliceRows = slice.map((x) => x.row);

  await resolveCommonFks(sliceRows, DEAL_RESOLVE_KEYS);

  const dealRows = slice.map(({ row, key }) => {
    const property = row.property as Record<string, unknown> | undefined;
    return {
      id: row.id,
      contract_ref: row.ref ?? null,
      custom_contract_reference_number:
        row.custom_contract_reference_number ?? null,
      contract_type: row.contract_type ?? null,
      contract_status: row.contract_status ?? null,
      date_of_contract: row.date_of_contract ?? null,
      date_of_reservation: row.date_of_reservation ?? null,
      start_date: row.start_date ?? null,
      end_date: row.end_date ?? null,
      final_selling_price_amount: num(row.final_selling_price_amount),
      final_rental_price_amount: num(row.final_rental_price_amount),
      commission_value_amount: num(row.commission_value_amount),
      commission_value_2_amount: num(row.commission_value_2_amount),
      vat_percentage: num(row.vat_percentage),
      mortgage_amount_amount: num(row.mortgage_amount_amount),
      sort_value: key,
      property: property ?? null,
      assigned_to_name: row.assigned_to_resolved ?? null,
      commission_to_name: row.commission_to_resolved ?? null,
      commission_to_2_name: row.commission_to_2_resolved ?? null,
      agent_name: row.agent_resolved ?? null,
      lawyer_buyer_name: row.name_of_lawyer_related_to_buyer_resolved ?? null,
      lawyer_seller_name: row.name_of_lawyer_seller_resolved ?? null,
      bank_name: row.bank_resolved ?? null,
    };
  });

  // Summary over the FULL filtered set (not just the top-N slice).
  const sellingValues: number[] = [];
  const rentalValues: number[] = [];
  const coalescedValues: number[] = [];
  const commissionValues: number[] = [];
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const row of scan.rows) {
    const sell = num(row.final_selling_price_amount);
    const rent = num(row.final_rental_price_amount);
    if (sell != null) sellingValues.push(sell);
    if (rent != null) rentalValues.push(rent);
    const coal = sell ?? rent;
    if (coal != null) coalescedValues.push(coal);
    const com = num(row.commission_value_amount);
    if (com != null) commissionValues.push(com);
    const s = String(row.contract_status ?? "(none)");
    byStatus[s] = (byStatus[s] || 0) + 1;
    const t = String(row.contract_type ?? "(none)");
    byType[t] = (byType[t] || 0) + 1;
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const summary = {
    count: scan.rows.length,
    total_matched: scan.totalMatched,
    total_selling_volume: sum(sellingValues),
    total_rental_volume: sum(rentalValues),
    total_commission: sum(commissionValues),
    avg_price:
      coalescedValues.length > 0
        ? sum(coalescedValues) / coalescedValues.length
        : null,
    median_price: median(coalescedValues),
    by_status: byStatus,
    by_type: byType,
  };

  return {
    effective_filters: {
      kind,
      contract_types: contractTypes,
      contract_statuses: contractStatuses,
      date_field: dateField,
      sort_axis: sortAxis,
      sort_field:
        sortAxis === "date"
          ? dateField
          : sortField ?? "(coalesce selling/rental)",
      desc,
      top,
      search: search ?? "(all)",
    },
    summary,
    deals: dealRows,
    capped: scan.capped,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerDealTools(server: McpServer): void {
  server.tool(
    "qobrix_deals",
    "Flexible 'deals' tool over the Contracts table — covers sales, rentals, listing " +
    "agreements, and pipeline reservations in a single call. " +
    "Defaults: kind='sale', contract_statuses=['agreed'] (so a no-arg call still means " +
    "'closed sale contracts'). Every default is overridable via kind / contract_types / " +
    "contract_statuses / include_reserved / date_field / min_price / max_price / party " +
    "filters / raw search. Sorts in-process (Qobrix's `sort` is silently ignored on " +
    "final_*_price_amount) and resolves property_id, agent, commission_to, lawyers, bank, " +
    "etc. to readable names. Example uses: " +
    "Best 2026 closed sales: { year: 2026, top: 5 }. " +
    "Best 2026 rentals: { kind: 'rental', year: 2026, top: 5 }. " +
    "Under-contract pipeline value: { contract_statuses: ['reserved'], year: 2026 }. " +
    "My deals: { assigned_to: 'CURRENT_USER', year: 2026 }. " +
    "All revenue deals >€1M last 90 days: { kind: 'any_revenue', since_days: 90, min_price: 1000000 }. " +
    "Agent leaderboard (by commission): { year: 2026, by: 'commission', top: 10 }.",
    DealsSchema.shape,
    async (args) => {
      try {
        const result = await runDeals(args as DealsArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
