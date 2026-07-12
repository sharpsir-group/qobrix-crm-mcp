import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  FunnelSchema,
  StaleLeadsSchema,
  WinLossSchema,
} from "../schemas.js";
import {
  ALWAYS_RESOLVE_KEYS,
  paginateAll,
  resolveId,
} from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

// ---------------------------------------------------------------------------
// Per-resource user-FK mapping
// ---------------------------------------------------------------------------
//
// Different Qobrix resources use different field names for the "owning user":
//   - calls, meetings, tasks, contracts → assigned_to
//   - email-messages, opportunities    → owner
//   - property-viewings, offers        → no user field, fall back to created_by
//
// Keep this in sync with rep_scorecard's mapping.

const USER_FIELD: Record<string, string> = {
  calls: "assigned_to",
  meetings: "assigned_to",
  tasks: "assigned_to",
  "email-messages": "owner",
  contracts: "assigned_to",
  opportunities: "owner",
  "property-viewings": "created_by",
  offers: "created_by",
};

function userFieldFor(resource: string): string {
  return USER_FIELD[resource] ?? "assigned_to";
}

// ---------------------------------------------------------------------------
// Shared date-window helpers
// ---------------------------------------------------------------------------

interface DateWindow {
  fromIso: string;
  toIso: string;
}

