import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListTasksSchema,
  GetTaskSchema,
  SearchTasksSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerTaskTools(server: McpServer): void {
  server.tool(
    "qobrix_list_tasks",
    "List tasks — the operational backbone of all canonical workflows: Follow-up, Pipeline Management, and Listing Checklists. " +
    "Tasks drive daily agent cadence: overdue follow-ups, listing prep, closing steps, payment tracking. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Include: AssignedToUsers (task owner), ContactContacts (related person), Properties (listing), " +
    "RelatedOpportunityOpportunities (lead), RelatedAgentAgents, RelatedContractContracts, " +
    "TaskStatus, TaskTypes, CreatedByUsers, ModifiedByUsers. " +
    "Canonical patterns: " +
    "My open tasks: search with assigned_to == CURRENT_USER and status != \"completed\". " +
    "Overdue: search with due_date <= NOW and status == \"pending\". " +
    "Tasks for a lead: search with related opportunity FK. " +
    "Listing checklist: search tasks linked to a property UUID.",
    ListTasksSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("tasks", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_task",
    "Get a single task by UUID — task detail for pipeline management and follow-up audit. " +
    "Returns { data: { id, ... } }. " +
    "Include: AssignedToUsers (who), ContactContacts (for whom), Properties (which listing), " +
    "RelatedOpportunityOpportunities (which deal), RelatedAgentAgents, TaskStatus, TaskTypes.",
    GetTaskSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("tasks", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_tasks",
    "Search tasks — the daily operations tool for pipeline and follow-up management. " +
    "Canonical recipes: " +
    "My open tasks: assigned_to == CURRENT_USER and status != \"completed\". " +
    "Overdue follow-ups: due_date <= NOW and status == \"pending\" (zero tolerance rule). " +
    "This week's tasks: created >= THIS_WEEK. " +
    "Tasks for a contact: contact == \"<uuid>\". " +
    "Tasks for a deal: search by related opportunity FK. " +
    "Use qobrix_get_schema with resource='Tasks' to discover all searchable fields.",
    SearchTasksSchema.shape,
    async ({ search, limit, page, sort }) => {
      try {
        const result = await getClient().list("tasks", {
          search, limit, page, sort,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
