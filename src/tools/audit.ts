import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import type { LogAuditEntry, QobrixPaginatedResponse } from "../types.js";
import {
  FieldChangeHistorySchema,
  GetChangesSchema,
  SearchChangesSchema,
  TopFieldChangersSchema,
} from "../schemas.js";
import { resolveId } from "./analytics.js";
import { errorResult, formatResult } from "./index.js";

const PAGE_SIZE = 100;
const DEFAULT_FIELD_HISTORY_PAGES = 10;
const DEFAULT_TOP_CHANGERS_PAGES = 50;

const RESOURCE_ALIASES: Record<string, string> = {
  Opportunities: "opportunities",
  Properties: "properties",
  Contacts: "contacts",
  Agents: "agents",
  Tasks: "tasks",
  PropertyViewings: "property-viewings",
  Projects: "projects",
  Offers: "offers",
  Contracts: "contracts",
  Calls: "calls",
  Meetings: "meetings",
  EmailMessages: "email-messages",
  Media: "media",
  PropertyTypes: "property-types",
  PropertySubtypes: "property-subtypes",
  PropertyFeatures: "property-features",
  Locations: "locations",
  Campaigns: "campaigns",
  Users: "users",
};

/** PascalCase resource label or kebab slug → API path segment */
export function toResourceSlug(name: string): string {
  const trimmed = name.trim();
  if (RESOURCE_ALIASES[trimmed]) return RESOURCE_ALIASES[trimmed];
  if (trimmed.includes("-")) return trimmed.toLowerCase();
  if (trimmed === trimmed.toLowerCase()) return trimmed;
  return trimmed.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function entryTouchesField(entry: LogAuditEntry, field: string): boolean {
  const orig = entry.original ?? {};
  const chg = entry.changed ?? {};
  return field in orig || field in chg;
}

function fieldDelta(
  entry: LogAuditEntry,
  field: string
): { before: unknown; after: unknown } {
  const orig = entry.original ?? {};
  const chg = entry.changed ?? {};
  return {
    before: field in orig ? orig[field] : null,
    after: field in chg ? chg[field] : null,
  };
}

function buildTimestampSearch(since?: string, until?: string): string | undefined {
  const parts: string[] = [];
  if (since) {
    const s = since.trim();
    parts.push(
      s.includes("timestamp") || s.includes(" and ") || s.includes(" or ")
        ? s
        : `timestamp >= ${s}`
    );
  }
  if (until) {
    const u = until.trim();
    parts.push(
      u.includes("timestamp") || u.includes(" and ") || u.includes(" or ")
        ? u
        : `timestamp <= ${u}`
    );
  }
  if (parts.length === 0) return undefined;
  return parts.join(" and ");
}

async function fetchAllChanges(
  fetchPage: (page: number) => Promise<QobrixPaginatedResponse>,
  maxPages: number
): Promise<{ rows: LogAuditEntry[]; pages_fetched: number; truncated: boolean }> {
  const rows: LogAuditEntry[] = [];
  let truncated = false;

  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(page);
    const batch = (result.data ?? []) as unknown as LogAuditEntry[];
    rows.push(...batch);

    const pag = result.pagination;
    if (!pag?.has_next_page || batch.length === 0) {
      return { rows, pages_fetched: page, truncated: false };
    }
    if (page === maxPages) {
      truncated = true;
    }
  }

  return { rows, pages_fetched: maxPages, truncated };
}

async function resolveUserLabel(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const label = await resolveId("owner", userId);
  if (typeof label === "string") return label;
  return userId;
}

