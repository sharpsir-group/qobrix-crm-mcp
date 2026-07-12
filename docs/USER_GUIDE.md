# User Guide — Qobrix CRM MCP

Connect Claude, Cursor, ChatGPT, PeerPane / ragchat, or any MCP client to live Qobrix CRM data. This guide walks the three auth modes in order of increasing capability.

| Mode | Transport | Credentials | Best for |
|------|-----------|-------------|----------|
| **A** (default, free) | stdio | Shared `QOBRIX_API_*` env | Local IDE, single shared identity |
| **B** (free) | HTTP | Per-request `X-Api-User` / `X-Api-Key` | Trusted private callers (localhost ragchat, internal services) |
| **C** (Enterprise) | HTTP | Self-service OAuth (`/connect` URL → login) | Per-user identity; agent works as the signed-in CRM user |

**Prerequisites (all modes):** Node.js **≥ 20**, a Qobrix tenant URL, and API credentials (Modes A/B) or the **Enterprise OAuth** bundle (Mode C).

```bash
git clone https://github.com/sharpsir-group/qobrix-crm-mcp.git
cd qobrix-crm-mcp
cp .env.example .env   # fill QOBRIX_API_* for Modes A/B
npm install
npm run build
```

---

## Which mode do I want?

- Use **Mode A** if you are wiring Cursor / Claude Desktop for yourself with one service account.
- Use **Mode B** if a trusted backend (ragchat, an internal API) already holds per-user or per-tenant Qobrix keys and can send them as headers on every `/mcp` call.
- Use **Mode C** when the end user must sign in (login + 2FA + consent) so the agent runs **as that user**. Mode C requires SharpSir’s Enterprise OAuth solution — see [Enterprise OAuth](../README.md#enterprise-oauth) and the companion [OAuth User Guide](https://github.com/sharpsir-group/qobrix-crm-mcp) (delivered with the bundle).

---

## Mode A — stdio + shared API key

Simplest path. The MCP process reads credentials from the environment and speaks stdio to the host.

### 1. Configure `.env`

```bash
QOBRIX_API_URL=https://yourcrm.qobrix.com
QOBRIX_API_USER=your-api-user-uuid
QOBRIX_API_KEY=your-api-key
QOBRIX_LOCALE=en-US
# leave transport unset (default stdio) — Mode A
```

### 2. Run

```bash
npm start
# → node dist/index.js  (stdio MCP)
```

### 3. Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "qobrix-crm": {
      "command": "node",
      "args": ["/absolute/path/to/qobrix-crm-mcp/dist/index.js"],
      "env": {
        "QOBRIX_API_URL": "https://yourcrm.qobrix.com",
        "QOBRIX_API_USER": "…",
        "QOBRIX_API_KEY": "…"
      }
    }
  }
}
```

### 4. Smoke test

Ask the agent: *“How many available properties are in the CRM?”* — it should call `search_properties` / `qobrix_count` and return live numbers.

**Security:** Mode A is a shared identity. Do not expose the stdio process over the network.

---

## Mode B — HTTP + per-request headers

For trusted callers that already know the Qobrix credentials to use on each request. No OAuth. Env shared-key fallback is **disabled** — missing headers → `401`.

### 1. Configure and start

```bash
export QOBRIX_MCP_TRANSPORT=http
export QOBRIX_MCP_AUTH=headers
export QOBRIX_MCP_HOST=127.0.0.1
export QOBRIX_MCP_PORT=3502
# Optional defaults (locale / cache only — not used as API identity)
export QOBRIX_LOCALE=en-US
npm start
```

### 2. Call `/mcp` with headers

| Header | Required | Purpose |
|--------|----------|---------|
| `X-Api-User` | Yes | Qobrix API user UUID |
| `X-Api-Key` | Yes | Qobrix API key |
| `X-Qobrix-Api-Url` | No | Override tenant URL for this request |
| `X-Locale` | No | Override locale |

```bash
curl -s http://127.0.0.1:3502/health
# {"ok":true,"transport":"http","auth":"headers",…}

# Initialize (Streamable HTTP) — headers required on every /mcp call
curl -s -X POST http://127.0.0.1:3502/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Api-User: $QOBRIX_API_USER" \
  -H "X-Api-Key: $QOBRIX_API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

### 3. Wire from ragchat / PeerPane

Point a streamable-HTTP MCP server entry at `http://127.0.0.1:3502/mcp` and forward the caller’s Qobrix credentials as the headers above on each request.

**Security:** Bind to loopback (or a private network). Mode B has no client OAuth — anyone who can reach `/mcp` and forge headers can act as that CRM user.

---

## Mode C — self-service Enterprise OAuth

The MCP becomes its **own** OAuth client and session holder. Northbound agents (ragchat, Claude, Cursor) need **no** bearer wiring: when a tool needs auth, the MCP returns a `/connect` URL; the user signs in; the next tool call runs as that user.

