import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
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
    "Relevance-ranked task search (F1-optimized) — daily ops for pipeline and follow-up. " +
    "TWO-TIER: `search` = hard must-haves; `boost[]` = soft weighted preferences; `limit`/`max_scan` for top-N and pool. " +
    "With boost: `_relevance` + `_matched`; pagination.mode='ranked'. " +
    "Call qobrix_search_dsl_help({resource:'Tasks'}) for fields. " +
    "Recipes: search='assigned_to == CURRENT_USER and status != \"completed\"', " +
    "boost=[{field:'due_date',op:'<=',value:'2026-12-31',weight:3}], limit=15, max_scan=100. " +
    "Overdue hard filter: due_date <= NOW and status == \"pending\".",
    SearchTasksSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields }) => {
      try {
        const result = await relevanceSearch({
          resource: "tasks",
          search, boost, max_scan, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
