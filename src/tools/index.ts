import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPropertyTools } from "./properties.js";
import { registerContactTools } from "./contacts.js";
import { registerAgentTools } from "./agents.js";
import { registerOpportunityTools } from "./opportunities.js";
import { registerViewingTools } from "./viewings.js";
import { registerTaskTools } from "./tasks.js";
import { registerMediaTools } from "./media.js";
import { registerProjectTools } from "./projects.js";
import { registerOfferTools } from "./offers.js";
import { registerContractTools } from "./contracts.js";
import { registerActivityTools } from "./activities.js";
import { registerMetaTools } from "./meta.js";
import { registerAnalyticsTools } from "./analytics.js";

export function formatResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function errorResult(error: unknown) {
  const message =
    error instanceof Error ? error.message : "An unknown error occurred";
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
    isError: true as const,
  };
}

export function registerTools(server: McpServer): void {
  registerPropertyTools(server);
  registerContactTools(server);
  registerAgentTools(server);
  registerOpportunityTools(server);
  registerViewingTools(server);
  registerTaskTools(server);
  registerMediaTools(server);
  registerProjectTools(server);
  registerOfferTools(server);
  registerContractTools(server);
  registerActivityTools(server);
  registerMetaTools(server);
  registerAnalyticsTools(server);
}
