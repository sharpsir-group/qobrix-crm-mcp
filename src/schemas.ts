import { z } from "zod";

const SEARCH_DESCRIPTION =
  "Qobrix search expression. Operators: ==, !=, <, >, <=, >=, in, contains, " +
  "starts with, ends with. Combine with: and, or, not. " +
  "Ranges: field in 200000..800000. Lists: field in [\"a\",\"b\"]. " +
  "Special vars: CURRENT_USER, NOW, THIS_WEEK, THIS_MONTH, DAYS_AGO(n). " +
  "String values MUST be double-quoted. Booleans: true/false (no quotes). " +
  "Association paths for cross-entity filtering: Properties.price, SalespersonUsers.Contacts.country. " +
  'Examples: \'status == "available" and sale_rent == "for_sale" and list_selling_price_amount <= 500000\', ' +
  '\'created >= DAYS_AGO(7)\', \'city contains "Limas"\', \'bedrooms in 2..4\'. ' +
  "If unsure about field names, call qobrix_get_schema first.";

const paginationParams = {
  limit: z.number().min(1).max(100).optional()
    .describe("Results per page (1-100, default 10). Response includes pagination.has_next_page to know if more pages exist."),
  page: z.number().min(1).optional()
    .describe("Page number (default 1). Use with limit for pagination. Check pagination.page_count for total pages."),
};

const searchParam = {
  search: z.string().describe(SEARCH_DESCRIPTION),
};

const sortParam = {
  sort: z.string().optional()
    .describe("Sort by field name. Prefix with - for descending. Examples: '-created' (newest first), 'name' (alphabetical), '-list_selling_price_amount' (highest price first)."),
};

const fieldsParam = {
  fields: z.array(z.string()).optional()
    .describe("Limit response to specific fields only (partial response). Reduces payload size. Example: ['id','name','status','list_selling_price_amount']. Omit to get all fields."),
};

const includeParam = {
  include: z.array(z.string()).optional()
    .describe("Associations to expand inline. Each entity has specific options listed in the include parameter description. Expands FK references into full objects."),
};

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export const ListPropertiesSchema = z.object({
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PropertyTypes, PropertySubtypes, Agents, " +
    "Opportunities, PropertyViewings, Translations, SalespersonUsers, CreatedByUsers, " +
    "ModifiedByUsers, LocationLocations, AgentAgents, SellerContacts, ProjectProjects"
  ),
  media: z.boolean().optional().describe(
    "Include inline media (photos, floor plans, thumbnails) on each row. Default false. " +
    "Each media-rich property can add 5-20 KB; only set true when the caller needs media URLs. " +
    "For media alone use qobrix_list_media(related_model='Properties', related_id=<uuid>)."
  ),
  expand: z.boolean().optional().describe(
    "Expand FK references into full nested objects (developer, project, seller, location, etc.). " +
    "Default false. With expand=false each FK is just a UUID string — much smaller payload. " +
    "Prefer include[] for surgical expansion of specific associations."
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetPropertySchema = z.object({
  id: z.string().describe("Property UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PropertyTypes, PropertySubtypes, Agents, " +
    "Opportunities, PropertyViewings, Translations, SalespersonUsers, CreatedByUsers, " +
    "LocationLocations, AgentAgents, SellerContacts, ProjectProjects"
  ),
  expand: z.boolean().optional().describe(
    "Expand FK references into full nested objects. Default false (FKs stay as UUID strings). " +
    "Prefer include[] for surgical expansion of specific associations."
  ),
});

export const SearchPropertiesSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  media: z.boolean().optional().describe(
    "Include inline media on each row. Default false. Only set true when media URLs are needed."
  ),
  expand: z.boolean().optional().describe(
    "Expand FK references into nested objects. Default false (FKs stay as UUID strings)."
  ),
});

export const GetPropertyCoordinatesSchema = z.object({
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetPropertiesByLeadSchema = z.object({
  id: z.string().describe("Lead/Opportunity UUID"),
  ...paginationParams,
});

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const ListContactsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: AssignedToUsers, User, Language, Organizations"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
  segment: z.string().optional().describe("Filter contacts by segment"),
});

