/**
 * Streamable HTTP transport for qobrix-crm-mcp.
 *
 * Mode B (default for HTTP): per-request X-Api-User / X-Api-Key → ALS.
 * Mode C (QOBRIX_MCP_AUTH=oauth): self-service OAuth client paired with
 *   qobrix-crm-mcp-oauth. /mcp is reachable without a bearer; tools surface
 *   a /connect URL (elicitation -32042 or tool-result text) when the session
 *   vault is empty. After browser login, /oauth/callback stores Qobrix creds.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import { disableEnvFallback } from "./client.js";
import { runWithAuthAsync, type AuthCredentials } from "./auth-context.js";
import { resolveAuthMode, modeDescription } from "./modes.js";
import { requireOAuthEnv } from "./oauth-rs.js";
import { runWithRequestContext } from "./request-context.js";
import {
  authorizeRedirect,
  connectCookieName,
  ensureClientRegistered,
  getSessionCredentials,
  handleCallback,
  refreshIfNeeded,
  signCookie,
} from "./oauth-client.js";

const MCP_PATH = "/mcp";

function readHeaderCreds(req: Request): AuthCredentials | null {
  const apiUser = String(req.headers["x-api-user"] || "").trim();
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  if (!apiUser || !apiKey) return null;
  const apiUrl = String(req.headers["x-qobrix-api-url"] || "").trim() || undefined;
  const locale = String(req.headers["x-locale"] || "").trim() || undefined;
  return { apiUser, apiKey, apiUrl, locale };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function successHtml(subject?: string): string {
  const who = subject ? ` (subject ${subject.slice(0, 12)}…)` : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Qobrix connected</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
  h1{font-size:1.25rem} .ok{color:#0a7a3e}
</style></head><body>
  <h1 class="ok">Connected to Qobrix</h1>
  <p>Authorization completed${who}. You can close this tab and return to the chat — ask the agent to retry.</p>
</body></html>`;
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Authorization failed</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
  h1{font-size:1.25rem;color:#a11} code{word-break:break-all}
</style></head><body>
  <h1>Authorization failed</h1>
  <p><code>${message.replace(/[<>&]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c)
  )}</code></p>
  <p>Return to the chat and ask the agent to request authorization again.</p>
</body></html>`;
}

export async function startHttpServer(): Promise<void> {
  const port = Number(process.env.QOBRIX_MCP_PORT || 3502);
  const host = process.env.QOBRIX_MCP_HOST || "127.0.0.1";
  const authMode = resolveAuthMode("http");

  const app = createMcpExpressApp({
    host,
    allowedHosts: process.env.QOBRIX_MCP_ALLOWED_HOSTS
      ? process.env.QOBRIX_MCP_ALLOWED_HOSTS.split(",").map((s) => s.trim())
      : undefined,
  });

  app.use(
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.QOBRIX_MCP_RATE_LIMIT || 300),
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      transport: "http",
      auth: authMode,
      description: modeDescription(authMode),
      connected:
        authMode === "oauth" ? Boolean(getSessionCredentials()) : undefined,
    });
  });

  // Modes B/C are strictly per-request (or session vault): never fall back to
  // a shared env account inside tool handlers.
  if (authMode === "oauth" || authMode === "headers") {
    disableEnvFallback();
  }

  if (authMode === "env" && !isLoopbackHost(host)) {
    process.stderr.write(
      "[qobrix-crm-mcp] WARNING: Mode A over HTTP shares one Qobrix account with every caller and is bound to a non-loopback host. Use QOBRIX_MCP_AUTH=headers or oauth for multi-user access.\n"
    );
  }

  if (authMode === "oauth") {
    // Validate env early; DCR can wait until first /connect.
    requireOAuthEnv();
    if (!isLoopbackHost(host) && !process.env.QOBRIX_MCP_ALLOWED_HOSTS) {
      process.stderr.write(
        "[qobrix-crm-mcp] WARNING: Mode C leaves /mcp unauthenticated to the MCP client and uses a single shared session vault. Bind QOBRIX_MCP_HOST to 127.0.0.1 (or set QOBRIX_MCP_ALLOWED_HOSTS) so only trusted callers can use the vault.\n"
      );
    }

    // Pre-register as AS client so /connect is fast; non-fatal if AS is down at boot.
    try {
      await ensureClientRegistered();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[qobrix-crm-mcp] Mode C DCR deferred (will retry on /connect): ${msg}\n`
      );
    }

    app.get("/connect", async (req, res) => {
      const elicitationId = String(req.query.e || "").trim();
      if (!elicitationId) {
        res.status(400).send(errorHtml("Missing connect parameter e="));
        return;
      }
      try {
        const { authorizeUrl, cookiePayload } =
          await authorizeRedirect(elicitationId);
        const signed = signCookie(cookiePayload);
        const secure = publicUrlIsHttps();
        res.setHeader(
          "Set-Cookie",
          `${connectCookieName()}=${encodeURIComponent(signed)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`
        );
        res.redirect(302, authorizeUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).send(errorHtml(msg));
      }
    });

    app.get("/oauth/callback", async (req, res) => {
      const err = String(req.query.error || "").trim();
      if (err) {
        const desc = String(req.query.error_description || err);
        res.status(400).send(errorHtml(desc));
        return;
      }
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();
      if (!code || !state) {
        res.status(400).send(errorHtml("Missing code or state"));
        return;
      }
      try {
        const result = await handleCallback({
          code,
          state,
          cookieHeader: req.headers.cookie,
        });
        // Clear connect cookie
        res.setHeader(
          "Set-Cookie",
          `${connectCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
        );
        res.status(200).send(successHtml(result.subject));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        res.status(400).send(errorHtml(msg));
      }
    });
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  /** Keep McpServer refs for request-context (elicitation capabilities). */
  const servers = new WeakMap<StreamableHTTPServerTransport, McpServer>();

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    let activeServer: McpServer | undefined;

    const run = async () => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
        activeServer = transport ? servers.get(transport) : undefined;
      } else if (req.method === "POST" && isInitializeRequest(req.body)) {
        const server = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport!);
          },
        });
        transport.onclose = () => {
          const sid = transport?.sessionId;
          if (sid) transports.delete(sid);
        };
        servers.set(transport, server);
        activeServer = server;
        await server.connect(transport);
      } else if (sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
        return;
      } else {
        // Stateless single-shot: create ephemeral transport for this request.
        const server = createServer();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        servers.set(transport, server);
        activeServer = server;
        await server.connect(transport);
      }

      // Only POST carries a JSON-RPC body. The SDK treats any non-undefined
      // parsedBody as the message, so passing Express's `{}` on a GET/DELETE
      // would corrupt the SSE stream / delete handling.
      const parsedBody = req.method === "POST" ? req.body : undefined;
      await runWithRequestContext({ mcpServer: activeServer }, async () => {
        await transport!.handleRequest(req, res, parsedBody);
      });
    };

    if (authMode === "oauth") {
      // Self-service Mode C: no bearer required. Use vault creds when present.
      let creds = await refreshIfNeeded();
      if (!creds) creds = getSessionCredentials();
      if (creds) {
        await runWithAuthAsync(creds, run);
      } else {
        // Unauthenticated marker path: tools raise AuthRequiredError → URL.
        await run();
      }
      return;
    }

    if (authMode === "headers") {
      const creds = readHeaderCreds(req);
      if (!creds) {
        res.status(401).json({
          error: "unauthorized",
          error_description:
            "Mode B requires X-Api-User and X-Api-Key request headers",
        });
        return;
      }
      await runWithAuthAsync(creds, run);
      return;
    }

    // Mode A over HTTP: shared env credentials (rare; useful for smoke tests).
    await run();
  };

  const mcpRoutes = [MCP_PATH];
  for (const path of mcpRoutes) {
    app.post(path, (req, res) => {
      void handleMcp(req, res);
    });
    app.get(path, (req, res) => {
      void handleMcp(req, res);
    });
    app.delete(path, (req, res) => {
      void handleMcp(req, res);
    });
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      process.stderr.write(
        `[qobrix-crm-mcp] HTTP listening on http://${host}:${port}${MCP_PATH} (${modeDescription(authMode)})\n`
      );
      if (authMode === "oauth") {
        try {
          const { resourceServerUrl } = requireOAuthEnv();
          process.stderr.write(
            `[qobrix-crm-mcp] Resource URL: ${resourceServerUrl.href}\n`
          );
          process.stderr.write(
            `[qobrix-crm-mcp] Connect URL base: ${process.env.QOBRIX_MCP_PUBLIC_URL || `http://${host}:${port}`}/connect\n`
          );
        } catch {
          /* already validated above */
        }
      }
      resolve();
    });
    server.on("error", reject);
  });

  const shutdown = async () => {
    for (const t of transports.values()) {
      await t.close().catch(() => undefined);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

function publicUrlIsHttps(): boolean {
  const raw =
    process.env.QOBRIX_MCP_PUBLIC_URL ||
    `http://127.0.0.1:${process.env.QOBRIX_MCP_PORT || "3502"}`;
  return raw.startsWith("https://");
}
