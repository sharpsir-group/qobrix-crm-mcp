import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { CountSchema, TopValuesSchema } from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 200; // safety cap: 20 000 records

async function resolveId(
  kind: string,
  id: string
): Promise<string | null> {
  const client = getClient();
  const routes: Record<string, string> = {
    developer_id: "contacts",
    seller: "contacts",
    contact_name: "contacts",
    contact_id: "contacts",
    agent: "agents",
    project: "projects",
    campaign_id: "campaigns",
    owner: "users",
    salesperson: "users",
    assigned_to: "users",
    created_by: "users",
    modified_by: "users",
  };

  const resource = routes[kind];
  if (!resource) return null;

  try {
    const result = await client.get(resource, id, { expand: false });
    const data = result.data as Record<string, unknown>;
    return (data.name as string) ?? (data.username as string) ?? null;
  } catch {
    return null;
  }
}

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
          name?: string;
        }> = [];

        for (const [value, count] of sorted) {
          const entry: { value: string; count: number; name?: string } = {
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
}
