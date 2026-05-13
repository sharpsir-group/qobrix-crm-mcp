import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
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
    "Search viewings using Qobrix search expressions — filter the showing pipeline. " +
    "Examples: created >= THIS_WEEK (this week's showings), created >= THIS_MONTH. " +
    "In the canonical Sales Pipeline, showings mark the transition from 'Demand Research' to 'Solution/Viewing' stage. " +
    "Use qobrix_get_schema with resource='PropertyViewings' to discover all searchable fields.",
    SearchViewingsSchema.shape,
    async ({ search, limit, page, sort }) => {
      try {
        const result = await getClient().list("property-viewings", {
          search, limit, page, sort,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