export const GetContactSchema = z.object({
  id: z.string().describe("Contact UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: AssignedToUsers, User, Language, Organizations"
  ),
});

export const SearchContactsSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const ListAgentsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PrimaryContactContacts, User, Brands, AgencyAgents"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetAgentSchema = z.object({
  id: z.string().describe("Agent UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PrimaryContactContacts, User, Brands, AgencyAgents"
  ),
});

export const SearchAgentsSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
});

// ---------------------------------------------------------------------------
// Opportunities (Leads)
// ---------------------------------------------------------------------------

export const ListOpportunitiesSchema = z.object({
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. IMPORTANT: avoid 'Locations' unless you also select the location FK via fields[]. " +
    "Verified safe options: ContactNameContacts, Properties, AgentAgents, PropertyTypes, " +
    "ClosedLostReason, User, OwnerUsers"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetOpportunitySchema = z.object({
  id: z.string().describe("Opportunity/Lead UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: ContactNameContacts (contact details), " +
    "Properties (linked properties), AgentAgents (assigned agent), PropertyTypes, " +
    "ClosedLostReason, User, OwnerUsers"
  ),
});

export const SearchOpportunitiesSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
});

export const GetLeadsByPropertySchema = z.object({
  propertyId: z.string().describe("Property UUID to find matching leads for"),
  ...paginationParams,
});

export const GetLeadPropertiesSchema = z.object({
  id: z.string().describe("Opportunity/Lead UUID"),
});

// ---------------------------------------------------------------------------
// Property Viewings
// ---------------------------------------------------------------------------

export const ListViewingsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PropertyViewingViewing"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetViewingSchema = z.object({
  id: z.string().describe("Property Viewing UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PropertyViewingViewing"
  ),
});

export const SearchViewingsSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const ListTasksSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: TaskStatus, TaskTypes, Properties, AssignedToUsers, " +
    "ContactContacts, RelatedOpportunityOpportunities, RelatedAgentAgents, " +
    "RelatedContractContracts, CreatedByUsers, ModifiedByUsers, ContractorContacts, " +
    "RelatedActionPlanSteps"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetTaskSchema = z.object({
  id: z.string().describe("Task UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: TaskStatus, TaskTypes, Properties, AssignedToUsers, " +
    "ContactContacts, RelatedOpportunityOpportunities, RelatedAgentAgents, CreatedByUsers"
  ),
});

export const SearchTasksSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const ListMediaSchema = z.object({
  ...paginationParams,
  related_model: z.string().optional().describe(
    "Filter by related entity type. Values: 'Properties', 'Contacts', 'Projects', 'Agents'. " +
    "Must be used together with related_id."
  ),
  related_id: z.string().optional().describe(
    "UUID of the related entity. Must be used together with related_model. " +
    "Example: related_model='Properties', related_id='<property-uuid>' to get all media for a property."
  ),
});

export const GetMediaSchema = z.object({
  id: z.string().describe("Media UUID"),
  size: z.string().optional().describe("Image size variant (e.g. 'thumbnail', 'medium', 'large')"),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const ListProjectsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: Agents, Developer, Translations, " +
    "LocationLocations, Assignee, Recommended, Favorites"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetProjectSchema = z.object({
  id: z.string().describe("Project UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: Agents, Developer, Translations, " +
    "LocationLocations, Assignee, Recommended, Favorites"
  ),
});

export const SearchProjectsSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
});

export const GetProjectCoordinatesSchema = z.object({
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export const ListOffersSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: CreatedByUsers, ModifiedByUsers, OpportunityOpportunities, PropertyProperties"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetOfferSchema = z.object({
  id: z.string().describe("Offer UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: CreatedByUsers, ModifiedByUsers, OpportunityOpportunities, PropertyProperties"
  ),
});

