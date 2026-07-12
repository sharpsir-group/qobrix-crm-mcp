# User Guide — Qobrix CRM MCP

Connect Claude, Cursor, ChatGPT, PeerPane / ragchat, or any MCP client to live Qobrix CRM data.

**Package version:** see [`package.json`](../package.json) (currently **1.5.0**).  
**Tools:** **64** MCP tools (entities, analytics, reporting, audit, cache, session/identity). Full list: [README — Tools at a Glance](../README.md#tools-at-a-glance).

| Mode | Transport | Credentials | Best for |
|------|-----------|-------------|----------|
| **A** (default, free) | stdio | Shared `QOBRIX_API_*` env | Local IDE, one shared CRM identity |
| **B** (free) | HTTP | Per-request `X-Api-User` / `X-Api-Key` | Trusted private callers (localhost ragchat, internal services) |
| **C** (Enterprise) | HTTP | Self-service OAuth (`/connect` → login) | Signed-in CRM user (**one shared vault per MCP process** — not multi-tenant isolation) |

**Prerequisites:** Node.js **≥ 20**, a Qobrix tenant URL, and API credentials (Modes A/B) or SharpSir’s **Enterprise OAuth** bundle (Mode C).

```bash
git clone https://github.com/sharpsir-group/qobrix-crm-mcp.git
cd qobrix-crm-mcp
cp .env.example .env   # fill QOBRIX_API_* for Modes A/B
npm install
npm run build
```

---

## Which mode do I want?

- **Mode A** — Cursor / Claude Desktop for yourself with one service account.
- **Mode B** — a trusted backend already holds Qobrix keys and can send them as headers on every `/mcp` call.
- **Mode C** — end user signs in (login + 2FA + consent) so tools run as that CRM user. Requires the proprietary **Enterprise OAuth** Authorization Server (delivered on request — [sharpsir.group](https://sharpsir.group) · [dev@sharpsir.group](mailto:dev@sharpsir.group)). The delivery package includes its own `docs/USER_GUIDE.md`. See also [Enterprise OAuth](../README.md#enterprise-oauth).

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

Ask the agent: *“How many available properties are in the CRM?”* — it should call `qobrix_search_properties` / `qobrix_count` and return live numbers.

**Security:** Mode A is a shared identity. Do not expose the stdio process over the network. (HTTP + `QOBRIX_MCP_AUTH=env` also exists in code for shared-env over HTTP — prefer Mode B/C for multi-caller deployments.)

---

## Mode B — HTTP + per-request headers

For trusted callers that already know the Qobrix credentials to use on each request. No OAuth. Env shared-key fallback is **disabled** — missing headers → error (no silent fall-back to `.env` API keys).

### 1. Configure and start

```bash
export QOBRIX_MCP_TRANSPORT=http
export QOBRIX_MCP_AUTH=headers
export QOBRIX_MCP_HOST=127.0.0.1
export QOBRIX_MCP_PORT=3502
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

The MCP becomes its **own** OAuth client and session holder. Northbound agents need **no** bearer wiring: when a tool needs auth, the MCP returns a `/connect` URL; the user signs in; the next tool call runs as that user.

Requires the proprietary companion **Enterprise OAuth** Authorization Server (delivered on request). Pairing secrets, login UI, vault, and HTTPS ops are documented in that package’s `docs/USER_GUIDE.md`.

### 1. Pairing env (Resource Server)

```bash
export QOBRIX_MCP_TRANSPORT=http
export QOBRIX_MCP_AUTH=oauth
export QOBRIX_MCP_HOST=127.0.0.1
export QOBRIX_MCP_PORT=3502

# Public HTTPS base (browser-facing /connect + /oauth/callback only)
export QOBRIX_MCP_PUBLIC_URL=https://qobrix-mcp.example.com
# Audience MUST include /mcp (do not omit — PUBLIC_URL fallback drops the path)
export QOBRIX_MCP_RESOURCE_URL=https://qobrix-mcp.example.com/mcp
# Public hostname(s) for Host checks. When HOST is loopback, 127.0.0.1 / localhost / ::1
# are auto-added so local agents (ragchat → http://127.0.0.1:3502/mcp) are not 403'd.
export QOBRIX_MCP_ALLOWED_HOSTS=qobrix-mcp.example.com

export QOBRIX_OAUTH_ISSUER=https://qobrix-oauth.example.com
export QOBRIX_OAUTH_INTROSPECTION_SECRET='<shared-long-secret>'
export QOBRIX_MCP_STATE_SECRET='<16+-char-secret>'   # cookies + session vault
export QOBRIX_MCP_DATA_DIR=./data/mcp-oauth          # persist across restarts

# Local http:// issuer only (AS also auto-sets this for http: issuers):
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

1. Agent calls a CRM tool with no session (or calls **`qobrix_sign_in`** / **`qobrix_whoami`**).
2. MCP returns either:
   - **URL-mode elicitation** (`JSON-RPC -32042`) when the client supports `elicitation.url`, or
   - A Markdown **`[Sign In to Qobrix]({PUBLIC_URL}/connect?e=…)`** link (ragchat / LangChain fallback). The LLM must show that exact link (unique / single-use — never reuse a link from an earlier message).
3. User opens `{PUBLIC_URL}/connect?e=…` → signed cookie → redirect to the AS login (HumaticAI-styled form: CRM URL, username, password, optional 2FA, collapsible legal clickwrap).
4. AS redirects to `{PUBLIC_URL}/oauth/callback` → PKCE exchange + introspection → encrypted session vault (`session.enc`).
5. User retries — tools run with that user’s minted Qobrix API key.
6. **`qobrix_whoami`** returns the current profile (`user` + `capabilities` + `portals`, plus OAuth `subject` when available).
7. **`qobrix_sign_out`** fully revokes: AS `/disconnect` (Bearer) deletes the minted Qobrix API key and clears the AS vault/tokens, then the local vault is wiped. Mode C uses one shared vault — sign-out disconnects the shared identity for this MCP process.

### 3. Endpoints

| Path | Purpose | Public? |
|------|---------|---------|
| `GET /connect?e=…` | Start auth (cookie + 302 to AS) | Yes (browser) |
| `GET /oauth/callback` | Code exchange + vault write | Yes (browser) |
| `GET /health` | Liveness; Mode C includes `connected: true/false` | Prefer localhost only |
| `POST/GET/DELETE /mcp` | Streamable HTTP MCP (no client bearer in Mode C) | Prefer localhost only |

### 4. Gotchas (production)

- Always set **`QOBRIX_MCP_RESOURCE_URL`** to the full public `/mcp` URL.
- DCR `redirect_uri` must equal `{PUBLIC_URL}/oauth/callback` exactly (re-register / clear `DATA_DIR` client if you change the public URL).
- Persist **`QOBRIX_MCP_DATA_DIR`** (DCR client + session vault).
- **Single active session — one CRM identity per MCP process.** Whoever completes `/connect` last is the identity every tool call uses. Do not share one Mode C process across unrelated end users; use Mode B for per-request isolation, or run one process per tenant/user.
- **`/mcp` has no client bearer.** Bind `QOBRIX_MCP_HOST` to loopback. If you reverse-proxy for browsers, **publish only `/connect` and `/oauth/callback`**; deny public `/mcp` and `/health` (e.g. Apache `Require all denied`). Agents such as ragchat must call `http://127.0.0.1:<port>/mcp` on the host.
- **Host allowlist:** set `QOBRIX_MCP_ALLOWED_HOSTS` to the public hostname. Loopback Host values are merged automatically when bind host is loopback — otherwise ragchat gets `403 Invalid Host: 127.0.0.1`.
- **Cookies:** connect cookie `Path` follows `QOBRIX_MCP_PUBLIC_URL` pathname (avoids reverse-proxy `ProxyPassReverseCookiePath` rewrites stealing `Path=/`).
- **Proxies:** Express `trust proxy` is **2** (Cloudflare → Apache → Node) so rate-limit IP keying is correct.
- Prefer **subdomain** URLs for the AS. Path mounts work when the AS issuer includes the path, login POST is relative, and well-known discovery is proxied carefully (see AS User Guide).
- Reference production (HumaticAI): public OAuth routes under `https://humaticai.com/qobrix-mcp` + `https://humaticai.com/qobrix-oauth`; `/mcp` stays on localhost for Alex/ragchat.

### 5. Verify

```bash
curl -s http://127.0.0.1:3502/health
# {"ok":true,"auth":"oauth","connected":false,…}

# After a successful browser login:
curl -s http://127.0.0.1:3502/health
# {"ok":true,"auth":"oauth","connected":true,…}

# Local agent path must succeed without a custom Host header:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3502/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ragchat","version":"0"}}}'
# → 200
```

Automated smoke: `npm run test:oauth-modes`.

---

## Caching & rate limits (optional)

- Caching: [README — Caching](../README.md#caching). Defaults: in-memory LRU; set `QOBRIX_REDIS_URL` for shared Redis. Related: `QOBRIX_CACHE_ENABLED`, `QOBRIX_CACHE_TTL`, `QOBRIX_CACHE_MAX_ENTRIES`, `QOBRIX_REDIS_KEY_PREFIX`.
- Rate limit: `QOBRIX_MCP_RATE_LIMIT` (default `300` req/min). Mode C also rate-limits `/connect` and `/oauth/callback` (`QOBRIX_MCP_OAUTH_RATE_LIMIT`, default `30`).
- Output cap: `QOBRIX_MCP_MAX_RESULT_CHARS` (see README).

---

## Next steps

- Full tool list and RESO workflows: [README](../README.md)
- Enterprise OAuth sales / delivery: [sharpsir.group](https://sharpsir.group) · [dev@sharpsir.group](mailto:dev@sharpsir.group)
- Companion AS operations: `docs/USER_GUIDE.md` in the Enterprise OAuth delivery package
