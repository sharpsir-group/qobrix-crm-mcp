import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CohortSchema } from "../schemas.js";
import { paginateAll, resolveId } from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CohortKind = "buyers" | "sellers" | "leads";

interface DateWindow {
  fromIso: string;
  toIso: string;
}

function resolveDateWindow(args: {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
}): DateWindow | null {
  if (args.since_days != null) {
    return { fromIso: `DAYS_AGO(${args.since_days})`, toIso: "NOW" };
  }
  if (args.year != null) {
    return {
      fromIso: `"${args.year}-01-01"`,
      toIso: `"${args.year + 1}-01-01"`,
    };
  }
  if (args.from || args.to) {
    return {
      fromIso: args.from ? `"${args.from}"` : "",
      toIso: args.to ? `"${args.to}"` : "",
    };
  }
  return null;
}

function dateClause(field: string, window: DateWindow | null): string | null {
  if (!window) return null;
  const parts: string[] = [];
  if (window.fromIso) parts.push(`${field} >= ${window.fromIso}`);
  if (window.toIso) parts.push(`${field} < ${window.toIso}`);
  return parts.length ? parts.join(" and ") : null;
}

function joinAnd(parts: Array<string | null | undefined>): string | undefined {
  const real = parts.filter((p): p is string => !!p);
  return real.length ? real.join(" and ") : undefined;
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

const CHUNK_SIZE = 50;

/**
 * Fetch a small set of rows by id list, chunked to keep the search expression
 * manageable. Returns a map id -> row.
 */
async function fetchByIds(
  resource: string,
  ids: string[],
  fields: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const list = chunk.map((id) => `"${id}"`).join(",");
    const search = `id in [${list}]`;
    const scan = await paginateAll({ resource, search, fields, expand: false });
    for (const row of scan.rows) {
      const id = row.id;
      if (typeof id === "string") out.set(id, row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core runner
// ---------------------------------------------------------------------------

export interface CohortArgs {
  kind?: CohortKind;
  min_count?: number;
  contract_types?: string[];
  contract_statuses?: string[];
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  top?: number;
}

interface DealRecord {
  ref: unknown;
  date: unknown;
  amount: number | null;
  commission: number | null;
  property_id: string | null;
  contract_id: string | null;
}

interface CohortBucket {
  contact_id: string;
  contact_name: unknown;
  deal_count: number;
  total_volume: number;
  total_commission: number;
  first_deal: unknown;
  last_deal: unknown;
  deals: DealRecord[];
}

export async function runCohort(
  args: CohortArgs
): Promise<Record<string, unknown>> {
  const kind: CohortKind = args.kind ?? "buyers";
  const minCount = Math.max(2, args.min_count ?? 2);
  const top = args.top ?? 20;
  const contractTypes = args.contract_types ?? ["cos"];
  const contractStatuses = args.contract_statuses ?? ["agreed"];

  const window = resolveDateWindow(args);

  if (kind === "leads") {
    // Group opportunities by contact_name in window.
    const dateField = "created";
    const search = joinAnd([dateClause(dateField, window)]);
    const scan = await paginateAll({
      resource: "opportunities",
      search,
      fields: [
        "id",
        "contact_name",
        "status",
        "created",
        "source",
        "enquiry_type",
        "ref",
      ],
      expand: false,
    });

    const byContact = new Map<string, CohortBucket>();
    let withContact = 0;
    for (const opp of scan.rows) {
      const cid = opp.contact_name;
      if (typeof cid !== "string" || !cid) continue;
      withContact++;
      let bucket = byContact.get(cid);
      if (!bucket) {
        bucket = {
          contact_id: cid,
          contact_name: null,
          deal_count: 0,
          total_volume: 0,
          total_commission: 0,
          first_deal: null,
          last_deal: null,
          deals: [],
        };
        byContact.set(cid, bucket);
      }
      bucket.deal_count++;
      const created = opp.created;
      if (typeof created === "string") {
        if (!bucket.first_deal || created < (bucket.first_deal as string)) {
          bucket.first_deal = created;
        }
        if (!bucket.last_deal || created > (bucket.last_deal as string)) {
          bucket.last_deal = created;
        }
      }
      bucket.deals.push({
        ref: opp.ref ?? null,
        date: opp.created ?? null,
        amount: null,
        commission: null,
        property_id: null,
        contract_id: typeof opp.id === "string" ? opp.id : null,
      });
    }

    const repeats = [...byContact.values()].filter(
      (b) => b.deal_count >= minCount
    );
    repeats.sort((a, b) => {
      if (b.deal_count !== a.deal_count) return b.deal_count - a.deal_count;
      return b.total_volume - a.total_volume;
    });
    const slice = repeats.slice(0, top);
    for (const b of slice) {
      const name = await resolveId("contact_name", b.contact_id);
      if (name != null) b.contact_name = name;
    }

    return {
      kind,
      window: {
        year: args.year ?? null,
        from: args.from ?? null,
        to: args.to ?? null,
        since_days: args.since_days ?? null,
      },
      min_count: minCount,
      total_rows_scanned: scan.totalScanned,
      total_with_contact: withContact,
      unique_contacts: byContact.size,
      repeat_contacts: repeats.length,
      cohort: slice,
      capped: scan.capped,
    };
  }

  // buyers + sellers share the contract scan.
  const dateField = "date_of_contract";
  const search = joinAnd([
    `contract_type in [${contractTypes.map((t) => `"${t}"`).join(",")}]`,
    `contract_status in [${contractStatuses.map((s) => `"${s}"`).join(",")}]`,
    dateClause(dateField, window),
  ]);
  const scan = await paginateAll({
    resource: "contracts",
    search,
    fields: [
      "id",
      "opportunity_id",
      "property_id",
      "date_of_contract",
      "final_selling_price_amount",
      "final_rental_price_amount",
      "commission_value_amount",
      "ref",
      "contract_type",
      "contract_status",
    ],
    expand: false,
  });

  // Resolve buyer/seller contact id per contract row.
  let contactByContract = new Map<string, string>();
  if (kind === "buyers") {
    const oppIds = new Set<string>();
    for (const row of scan.rows) {
      const oid = row.opportunity_id;
      if (typeof oid === "string" && oid) oppIds.add(oid);
    }
    const opps = await fetchByIds("opportunities", [...oppIds], [
      "id",
      "contact_name",
    ]);
    for (const row of scan.rows) {
      const oid = row.opportunity_id;
      if (typeof oid !== "string" || !oid) continue;
      const opp = opps.get(oid);
      const cid = opp?.contact_name;
      if (typeof cid === "string" && cid && typeof row.id === "string") {
        contactByContract.set(row.id, cid);
      }
    }
  } else {
    // sellers
    const propIds = new Set<string>();
    for (const row of scan.rows) {
      const pid = row.property_id;
      if (typeof pid === "string" && pid) propIds.add(pid);
    }
    const props = await fetchByIds("properties", [...propIds], [
      "id",
      "seller",
    ]);
    for (const row of scan.rows) {
      const pid = row.property_id;
      if (typeof pid !== "string" || !pid) continue;
      const prop = props.get(pid);
      const cid = prop?.seller;
      if (typeof cid === "string" && cid && typeof row.id === "string") {
        contactByContract.set(row.id, cid);
      }
    }
  }

  const byContact = new Map<string, CohortBucket>();
  let withContact = 0;
  for (const row of scan.rows) {
    const contractId = typeof row.id === "string" ? row.id : null;
    if (!contractId) continue;
    const cid = contactByContract.get(contractId);
    if (!cid) continue;
    withContact++;

    let bucket = byContact.get(cid);
    if (!bucket) {
      bucket = {
        contact_id: cid,
        contact_name: null,
        deal_count: 0,
        total_volume: 0,
        total_commission: 0,
        first_deal: null,
        last_deal: null,
        deals: [],
      };
      byContact.set(cid, bucket);
    }
    bucket.deal_count++;
    const amount =
      toNumberOrNull(row.final_selling_price_amount) ??
      toNumberOrNull(row.final_rental_price_amount);
    if (amount != null) bucket.total_volume += amount;
    const com = toNumberOrNull(row.commission_value_amount);
    if (com != null) bucket.total_commission += com;
    const date = row.date_of_contract;
    if (typeof date === "string") {
      if (!bucket.first_deal || date < (bucket.first_deal as string)) {
        bucket.first_deal = date;
      }
      if (!bucket.last_deal || date > (bucket.last_deal as string)) {
        bucket.last_deal = date;
      }
    }
    bucket.deals.push({
      ref: row.ref ?? null,
      date: row.date_of_contract ?? null,
      amount,
      commission: com,
      property_id: typeof row.property_id === "string" ? row.property_id : null,
      contract_id: contractId,
    });
  }

  const repeats = [...byContact.values()].filter(
    (b) => b.deal_count >= minCount
  );
  repeats.sort((a, b) => {
    if (b.deal_count !== a.deal_count) return b.deal_count - a.deal_count;
    return b.total_volume - a.total_volume;
  });
  const slice = repeats.slice(0, top);
  const resolveKey = kind === "sellers" ? "seller" : "contact_name";
  for (const b of slice) {
    const name = await resolveId(resolveKey, b.contact_id);
    if (name != null) b.contact_name = name;
  }

  return {
    kind,
    window: {
      year: args.year ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      since_days: args.since_days ?? null,
    },
    min_count: minCount,
    contract_types: contractTypes,
    contract_statuses: contractStatuses,
    total_contracts_scanned: scan.totalScanned,
    total_with_contact: withContact,
    unique_contacts: byContact.size,
    repeat_contacts: repeats.length,
    cohort: slice,
    capped: scan.capped,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCustomerTools(server: McpServer): void {
  server.tool(
    "qobrix_cohort",
    "Find contacts that appear on multiple deals or opportunities — the 'repeat customer' " +
    "report every CRM analyst gets asked for. Three modes: 'buyers' (default) walks closed " +
    "contracts → opportunity_id → opportunities.contact_name to identify the buyer behind each " +
    "closed sale. 'sellers' walks contracts → property_id → properties.seller. 'leads' groups " +
    "all opportunities by contact_name regardless of close. Returns each repeat contact with " +
    "deal_count, total_volume, total_commission, first_deal, last_deal, and a deals[] breakdown. " +
    "Example uses: " +
    "2026 repeat buyers: { kind: 'buyers', year: 2026, min_count: 2 }. " +
    "All-time loyal customers: { kind: 'buyers', min_count: 3 }. " +
    "Recurring sellers this year: { kind: 'sellers', year: 2026 }. " +
    "Frequent enquirers (any close): { kind: 'leads', since_days: 365 }.",
    CohortSchema.shape,
    async (args) => {
      try {
        const result = await runCohort(args as CohortArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
