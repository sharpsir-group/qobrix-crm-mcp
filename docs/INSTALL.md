# Install Qobrix CRM MCP for Claude

This guide deploys the MCP Resource Server in Mode D at:

- MCP: `https://intranet.sharpsir.group/qobrix-crm-mcp/mcp`
- OAuth issuer: `https://intranet.sharpsir.group/qobrix-crm-mcp-oauth`

The Node processes bind only to loopback. Apache provides public HTTPS.

## Prerequisites

- Node.js 20 or later
- npm
- pm2
- Apache 2.4 with `mod_proxy`, `mod_proxy_http`, `mod_headers`, and TLS
- The paired `qobrix-crm-mcp-oauth` repository
- A Qobrix tenant URL and valid Qobrix user credentials

## Build

```bash
cd /home/bitnami/qobrix-crm-mcp
npm ci
npm run build
```

The build copies the Sharp SIR logo into `dist/assets/`.

## Configure Mode D

Generate secrets once:

```bash
openssl rand -hex 32  # shared introspection secret
openssl rand -hex 32  # MCP state secret
```

Create `.env` (never commit it):

```dotenv
QOBRIX_MCP_TRANSPORT=http
QOBRIX_MCP_AUTH=oauth-claude
QOBRIX_MCP_HOST=127.0.0.1
QOBRIX_MCP_PORT=3502
QOBRIX_MCP_ALLOWED_HOSTS=intranet.sharpsir.group
QOBRIX_MCP_PUBLIC_URL=https://intranet.sharpsir.group/qobrix-crm-mcp
QOBRIX_MCP_RESOURCE_URL=https://intranet.sharpsir.group/qobrix-crm-mcp/mcp
QOBRIX_OAUTH_ISSUER=https://intranet.sharpsir.group/qobrix-crm-mcp-oauth
QOBRIX_OAUTH_INTROSPECTION_SECRET=<same-value-as-the-oauth-server>
QOBRIX_MCP_STATE_SECRET=<random-hex-value>
QOBRIX_MCP_DATA_DIR=./data/mcp-oauth
QOBRIX_CACHE_ENABLED=true
QOBRIX_CACHE_TTL=300
```

Set `.env` permissions to `600`.

## Run with pm2

Start the OAuth server first, then the MCP:

```bash
pm2 start /home/bitnami/qobrix-crm-mcp-oauth/dist/index.js \
  --name qobrix-crm-mcp-oauth \
  --cwd /home/bitnami/qobrix-crm-mcp-oauth \
  --interpreter node --node-args="--env-file=.env"

pm2 start /home/bitnami/qobrix-crm-mcp/dist/index.js \
  --name qobrix-crm-mcp \
  --cwd /home/bitnami/qobrix-crm-mcp \
  --interpreter node --node-args="--env-file=.env"

pm2 save
```

Local health check:

```bash
curl -fsS http://127.0.0.1:3502/health
```

## Apache reverse proxy

Add these directives to the TLS virtual host. Keep the well-known paths before
the broad OAuth prefix.

```apache
# RFC 9728 protected-resource metadata and MCP Streamable HTTP endpoint.
ProxyPass /.well-known/oauth-protected-resource/qobrix-crm-mcp/mcp http://127.0.0.1:3502/.well-known/oauth-protected-resource/qobrix-crm-mcp/mcp
ProxyPassReverse /.well-known/oauth-protected-resource/qobrix-crm-mcp/mcp http://127.0.0.1:3502/.well-known/oauth-protected-resource/qobrix-crm-mcp/mcp
ProxyPass /qobrix-crm-mcp/mcp http://127.0.0.1:3502/mcp timeout=600 flushpackets=on
ProxyPassReverse /qobrix-crm-mcp/mcp http://127.0.0.1:3502/mcp

# RFC 8414 path-aware Authorization Server metadata.
ProxyPass /.well-known/oauth-authorization-server/qobrix-crm-mcp-oauth http://127.0.0.1:3503/.well-known/oauth-authorization-server
ProxyPassReverse /.well-known/oauth-authorization-server/qobrix-crm-mcp-oauth http://127.0.0.1:3503/.well-known/oauth-authorization-server
ProxyPass /.well-known/oauth-authorization-server http://127.0.0.1:3503/.well-known/oauth-authorization-server
ProxyPassReverse /.well-known/oauth-authorization-server http://127.0.0.1:3503/.well-known/oauth-authorization-server

# OAuth endpoints; public prefix is stripped before forwarding.
ProxyPass /qobrix-crm-mcp-oauth/ http://127.0.0.1:3503/
ProxyPassReverse /qobrix-crm-mcp-oauth/ http://127.0.0.1:3503/

<Location "/qobrix-crm-mcp/mcp">
  SetEnv proxy-sendchunked 1
  Header set X-Accel-Buffering "no"
</Location>
```

Validate and reload:

```bash
sudo /opt/bitnami/apache/bin/apachectl configtest
sudo /opt/bitnami/apache/bin/apachectl -k graceful
```

## Verify OAuth discovery

The unauthenticated MCP request must return `401` with a
`WWW-Authenticate` header containing the PRM URL:

```bash
curl -si -X POST \
  https://intranet.sharpsir.group/qobrix-crm-mcp/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

Verify the discovery documents:

```bash
curl -fsS \
  https://intranet.sharpsir.group/.well-known/oauth-protected-resource/qobrix-crm-mcp/mcp

curl -fsS \
  https://intranet.sharpsir.group/.well-known/oauth-authorization-server/qobrix-crm-mcp-oauth
```

The PRM `resource` must exactly match the MCP URL. Its first
`authorization_servers` entry must exactly match the OAuth issuer.

## Connect Claude

1. Open Claude.ai or Claude Desktop.
2. Go to **Settings → Connectors → Add custom connector**.
3. Enter `https://intranet.sharpsir.group/qobrix-crm-mcp/mcp`.
4. Select **Connect**.
5. Complete the Sharp Matrix Qobrix authorization form (CRM URL, username,
   password, and 2FA when requested).
6. Approve access. Claude receives an audience-bound token and loads the tools.

If a WAF restricts source networks, allow Anthropic egress
`160.79.104.0/21`.

## Other authentication modes

Modes A, B, and C remain supported. See [USER_GUIDE.md](./USER_GUIDE.md) for
stdio shared credentials, trusted HTTP headers, and elicitation-based OAuth.
