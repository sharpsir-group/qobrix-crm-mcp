import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
import {
  ListViewingsSchema,
  GetViewingSchema,
  SearchViewingsSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerViewingTools(server: McpServer): void {
  server.tool(
    "qobrix_list_viewings",
    "List property viewings (RESO ShowingAppointment) — the Showing/Viewing Lifecycle tool. " +
    "Viewings are the pivot between Follow-up and Active Sales: the first viewing marks a lead as actively engaged. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Each viewing links a property, a contact, and an agent/creator. " +
    "Verified include: PropertyViewingViewing. " +
    "Workflow patterns: " +
    "This week's viewings: search with created >= THIS_WEEK. " +
    "Property's showing history: qobrix_get_property with include=['PropertyViewings']. " +
    "Meetings linked to viewings: qobrix_list_meetings with include=['ViewingPropertyViewings']. " +
    "After a showing, the next pipeline step is Offer → Contract → Close.",
    ListViewingsSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("property-viewings", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_viewing",
    "Get a single viewing by UUID — the showing detail view in the Showing Lifecycle. " +
    "Returns { data: { id, ... } }. Verified include: PropertyViewingViewing. " +
    "After retrieving, use the property and contact FKs to trace back to the listing and lead.",
    GetViewingSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("property-viewings", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_viewings",
    "Relevance-ranked viewing search (F1-optimized). " +
    "TWO-TIER: `search` = hard must-haves; `boost[]` = soft weighted preferences; `limit`/`max_scan` for top-N and pool. " +
    "With boost: `_relevance` + `_matched`; pagination.mode='ranked'. " +
    "Call qobrix_search_dsl_help({resource:'PropertyViewings'}) for fields. " +
    "Example: search='created >= THIS_WEEK', boost=[{field:'created',op:'>=',value:'2026-01-01',weight:1}], limit=10.",
    SearchViewingsSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields }) => {
      try {
        const result = await relevanceSearch({
          resource: "property-viewings",
          search, boost, max_scan, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
