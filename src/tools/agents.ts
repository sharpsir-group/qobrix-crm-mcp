import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
import {
  ListAgentsSchema,
  GetAgentSchema,
  SearchAgentsSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerAgentTools(server: McpServer): void {
  server.tool(
    "qobrix_list_agents",
    "List agents (RESO Member resource) — real estate brokers managing listings and leads. " +
    "Agents are the central actor across all workflows: they manage the Listing Lifecycle, drive the Sales Pipeline, " +
    "and own Follow-up activities. Referenced by property.agent and opportunity.agent FKs. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Verified include: PrimaryContactContacts, User, Brands, AgencyAgents (parent agency). " +
    "Workflow: to see an agent's full portfolio, search Properties and Opportunities by agent == '<uuid>'.",
    ListAgentsSchema.shape,
    async ({ limit, page, sort, fields, include, search }) => {
      try {
        const result = await getClient().list("agents", {
          limit, page, sort, fields, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_agent",
    "Get a single agent by UUID — resolve a RESO Member/ListAgent from a listing or lead. " +
    "Returns { data: { id, ref, ... } }. " +
    "Verified include: PrimaryContactContacts, User, Brands, AgencyAgents (parent brokerage). " +
    "Agent 360° pattern: " +
    "1. Active listings: qobrix_search_properties with agent == '<uuid>' and status == \"available\" " +
    "2. Active leads: qobrix_search_opportunities with agent == '<uuid>' and status == \"open\" " +
    "3. Pipeline deals: qobrix_search_offers / qobrix_search_contracts linked to agent's opportunities " +
    "4. Activity: search Tasks, Calls, Meetings by the agent FK",
    GetAgentSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("agents", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_agents",
    "Relevance-ranked agent search (F1-optimized). " +
    "TWO-TIER: `search` = hard must-haves; `boost[]` = soft weighted preferences; `limit`/`max_scan` control top-N and pool size. " +
    "With boost: `_relevance` + `_matched`; pagination.mode='ranked'. " +
    "Call qobrix_search_dsl_help({resource:'Agents'}) for DSL + fields. " +
    "Example: boost=[{field:'ref',op:'contains',value:'LIM',weight:2}], limit=10, max_scan=100.",
    SearchAgentsSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields }) => {
      try {
        const result = await relevanceSearch({
          resource: "agents",
          search, boost, max_scan, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