export function registerAuditTools(server: McpServer): void {
  server.tool(
    "qobrix_get_changes",
    "Retrieve audit / change-log entries for a single CRM record (Qobrix LogAudit). " +
      "Calls GET /api/v2/{resource}/{id}/changes. Each row has original (before), changed (after), " +
      "user_id (who), timestamp, type (create/update/delete). " +
      "IMPORTANT: LogAudit.source is the resource name (e.g. 'Opportunities'), NOT the lead marketing source field. " +
      "Field-level before/after for e.g. lead source are keys inside original and changed objects. " +
      "For a filtered timeline of one field use qobrix_field_change_history.",
    GetChangesSchema.shape,
    async ({ resource, id, search, fields, sort, limit, page }) => {
      try {
        const slug = toResourceSlug(resource);
        const client = getClient();
        const result = await client.requestFresh<QobrixPaginatedResponse>(
          `${slug}/${id}/changes`,
          {
            search,
            limit: limit ?? 10,
            page: page ?? 1,
            ...(fields ? { fields } : {}),
            ...(sort !== undefined ? { sort } : {}),
          }
        );
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_changes",
    "Search tenant-wide audit log for a CRM resource (Qobrix LogAudit). " +
      "Calls GET /api/v2/{resource}/changes. Use to find who changed what across all records. " +
      "Search examples: timestamp >= DAYS_AGO(30), user_id == \"<uuid>\", primary_key == \"<record-uuid>\". " +
      "Pair with qobrix_top_field_changers for leaderboards or qobrix_field_change_history for one record.",
    SearchChangesSchema.shape,
    async ({ resource, search, fields, sort, limit, page }) => {
      try {
        const slug = toResourceSlug(resource);
        const client = getClient();
        const result = await client.requestFresh<QobrixPaginatedResponse>(`${slug}/changes`, {
          search,
          limit: limit ?? 10,
          page: page ?? 1,
          ...(fields ? { fields } : {}),
          ...(sort !== undefined ? { sort } : {}),
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_field_change_history",
    "Build a chronological timeline of edits to one field on one CRM record. " +
      "Paginates GET /{resource}/{id}/changes and filters rows where the field appears in original or changed. " +
      "Returns [{timestamp, user_id, user_name?, type, before, after}] sorted oldest-first. " +
      "Use for: 'who changed source on this opportunity and when?'",
    FieldChangeHistorySchema.shape,
    async ({ resource, id, field, resolve_users, max_pages }) => {
      try {
        const slug = toResourceSlug(resource);
        const client = getClient();
        const cap = max_pages ?? DEFAULT_FIELD_HISTORY_PAGES;

        const { rows, pages_fetched, truncated } = await fetchAllChanges(
          (page) =>
            client.requestFresh<QobrixPaginatedResponse>(`${slug}/${id}/changes`, {
              limit: PAGE_SIZE,
              page,
              fields: [
                "timestamp",
                "user_id",
                "impersonated_user_id",
                "type",
                "original",
                "changed",
                "primary_key",
              ],
              sort: "-timestamp",
            }),
          cap
        );

        const relevant = rows.filter((e) => entryTouchesField(e, field));
        relevant.sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const userIds = new Set<string>();
        if (resolve_users) {
          for (const e of relevant) {
            if (e.user_id) userIds.add(e.user_id);
            if (e.impersonated_user_id) userIds.add(e.impersonated_user_id);
          }
        }
        const userNames = new Map<string, string | null>();
        if (resolve_users) {
          await Promise.all(
            [...userIds].map(async (uid) => {
              userNames.set(uid, await resolveUserLabel(uid));
            })
          );
        }

        const timeline = relevant.map((e) => {
          const { before, after } = fieldDelta(e, field);
          return {
            timestamp: e.timestamp,
            user_id: e.user_id ?? null,
            ...(resolve_users
              ? { user_name: e.user_id ? userNames.get(e.user_id) ?? null : null }
              : {}),
            impersonated_user_id: e.impersonated_user_id ?? null,
            ...(resolve_users && e.impersonated_user_id
              ? {
                  impersonated_user_name:
                    userNames.get(e.impersonated_user_id) ?? null,
                }
              : {}),
            type: e.type ?? null,
            before,
            after,
          };
        });

        return formatResult({
          resource: slug,
          record_id: id,
          field,
          change_count: timeline.length,
          pages_fetched,
          truncated,
          timeline,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_top_field_changers",
    "Leaderboard: which users most often edited a given field (tenant-wide audit scan). " +
      "Paginates GET /{resource}/changes, counts rows where field appears in changed, groups by user_id. " +
      "Returns [{user_id, user_name?, change_count, latest_change_at, sample_record_ids}]. " +
      "Use for: 'who rewrites lead source to direct most often in the last 6 months?'",
    TopFieldChangersSchema.shape,
    async ({ resource, field, since, until, limit, resolve_users, max_pages }) => {
      try {
        const slug = toResourceSlug(resource);
        const client = getClient();
        const cap = max_pages ?? DEFAULT_TOP_CHANGERS_PAGES;
        const tsSearch = buildTimestampSearch(since, until);

        const { rows, pages_fetched, truncated } = await fetchAllChanges(
          (page) =>
            client.requestFresh<QobrixPaginatedResponse>(`${slug}/changes`, {
              limit: PAGE_SIZE,
              page,
              search: tsSearch,
              fields: [
                "timestamp",
                "user_id",
                "primary_key",
                "original",
                "changed",
                "type",
              ],
              sort: "-timestamp",
            }),
          cap
        );

        type Agg = {
          change_count: number;
          latest_change_at: string;
          sample_record_ids: Set<string>;
        };
        const byUser = new Map<string, Agg>();

        for (const e of rows) {
          const chg = e.changed ?? {};
          if (!(field in chg)) continue;
          const uid = e.user_id;
          if (!uid) continue;

          let agg = byUser.get(uid);
          if (!agg) {
            agg = {
              change_count: 0,
              latest_change_at: e.timestamp,
              sample_record_ids: new Set(),
            };
            byUser.set(uid, agg);
          }
          agg.change_count++;
          if (e.timestamp > agg.latest_change_at) {
            agg.latest_change_at = e.timestamp;
          }
          if (e.primary_key && agg.sample_record_ids.size < 5) {
            agg.sample_record_ids.add(e.primary_key);
          }
        }

        const topN = limit ?? 20;
        const leaderboard = [...byUser.entries()]
          .map(([user_id, agg]) => ({
            user_id,
            change_count: agg.change_count,
            latest_change_at: agg.latest_change_at,
            sample_record_ids: [...agg.sample_record_ids],
          }))
          .sort((a, b) => b.change_count - a.change_count)
          .slice(0, topN);

        if (resolve_users) {
          await Promise.all(
            leaderboard.map(async (row) => {
              (row as Record<string, unknown>).user_name = await resolveUserLabel(
                row.user_id
              );
            })
          );
        }

        return formatResult({
          resource: slug,
          field,
          search: tsSearch ?? null,
          rows_scanned: rows.length,
          pages_fetched,
          truncated,
          leaderboard,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
