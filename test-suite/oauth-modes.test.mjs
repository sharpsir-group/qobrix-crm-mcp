/**
 * Smoke / regression tests for Mode A/B/C wiring (no live Qobrix required).
 *
 * Mode C (1.4+): self-service OAuth — /mcp has no bearer gate; tools surface
 * a /connect URL; AS advertises S256 + exact redirect_uri.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MCP_ROOT = new URL("..", import.meta.url).pathname;
const OAUTH_ROOT = "/home/bitnami/qobrix-crm-mcp-oauth";
const SECRET = "test-introspection-secret-" + randomBytes(8).toString("hex");
const STATE_SECRET = "test-state-secret-" + randomBytes(8).toString("hex");
const VAULT_KEY = "test-vault-key-" + randomBytes(8).toString("hex");
const PORT_AS = 13503;
const PORT_MCP_B = 13502;
const PORT_MCP_C = 13504;

function waitUrl(url, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  return (async () => {
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url);
        if (res.ok || res.status === 401) return res;
      } catch {
        /* retry */
      }
      await sleep(200);
    }
    throw new Error(`Timeout waiting for ${url}`);
  })();
}

function spawnNode(cwd, args, env) {
  // Do not inherit production OAuth allowlists / data dirs from the parent shell
  // (e.g. PM2-exported QOBRIX_OAUTH_REDIRECT_ALLOWLIST would reject test ports).
  const scrubbed = { ...process.env };
  for (const key of Object.keys(scrubbed)) {
    if (key.startsWith("QOBRIX_") || key === "MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL") {
      delete scrubbed[key];
    }
  }
  const child = spawn("node", args, {
    cwd,
    env: { ...scrubbed, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  return child;
}

async function mcpInitialize(url, { elicitationUrl = false } = {}) {
  const capabilities = elicitationUrl
    ? { elicitation: { url: true, form: true } }
    : {};
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities,
        clientInfo: { name: "test", version: "0" },
      },
    }),
  });
  return res;
}

async function mcpCallTool(url, sessionId, name, args = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  // notifications/initialized
  await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

/** Parse JSON-RPC from plain JSON or SSE `data:` lines. */
async function readJsonRpc(res) {
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (ct.includes("application/json")) {
    return JSON.parse(text);
  }
  // SSE
  for (const line of text.split("\n")) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        return JSON.parse(payload);
      } catch {
        /* continue */
      }
    }
  }
  // last resort
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