export const SearchOffersSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
});

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const ListContractsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: Contacts, PaymentInstallments, " +
    "ContractParties, PropertyIdProperties, OpportunityIdOpportunities, CreatedByUsers"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetContractSchema = z.object({
  id: z.string().describe("Contract UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: Contacts, PaymentInstallments, " +
    "ContractParties, PropertyIdProperties, OpportunityIdOpportunities, CreatedByUsers"
  ),
});

export const SearchContractsSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const ListCallsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: AssignedToUsers, ContactContacts, " +
    "RelatedOpportunityOpportunities, RelatedAgentAgents, RelatedContractContracts, " +
    "CreatedByUsers, ModifiedByUsers"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetCallSchema = z.object({
  id: z.string().describe("Call UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: AssignedToUsers, ContactContacts, " +
    "RelatedOpportunityOpportunities, RelatedAgentAgents, CreatedByUsers"
  ),
});

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const ListMeetingsSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: AssignedToUsers, ContactContacts, " +
    "RelatedOpportunityOpportunities, RelatedAgentAgents, ViewingPropertyViewings, " +
    "CreatedByUsers, ModifiedByUsers"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetMeetingSchema = z.object({
  id: z.string().describe("Meeting UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: AssignedToUsers, ContactContacts, " +
    "ViewingPropertyViewings, CreatedByUsers"
  ),
});

// ---------------------------------------------------------------------------
// Email Messages
// ---------------------------------------------------------------------------

