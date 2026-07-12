/**
 * Per-request MCP server handle so tool handlers can inspect client
 * capabilities (e.g. URL-mode elicitation) and send completion notifications.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type RequestContext = {
  mcpServer?: McpServer;
};

const requestStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestStorage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function getRequestMcpServer(): McpServer | undefined {
  return requestStorage.getStore()?.mcpServer;
}

/** True when the connected client declared elicitation.url capability. */
export function clientSupportsUrlElicitation(): boolean {
  const caps = getRequestMcpServer()?.server.getClientCapabilities();
  const elicitation = caps?.elicitation as
    | { url?: boolean; form?: boolean }
    | undefined;
  return Boolean(elicitation?.url);
}