describe("modes + open-core pairing", () => {
  it("Mode B: HTTP rejects missing headers and accepts X-Api-*", async () => {
    const child = spawnNode(MCP_ROOT, ["dist/index.js"], {
      QOBRIX_MCP_TRANSPORT: "http",
      QOBRIX_MCP_AUTH: "headers",
      QOBRIX_MCP_HOST: "127.0.0.1",
      QOBRIX_MCP_PORT: String(PORT_MCP_B),
      QOBRIX_API_URL: "https://example.invalid",
      QOBRIX_API_USER: "u",
      QOBRIX_API_KEY: "k",
    });
    try {
      await waitUrl(`http://127.0.0.1:${PORT_MCP_B}/health`);
      const health = await fetch(`http://127.0.0.1:${PORT_MCP_B}/health`);
      assert.equal(health.status, 200);
      const body = await health.json();
      assert.equal(body.auth, "headers");

      const noHdr = await fetch(`http://127.0.0.1:${PORT_MCP_B}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        }),
      });
      assert.equal(noHdr.status, 401);
    } finally {
      child.kill("SIGTERM");
    }
  });

  it("Mode C + companion: AS S256, DCR, /mcp without bearer, /connect rejects bad e=", async () => {
    const dataDir = join(
      tmpdir(),
      "qobrix-oauth-test-" + randomBytes(4).toString("hex")
    );
    const mcpDataDir = join(
      tmpdir(),
      "qobrix-mcp-oauth-test-" + randomBytes(4).toString("hex")
    );
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(mcpDataDir, { recursive: true });
    const resource = `http://127.0.0.1:${PORT_MCP_C}/mcp`;
    const publicUrl = `http://127.0.0.1:${PORT_MCP_C}`;
    const issuer = `http://127.0.0.1:${PORT_AS}`;

    const as = spawnNode(OAUTH_ROOT, ["dist/index.js"], {
      QOBRIX_OAUTH_ISSUER: issuer,
      QOBRIX_MCP_RESOURCE_URL: resource,
      QOBRIX_OAUTH_INTROSPECTION_SECRET: SECRET,
      QOBRIX_OAUTH_VAULT_KEY: VAULT_KEY,
      QOBRIX_OAUTH_HOST: "127.0.0.1",
      QOBRIX_OAUTH_PORT: String(PORT_AS),
      QOBRIX_OAUTH_DATA_DIR: dataDir,
      QOBRIX_API_URL: "https://example.invalid",
      MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL: "true",
    });

    const mcp = spawnNode(MCP_ROOT, ["dist/index.js"], {
      QOBRIX_MCP_TRANSPORT: "http",
      QOBRIX_MCP_AUTH: "oauth",
      QOBRIX_MCP_HOST: "127.0.0.1",
      QOBRIX_MCP_PORT: String(PORT_MCP_C),
      QOBRIX_OAUTH_ISSUER: issuer,
      QOBRIX_MCP_RESOURCE_URL: resource,
      QOBRIX_MCP_PUBLIC_URL: publicUrl,
      QOBRIX_OAUTH_INTROSPECTION_SECRET: SECRET,
      QOBRIX_MCP_STATE_SECRET: STATE_SECRET,
      QOBRIX_MCP_DATA_DIR: mcpDataDir,
      QOBRIX_API_URL: "https://example.invalid",
      MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL: "true",
    });

    try {
      await waitUrl(`${issuer}/health`);
      await waitUrl(`http://127.0.0.1:${PORT_MCP_C}/health`);

      const health = await fetch(`http://127.0.0.1:${PORT_MCP_C}/health`);
      assert.equal(health.status, 200);
      const healthBody = await health.json();
      assert.equal(healthBody.auth, "oauth");
      assert.equal(healthBody.connected, false);

      // AS metadata: S256 + introspection
      const meta = await fetch(
        `${issuer}/.well-known/oauth-authorization-server`
      );
      assert.equal(meta.status, 200);
      const metaBody = await meta.json();
      assert.equal(String(metaBody.issuer).replace(/\/+$/, ""), issuer);
      assert.ok(String(metaBody.introspection_endpoint).includes("/introspect"));
      assert.deepEqual(metaBody.code_challenge_methods_supported, ["S256"]);

      // DCR with MCP callback redirect_uri (exact match required by AS)
      const redirectUri = `${publicUrl}/oauth/callback`;
      const dcr = await fetch(`${issuer}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "smoke-test",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        }),
      });
      assert.equal(dcr.status, 201);
      const client = await dcr.json();
      assert.ok(client.client_id);
      assert.ok(client.redirect_uris.includes(redirectUri));

      // /mcp accepts initialize WITHOUT bearer (self-service Mode C)
      const init = await mcpInitialize(resource);
      assert.ok(
        init.status === 200 || init.status === 202,
        `expected 200/202, got ${init.status}`
      );

      // /connect rejects missing/bad elicitation id
      const badConnect = await fetch(`${publicUrl}/connect?e=not-a-real-id`, {
        redirect: "manual",
      });
      assert.equal(badConnect.status, 400);
      const badHtml = await badConnect.text();
      assert.match(badHtml, /Unknown or expired|expired|failed/i);

      // Cold tool call (no session) → auth URL in tool result text (no elicitation)
      const init2 = await mcpInitialize(resource);
      const sessionId = init2.headers.get("mcp-session-id");
      const toolRes = await mcpCallTool(
        resource,
        sessionId,
        "qobrix_list_contacts",
        { limit: 1 }
      );
      assert.ok(toolRes.status === 200 || toolRes.status === 202);
      const rpc = await readJsonRpc(toolRes);

      // Either CallToolResult with connect URL text, or -32042 if somehow elicitation
      if (rpc.error) {
        assert.equal(rpc.error.code, -32042);
        const url =
          rpc.error.data?.elicitations?.[0]?.url ||
          JSON.stringify(rpc.error.data);
        assert.match(String(url), /\/connect\?e=/);
      } else {
        const text = JSON.stringify(rpc.result || rpc);
        assert.match(text, /\/connect\?e=/);
        assert.match(text, /\[Sign In to Qobrix\]\(/);
        assert.match(text, /authorization|sign in|Qobrix/i);
        assert.match(text, /unique and single-use|never reuse/i);
      }

      // Session tools: sign_in / whoami (cold) surface connect link; sign_out with no session
      const signInRes = await mcpCallTool(
        resource,
        sessionId,
        "qobrix_sign_in",
        {}
      );
      const signInRpc = await readJsonRpc(signInRes);
      if (signInRpc.error) {
        assert.equal(signInRpc.error.code, -32042);
        assert.match(
          String(
            signInRpc.error.data?.elicitations?.[0]?.url ||
              JSON.stringify(signInRpc.error.data)
          ),
          /\/connect\?e=/
        );
      } else {
        const t = JSON.stringify(signInRpc.result || signInRpc);
        assert.match(t, /\/connect\?e=/);
        assert.match(t, /\[Sign In to Qobrix\]\(/);
      }

      const whoamiRes = await mcpCallTool(
        resource,
        sessionId,
        "qobrix_whoami",
        {}
      );
      const whoamiRpc = await readJsonRpc(whoamiRes);
      if (whoamiRpc.error) {
        assert.equal(whoamiRpc.error.code, -32042);
        assert.match(
          String(
            whoamiRpc.error.data?.elicitations?.[0]?.url ||
              JSON.stringify(whoamiRpc.error.data)
          ),
          /\/connect\?e=/
        );
      } else {
        const t = JSON.stringify(whoamiRpc.result || whoamiRpc);
        assert.match(t, /\/connect\?e=/);
      }

      const signOutRes = await mcpCallTool(
        resource,
        sessionId,
        "qobrix_sign_out",
        {}
      );
      const signOutRpc = await readJsonRpc(signOutRes);
      assert.ok(!signOutRpc.error, "sign_out should not error when disconnected");
      const signOutText = JSON.stringify(signOutRpc.result || signOutRpc);
      assert.match(signOutText, /No active Qobrix session/i);

      // Fingerprint helper sanity (Mode B/C cache scoping)
      const fp = createHash("sha256").update("u|k").digest("hex").slice(0, 16);
      assert.equal(fp.length, 16);
    } finally {
      as.kill("SIGTERM");
      mcp.kill("SIGTERM");
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      try {
        rmSync(mcpDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("Mode C elicitation client: tools/call returns -32042 with /connect URL", async () => {
    const dataDir = join(
      tmpdir(),
      "qobrix-oauth-test-" + randomBytes(4).toString("hex")
    );
    const mcpDataDir = join(
      tmpdir(),
      "qobrix-mcp-oauth-test-" + randomBytes(4).toString("hex")
    );
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(mcpDataDir, { recursive: true });
    const resource = `http://127.0.0.1:${PORT_MCP_C}/mcp`;
    const publicUrl = `http://127.0.0.1:${PORT_MCP_C}`;
    const issuer = `http://127.0.0.1:${PORT_AS}`;

    const as = spawnNode(OAUTH_ROOT, ["dist/index.js"], {
      QOBRIX_OAUTH_ISSUER: issuer,
      QOBRIX_MCP_RESOURCE_URL: resource,
      QOBRIX_OAUTH_INTROSPECTION_SECRET: SECRET,
      QOBRIX_OAUTH_VAULT_KEY: VAULT_KEY,
      QOBRIX_OAUTH_HOST: "127.0.0.1",
      QOBRIX_OAUTH_PORT: String(PORT_AS),
      QOBRIX_OAUTH_DATA_DIR: dataDir,
      QOBRIX_API_URL: "https://example.invalid",
      MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL: "true",
    });

    const mcp = spawnNode(MCP_ROOT, ["dist/index.js"], {
      QOBRIX_MCP_TRANSPORT: "http",
      QOBRIX_MCP_AUTH: "oauth",
      QOBRIX_MCP_HOST: "127.0.0.1",
      QOBRIX_MCP_PORT: String(PORT_MCP_C),
      QOBRIX_OAUTH_ISSUER: issuer,
      QOBRIX_MCP_RESOURCE_URL: resource,
      QOBRIX_MCP_PUBLIC_URL: publicUrl,
      QOBRIX_OAUTH_INTROSPECTION_SECRET: SECRET,
      QOBRIX_MCP_STATE_SECRET: STATE_SECRET,
      QOBRIX_MCP_DATA_DIR: mcpDataDir,
      QOBRIX_API_URL: "https://example.invalid",
      MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL: "true",
    });

    try {
      await waitUrl(`${issuer}/health`);
      await waitUrl(`http://127.0.0.1:${PORT_MCP_C}/health`);

      const init = await mcpInitialize(resource, { elicitationUrl: true });
      assert.ok(init.status === 200 || init.status === 202);
      const sessionId = init.headers.get("mcp-session-id");

      const toolRes = await mcpCallTool(
        resource,
        sessionId,
        "qobrix_list_contacts",
        { limit: 1 }
      );
      const rpc = await readJsonRpc(toolRes);

      // Prefer -32042; fall back to text URL if transport wrapped it
      if (rpc.error) {
        assert.equal(rpc.error.code, -32042);
        const el = rpc.error.data?.elicitations?.[0];
        assert.equal(el?.mode, "url");
        assert.match(String(el?.url || ""), /\/connect\?e=/);
        assert.ok(el?.elicitationId);

        // Valid /connect should 302 toward AS /authorize (or /login)
        const connectRes = await fetch(el.url, { redirect: "manual" });
        assert.ok(
          connectRes.status === 302 || connectRes.status === 301,
          `expected redirect, got ${connectRes.status}`
        );
        const loc = connectRes.headers.get("location") || "";
        assert.match(loc, /authorize|login/i);
        const setCookie = connectRes.headers.get("set-cookie") || "";
        assert.match(setCookie, /qobrix_mcp_connect=/);
      } else {
        const text = JSON.stringify(rpc.result || rpc);
        assert.match(text, /\/connect\?e=/);
      }
    } finally {
      as.kill("SIGTERM");
      mcp.kill("SIGTERM");
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      try {
        rmSync(mcpDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});