export const ListEmailMessagesSchema = z.object({
  ...paginationParams,
  ...sortParam,
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: Properties, CreatedByUsers, ModifiedByUsers, " +
    "ContactContacts, RelatedOpportunityOpportunities, RelatedAgentAgents, " +
    "RelatedContractContracts, OwnerUsers, Agent, Contract, Opportunity, Campaign"
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetEmailMessageSchema = z.object({
  id: z.string().describe("Email Message UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Options: Properties, ContactContacts, " +
    "RelatedOpportunityOpportunities, Agent, Campaign"
  ),
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const RESOURCE_DESCRIPTION =
  "Resource name (case-sensitive, lowercase plural as used by Qobrix API). " +
  "Values: properties, opportunities, contacts, agents, tasks, property-viewings, " +
  "projects, offers, contracts, calls, meetings, email-messages.";

export const CountSchema = z.object({
  resource: z.string().describe(RESOURCE_DESCRIPTION),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const TopValuesSchema = z.object({
  resource: z.string().describe(RESOURCE_DESCRIPTION),
  field: z.string().describe(
    "Field name to aggregate by (e.g. 'developer_id', 'agent', 'status', 'source', 'owner', 'city', 'property_type'). " +
    "Must be a top-level scalar field on the resource."
  ),
  search: z.string().optional().describe(
    "Optional Qobrix search expression to filter records before aggregating. " +
    'Example: \'status == "available" and sale_rent == "for_sale"\' to only aggregate active sale listings.'
  ),
  top: z.number().min(1).max(50).optional().describe(
    "Number of top values to return (default 10, max 50). Returns the N most-frequent values."
  ),
  resolve: z.boolean().optional().describe(
    "If true, attempt to resolve UUID foreign keys to human-readable names by looking up " +
    "the referenced entity (Contacts, Agents, Projects, Users). Default false."
  ),
});

export const TopRecordsSchema = z.object({
  resource: z.string().describe(RESOURCE_DESCRIPTION),
  sort_by: z.string().describe(
    "Field to sort by (numeric or ISO date). Pages through results and sorts in-process — " +
    "use this when the list/search 'sort' param is silently ignored by the Qobrix API " +
    "(common for nullable/computed numeric fields like contracts.final_selling_price_amount)."
  ),
  desc: z.boolean().optional().describe("Sort descending (default true)."),
  top: z.number().min(1).max(50).optional().describe(
    "Number of top records to return (default 10, max 50)."
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
  fields: z.array(z.string()).optional().describe(
    "Optional projection. Always-resolved FK keys (property_id, agent, owner, assigned_to, etc.) " +
    "are fetched regardless; this just limits other fields on the raw row."
  ),
  include: z.array(z.string()).optional().describe(
    "Optional Qobrix associations to expand inline (passed through to the underlying list call)."
  ),
  resolve: z.array(z.string()).optional().describe(
    "Extra FK field names to resolve to readable names, in addition to the always-resolve set " +
    "(property_id, agent, owner, assigned_to, commission_to, commission_to_2, contact_name, " +
    "salesperson, seller, project, developer_id, campaign_id)."
  ),
});

const AGGREGATE_OPS = ["sum", "avg", "min", "max", "count"] as const;

export const AggregateSchema = z.object({
  resource: z.string().describe(RESOURCE_DESCRIPTION),
  field: z.string().describe(
    "Numeric field to aggregate (e.g. 'final_selling_price_amount', 'commission_value_amount', " +
    "'list_selling_price_amount'). For op='count', any field works (only non-null values are counted)."
  ),
  op: z.enum(AGGREGATE_OPS).describe(
    "Aggregation: 'sum' total, 'avg' mean, 'min'/'max' extremes, 'count' rows with a non-empty value."
  ),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
  group_by: z
    .union([z.string(), z.array(z.string()).min(1).max(3)])
    .optional()
    .describe(
      "Optional grouping. Pass a single field name (e.g. 'commission_to_2' for agent " +
      "leaderboard, 'property_type' for type-mix, 'city' for geo) or an array of 2-3 fields " +
      "for a multi-dimensional pivot (e.g. ['city','property_type']). Without group_by " +
      "returns a single aggregate."
    ),
  top: z.number().min(1).max(50).optional().describe(
    "When group_by is set, number of top buckets to return (default 10, max 50). Buckets sorted by op desc."
  ),
  resolve: z.boolean().optional().describe(
    "If true and group_by looks like a UUID FK (or any dim of a multi-dim group_by does), " +
    "resolve bucket keys to readable names. Defaults to true when any dim is in the " +
    "always-resolve set, false otherwise."
  ),
});

// ---------------------------------------------------------------------------
// Reporting tools (time-series, funnel, rep scorecard, stale leads)
// ---------------------------------------------------------------------------

const TIME_BUCKETS = ["day", "week", "month", "quarter", "year"] as const;
const TIME_METRICS = ["count", "sum", "avg", "min", "max"] as const;

export const TimeSeriesSchema = z.object({
  resource: z.string().describe(RESOURCE_DESCRIPTION),
  bucket: z.enum(TIME_BUCKETS).optional().describe(
    "Bucket size (default 'month'). 'week' uses ISO weeks starting Monday."
  ),
  metric: z.enum(TIME_METRICS).optional().describe(
    "Aggregation inside each bucket (default 'count'). Anything other than 'count' requires `field`."
  ),
  field: z.string().optional().describe(
    "Numeric field aggregated by `metric` (required when metric != 'count'). " +
    "Examples: 'final_selling_price_amount' (contracts), 'budget' (opportunities)."
  ),
  date_field: z.string().optional().describe(
    "Date column to bucket on. Defaults per-resource: contracts → date_of_contract, " +
    "opportunities → created, properties → created, calls/meetings/email-messages/tasks → created."
  ),
  year: z.number().int().optional().describe("Calendar year window."),
  from: z.string().optional().describe("ISO date (YYYY-MM-DD) inclusive lower bound."),
  to: z.string().optional().describe("ISO date (YYYY-MM-DD) exclusive upper bound."),
  since_days: z.number().int().optional().describe(
    "Rolling window: only rows dated within the last N days. Mutually exclusive with year/from/to."
  ),
  search: z.string().optional().describe(
    "Extra raw Qobrix search expression ANDed with the date window."
  ),
  compare_to_prior: z.boolean().optional().describe(
    "If true, runs the same query over the prior identical-length window and returns " +
    "a `prior` block + YoY % diffs (when buckets line up)."
  ),
});

export const FunnelSchema = z.object({
  year: z.number().int().optional().describe("Calendar year window for the funnel."),
  from: z.string().optional().describe("ISO lower bound."),
  to: z.string().optional().describe("ISO exclusive upper bound."),
  since_days: z.number().int().optional().describe("Rolling window in days."),
  assigned_to: z.string().optional().describe(
    "User UUID, or 'CURRENT_USER' to scope the funnel to one rep."
  ),
  agent: z.string().optional().describe(
    "Agent UUID (commission_to_2 / Properties.agent) to scope to an external broker."
  ),
  stage_overrides: z.record(z.string()).optional().describe(
    "Optional map of stage_name → raw Qobrix search expression to override the canonical " +
    "stage definition. Valid stage names: 'leads', 'qualified', 'viewing', 'offer', " +
    "'reserved', 'closed'."
  ),
});

const SCORECARD_SORT = [
  "volume",
  "commission",
  "deals_closed",
  "activities",
  "viewings",
] as const;

export const RepScorecardSchema = z.object({
  user: z.string().optional().describe(
    "User UUID for a single-rep card. Omit for top-N leaderboard mode. " +
    "Accepts the special token 'CURRENT_USER'."
  ),
  top: z.number().min(1).max(50).optional().describe(
    "Leaderboard size (default 10). Ignored when `user` is set."
  ),
  sort_by: z.enum(SCORECARD_SORT).optional().describe(
    "Leaderboard sort axis (default 'volume'). Ignored when `user` is set."
  ),
  year: z.number().int().optional().describe("Calendar year window."),
  from: z.string().optional().describe("ISO lower bound."),
  to: z.string().optional().describe("ISO exclusive upper bound."),
  since_days: z.number().int().optional().describe("Rolling window in days."),
});

export const StaleLeadsSchema = z.object({
  since_days: z.number().int().min(1).optional().describe(
    "Threshold in days (default 30). A lead is 'stale' if no Call/Meeting/Email/Task touched it " +
    "and the opportunity itself wasn't modified within this window."
  ),
  statuses: z.array(z.string()).optional().describe(
    "Opportunity statuses considered 'live' (default ['new','open'])."
  ),
  assigned_to: z.string().optional().describe(
    "Scope to one rep's leads. UUID or 'CURRENT_USER'."
  ),
  top: z.number().min(1).max(200).optional().describe(
    "Max stale leads to return (default 50). Sorted oldest-modified first."
  ),
});

// ---------------------------------------------------------------------------
// Deals (domain shortcut over Contracts)
// ---------------------------------------------------------------------------

const DEAL_KINDS = ["sale", "rental", "listing", "any_revenue", "any"] as const;
const DEAL_BY = ["price", "commission", "date"] as const;
const DEAL_DATE_FIELDS = [
  "date_of_contract",
  "date_of_reservation",
  "start_date",
  "end_date",
  "created",
  "modified",
] as const;

export const DealsSchema = z.object({
  kind: z.enum(DEAL_KINDS).optional().describe(
    "Semantic shortcut (default 'sale'). Sets default contract_types when contract_types is omitted: " +
    "'sale'=['cos'], 'rental'=['tenancy_agreement'], 'listing'=['listing_for_sale','listing_for_rent'], " +
    "'any_revenue'=['cos','tenancy_agreement'], 'any'=no contract_type filter."
  ),
  contract_types: z.array(z.string()).optional().describe(
    "Explicit contract types (overrides kind defaults). Subset of: " +
    "cos, tenancy_agreement, listing_for_sale, listing_for_rent, property_management, viewing_agreement."
  ),
  contract_statuses: z.array(z.string()).optional().describe(
    "Contract statuses (default ['agreed']). Use ['reserved','agreed'] for under-contract + closed, " +
    "['reserved'] for pipeline only, ['cancelled'] for fall-throughs."
  ),
  include_reserved: z.boolean().optional().describe(
    "Convenience flag: when true, adds 'reserved' to contract_statuses."
  ),
  year: z.number().int().optional().describe("Calendar year window (e.g. 2026)."),
  from: z.string().optional().describe("ISO date (YYYY-MM-DD) inclusive lower bound."),
  to: z.string().optional().describe("ISO date (YYYY-MM-DD) exclusive upper bound."),
  since_days: z.number().int().optional().describe(
    "Rolling window: only deals dated within the last N days. Mutually exclusive with year/from/to."
  ),
  date_field: z.enum(DEAL_DATE_FIELDS).optional().describe(
    "Which date column to filter by (default depends on kind: sale=date_of_contract, " +
    "rental=start_date, listing=created, otherwise date_of_contract)."
  ),
  min_price: z.number().optional().describe(
    "Lower bound on the kind's natural price field (selling for sale, rental for rental)."
  ),
  max_price: z.number().optional().describe(
    "Upper bound on the kind's natural price field."
  ),
  assigned_to: z.string().optional().describe(
    "User UUID assigned to the contract, or the special token 'CURRENT_USER'."
  ),
  commission_to: z.string().optional().describe(
    "User UUID receiving commission (commission_to), or 'CURRENT_USER'."
  ),
  commission_to_2: z.string().optional().describe(
    "Agent UUID receiving commission (commission_to_2)."
  ),
  agent: z.string().optional().describe(
    "Convenience alias for commission_to_2 (the deal's broker/external agent)."
  ),
  search: z.string().optional().describe(
    "Extra raw Qobrix search expression ANDed with everything else (escape hatch for niche filters)."
  ),
  by: z.enum(DEAL_BY).optional().describe(
    "Sort axis (default 'price'). 'price' uses final_selling_price_amount (sale), " +
    "final_rental_price_amount (rental), or per-row coalesce for mixed kinds. " +
    "'commission' uses commission_value_amount. 'date' uses the resolved date_field."
  ),
  desc: z.boolean().optional().describe("Sort descending (default true)."),
  top: z.number().min(1).max(50).optional().describe(
    "Number of deals to return (default 10, max 50). The summary block always covers the full filtered set."
  ),
});

// ---------------------------------------------------------------------------
// Cohort / repeat customers
// ---------------------------------------------------------------------------

const COHORT_KINDS = ["buyers", "sellers", "leads"] as const;

export const CohortSchema = z.object({
  kind: z.enum(COHORT_KINDS).optional().describe(
    "Which population to cohort (default 'buyers'). " +
    "'buyers' = contacts behind closed contracts (contract.opportunity_id → opportunity.contact_name). " +
    "'sellers' = contacts on the listing side (contract.property_id → property.seller). " +
    "'leads' = contacts on opportunities regardless of close."
  ),
  min_count: z.number().int().min(2).max(100).optional().describe(
    "Minimum deal/opportunity count per contact to include them in the cohort (default 2)."
  ),
  contract_types: z.array(z.string()).optional().describe(
    "Contract types for buyers/sellers (default ['cos'])."
  ),
  contract_statuses: z.array(z.string()).optional().describe(
    "Contract statuses for buyers/sellers (default ['agreed'])."
  ),
  year: z.number().int().optional().describe("Calendar year window."),
  from: z.string().optional().describe("ISO inclusive lower bound."),
  to: z.string().optional().describe("ISO exclusive upper bound."),
  since_days: z.number().int().optional().describe("Rolling window in days."),
  top: z.number().min(1).max(100).optional().describe(
    "Max repeat contacts to return (default 20)."
  ),
});

// ---------------------------------------------------------------------------
// Win / Loss analytics
// ---------------------------------------------------------------------------

export const WinLossSchema = z.object({
  year: z.number().int().optional().describe("Calendar year window."),
  from: z.string().optional().describe("ISO inclusive lower bound."),
  to: z.string().optional().describe("ISO exclusive upper bound."),
  since_days: z.number().int().optional().describe(
    "Rolling window in days. Window is applied to last_status_change (fallback modified)."
  ),
  group_by: z
    .union([z.string(), z.array(z.string()).min(1).max(3)])
    .optional()
    .describe(
      "Optional slicing dimension(s). Common values: 'source', 'enquiry_type', 'owner', " +
      "'agent', 'closed_lost_reason_id'. Pass an array of 2-3 fields for a multi-dim pivot."
    ),
  assigned_to: z.string().optional().describe(
    "Scope to one rep's opportunities (UUID or 'CURRENT_USER'). Maps to opportunities.owner."
  ),
  agent: z.string().optional().describe(
    "Scope to one external broker (opportunities.agent UUID)."
  ),
  top: z.number().min(1).max(50).optional().describe(
    "Max group buckets to return (default 10)."
  ),
  include_top_losses: z.boolean().optional().describe(
    "When true, also returns the 10 most-recent closed_lost opportunities with " +
    "closed_lost_details, source, last_status_change, and resolved contact_name."
  ),
});

// ---------------------------------------------------------------------------
// Days on market
// ---------------------------------------------------------------------------

const DOM_KINDS = ["sold", "reserved", "any_closed"] as const;
const DOM_LISTING_FIELDS = [
  "listing_date",
  "website_listing_date",
  "created",
] as const;
const DOM_CLOSE_FIELDS = [
  "date_of_contract",
  "date_of_reservation",
] as const;

export const DaysOnMarketSchema = z.object({
  kind: z.enum(DOM_KINDS).optional().describe(
    "Which contracts count as a 'close' (default 'sold' = contract_type=cos + contract_status=agreed). " +
    "'reserved' = contract_status=reserved. 'any_closed' = reserved + agreed."
  ),
  listing_date_field: z.enum(DOM_LISTING_FIELDS).optional().describe(
    "Anchor on the property side (default 'listing_date'). Per-row fallback to website_listing_date " +
    "then created when the chosen field is null."
  ),
  close_date_field: z.enum(DOM_CLOSE_FIELDS).optional().describe(
    "Anchor on the contract side. Default depends on kind: sold→date_of_contract, " +
    "reserved→date_of_reservation."
  ),
  year: z.number().int().optional().describe("Calendar year window."),
  from: z.string().optional().describe("ISO inclusive lower bound."),
  to: z.string().optional().describe("ISO exclusive upper bound."),
  since_days: z.number().int().optional().describe("Rolling window in days."),
  group_by: z
    .union([z.string(), z.array(z.string()).min(1).max(3)])
    .optional()
    .describe(
      "Optional grouping field(s) on the property side: 'property_type', 'city', " +
      "'commission_to_2'/'agent' (broker). Multi-dim arrays of 2-3 fields supported."
    ),
  top: z.number().min(1).max(50).optional().describe(
    "Max group buckets to return (default 10)."
  ),
  include_outliers: z.boolean().optional().describe(
    "When true, also returns the 5 longest-DOM and 5 shortest-DOM deals."
  ),
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export const CacheStatsSchema = z.object({}).describe(
  "No arguments. Returns hit/miss counters, memory size, in-flight requests, " +
  "TTL, and Redis status."
);

export const CacheClearSchema = z.object({
  prefix: z.string().optional().describe(
    "Optional cache-key prefix to clear (e.g. 'v1:request:properties' to invalidate " +
    "only property responses). Omit to clear the entire cache (memory + Redis)."
  ),
});

// ---------------------------------------------------------------------------
// Schema / Metadata
// ---------------------------------------------------------------------------

export const GetSchemaSchema = z.object({
  resource: z.string().describe(
    "Resource name (case-sensitive, PascalCase). Valid values: Properties, Contacts, " +
    "Opportunities, Agents, Tasks, PropertyViewings, Projects, Offers, Contracts, Calls, " +
    "Meetings, EmailMessages, Media, PropertyTypes, PropertySubtypes, PropertyFeatures, Locations. " +
    "Returns every field with name, type, label, and validation rules. " +
    "Use this to discover field names before building search expressions or fields[] arrays."
  ),
});

export const GetFieldOptionsSchema = z.object({
  ...paginationParams,
  search: z.string().optional().describe(
    "Search expression to filter field options. " +
    'Example: \'resource == "Properties" and field == "status"\' to see allowed status values for properties.'
  ),
});
