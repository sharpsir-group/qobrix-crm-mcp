import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListOpportunitiesSchema,
  GetOpportunitySchema,
  SearchOpportunitiesSchema,
  GetLeadsByPropertySchema,
  GetLeadPropertiesSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerOpportunityTools(server: McpServer): void {
  server.tool(
    "qobrix_list_opportunities",
    "List opportunities/leads from Qobrix CRM — the central entity of the Sales Pipeline and Lead-Contact Lifecycle. " +
    "In Qobrix, leads ARE opportunities. Each represents a buyer/renter/investor enquiry. " +
    "RESO funnel mapping: 'new' = MQL/Lead, 'open' = SQL/Active, 'won' = Closed Won, 'closed_lost' = Lost. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "IMPORTANT: Avoid include=['Locations']. Safe verified includes: ContactNameContacts, Properties, " +
    "AgentAgents, PropertyTypes, ClosedLostReason, User, OwnerUsers. " +
    "Key fields (77 total): status, enquiry_type (buy/rent/invest), buy_rent, " +
    "contact_name (UUID → Contact), agent (UUID → Agent), owner (UUID → user), " +
    "source, area_of_interest, bedrooms_from/to, price ranges, next_follow_up_date, enquiry_date. " +
    "Workflow patterns: " +
    "Pipeline overview: group by status to see funnel distribution. " +
    "Overdue follow-ups: status == \"open\" and next_follow_up_date <= NOW. " +
    "New leads this week: created >= THIS_WEEK and status == \"new\". " +
    "To match leads to properties: qobrix_get_leads_by_property or qobrix_get_lead_properties.",
    ListOpportunitiesSchema.shape,
    async ({ limit, page, sort, fields, include, search }) => {
      try {
        const result = await getClient().list("opportunities", {
          limit, page, sort, fields, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_opportunity",
    "Get a single lead/opportunity by UUID — drill into a pipeline deal in the Sales Pipeline workflow. " +
    "Returns { data: { id, ref, status, enquiry_type, contact_name, agent, ... } }. " +
    "RESO mapping: status 'new' = Lead, 'open' = Active/SQL, 'won' = Closed Won, 'closed_lost' = Lost. " +
    "Verified include: ContactNameContacts (the person), Properties (linked listings), " +
    "AgentAgents (assigned broker, RESO ListAgent), PropertyTypes, ClosedLostReason, User, OwnerUsers. " +
    "Canonical deal drill-down pattern: " +
    "1. Get the lead with include=['ContactNameContacts','Properties','AgentAgents'] " +
    "2. Check showing history: qobrix_list_viewings (search by related property) " +
    "3. Check offers: qobrix_search_offers for this lead " +
    "4. Check activity: search Tasks, Calls, Meetings linked to this opportunity " +
    "FK: contact_name → Contacts, agent → Agents, owner → Users.",
    GetOpportunitySchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("opportunities", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_opportunities",
    "Search leads/opportunities — the primary pipeline filtering tool in the Sales Pipeline workflow. " +
    "Use to segment the funnel, find overdue follow-ups, or match buyer criteria. " +
    "RESO funnel stages via status: 'new' → 'open' → 'won' or 'closed_lost'. " +
    "Canonical Sales Pipeline recipes: " +
    "New leads this week: created >= THIS_WEEK and status == \"new\". " +
    "Active pipeline: status == \"open\". " +
    "Overdue follow-ups: status == \"open\" and next_follow_up_date <= NOW. " +
    "Agent workload: agent == \"<uuid>\" and status != \"closed_lost\". " +
    "Buyer criteria match: enquiry_type == \"buy\" and area_of_interest contains \"Limassol\" and list_selling_price_from >= 300000. " +
    "Won deals: status == \"won\" and created >= THIS_MONTH. " +
    "Lost deal analysis: status == \"closed_lost\" and created >= DAYS_AGO(90). " +
    "Key fields: status, enquiry_type, buy_rent, contact_name, agent, owner, " +
    "source, area_of_interest, bedrooms_from/to, price ranges, next_follow_up_date, created.",
    SearchOpportunitiesSchema.shape,
    async ({ search, limit, page, sort, fields }) => {
      try {
        const result = await getClient().list("opportunities", {
          search, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_leads_by_property",
    "Get matching leads for a property — the 'supply-side matching' tool in the Sales Pipeline. " +
    "Answers: 'Who is interested in this listing?' by returning leads whose criteria match the property. " +
    "This is the canonical buyer-property matching pattern (RESO Prospecting). " +
    "Use after listing a new property to find potential buyers in the existing lead database. " +
    "Complement with qobrix_get_lead_properties for the reverse (demand-side) match. " +
    "The propertyId is the Property UUID. Returns paginated results.",
    GetLeadsByPropertySchema.shape,
    async ({ propertyId, limit, page }) => {
      try {
        const params: Record<string, string | number | undefined> = { limit, page };
        const result = await getClient().getPath(
          `opportunities/by-property/${propertyId}`, params
        );
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_lead_properties",
    "Get properties linked to a lead — the 'demand-side matching' tool in the Sales Pipeline. " +
    "Answers: 'What properties does this buyer want?' by returning properties attached to an opportunity. " +
    "This is the canonical property suggestion pattern (RESO Demand/Solution matching). " +
    "Reverse of qobrix_get_leads_by_property (which finds leads for a property). " +
    "In the 8-stage buyer journey, use at the Solution/Viewing stage to prepare showing candidates. " +
    "The id is the Opportunity UUID.",
    GetLeadPropertiesSchema.shape,
    async ({ id }) => {
      try {
        const result = await getClient().getSubresource("opportunities", id, "properties");
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