Requires the proprietary companion **Enterprise OAuth** Authorization Server (delivered on request — [sharpsir.group](https://sharpsir.group) · [dev@sharpsir.group](mailto:dev@sharpsir.group)). The delivery package includes its own `docs/USER_GUIDE.md` (pairing secrets, login/2FA, vault, public HTTPS).

### 1. Pairing env (Resource Server)

```bash
export QOBRIX_MCP_TRANSPORT=http
export QOBRIX_MCP_AUTH=oauth
export QOBRIX_MCP_HOST=127.0.0.1
export QOBRIX_MCP_PORT=3502

# Public HTTPS base (browser-facing /connect + /oauth/callback)
export QOBRIX_MCP_PUBLIC_URL=https://qobrix-mcp.example.com
# Audience MUST include /mcp (do not omit — PUBLIC_URL fallback drops the path)
export QOBRIX_MCP_RESOURCE_URL=https://qobrix-mcp.example.com/mcp
export QOBRIX_MCP_ALLOWED_HOSTS=qobrix-mcp.example.com

# From the Enterprise OAuth bundle (identical secret on both sides)
export QOBRIX_OAUTH_ISSUER=https://qobrix-oauth.example.com
export QOBRIX_OAUTH_INTROSPECTION_SECRET='<shared-long-secret>'
export QOBRIX_MCP_STATE_SECRET='<16+-char-secret>'   # cookies + session vault
export QOBRIX_MCP_DATA_DIR=./data/mcp-oauth          # persist across restarts

# Local http:// issuer only:
# export MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true

npm start
```

Local loopback pairing (dev):

```bash
export QOBRIX_MCP_PUBLIC_URL=http://127.0.0.1:3502
export QOBRIX_MCP_RESOURCE_URL=http://127.0.0.1:3502/mcp
export QOBRIX_OAUTH_ISSUER=http://127.0.0.1:3503
export MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true
```

### 2. What the user sees in chat

1. Agent calls a CRM tool with no session.
2. MCP returns either:
   - **URL-mode elicitation** (`JSON-RPC -32042`) when the client supports `elicitation.url`, or
   - Plain tool-result text with the `/connect` link (ragchat / LangChain fallback).
3. User opens `{PUBLIC_URL}/connect?e=…` → signed cookie → redirect to the Authorization Server login (username / password / 2FA / consent).
4. AS redirects to `{PUBLIC_URL}/oauth/callback` → PKCE exchange + introspection → encrypted session vault.
5. User retries the same question — tools run with that user’s Qobrix API key.

### 3. Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | Liveness; Mode C includes `connected: true/false` |
| `GET /connect?e=…` | Start auth (cookie + 302 to AS) |
| `GET /oauth/callback` | Code exchange + vault write |
| `POST/GET/DELETE /mcp` | Streamable HTTP MCP (no client bearer in Mode C) |

### 4. Gotchas

- Always set **`QOBRIX_MCP_RESOURCE_URL`** to the full public `/mcp` URL.
- DCR `redirect_uri` must equal `{PUBLIC_URL}/oauth/callback` exactly (re-register if you change the public URL).
- Persist **`QOBRIX_MCP_DATA_DIR`** (DCR client + session vault).
- **Single active session — one CRM identity per MCP process.** Mode C stores one encrypted vault (`session.enc`) for the whole server. Whoever completes `/connect` last is the identity every tool call uses until reconnect or vault clear. Do **not** share one Mode C process across unrelated end users expecting isolation; run one process per tenant/user, or use Mode B with per-request headers from a trusted backend.
- Because `/mcp` has **no client bearer**, bind `QOBRIX_MCP_HOST` to loopback / a trusted network. If you reverse-proxy only the browser routes (`/connect`, `/oauth/callback`), **deny public access to `/mcp` and `/health`** (agents such as ragchat should call `http://127.0.0.1:<port>/mcp` on the host). Exposing `/mcp` on the internet would let any caller use the shared vault after someone signs in.
- Prefer **subdomain** public URLs for the Authorization Server. Path mounts work when the AS login form uses a relative POST and connect cookies use `Path` equal to the PUBLIC_URL pathname (avoids reverse-proxy cookie-path rewrites).
- Reference production (HumaticAI): `https://humaticai.com/qobrix-mcp` + `https://humaticai.com/qobrix-oauth` (public surface is OAuth routes only; `/mcp` stays localhost).

### 5. Verify

```bash
curl -s http://127.0.0.1:3502/health
# {"ok":true,"auth":"oauth","connected":false,…}

# After a successful browser login:
curl -s http://127.0.0.1:3502/health
# {"ok":true,"auth":"oauth","connected":true,…}
```

Automated smoke: `npm run test:oauth-modes`.

---

## Caching (optional, all modes)

See [README — Caching](../README.md#caching). Defaults keep an in-memory LRU; set `QOBRIX_REDIS_URL` for a shared Redis tier.

---

## Next steps

- Full tool list and RESO workflows: [README](../README.md)
- Enterprise OAuth sales / delivery: [sharpsir.group](https://sharpsir.group) · [dev@sharpsir.group](mailto:dev@sharpsir.group)
- Companion AS operations: `docs/USER_GUIDE.md` in the Enterprise OAuth delivery package
