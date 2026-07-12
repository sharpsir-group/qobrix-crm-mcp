/**
 * Qobrix Search Expression (DSL) reference for LLM tool guidance.
 *
 * Distilled from OpenAPI components.schemas.SearchExpression
 * (document.yaml) — Symfony Expression Language syntax used by
 * GET /api/v2/{resource}?search=...
 */

export const SEARCH_DSL_REFERENCE = `# Qobrix Search Expression DSL

Search expressions filter CRM records server-side. Syntax is Symfony Expression Language
(https://symfony.com/doc/7.2/components/expression_language/syntax.html).

## Quick start

\`\`\`
status == "available" and sale_rent == "for_sale" and list_selling_price_amount <= 500000
\`\`\`

## Values

| Kind | Syntax | Notes |
|------|--------|-------|
| String | \`"Limassol"\` or \`'Limassol'\` | Prefer double quotes in MCP tools |
| Number | \`500000\`, \`99.99\` | No quotes |
| Boolean | \`true\` / \`false\` | No quotes |
| Null | \`null\` | Missing / empty |
| List | \`["villa","house"]\` | For \`in\` / \`not in\` |

## Comparison operators

| Op | Meaning | Example |
|----|---------|---------|
| \`==\` | Equal | \`status == "available"\` |
| \`!=\` or \`<>\` | Not equal | \`status != "sold"\` |
| \`<\` \`>\` \`<=\` \`>=\` | Numeric / date compare | \`bedrooms >= 3\` |

## Text operators

| Op | Example |
|----|---------|
| \`contains\` | \`city contains "Limas"\` |
| \`starts with\` | \`name starts with "Villa"\` |
| \`ends with\` | \`email ends with "@company.com"\` |
| \`~\` (concat) | \`first_name ~ " " ~ last_name\` |

## Lists and ranges

| Form | Example |
|------|---------|
| Membership | \`property_type in ["villa","house"]\` |
| Exclusion | \`status not in ["sold","withdrawn"]\` |
| Inclusive range | \`bedrooms in 2..4\`, \`list_selling_price_amount in 200000..800000\` |

## Logic

| Form | Example |
|------|---------|
| AND | \`a and b\` |
| OR | \`a or b\` |
| NOT | \`not (status == "sold")\` |
| Grouping | \`(price < 300000 and bedrooms >= 2) or city == "Limassol"\` |
| Ternary | \`age >= 18 ? "adult" : "minor"\` (rarely needed in filters) |

## Association paths

Cross-entity filters use dotted paths:

\`\`\`
SalespersonUsers.Contacts.country == "CY"
\`\`\`

You may also prefix with the resource name (\`Properties.price\`) though bare field
names on the current resource are preferred.

## Built-in functions

| Function | Purpose | Example |
|----------|---------|---------|
| \`LOCALDATE(date [, tz])\` | Localize a date | \`created >= LOCALDATE("2023-01-01")\` |
| \`TRANSLATED(field)\` | Translated field value | \`TRANSLATED(description) contains "luxury"\` |
| \`IN_POLYGON(coords, polygon)\` | Point-in-polygon | \`IN_POLYGON(coordinates, "lat lng, ...")\` |
| \`DISTANCE_FROM(coords, point)\` | Distance in meters | \`DISTANCE_FROM(coordinates, "34.43,32.13") <= 5000\` |
| \`MAX(a, b, ...)\` / \`MIN(a, b, ...)\` | Clamp / pick extremes | \`MAX(list_selling_price_amount, 100000) > 150000\` |

## Date helpers

Going back: \`DAYS_AGO(n)\`, \`WEEKS_AGO(n)\`, \`MONTHS_AGO(n)\`, \`YEARS_AGO(n)\`
Going forward: \`DAYS_FROM_NOW(n)\`, \`WEEKS_FROM_NOW(n)\`, \`MONTHS_FROM_NOW(n)\`, \`YEARS_FROM_NOW(n)\`

Shortcuts: \`NOW\`, \`TODAY\`, \`YESTERDAY\`, \`TOMORROW\`,
\`THIS_WEEK\`, \`LAST_WEEK\`, \`NEXT_WEEK\`,
\`THIS_MONTH\`, \`LAST_MONTH\`, \`NEXT_MONTH\`,
\`THIS_YEAR\`, \`LAST_YEAR\`, \`NEXT_YEAR\`

User: \`CURRENT_USER\` (UUID of the API user)

Examples:
\`\`\`
created >= DAYS_AGO(7)
created >= LAST_MONTH
assigned_to == CURRENT_USER
\`\`\`

## Relevance search recipe (all qobrix_search_* tools)

Applies to properties, projects, contacts, agents, opportunities, viewings, tasks, offers, contracts:

1. Put **must-have** constraints in \`search\` (hard filter → precision).
2. Put **nice-to-haves** in \`boost[]\` (soft weighted criteria → recall + ranking).
3. Set \`limit\` to how many ranked results to return (default 10, max 100).
4. Set \`max_scan\` to how many candidates to score (default 100 with boost, hard cap 500).
   Higher \`max_scan\` improves recall; higher \`limit\` returns more of the ranked set.

### Lead <-> listing matching via search

- **Demand→supply**: from a lead's criteria, call \`qobrix_search_properties\` / \`qobrix_search_projects\` with search+boost.
- **Supply→demand**: call \`qobrix_search_opportunities\` with search on open leads + boost against the listing (works for projects; native by-property does not).

Call \`qobrix_search_dsl_help\` anytime for this reference; pass \`resource\` to list live fields.
`;

