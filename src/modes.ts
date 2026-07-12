/**
 * Auth modes for qobrix-crm-mcp (open-core).
 *
 * A — stdio + env shared key (default, local/single-tenant).
 * B — HTTP + per-request X-Api-User / X-Api-Key (trusted callers, localhost).
 * C — HTTP + OAuth 2.1 resource server paired ONLY with qobrix-crm-mcp-oauth.
 *
 * Trust boundaries:
 * - A: process owner controls env secrets; one shared Qobrix identity.
 * - B: caller is trusted (same host / private network); credentials are
 *   request-scoped and must never be logged. Bind to 127.0.0.1 by default.
 * - C: end-user authenticates at qobrix-crm-mcp-oauth; this server validates
 *   audience-bound bearer tokens and resolves per-user Qobrix API keys via
 *   introspection. No third-party authorization servers.
 */

export type AuthMode = "env" | "headers" | "oauth";

export type TransportMode = "stdio" | "http";

export function resolveTransport(): TransportMode {
  const raw = (process.env.QOBRIX_MCP_TRANSPORT || "stdio").toLowerCase().trim();
  if (raw === "http" || raw === "streamable_http" || raw === "streamable-http") {
    return "http";
  }
  return "stdio";
}

/**
 * Resolve the HTTP auth mode. Stdio always uses env credentials (Mode A).
 * HTTP defaults to headers (Mode B) unless QOBRIX_MCP_AUTH=oauth (Mode C).
 */
export function resolveAuthMode(transport: TransportMode = resolveTransport()): AuthMode {
  if (transport === "stdio") return "env";
  const raw = (process.env.QOBRIX_MCP_AUTH || "headers").toLowerCase().trim();
  if (raw === "oauth" || raw === "oauth2" || raw === "c") return "oauth";
  if (raw === "env" || raw === "a") return "env";
  return "headers";
}

export function modeDescription(mode: AuthMode): string {
  switch (mode) {
    case "env":
      return "Mode A: shared Qobrix credentials from process.env";
    case "headers":
      return "Mode B: per-request X-Api-User / X-Api-Key (trusted callers)";
    case "oauth":
      return "Mode C: OAuth 2.1 RS paired with qobrix-crm-mcp-oauth";
  }
}