function resolveWindow(args: {
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

function partyValueExpr(raw: string): string {
  if (raw === "CURRENT_USER") return "CURRENT_USER";
  return `"${raw.replace(/"/g, '\\"')}"`;
}

function joinAnd(clauses: Array<string | null | undefined>): string | undefined {
  const real = clauses.filter((c): c is string => !!c);
  return real.length ? real.join(" and ") : undefined;
}

async function countOnly(resource: string, search?: string): Promise<number> {
  const res = await getClient().list(resource, {
    search,
    limit: 1,
    fields: ["id"],
    expand: false,
  });
  return res.pagination.count;
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

const FUNNEL_STAGES = [
  "leads",
  "qualified",
  "viewing",
  "offer",
  "reserved",
  "closed",
] as const;
type StageName = (typeof FUNNEL_STAGES)[number];

interface StageDef {
  name: StageName;
  resource: string;
  date_field: string;
  base_search: (party: { assigned_to?: string; agent?: string }) => string | null;
}

function userClause(resource: string, user: string | undefined): string | null {
  if (!user) return null;
  return `${userFieldFor(resource)} == ${partyValueExpr(user)}`;
}

const STAGES: StageDef[] = [
  {
    name: "leads",
    resource: "opportunities",
    date_field: "created",
    base_search: ({ assigned_to, agent }) => {
      const parts: string[] = [];
      const u = userClause("opportunities", assigned_to);
      if (u) parts.push(u);
      if (agent) parts.push(`agent == ${partyValueExpr(agent)}`);
      return parts.length ? parts.join(" and ") : null;
    },
  },
  {
    name: "qualified",
    resource: "opportunities",
    date_field: "created",
    base_search: ({ assigned_to, agent }) => {
      const parts = ['status in ["open","won"]'];
      const u = userClause("opportunities", assigned_to);
      if (u) parts.push(u);
      if (agent) parts.push(`agent == ${partyValueExpr(agent)}`);
      return parts.join(" and ");
    },
  },
  {
    name: "viewing",
    resource: "property-viewings",
    date_field: "created",
    base_search: ({ assigned_to }) => {
      // No assignment field on viewings; created_by is the only user proxy.
      return userClause("property-viewings", assigned_to);
    },
  },
  {
    name: "offer",
    resource: "offers",
    date_field: "created",
    base_search: ({ assigned_to }) => {
      return userClause("offers", assigned_to);
    },
  },
  {
    name: "reserved",
    resource: "contracts",
    date_field: "date_of_reservation",
    base_search: ({ assigned_to, agent }) => {
      const parts = ['contract_status == "reserved"'];
      const u = userClause("contracts", assigned_to);
      if (u) parts.push(u);
      if (agent) parts.push(`commission_to_2 == ${partyValueExpr(agent)}`);
      return parts.join(" and ");
    },
  },
  {
    name: "closed",
    resource: "contracts",
    date_field: "date_of_contract",
    base_search: ({ assigned_to, agent }) => {
      const parts = ['contract_type == "cos"', 'contract_status == "agreed"'];
      const u = userClause("contracts", assigned_to);
      if (u) parts.push(u);
      if (agent) parts.push(`commission_to_2 == ${partyValueExpr(agent)}`);
      return parts.join(" and ");
    },
  },
];

// ---------------------------------------------------------------------------
// Stale leads helpers
// ---------------------------------------------------------------------------

const ACTIVITY_RESOURCES = [
  "calls",
  "meetings",
  "email-messages",
  "tasks",
] as const;

/**
 * Best-effort extraction of the linked opportunity UUID from an activity row.
 * Field naming varies slightly across resources, so we look at every
 * known shape and return the first non-empty value.
 */
function extractRelatedOpportunityId(row: Record<string, unknown>): string | null {
  const candidates = [
    "related_opportunity",
    "related_opportunity_id",
    "opportunity_id",
    "opportunity",
  ];
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (v && typeof v === "object") {
      const id = (v as Record<string, unknown>).id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core implementations (exported for tests + tool wrappers)
// ---------------------------------------------------------------------------

export interface FunnelArgs {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  assigned_to?: string;
  agent?: string;
  stage_overrides?: Record<string, string>;
}

export async function runFunnel(
  args: FunnelArgs
): Promise<Record<string, unknown>> {
  const window = resolveWindow(args) ?? {
    fromIso: '"1970-01-01"',
    toIso: '"9999-01-01"',
  };
  const party = { assigned_to: args.assigned_to, agent: args.agent };
  const overrides = args.stage_overrides ?? {};

  const stages: Array<{
    name: StageName;
    count: number;
    resource: string;
    search: string | undefined;
    conv_from_prev_pct: number | null;
    conv_from_top_pct: number | null;
  }> = [];

  for (const stage of STAGES) {
    const stageOverride = overrides[stage.name];
    let search: string | undefined;
    if (stageOverride) {
      const date = dateClause(stage.date_field, window);
      search = joinAnd([date, `(${stageOverride})`]);
    } else {
      const date = dateClause(stage.date_field, window);
      const base = stage.base_search(party);
      search = joinAnd([base, date]);
    }
    const count = await countOnly(stage.resource, search);
    stages.push({
      name: stage.name,
      count,
      resource: stage.resource,
      search,
      conv_from_prev_pct: null,
      conv_from_top_pct: null,
    });
  }

  const top = stages[0].count;
  for (let i = 0; i < stages.length; i++) {
    if (i > 0) {
      const prev = stages[i - 1].count;
      stages[i].conv_from_prev_pct =
        prev > 0 ? (stages[i].count / prev) * 100 : null;
    }
    stages[i].conv_from_top_pct =
      top > 0 ? (stages[i].count / top) * 100 : null;
  }

  return {
    window: {
      from: args.from,
      to: args.to,
      year: args.year,
      since_days: args.since_days,
    },
    effective_filters: {
      assigned_to: args.assigned_to ?? null,
      agent: args.agent ?? null,
      stage_overrides: Object.keys(overrides),
    },
    stages,
  };
}

export interface StaleLeadsArgs {
  since_days?: number;
  statuses?: string[];
  assigned_to?: string;
  top?: number;
}

export async function runStaleLeads(
  args: StaleLeadsArgs
): Promise<Record<string, unknown>> {
  const since = args.since_days ?? 30;
  const statuses = args.statuses ?? ["new", "open"];
  const top = args.top ?? 50;

  const activitySearch = `created >= DAYS_AGO(${since})`;
  const recent = new Set<string>();
  for (const resource of ACTIVITY_RESOURCES) {
    let rows: Array<Record<string, unknown>>;
    try {
      const scan = await paginateAll({
        resource,
        search: activitySearch,
        fields: ["id", "related_opportunity"],
        expand: false,
      });
      rows = scan.rows;
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const oppId = extractRelatedOpportunityId(row);
      if (oppId) recent.add(oppId);
    }
  }

  const oppOwnerField = userFieldFor("opportunities");
  const oppParts: string[] = [
    `status in [${statuses.map((s) => `"${s}"`).join(",")}]`,
  ];
  if (args.assigned_to) {
    oppParts.push(
      `${oppOwnerField} == ${partyValueExpr(args.assigned_to)}`
    );
  }
  const oppSearch = oppParts.join(" and ");

  const oppScan = await paginateAll({
    resource: "opportunities",
    search: oppSearch,
    fields: [
      "id",
      "contact_name",
      oppOwnerField,
      "agent",
      "created",
      "modified",
      "source",
      "status",
      "enquiry_type",
    ],
    expand: false,
  });

  const cutoffMs = Date.now() - since * 86400000;
  const stale: Array<Record<string, unknown>> = [];
  for (const opp of oppScan.rows) {
    const id = String(opp.id ?? "");
    if (!id) continue;
    if (recent.has(id)) continue;
    const modifiedRaw = opp.modified;
    const modifiedMs =
      typeof modifiedRaw === "string" ? Date.parse(modifiedRaw) : NaN;
    if (Number.isFinite(modifiedMs) && modifiedMs >= cutoffMs) continue;
    stale.push(opp);
  }

  stale.sort((a, b) => {
    const am = typeof a.modified === "string" ? Date.parse(a.modified) : 0;
    const bm = typeof b.modified === "string" ? Date.parse(b.modified) : 0;
    return am - bm;
  });

  const slice = stale.slice(0, top);
  for (const opp of slice) {
    const contactId = opp.contact_name;
    if (typeof contactId === "string" && contactId) {
      const name = await resolveId("contact_name", contactId);
      if (name) opp.contact_name_resolved = name;
    }
    const owner = opp[oppOwnerField];
    if (typeof owner === "string" && owner) {
      const name = await resolveId(oppOwnerField, owner);
      if (name) opp[`${oppOwnerField}_resolved`] = name;
    }
  }

  return {
    threshold_days: since,
    statuses,
    assigned_to: args.assigned_to ?? null,
    total_open: oppScan.totalMatched,
    total_stale: stale.length,
    recent_activity_opportunities: recent.size,
    stale: slice,
  };
}

// ---------------------------------------------------------------------------
// Win / Loss analytics
// ---------------------------------------------------------------------------

export interface WinLossArgs {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
  group_by?: string | string[];
  assigned_to?: string;
  agent?: string;
  top?: number;
  include_top_losses?: boolean;
}

interface WinLossTotals {
  new: number;
  open: number;
  won: number;
  closed_lost: number;
  other: number;
  win_rate_pct: number | null;
  loss_rate_pct: number | null;
}

function emptyTotals(): WinLossTotals {
  return {
    new: 0,
    open: 0,
    won: 0,
    closed_lost: 0,
    other: 0,
    win_rate_pct: null,
    loss_rate_pct: null,
  };
}

function finalizeTotals(t: WinLossTotals): WinLossTotals {
  const decided = t.won + t.closed_lost;
  if (decided > 0) {
    t.win_rate_pct = (t.won / decided) * 100;
    t.loss_rate_pct = (t.closed_lost / decided) * 100;
  }
  return t;
}

export async function runWinLoss(
  args: WinLossArgs
): Promise<Record<string, unknown>> {
  const top = args.top ?? 10;
  const dims: string[] | null = args.group_by == null
    ? null
    : Array.isArray(args.group_by)
      ? args.group_by
      : [args.group_by];

  // Window applied to last_status_change (preferred) OR modified for rows
  // that never had a status change.
  const window = resolveWindow(args) ?? null;
  const windowClauses: string[] = [];
  if (window?.fromIso) {
    windowClauses.push(
      `(last_status_change >= ${window.fromIso} or ` +
      `(last_status_change == null and modified >= ${window.fromIso}))`
    );
  }
  if (window?.toIso) {
    windowClauses.push(
      `(last_status_change < ${window.toIso} or ` +
      `(last_status_change == null and modified < ${window.toIso}))`
    );
  }
  const scopeClauses: string[] = [];
  if (args.assigned_to) {
    scopeClauses.push(
      `${userFieldFor("opportunities")} == ${partyValueExpr(args.assigned_to)}`
    );
  }
  if (args.agent) {
    scopeClauses.push(`agent == ${partyValueExpr(args.agent)}`);
  }
  const search = joinAnd([...windowClauses, ...scopeClauses]);

  const baseFields = [
    "id",
    "status",
    "source",
    "enquiry_type",
    "owner",
    "agent",
    "closed_lost_reason_id",
    "closed_lost_details",
    "last_status_change",
    "modified",
    "created",
    "contact_name",
  ];
  const allFields = dims
    ? Array.from(new Set([...baseFields, ...dims]))
    : baseFields;

  const scan = await paginateAll({
    resource: "opportunities",
    search,
    fields: allFields,
    expand: false,
  });

  const totals = emptyTotals();
  const grouped = new Map<
    string,
    { keys: string[]; totals: WinLossTotals }
  >();
  const KEY_SEP = "\u0001";

  for (const row of scan.rows) {
    const status = String(row.status ?? "other");
    if (status === "new") totals.new++;
    else if (status === "open") totals.open++;
    else if (status === "won") totals.won++;
    else if (status === "closed_lost") totals.closed_lost++;
    else totals.other++;

    if (!dims) continue;

    const keys: string[] = [];
    let skip = false;
    for (const d of dims) {
      const v = row[d];
      if (v == null || v === "") {
        skip = true;
        break;
      }
      keys.push(String(v));
    }
    if (skip) continue;
    const tuple = keys.join(KEY_SEP);
    let bucket = grouped.get(tuple);
    if (!bucket) {
      bucket = { keys, totals: emptyTotals() };
      grouped.set(tuple, bucket);
    }
    if (status === "new") bucket.totals.new++;
    else if (status === "open") bucket.totals.open++;
    else if (status === "won") bucket.totals.won++;
    else if (status === "closed_lost") bucket.totals.closed_lost++;
    else bucket.totals.other++;
  }

  finalizeTotals(totals);

  let groupRows:
    | Array<{
        group_value?: string;
        group_keys?: string[];
        group_name?: unknown;
        group_names?: unknown[];
        decided: number;
        new: number;
        open: number;
        won: number;
        closed_lost: number;
        other: number;
        win_rate_pct: number | null;
        loss_rate_pct: number | null;
      }>
    | undefined;
  if (dims) {
    const isSingle = dims.length === 1;
    const buckets = [...grouped.values()].map((b) => {
      finalizeTotals(b.totals);
      const decided = b.totals.won + b.totals.closed_lost;
      const out: {
        group_value?: string;
        group_keys?: string[];
        group_name?: unknown;
        group_names?: unknown[];
        decided: number;
        new: number;
        open: number;
        won: number;
        closed_lost: number;
        other: number;
        win_rate_pct: number | null;
        loss_rate_pct: number | null;
      } = {
        decided,
        new: b.totals.new,
        open: b.totals.open,
        won: b.totals.won,
        closed_lost: b.totals.closed_lost,
        other: b.totals.other,
        win_rate_pct: b.totals.win_rate_pct,
        loss_rate_pct: b.totals.loss_rate_pct,
      };
      if (isSingle) out.group_value = b.keys[0];
      else out.group_keys = b.keys;
      return out;
    });

    buckets.sort((a, b) => {
      if (b.decided !== a.decided) return b.decided - a.decided;
      const aw = a.win_rate_pct ?? -1;
      const bw = b.win_rate_pct ?? -1;
      return bw - aw;
    });

    const slice = buckets.slice(0, top);

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

    groupRows = slice;
  }

  // Optional top-N recent losses with resolved details.
  let topLosses:
    | Array<Record<string, unknown>>
    | undefined;
  if (args.include_top_losses) {
    const losses = scan.rows
      .filter((r) => r.status === "closed_lost")
      .sort((a, b) => {
        const ak = (a.last_status_change ?? a.modified) as string | undefined;
        const bk = (b.last_status_change ?? b.modified) as string | undefined;
        return String(bk ?? "").localeCompare(String(ak ?? ""));
      })
      .slice(0, 10);
    for (const r of losses) {
      const cid = r.contact_name;
      if (typeof cid === "string" && cid) {
        const name = await resolveId("contact_name", cid);
        if (name != null) r.contact_name_resolved = name;
      }
      const reason = r.closed_lost_reason_id;
      if (typeof reason === "string" && reason) {
        const label = await resolveId("closed_lost_reason_id", reason);
        if (label != null) r.closed_lost_reason_label = label;
      }
    }
    topLosses = losses;
  }

  return {
    window: {
      year: args.year ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      since_days: args.since_days ?? null,
    },
    scope: {
      assigned_to: args.assigned_to ?? null,
      agent: args.agent ?? null,
    },
    group_by: dims ?? null,
    total_matched: scan.totalMatched,
    total_scanned: scan.totalScanned,
    totals,
    top_buckets: groupRows,
    top_losses: topLosses,
    capped: scan.capped,
  };
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerPipelineTools(server: McpServer): void {
  server.tool(
    "qobrix_funnel",
    "Canonical sales funnel in one call. Six stages with conversion %: " +
    "Leads (opportunities created in window) → Qualified (status in [open,won]) → " +
    "Viewing (property-viewings created in window) → Offer (offers created in window) → " +
    "Reserved (contracts with contract_status=reserved) → Closed (contracts cos + agreed). " +
    "Each stage is scoped by the same date window and (optional) assigned_to / agent. " +
    "Use stage_overrides to substitute a tenant-specific definition for any stage. " +
    "Example uses: " +
    "2026 funnel: { year: 2026 }. " +
    "My funnel last 90 days: { assigned_to: 'CURRENT_USER', since_days: 90 }. " +
    "Agent Vera's funnel: { agent: '<agent-uuid>', year: 2026 }.",
    FunnelSchema.shape,
    async (args) => {
      try {
        const result = await runFunnel(args as FunnelArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_win_loss",
    "Win-rate analytics over opportunities. Globally returns counts of new / open / won / " +
    "closed_lost plus win_rate_pct = won / (won + closed_lost). Optional group_by slices by " +
    "source, enquiry_type, owner, agent, or closed_lost_reason_id (multi-dim arrays supported). " +
    "Window applied to last_status_change (fallback modified). Set include_top_losses=true to " +
    "also receive the 10 most-recent closed_lost opportunities with reason labels and details. " +
    "Example uses: " +
    "Overall 2026 win rate: { year: 2026 }. " +
    "Win rate by lead source: { year: 2026, group_by: 'source' }. " +
    "Top loss reasons last 90 days: { since_days: 90, group_by: 'closed_lost_reason_id' }. " +
    "My win rate: { assigned_to: 'CURRENT_USER', year: 2026 }. " +
    "Forensic loss review: { year: 2026, include_top_losses: true }.",
    WinLossSchema.shape,
    async (args) => {
      try {
        const result = await runWinLoss(args as WinLossArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_stale_leads",
    "Find live opportunities (default status in [new,open]) that have no recent activity. " +
    "An opportunity is 'stale' when no call/meeting/email/task touched it within since_days " +
    "AND the opportunity itself wasn't modified within that window. Sorted oldest-modified first. " +
    "Example uses: " +
    "Silent leads (default, 30d): {}. " +
    "Aggressive cadence: { since_days: 7 }. " +
    "My silent leads: { assigned_to: 'CURRENT_USER' }.",
    StaleLeadsSchema.shape,
    async (args) => {
      try {
        const result = await runStaleLeads(args as StaleLeadsArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
