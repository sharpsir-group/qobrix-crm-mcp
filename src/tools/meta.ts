import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  GetSchemaSchema,
  GetFieldOptionsSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerMetaTools(server: McpServer): void {
  server.tool(
    "qobrix_get_schema",
    "Get the full field schema for any CRM resource — the Schema Discovery tool. " +
    "CALL THIS FIRST when unsure about field names for search, fields[], or sort. " +
    "Returns every field with name, type, label, and validation rules (RESO Data Dictionary equivalent). " +
    "Resources (case-sensitive): Properties, Contacts, Opportunities, Agents, Tasks, " +
    "PropertyViewings, Projects, Offers, Contracts, Calls, Meetings, EmailMessages, " +
    "Media, PropertyTypes, PropertySubtypes, PropertyFeatures, Locations. " +
    "Canonical use: before building search expressions for any workflow (Listing, Sales Pipeline, Follow-up), " +
    "call this to discover the correct field names. The schema is the source of truth. " +
    "Pair with qobrix_get_field_options to see allowed enum values for dropdown fields.",
    GetSchemaSchema.shape,
    async ({ resource }) => {
      try {
        const result = await getClient().getPath(`schema/${resource}`);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_field_options",
    "Get dropdown/enum field options — discover valid values for status fields, types, and categories. " +
    "Essential for building correct search expressions in any workflow. " +
    "Returns { data: [...], pagination: { ... } }. Each item has: id, resource, field, label, value. " +
    "Key examples for canonical workflows: " +
    "Listing statuses: search='resource == \"Properties\" and field == \"status\"' → available/reserved/sold/withdrawn. " +
    "Lead statuses: search='resource == \"Opportunities\" and field == \"status\"' → new/open/won/closed_lost. " +
    "Property types: search='resource == \"Properties\" and field == \"property_type\"'. " +
    "Task types: search='resource == \"Tasks\" and field == \"task_type\"'. " +
    "Pair with qobrix_get_schema for complete field discovery.",
    GetFieldOptionsSchema.shape,
    async ({ limit, page, search }) => {
      try {
        const result = await getClient().list("field-options", {
          limit, page, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