export const PROPERTY_FIELD_CHEATSHEET = `# Properties — high-value searchable fields

| Field | Use for |
|-------|---------|
| \`status\` | \`available\` / \`reserved\` / \`sold\` / \`withdrawn\` |
| \`sale_rent\` | \`for_sale\` / \`for_rent\` |
| \`property_type\` | villa, apartment, house, land, … (use field-options) |
| \`property_subtype\` | Finer type |
| \`city\`, \`country\`, \`municipality\`, \`post_code\` | Location |
| \`list_selling_price_amount\` | Sale price |
| \`list_rental_price_amount\` | Rent price |
| \`bedrooms\`, \`bathrooms\` | Rooms |
| \`covered_area_amount\`, \`plot_area_amount\` | Size |
| \`new_build\`, \`sea_view\`, \`beach_front\` | Boolean amenities |
| \`distance_from_beach\`, \`distance_from_airport\`, … | Distance amounts |
| \`agent\`, \`project\`, \`seller\`, \`salesperson\` | FK UUIDs |
| \`created\`, \`modified\`, \`listing_date\` | Dates |
| \`name\`, \`ref\`, \`description\` | Text / ref |

Discover all fields: \`qobrix_get_schema({ resource: "Properties" })\`
Enum values: \`qobrix_get_field_options\` with \`resource == "Properties" and field == "status"\`
`;

export const PROJECT_FIELD_CHEATSHEET = `# Projects — high-value searchable fields

| Field | Use for |
|-------|---------|
| \`name\`, \`ref\`, \`reference_code\` | Identity |
| \`city\`, \`country\`, \`municipality\`, \`post_code\` | Location |
| \`availability_status\` | Availability |
| \`construction_stage\` | Build stage |
| \`starting_price_from\`, \`price_to\` | Price band |
| \`number_of_units\` | Scale |
| \`developer_id\`, \`assigned_to\` | FK UUIDs |
| \`featured\`, \`housing_type\` | Flags / type |
| \`completion_date\`, \`created\`, \`modified\` | Dates |
| \`description\`, \`short_description\`, \`location_description\` | Text |
| \`distance_from_beach_amount\`, \`distance_from_airport_amount\`, … | Distances |

Discover all fields: \`qobrix_get_schema({ resource: "Projects" })\`
`;

export const OPPORTUNITY_FIELD_CHEATSHEET = `# Opportunities (Leads) — high-value searchable / boost fields

| Field | Use for |
|-------|---------|
| \`status\` | \`new\` / \`open\` / \`won\` / \`closed_lost\` |
| \`buy_rent\`, \`enquiry_type\` | Buy vs rent / enquiry kind |
| \`area_of_interest\`, \`post_codes\` | Location preference |
| \`bedrooms_from\`, \`bedrooms_to\` | Bedroom range |
| \`bathrooms_from\`, \`bathrooms_to\` | Bathroom range |
| \`list_selling_price_from\`, \`list_selling_price_to\` | Sale budget |
| \`list_rental_price_from\`, \`list_rental_price_to\` | Rent budget |
| \`covered_area_from_amount\`, \`plot_area_from_amount\` | Size floors |
| \`new_build\`, \`pets_allowed\`, \`private_swimming_pool\` | Preferences |
| \`contact_name\`, \`agent\`, \`owner\` | FK UUIDs |
| \`next_follow_up_date\`, \`created\`, \`enquiry_date\` | Dates |

Supply→demand: boost open leads against a listing's city/beds/price.
Discover all fields: \`qobrix_get_schema({ resource: "Opportunities" })\`
`;

export const CONTACT_FIELD_CHEATSHEET = `# Contacts — high-value searchable / boost fields

| Field | Use for |
|-------|---------|
| \`name\`, \`first_name\`, \`last_name\` | Identity |
| \`email\`, \`phone\` | Contact info |
| \`city\`, \`country\`, \`nationality\` | Geography |
| \`assigned_to\` | Owner (or CURRENT_USER) |
| \`is_company\`, \`role\` | Type / role |
| \`preferred_language\`, \`preferred_contact_method\` | Preferences |
| \`created\`, \`modified\` | Dates |

Discover all fields: \`qobrix_get_schema({ resource: "Contacts" })\`
`;

export function buildDslHelpText(resource?: string): string {
  const parts = [SEARCH_DSL_REFERENCE];
  if (!resource) {
    parts.push(
      PROPERTY_FIELD_CHEATSHEET,
      PROJECT_FIELD_CHEATSHEET,
      OPPORTUNITY_FIELD_CHEATSHEET,
      CONTACT_FIELD_CHEATSHEET
    );
    return parts.join("\n");
  }
  const key = resource.trim().toLowerCase();
  if (key === "properties" || key === "property") {
    parts.push(PROPERTY_FIELD_CHEATSHEET);
  } else if (key === "projects" || key === "project") {
    parts.push(PROJECT_FIELD_CHEATSHEET);
  } else if (key === "opportunities" || key === "opportunity" || key === "leads" || key === "lead") {
    parts.push(OPPORTUNITY_FIELD_CHEATSHEET);
  } else if (key === "contacts" || key === "contact") {
    parts.push(CONTACT_FIELD_CHEATSHEET);
  } else {
    parts.push(
      `\n# Resource: ${resource}\n` +
        `No built-in cheatsheet. Call qobrix_get_schema({ resource: "${resource}" }) ` +
        `and qobrix_get_field_options for enum values.\n`
    );
  }
  return parts.join("\n");
}
