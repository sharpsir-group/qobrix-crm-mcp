import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListPropertiesSchema,
  GetPropertySchema,
  SearchPropertiesSchema,
  GetPropertyCoordinatesSchema,
  GetPropertiesByLeadSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerPropertyTools(server: McpServer): void {
  server.tool(
    "qobrix_list_properties",
    "List properties (RESO Property resource) from Qobrix CRM. " +
    "Core tool for the Listing Lifecycle — use to browse active inventory, track status changes, or audit listings. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, has_prev_page, page_count, limit } }. " +
    "RESO StandardStatus mapping: 'available' = Active, 'reserved' = Pending/Under Contract, 'sold' = Closed, 'withdrawn' = Withdrawn. " +
    "Key fields (184 total): name, ref, status, sale_rent (for_sale/for_rent), property_type, " +
    "property_subtype, city, country, list_selling_price_amount, list_rental_price_amount, " +
    "bedrooms, bathrooms, covered_area_amount, plot_area_amount, " +
    "agent (UUID → qobrix_get_agent), seller (UUID → qobrix_get_contact), " +
    "project (UUID → qobrix_get_project), salesperson (UUID → user). " +
    "Workflow recipes: " +
    "Active inventory → search: status == \"available\" and sale_rent == \"for_sale\". " +
    "Recent listings → sort: '-created'. " +
    "Buyer-property match → feed results into qobrix_get_leads_by_property. " +
    "Listing media → follow up with qobrix_list_media(related_model='Properties'). " +
    "PAYLOAD DEFAULTS: expand=false and media=false — FKs come back as UUIDs and media is not inlined " +
    "(set expand=true / media=true explicitly when full nested objects or media URLs are needed). " +
    "Prefer include[] for surgical expansion of specific associations. Default limit 10, max 100.",
    ListPropertiesSchema.shape,
    async ({ limit, page, sort, fields, include, media, expand, search }) => {
      try {
        const result = await getClient().list("properties", {
          limit, page, sort, fields, include, media, expand, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_property",
    "Get a single property by UUID — the listing detail view in the Listing Lifecycle. " +
    "Returns { data: { id, name, status, ... } }. " +
    "RESO StandardStatus: 'available' = Active, 'reserved' = Pending, 'sold' = Closed, 'withdrawn' = Withdrawn. " +
    "Use include[] to expand related entities inline: " +
    "Verified: Agents, PropertyTypes, PropertySubtypes, PropertyViewings, Opportunities, " +
    "Translations, SalespersonUsers, CreatedByUsers, LocationLocations, AgentAgents, SellerContacts, ProjectProjects. " +
    "Workflow tips: " +
    "include=['PropertyViewings'] → see showing history (Showing Lifecycle). " +
    "include=['Opportunities'] → see interested leads (Sales Pipeline). " +
    "include=['AgentAgents'] → listing agent (RESO ListAgent). " +
    "include=['SellerContacts'] → seller/owner (RESO OwnerMember). " +
    "FK fields: agent → Agents, seller → Contacts, project → Projects, salesperson → Users.",
    GetPropertySchema.shape,
    async ({ id, include, expand }) => {
      try {
        const result = await getClient().get("properties", id, { include, expand });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_properties",
    "Search properties using Qobrix search expressions — the primary tool for buyer-property matching in the Sales Pipeline. " +
    "Use a lead's criteria (bedrooms, budget, location, type) to build a search expression. " +
    "RESO StandardStatus mapping: 'available' = Active, 'reserved' = Pending, 'sold' = Closed, 'withdrawn' = Withdrawn. " +
    "Common workflow patterns: " +
    "Active inventory: status == \"available\" and sale_rent == \"for_sale\" and list_selling_price_amount <= 500000. " +
    "Buyer criteria match: city == \"Limassol\" and bedrooms >= 3 and property_type in [\"villa\",\"house\"]. " +
    "New listings: created >= DAYS_AGO(7) and status == \"available\". " +
    "Price range: list_selling_price_amount in 200000..800000. " +
    "Agent portfolio: agent == \"<agent-uuid>\" and status == \"available\". " +
    "Project units: project == \"<project-uuid>\" and status != \"sold\". " +
    "Key searchable fields: status, sale_rent, property_type, city, country, " +
    "list_selling_price_amount, list_rental_price_amount, bedrooms, bathrooms, " +
    "covered_area_amount, plot_area_amount, new_build, sea_view, agent, project, created, modified. " +
    "After finding matches, use qobrix_get_leads_by_property to see who else is interested.",
    SearchPropertiesSchema.shape,
    async ({ search, limit, page, sort, fields, media, expand }) => {
      try {
        const result = await getClient().list("properties", {
          search, limit, page, sort, fields, media, expand,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_property_coordinates",
    "Get lat/lng coordinates for properties, useful for map display. " +
    "Optionally filter with a search expression to get coordinates for a subset. " +
    "Returns array of { id, coordinates } objects.",
    GetPropertyCoordinatesSchema.shape,
    async ({ search }) => {
      try {
        const params: Record<string, string | undefined> = { search };
        const result = await getClient().getPath("properties/coordinates", params);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_properties_by_lead",
    "Get properties explicitly linked to a lead — the 'demand-side view' in the Sales Pipeline. " +
    "Shows which properties a lead/opportunity has been matched to or expressed interest in. " +
    "The id parameter is the Opportunity UUID (not the property UUID). " +
    "In the canonical buyer journey: after Qualification, use this to review Solution/Viewing candidates. " +
    "Alternative: qobrix_get_opportunity with include=['Properties'] for inline expansion. " +
    "Complement with qobrix_get_leads_by_property for the reverse (supply-side) match.",
    GetPropertiesByLeadSchema.shape,
    async ({ id, limit, page }) => {
      try {
        const params: Record<string, string | number | undefined> = { limit, page };
        const result = await getClient().getPath(`properties/by-lead/${id}`, params);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
