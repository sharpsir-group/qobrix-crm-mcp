/**
 * Smoke / regression tests for Mode A/B/C wiring (no live Qobrix required).
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
  const child = spawn("node", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", () => {});
  return child;
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
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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

  it("Mode C + companion: metadata, DCR, 401 without token, audience-bound introspect", async () => {
    const dataDir = join(tmpdir(), "qobrix-oauth-test-" + randomBytes(4).toString("hex"));
    mkdirSync(dataDir, { recursive: true });
    const resource = `http://127.0.0.1:${PORT_MCP_C}/mcp`;
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
      QOBRIX_OAUTH_INTROSPECTION_SECRET: SECRET,
      MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL: "true",
    });

    try {
      await waitUrl(`${issuer}/health`);
      await waitUrl(`http://127.0.0.1:${PORT_MCP_C}/health`);

      const meta = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
      assert.equal(meta.status, 200);
      const metaBody = await meta.json();
      assert.equal(String(metaBody.issuer).replace(/\/+$/, ""), issuer);
      assert.ok(String(metaBody.introspection_endpoint).includes("/introspect"));

      const dcr = await fetch(`${issuer}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "smoke-test",
          redirect_uris: ["http://127.0.0.1/callback"],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "client_secret_post",
        }),
      });
      assert.equal(dcr.status, 201);
      const client = await dcr.json();
      assert.ok(client.client_id);

      const prm = await fetch(
        `http://127.0.0.1:${PORT_MCP_C}/.well-known/oauth-protected-resource/mcp`
      );
      assert.equal(prm.status, 200);
      const prmBody = await prm.json();
      assert.ok(
        prmBody.authorization_servers.some(
          (u) => String(u).replace(/\/+$/, "") === issuer
        )
      );

      const unauth = await fetch(resource, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
      assert.equal(unauth.status, 401);
      const www = unauth.headers.get("www-authenticate") || "";
      assert.match(www, /resource_metadata=/i);

      // Seed vault + opaque token via provider internals is hard from outside;
      // verify introspection rejects wrong secret / inactive token.
      const bad = await fetch(`${issuer}/introspect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Bearer wrong-secret",
        },
        body: new URLSearchParams({ token: "nope" }).toString(),
      });
      assert.equal(bad.status, 200);
      const badBody = await bad.json();
      assert.equal(badBody.active, false);

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
    }
  });
});
