import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
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
    "Buyer-property match → prefer qobrix_search_properties with search + boost for free-language demand. " +
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
    "Highly relevant property search for free-language buyer demand (F1-optimized). " +
    "TWO-TIER RECIPE: " +
    "(1) `search` = hard DSL must-haves (server filter → precision). " +
    "(2) `boost[]` = soft weighted nice-to-haves scored client-side over up to `max_scan` candidates " +
    "(recall + ranking → better precision@top). " +
    "(3) `limit` = how many ranked rows to return (default 10, max 100) — raise for more options, " +
    "keep modest to avoid context overload. " +
    "With boost: returns top-N with `_relevance` (score) and `_matched` (which boosts hit); " +
    "pagination.mode='ranked' and pagination.scanned shows pool size. " +
    "Without boost: fast path — single cached list page (pagination.mode='fast'). " +
    "Call qobrix_search_dsl_help({resource:'Properties'}) before composing queries. " +
    "Examples: " +
    "Hard only: search='status == \"available\" and sale_rent == \"for_sale\" and city contains \"Limassol\"'. " +
    "Demand match: search='status == \"available\" and sale_rent == \"for_sale\"', " +
    "boost=[{field:'sea_view',op:'==',value:true,weight:3},{field:'bedrooms',op:'>=',value:3,weight:2}," +
    "{field:'list_selling_price_amount',op:'in',value:'200000..600000',weight:2}], limit=15, max_scan=200. " +
    "All upstream pages are response-cached (QOBRIX_CACHE_TTL, default 300s).",
    SearchPropertiesSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields, media, expand }) => {
      try {
        const result = await relevanceSearch({
          resource: "properties",
          search,
          boost,
          max_scan,
          limit,
          page,
          sort,
          fields,
          media,
          expand,
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
