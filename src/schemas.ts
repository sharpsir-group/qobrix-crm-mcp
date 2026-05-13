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
  media: z.boolean().optional().describe("Include media in response (default true). Set to false to reduce payload size."),
  search: z.string().optional().describe(SEARCH_DESCRIPTION),
});

export const GetPropertySchema = z.object({
  id: z.string().describe("Property UUID"),
  include: z.array(z.string()).optional().describe(
    "Associations to expand. Verified options: PropertyTypes, PropertySubtypes, Agents, " +
    "Opportunities, PropertyViewings, Translations, SalespersonUsers, CreatedByUsers, " +
    "LocationLocations, AgentAgents, SellerContacts, ProjectProjects"
  ),
});

export const SearchPropertiesSchema = z.object({
  ...searchParam,
  ...paginationParams,
  ...sortParam,
  ...fieldsParam,
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
