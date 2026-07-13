/**
 * Per-request MCP server handle so tool handlers can inspect client
 * capabilities (e.g. URL-mode elicitation) and send completion notifications.
 * Also carries the Mode C vaultKey for per-user session isolation.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_VAULT_KEY } from "./identity.js";

export type RequestContext = {
  mcpServer?: McpServer;
  /** Mode C per-user vault key (`{platform}:{userId}` or `default`). */
  vaultKey?: string;
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

export function getRequestVaultKey(): string {
  return requestStorage.getStore()?.vaultKey || DEFAULT_VAULT_KEY;
}

/** True when the connected client declared elicitation.url capability. */
export function clientSupportsUrlElicitation(): boolean {
  const caps = getRequestMcpServer()?.server.getClientCapabilities();
  const elicitation = caps?.elicitation as
    | { url?: boolean; form?: boolean }
    | undefined;
  return Boolean(elicitation?.url);
}
