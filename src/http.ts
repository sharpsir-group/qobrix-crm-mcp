/**
 * Streamable HTTP transport for qobrix-crm-mcp.
 *
 * Mode B (default for HTTP): per-request X-Api-User / X-Api-Key → ALS.
 * Mode C (QOBRIX_MCP_AUTH=oauth): OAuth 2.1 RS paired with qobrix-crm-mcp-oauth.
 */

import { randomUUID } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "./server.js";
import { disableEnvFallback } from "./client.js";
import { runWithAuthAsync, type AuthCredentials } from "./auth-context.js";
import { resolveAuthMode, modeDescription } from "./modes.js";
import {
  requireOAuthEnv,
  fetchAuthorizationServerMetadata,
  createCompanionTokenVerifier,
  credentialsFromAuthInfo,
} from "./oauth-rs.js";

const MCP_PATH = "/mcp";

function readHeaderCreds(req: Request): AuthCredentials | null {
  const apiUser = String(req.headers["x-api-user"] || "").trim();
  const apiKey = String(req.headers["x-api-key"] || "").trim();
  if (!apiUser || !apiKey) return null;
  const apiUrl = String(req.headers["x-qobrix-api-url"] || "").trim() || undefined;
  const locale = String(req.headers["x-locale"] || "").trim() || undefined;
  return { apiUser, apiKey, apiUrl, locale };
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
    });
  });

  let authMiddleware: RequestHandler | null = null;
  let resourceServerUrl: URL | null = null;

  // Modes B/C are strictly per-request: never fall back to a shared env account.
  if (authMode === "oauth" || authMode === "headers") {
    disableEnvFallback();
  } else if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    process.stderr.write(
      "[qobrix-crm-mcp] WARNING: Mode A over HTTP shares one Qobrix account with every caller and is bound to a non-loopback host. Use QOBRIX_MCP_AUTH=headers or oauth for multi-user access.\n"
    );
  }

  if (authMode === "oauth") {
    const { issuer, resourceServerUrl: rsUrl, introspectionSecret } =
      requireOAuthEnv();
    resourceServerUrl = rsUrl;
    const oauthMetadata = await fetchAuthorizationServerMetadata(issuer);
    const verifier = createCompanionTokenVerifier({
      issuer,
      resourceServerUrl: rsUrl,
      introspectionEndpoint: oauthMetadata.introspection_endpoint!,
      introspectionSecret,
    });

    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: rsUrl,
        scopesSupported: ["qobrix:read"],
        resourceName: "Qobrix CRM MCP",
      })
    );

    authMiddleware = requireBearerAuth({
      verifier,
      requiredScopes: ["qobrix:read"],
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(rsUrl),
    });
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const handleMcp = async (req: Request, res: Response): Promise<void> => {
    const run = async () => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && transports.has(sessionId)) {
        transport = transports.get(sessionId);
      } else if (
        req.method === "POST" &&
        isInitializeRequest(req.body)
      ) {
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
        await server.connect(transport);
      }

      // Only POST carries a JSON-RPC body. The SDK treats any non-undefined
      // parsedBody as the message, so passing Express's `{}` on a GET/DELETE
      // would corrupt the SSE stream / delete handling.
      const parsedBody = req.method === "POST" ? req.body : undefined;
      await transport!.handleRequest(req, res, parsedBody);
    };

    if (authMode === "oauth") {
      const creds = credentialsFromAuthInfo(req.auth);
      if (!creds) {
        res.status(401).json({ error: "missing_qobrix_credentials" });
        return;
      }
      await runWithAuthAsync(creds, run);
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
    if (authMiddleware) {
      app.post(path, authMiddleware, (req, res) => {
        void handleMcp(req, res);
      });
      app.get(path, authMiddleware, (req, res) => {
        void handleMcp(req, res);
      });
      app.delete(path, authMiddleware, (req, res) => {
        void handleMcp(req, res);
      });
    } else {
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
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      process.stderr.write(
        `[qobrix-crm-mcp] HTTP listening on http://${host}:${port}${MCP_PATH} (${modeDescription(authMode)})\n`
      );
      if (resourceServerUrl) {
        process.stderr.write(
          `[qobrix-crm-mcp] Resource URL: ${resourceServerUrl.href}\n`
        );
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
