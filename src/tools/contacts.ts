import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListContactsSchema,
  GetContactSchema,
  SearchContactsSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerContactTools(server: McpServer): void {
  server.tool(
    "qobrix_list_contacts",
    "List contacts (RESO Contacts resource) from Qobrix CRM — the people/companies in the CRM. " +
    "Core to the Lead-Contact Lifecycle: a Contact becomes a Lead when an Opportunity is created for them. " +
    "RESO ContactType mapping: use opportunity.enquiry_type and property.seller FK to determine Buyer/Seller/Tenant role. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Key fields (42 total): first_name, last_name, name, email, phone, city, country, " +
    "assigned_to (UUID → user, RESO OwnerMember), role, is_company, nationality, " +
    "preferred_language, preferred_contact_method, consent fields, created, modified. " +
    "Cross-references: property.seller → Contact UUID, opportunity.contact_name → Contact UUID, " +
    "task.contact → Contact UUID, call/meeting.contact → Contact UUID. " +
    "Workflow: to see a contact's full journey, search Opportunities, Tasks, Calls, and Meetings by their UUID.",
    ListContactsSchema.shape,
    async ({ limit, page, sort, fields, include, search, segment }) => {
      try {
        const result = await getClient().list("contacts", {
          limit, page, sort, fields, include, search, segment,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_contact",
    "Get a single contact by UUID — the person/company detail view in the Lead-Contact Lifecycle. " +
    "Returns { data: { id, first_name, last_name, email, phone, ... } }. " +
    "Verified include: AssignedToUsers (RESO OwnerMember), User, Language, Organizations. " +
    "To build the full contact journey (canonical 360° view): " +
    "1. Leads: qobrix_search_opportunities with contact_name == '<uuid>' " +
    "2. Tasks: qobrix_search_tasks with contact == '<uuid>' " +
    "3. Calls: qobrix_search_calls (search by contact FK) " +
    "4. Meetings: qobrix_search_meetings (search by contact FK) " +
    "5. Seller listings: qobrix_search_properties with seller == '<uuid>' " +
    "This contact 360° pattern is the core of Lead-Contact Lifecycle and Follow-up workflows.",
    GetContactSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("contacts", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_contacts",
    "Search contacts using Qobrix search expressions — find people/companies in the Lead-Contact Lifecycle. " +
    "Use to segment the contact database by geography, language, role, or creation date. " +
    "Examples: " +
    "My contacts: assigned_to == CURRENT_USER. " +
    "By geography: country == \"CY\" and city == \"Limassol\". " +
    "New contacts this month: created >= THIS_MONTH. " +
    "Companies: is_company == true. " +
    "By language: preferred_language == \"en\". " +
    "By name: name contains \"Smith\". " +
    "Key fields: first_name, last_name, name, email, phone, city, country, " +
    "nationality, assigned_to, role, is_company, preferred_language, created, modified. " +
    "After finding contacts, search Opportunities by contact_name to check their lead status in the funnel.",
    SearchContactsSchema.shape,
    async ({ search, limit, page, sort, fields }) => {
      try {
        const result = await getClient().list("contacts", {
          search, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
