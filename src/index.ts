#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";

const SERVER_INSTRUCTIONS = `
Qobrix CRM MCP Server — read-only access to a real-estate CRM aligned with RESO DD 2.0 canonical processes.

## Canonical RE Workflows (RESO-aligned)

This CRM supports six core real-estate business processes. Use the tool recipes below to serve each workflow.

### 1. Listing Lifecycle (RESO Property.StandardStatus)
A property listing moves through: Incomplete → Active → Pending → Closed/Withdrawn.
Qobrix status mapping: "available" = Active, "reserved" = Pending/Under Contract, "sold" = Closed, "withdrawn" = Withdrawn/Canceled.
- **Check listing inventory**: qobrix_search_properties with status == "available" and sale_rent == "for_sale"
- **Drill into a listing**: qobrix_get_property with include=['PropertyTypes','Agents','PropertyViewings']
- **Listing media check**: qobrix_list_media with related_model='Properties' and related_id=<uuid>
- **Map view**: qobrix_get_property_coordinates with optional search filter
- **Track price changes**: qobrix_list_properties sorted by -modified with status == "available"
- **Sold-inventory view**: qobrix_search_properties with status == "sold" (post-close inventory state; for the *deal records* use qobrix_deals)

### 2. Lead-Contact Lifecycle (RESO Contacts.ContactType funnel)
A person flows: Lead → Prospect → Ready to Buy → Buyer (or Seller/Tenant/Other).
Qobrix maps this as Opportunities with status: "new" = Lead/MQL, "open" = SQL/Active, "won" = Closed Won, "closed_lost" = Lost.
- **Lead pipeline overview**: qobrix_search_opportunities by status to count funnel stages
- **Qualify a lead**: qobrix_get_opportunity with include=['ContactNameContacts'] to see who they are
- **Lead source analysis**: qobrix_list_opportunities with fields=['source','source_description','enquiry_type']
- **Contact ownership**: qobrix_get_contact with include=['AssignedToUsers'] (maps to RESO OwnerMember)
- **Find a contact's leads**: qobrix_search_opportunities with contact_name == '<contact-uuid>'
- **Find a contact's tasks**: qobrix_search_tasks with contact == '<contact-uuid>'

### 3. Sales Pipeline (8-stage buyer journey)
Qualification → Demand Research → Solution/Viewing → Decision Making → Deal Signing → Payment → Closed Won/Lost.
- **Buyer-property matching**: qobrix_get_leads_by_property (who wants this property?) or qobrix_get_lead_properties (what does this lead want?)
- **Viewing stage**: qobrix_list_viewings or qobrix_get_property with include=['PropertyViewings']
- **Offer stage**: qobrix_list_offers with include=['OpportunityOpportunities','PropertyProperties']
- **Contract/signing stage**: qobrix_list_contracts with include=['Contacts','PropertyIdProperties','PaymentInstallments']
- **Pipeline tasks**: qobrix_list_tasks with include=['TaskStatus','AssignedToUsers','ContactContacts']

### 4. Showing/Viewing Lifecycle (RESO ShowingRequest → Appointment → Showing)
In Qobrix, PropertyViewings track scheduled visits. Meetings can wrap viewings.
- **List viewings**: qobrix_list_viewings with include=['PropertyViewingViewing']
- **Property's viewings**: qobrix_get_property with include=['PropertyViewings']
- **Meetings with viewings**: qobrix_list_meetings with include=['ViewingPropertyViewings','ContactContacts']
- The first showing/meeting is the trigger that moves a lead from follow-up (nurturing) to active sales.

### 5. Transaction/Offer Lifecycle (RESO TransactionManagement)
Offer → Contract → Payment → Close. The chain: Offer links Opportunity + Property; Contract formalizes the deal.
- **Offer chain**: qobrix_list_offers with include=['OpportunityOpportunities','PropertyProperties']
- **Contract details**: qobrix_get_contract with include=['Contacts','PropertyIdProperties','PaymentInstallments','ContractParties']
- **Deals (sales, rentals, listings, pipeline)**: prefer **qobrix_deals** — covers every "deal" question in one call. Deals live in the **Contracts** table. The default "closed deal" = contract_type == "cos" AND contract_status == "agreed", but rentals (tenancy_agreement), listing agreements, and under-contract reservations (contract_status == "reserved") are also deals. qobrix_deals accepts kind ("sale"|"rental"|"listing"|"any_revenue"|"any"), explicit contract_types[]/contract_statuses[], date_field + year/from/to/since_days, min_price/max_price, assigned_to/commission_to/commission_to_2/agent, and a raw search escape hatch. Property.status "sold" is the post-close inventory state, *not* the deal record — never use it as a substitute for the Contracts query.
- **Top-N by amount on contracts/opportunities**: use **qobrix_top_records** (sort_by=final_selling_price_amount etc.) — the API's sort parameter is silently ignored on calculated/nullable numeric fields, so client-side fetch-and-sort is required.
- **Sums / averages / leaderboards**: use **qobrix_aggregate** (e.g. op="sum" field="final_selling_price_amount" group_by="commission_to_2" for an agent leaderboard by 2026 volume).

### 6. Activity Tracking / Follow-up
Zero tolerance on missed follow-ups. Daily cadence for active deals. Track all touchpoints.
- **Call history**: qobrix_list_calls with include=['ContactContacts','AssignedToUsers']
- **Meeting history**: qobrix_list_meetings with include=['ContactContacts','AssignedToUsers']
- **Email trail**: qobrix_list_email_messages with include=['ContactContacts','Properties']
- **Overdue tasks**: qobrix_search_tasks with due_date <= NOW and status == "pending"
- **My open tasks**: qobrix_search_tasks with assigned_to == CURRENT_USER and status != "completed"

## Data Model (entities and how they relate)
- **Properties** — real-estate listings. FK: agent→Agents, seller→Contacts, project→Projects, salesperson→Users. Status: available/reserved/sold/withdrawn.
- **Contacts** — people/companies (buyers, sellers, tenants). RESO ContactType: Lead/Prospect/Buyer/Seller/Other.
- **Opportunities** — leads/enquiries. FK: contact_name→Contacts, agent→Agents. Status: new/open/won/closed_lost. This IS the lead pipeline.
- **Agents** — brokers managing properties and leads. Referenced by property.agent. RESO Member equivalent.
- **Projects** — property developments grouping units. Referenced by property.project.
- **Offers** — purchase offers linking Opportunity + Property. RESO TransactionManagement equivalent.
- **Contracts** — sale/rental agreements linking Contacts + Properties + Opportunities.
- **Tasks** — CRM tasks tied to any entity. Used for follow-up scheduling and pipeline management.
- **Property Viewings** — scheduled showings. RESO Showing/ShowingAppointment equivalent.
- **Calls, Meetings, Email Messages** — activity history for engagement tracking.
- **Media** — photos, documents, floor plans attached to any entity. RESO Media equivalent.

## Fetching related data
Three strategies to resolve foreign keys:
1. **include[] parameter** — expand associations inline in one call (e.g. include=['Agents','PropertyViewings']).
2. **Separate get call** — take the UUID from an FK field and call the appropriate get tool.
3. **Search by FK** — find related records via search (e.g. search properties with agent == '<uuid>').
Prefer include[] when available. Use search-by-FK when include[] is unavailable. Only include values marked "Verified" in tool descriptions are guaranteed to work.

## Search expression syntax
Operators: ==, !=, <, >, <=, >=, in, contains, starts with, ends with.
Combine with: and, or, not. Ranges: field in 200000..800000.
Special variables: CURRENT_USER, NOW, THIS_WEEK, THIS_MONTH, DAYS_AGO(n).
String values must be double-quoted. Boolean fields use true/false without quotes.
Example: status == "available" and sale_rent == "for_sale" and list_selling_price_amount <= 500000

## Pagination
All list endpoints return { data: [...], pagination: { count, current_page, has_next_page, has_prev_page, page_count, limit } }.
Default limit=10, max 100. Exception: Media list returns { data: [...] } without pagination.

## Discovering field names
Call qobrix_get_schema with the resource name (e.g. 'Properties', 'Contacts', 'Opportunities') to discover all fields, types, and validation rules before building search expressions.

## Known quirks
- Opportunities: avoid include=['Locations'] in list calls unless you also select the location FK in fields[].
- Media endpoint does not support search expressions or pagination metadata.
- Sort: prefix with - for descending (e.g. sort='-created').
- **Sort silently ignored on some numeric fields**: the API's sort parameter is dropped without error for calculated/nullable numeric fields (e.g. contracts.final_selling_price_amount, opportunities.budget). For top-N by such a field, use **qobrix_top_records** (fetches + sorts in-process). For totals, use **qobrix_aggregate**.
- **Closed deals are *not* properties with status="sold"**: that flag tracks the listing's post-close inventory state. The deal record lives in **Contracts**. Use **qobrix_deals** for any "closed deals / top sales / rentals / pipeline" question.
`.trim();

function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "qobrix-crm-mcp",
      version: "1.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  registerTools(server);
  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Server startup error:", error);
  process.exit(1);
});
