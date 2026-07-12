import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RepScorecardSchema } from "../schemas.js";
import { paginateAll, resolveId } from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

type SortAxis =
  | "volume"
  | "commission"
  | "deals_closed"
  | "activities"
  | "viewings";

// Per-resource user-FK field (mirrors pipeline.ts USER_FIELD).
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

interface UserBucket {
  user: string;
  user_name: string | null;
  calls: number;
  meetings: number;
  emails: number;
  tasks: number;
  viewings_set: number;
  opportunities_owned: number;
  deals_closed: number;
  total_volume: number;
  total_commission: number;
}

function buildWindow(args: {
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
}): { fromIso: string; toIso: string } | null {
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

function dateClause(
  field: string,
  window: { fromIso: string; toIso: string } | null
): string | null {
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

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function getOrCreate(map: Map<string, UserBucket>, user: string): UserBucket {
  let b = map.get(user);
  if (!b) {
    b = {
      user,
      user_name: null,
      calls: 0,
      meetings: 0,
      emails: 0,
      tasks: 0,
      viewings_set: 0,
      opportunities_owned: 0,
      deals_closed: 0,
      total_volume: 0,
      total_commission: 0,
    };
    map.set(user, b);
  }
  return b;
}

export interface RepScorecardArgs {
  user?: string;
  top?: number;
  sort_by?: SortAxis;
  year?: number;
  from?: string;
  to?: string;
  since_days?: number;
}

export async function runRepScorecard(
  args: RepScorecardArgs
): Promise<Record<string, unknown>> {
  const window = buildWindow(args);
  const top = args.top ?? 10;
  const sortAxis: SortAxis = args.sort_by ?? "volume";
  const userFilter = args.user
    ? args.user === "CURRENT_USER"
      ? null
      : args.user
    : null;
  const usingCurrentUser = args.user === "CURRENT_USER";

  const buckets = new Map<string, UserBucket>();

  function userScope(resource: string): string | null {
    const field = userFieldFor(resource);
    if (userFilter) return `${field} == ${partyValueExpr(userFilter)}`;
    if (usingCurrentUser) return `${field} == CURRENT_USER`;
    return null;
  }

  // For each activity-style resource we count rows per its user field.
  const activityResources = [
    { resource: "calls", date: "created", key: "calls" as const },
    { resource: "meetings", date: "created", key: "meetings" as const },
    { resource: "email-messages", date: "created", key: "emails" as const },
    { resource: "tasks", date: "created", key: "tasks" as const },
    {
      resource: "property-viewings",
      date: "created",
      key: "viewings_set" as const,
    },
  ];

  for (const r of activityResources) {
    const field = userFieldFor(r.resource);
    const parts = [dateClause(r.date, window), userScope(r.resource)];
    const search = parts.filter(Boolean).join(" and ") || undefined;

    let rows: Array<Record<string, unknown>>;
    try {
      const scan = await paginateAll({
        resource: r.resource,
        search,
        fields: ["id", field],
        expand: false,
      });
      rows = scan.rows;
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const u = row[field];
      if (typeof u !== "string" || !u) continue;
      const b = getOrCreate(buckets, u);
      b[r.key]++;
    }
  }

  // Opportunities created in window, bucketed by owner.
  {
    const field = userFieldFor("opportunities");
    const parts = [dateClause("created", window), userScope("opportunities")];
    const search = parts.filter(Boolean).join(" and ") || undefined;
    try {
      const scan = await paginateAll({
        resource: "opportunities",
        search,
        fields: ["id", field],
        expand: false,
      });
      for (const row of scan.rows) {
        const u = row[field];
        if (typeof u !== "string" || !u) continue;
        getOrCreate(buckets, u).opportunities_owned++;
      }
    } catch {
      // ignore: some tenants disable opps for the API user
    }
  }

  // Closed deals (contracts with cos + agreed) in window, bucketed by assigned_to.
  {
    const field = userFieldFor("contracts");
    const parts = [
      'contract_type == "cos"',
      'contract_status == "agreed"',
      dateClause("date_of_contract", window),
      userScope("contracts"),
    ];
    const search = parts.filter(Boolean).join(" and ");
    try {
      const scan = await paginateAll({
        resource: "contracts",
        search,
        fields: [
          "id",
          field,
          "final_selling_price_amount",
          "commission_value_amount",
        ],
        expand: false,
      });
      for (const row of scan.rows) {
        const u = row[field];
        if (typeof u !== "string" || !u) continue;
        const b = getOrCreate(buckets, u);
        b.deals_closed++;
        const price = num(row.final_selling_price_amount);
        if (price != null) b.total_volume += price;
        const com = num(row.commission_value_amount);
        if (com != null) b.total_commission += com;
      }
    } catch {
      // ignore
    }
  }

  let rows = [...buckets.values()];

  if (userFilter) {
    rows = rows.filter((r) => r.user === userFilter);
  }

  rows.sort((a, b) => {
    switch (sortAxis) {
      case "commission":
        return b.total_commission - a.total_commission;
      case "deals_closed":
        return b.deals_closed - a.deals_closed;
      case "activities":
        return (
          b.calls + b.meetings + b.emails + b.tasks -
          (a.calls + a.meetings + a.emails + a.tasks)
        );
      case "viewings":
        return b.viewings_set - a.viewings_set;
      case "volume":
      default:
        return b.total_volume - a.total_volume;
    }
  });

  if (!userFilter) rows = rows.slice(0, top);

  for (const r of rows) {
    const name = await resolveId("assigned_to", r.user);
    if (typeof name === "string") r.user_name = name;
  }

  return {
    mode: userFilter || usingCurrentUser ? "single_user" : "leaderboard",
    sort_by: sortAxis,
    window: {
      year: args.year ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      since_days: args.since_days ?? null,
    },
    user_filter: args.user ?? null,
    n_users: buckets.size,
    rows,
  };
}

export function registerProductivityTools(server: McpServer): void {
  server.tool(
    "qobrix_rep_scorecard",
    "Per-rep productivity roll-up. One call returns a wide row for a single user or a " +
    "top-N leaderboard (default). Counts calls/meetings/emails/tasks/viewings/opportunities " +
    "and deals closed; sums total_volume + total_commission from closed contracts. " +
    "Bucketed by assigned_to across every resource. " +
    "Example uses: " +
    "Leaderboard 2026 by volume: { year: 2026 }. " +
    "My scorecard last 30 days: { user: 'CURRENT_USER', since_days: 30 }. " +
    "Top 5 by activities this quarter: { from: '2026-01-01', to: '2026-04-01', sort_by: 'activities', top: 5 }.",
    RepScorecardSchema.shape,
    async (args) => {
      try {
        const result = await runRepScorecard(args as RepScorecardArgs);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
