import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
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
    "Search agents using Qobrix search expressions — find brokers by name, area, or specialization. " +
    "RESO Member equivalent. Agents are the key actor in Listing and Sales Pipeline workflows. " +
    "Use qobrix_get_schema with resource='Agents' to discover all searchable fields.",
    SearchAgentsSchema.shape,
    async ({ search, limit, page, sort }) => {
      try {
        const result = await getClient().list("agents", {
          search, limit, page, sort,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
