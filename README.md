<p align="center">
  <a href="https://sharpsir.group">
    <img src="https://raw.githubusercontent.com/sharpsir-group/.github/main/brand/logo-blue.png" alt="SharpSir Group — Sharp Sotheby's International Realty brand logo" width="400" />
  </a>
</p>

<h1 align="center">Qobrix CRM MCP Server</h1>

<p align="center">
  <strong>Connect Claude, Cursor, and other MCP clients to your Qobrix real-estate CRM</strong> — listings, leads, viewings, offers, contracts, and activity in one read-only <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> layer.<br />
  <strong>46 tools</strong> (CRM entities + analytics + cache controls), <a href="https://www.reso.org/data-dictionary/">RESO Data Dictionary 2.0</a> workflows, optional <strong>Redis-backed response caching</strong>, and <strong>167 automated tests</strong>.
</p>

<p align="center">
  <a href="https://github.com/sharpsir-group/qobrix-crm-mcp">GitHub</a>
  ·
  <a href="https://qobrix.com/">Qobrix CRM</a>
  ·
  <a href="https://modelcontextprotocol.io/">MCP specification</a>
  ·
  <a href="https://www.reso.org/data-dictionary/">RESO DD 2.0</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="Built with TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Requires Node.js 20+" />
  <img src="https://img.shields.io/badge/MCP-000000?style=flat&logo=anthropic&logoColor=white" alt="Model Context Protocol" />
  <img src="https://img.shields.io/badge/Qobrix_CRM-4A90D9?style=flat&logoColor=white" alt="Qobrix CRM integration" />
  <img src="https://img.shields.io/badge/RESO_DD_2.0-1A1A2E?style=flat&logoColor=white" alt="RESO Data Dictionary 2.0" />
  <img src="https://img.shields.io/badge/Zod-3E67B1?style=flat&logo=zod&logoColor=white" alt="Zod schema validation" />
  <a href="https://github.com/sharpsir-group/qobrix-crm-mcp/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=flat" alt="Apache 2.0 license" /></a>
</p>

---

## Table of contents

- [What it does](#what-it-does)
- [Who it is for](#who-it-is-for)
- [Canonical real-estate workflows](#canonical-re-workflows)
- [Tools at a glance](#tools-at-a-glance)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Caching](#caching)
- [Usage with Cursor & other MCP hosts](#usage-with-cursor)
- [Search expression syntax](#search-expression-syntax)
- [Fetching related data](#fetching-related-data)
- [Testing](#testing)
- [Architecture](#architecture)
- [How the LLM learns](#how-the-llm-learns)
- [Technology](#technology)
- [License](#license)

---

### What It Does

An AI assistant connected to this server can browse properties, qualify leads, track showings, review offers and contracts, audit follow-up activity, and discover CRM field schemas — all through natural language. Every tool description teaches the LLM which canonical real-estate workflow it belongs to, which RESO resource it maps to, and which tools to chain next.

### Who it is for

- **Brokerages & developers** using [Qobrix](https://qobrix.com/) who want ChatGPT, Claude, or Cursor to answer questions grounded in live CRM data (not copy-pasted exports).
- **Engineers** wiring **MCP** into internal tools: stdio transport, typed Zod inputs, and no write surface — safe to experiment with prompts and agents.
- **Data & operations teams** running dashboards: use **`qobrix_count`** / **`qobrix_top_values`** for YoY-style metrics without custom scripts, and **response caching** to cut API load on repeat queries.

### Canonical RE Workflows

The server is organized around six RESO-aligned business processes. The LLM receives these as built-in instructions so it can navigate the CRM without prior training.

| # | Workflow | RESO Mapping | Key Tools |
|---|----------|-------------|-----------|
| 1 | **Listing Lifecycle** | `Property.StandardStatus` | `search_properties`, `get_property`, `list_media`, `get_property_coordinates` |
| 2 | **Lead-Contact Lifecycle** | `Contacts.ContactType` funnel | `search_opportunities`, `get_contact`, `search_tasks` |
| 3 | **Sales Pipeline** | 8-stage buyer journey | `get_leads_by_property`, `get_lead_properties`, `list_viewings`, `list_offers`, `list_contracts` |
| 4 | **Showing / Viewing** | `ShowingAppointment` | `list_viewings`, `get_viewing`, `list_meetings` |
| 5 | **Transaction / Offer** | `TransactionManagement` | `list_offers`, `get_offer`, `list_contracts`, `get_contract` |
| 6 | **Activity / Follow-up** | Engagement tracking | `list_calls`, `list_meetings`, `list_email_messages`, `search_tasks` |

#### Status Mappings

| Qobrix Property Status | RESO StandardStatus |
|------------------------|---------------------|
| `available` | Active |
| `reserved` | Pending / Under Contract |
| `sold` | Closed |
| `withdrawn` | Withdrawn / Canceled |

| Qobrix Opportunity Status | RESO Lead Funnel |
|--------------------------|------------------|
| `new` | MQL / Raw Lead |
| `open` | SQL / Active |
| `won` | Closed Won |
| `closed_lost` | Lost |

---

### Tools at a Glance

**46** read-only tools — CRM entities, schema discovery, **analytics** (`qobrix_count`, `qobrix_top_values`), and **cache** helpers (`qobrix_cache_stats`, `qobrix_cache_clear`):

| Entity Group | Tools | Capabilities |
|-------------|-------|-------------|
| **Properties** | 5 | List, Get, Search, Coordinates (map), Properties-by-Lead |
| **Contacts** | 3 | List, Get, Search |
| **Agents** | 3 | List, Get, Search |
| **Opportunities / Leads** | 5 | List, Get, Search, Leads-by-Property, Lead-Properties |
| **Property Viewings** | 3 | List, Get, Search |
| **Tasks** | 3 | List, Get, Search |
| **Media** | 2 | List (with entity filter), Get (with size variants) |
| **Projects** | 4 | List, Get, Search, Coordinates |
| **Offers** | 3 | List, Get, Search |
| **Contracts** | 3 | List, Get, Search |
| **Calls** | 2 | List, Get |
| **Meetings** | 2 | List, Get |
| **Email Messages** | 2 | List, Get |
| **Schema / Meta** | 2 | Get Schema (field discovery), Get Field Options (enum values) |
| **Analytics** | 2 | Count rows and top-N field values via MCP (no custom pagination scripts) |
| **Cache** | 2 | Stats and prefix or full invalidation for fresher reads |

Every tool description includes its canonical workflow role, RESO equivalent, verified `include[]` options, FK resolution guidance, and search expression examples.

---

### Quick Start

```bash
git clone https://github.com/sharpsir-group/qobrix-crm-mcp.git
cd qobrix-crm-mcp
npm install
npm run build
```

### Configuration

Create a `.env` file in the project root:

```bash
QOBRIX_API_URL=https://yourcrm.qobrix.com
QOBRIX_API_USER=your-api-user-uuid
QOBRIX_API_KEY=your-api-key
QOBRIX_LOCALE=en-US          # optional
```

| Variable | Required | Description |
|----------|----------|-------------|
| `QOBRIX_API_URL` | Yes | Qobrix instance base URL |
| `QOBRIX_API_USER` | Yes | `X-Api-User` header value (UUID) |
| `QOBRIX_API_KEY` | Yes | `X-Api-Key` header value |
| `QOBRIX_LOCALE` | No | `X-Locale` header (e.g. `en-US`, `el-GR`) |

### Caching

All MCP tools are read-only `GET`s, so a response cache cannot corrupt CRM state. The server wraps **one chokepoint** (`QobrixClient.request()`) with a read-through cache, so every existing tool benefits without any contract change.

**Design — cache-aside with single-flight coalescing:**

- **Tier 1 — in-memory LRU** (always on, zero deps): per-process, TTL'd, size-capped.
- **Tier 2 — Redis** (optional, lazy-loaded via dynamic `import()`): set `QOBRIX_REDIS_URL` to enable; the server falls back to memory-only on any Redis error.
- **Single-flight**: when the LLM fires parallel tool calls that hit the same cold cache key (common with `qobrix_top_values`), all in-process callers share one upstream fetch.
- **Errors are never cached** — a transient 5xx will not get stuck.
- **TTL only**, no stale-while-revalidate in v1.

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `QOBRIX_CACHE_ENABLED` | `true` | Set to `false` to bypass the cache entirely |
| `QOBRIX_CACHE_TTL` | `300` | TTL in seconds; CRM edits visible within this window |
| `QOBRIX_CACHE_MAX_ENTRIES` | `5000` | LRU cap for the in-memory tier |
| `QOBRIX_REDIS_URL` | `(empty)` | `redis://` / `rediss://` URL; empty = memory only |
| `QOBRIX_REDIS_KEY_PREFIX` | `qobrix:` | Namespace when sharing a Redis instance |

**Cache tools (exposed to the LLM):**

| Tool | Use |
|------|-----|
| `qobrix_cache_stats` | Hits/misses/size/in-flight/Redis status — verify the cache is paying off |
| `qobrix_cache_clear` | Invalidate all keys or by `prefix` (e.g. `v1:request:opportunities`) for instant refresh before TTL |

**Recommended Redis server config** (for a dedicated cache-only Redis, per Redis docs):

```conf
maxmemory 256mb
maxmemory-policy allkeys-lru
maxmemory-samples 10
```

**TTL guidance** — Redis docs recommend short TTLs for frequently-changing data (60–120s) and longer for stable data (hours). 300s is a conservative default for a CRM that mixes lead pipeline (changes minutely) with property listings (changes hourly). Use `qobrix_cache_clear` when you need an instant refresh.

**Trade-off / known limit:** Single-flight coalescing is **in-process only**. Multi-instance deployments behind one shared Redis can still see modest stampede on cold keys; a distributed `SETNX` lock is future work and not needed for single-user MCP clients.

**Best-practices alignment:**

| Best practice | Where honored |
|---|---|
| Cache-aside / read-through (Redis docs, MCP caching guides) | `QobrixClient.request()` wrap |
| Canonical, versioned cache key | `cacheKey("v1", ...)` with sorted params |
| Conservative TTL | `300s` default, env-overridable |
| Errors not cached | Wrap stores only on resolved upstream success |
| Single-flight stampede prevention | In-process `inflight` map |
| `allkeys-lru` for cache-only Redis | Documented above for self-hosters |
| Observability + manual invalidation | `qobrix_cache_stats`, `qobrix_cache_clear` |
| Official Node.js Redis client | `redis` (node-redis), as `optionalDependencies` |

### Usage with Cursor

This server speaks **stdio MCP**, the default transport for [Cursor](https://cursor.com/), Claude Desktop, and other hosts. Add to `~/.cursor/mcp.json` (or your host’s equivalent):

```json
{
  "mcpServers": {
    "qobrix-crm": {
      "command": "node",
      "args": ["/path/to/qobrix-crm-mcp/dist/index.js"],
      "env": {
        "QOBRIX_API_URL": "https://yourcrm.qobrix.com",
        "QOBRIX_API_USER": "...",
        "QOBRIX_API_KEY": "..."
      }
    }
  }
}
```

---

### Search Expression Syntax

Tools that accept a `search` parameter use Qobrix's expression language:

| Feature | Syntax | Example |
|---------|--------|---------|
| Equality | `==`, `!=` | `status == "available"` |
| Comparison | `<`, `>`, `<=`, `>=` | `list_selling_price_amount <= 500000` |
| Contains | `contains`, `starts with`, `ends with` | `city contains "Limas"` |
| Set membership | `in [...]` | `property_type in ["villa","house"]` |
| Range | `in min..max` | `bedrooms in 2..4` |
| Logical | `and`, `or`, `not` | `status == "available" and sale_rent == "for_sale"` |
| Time variables | `NOW`, `THIS_WEEK`, `THIS_MONTH`, `DAYS_AGO(n)` | `created >= DAYS_AGO(30)` |
| Current user | `CURRENT_USER` | `assigned_to == CURRENT_USER` |
| Association path | `Entity.field` | `Properties.price > 100000` |

> **Tip:** Call `qobrix_get_schema` with any resource name to discover all available field names before building search expressions.

---

### Fetching Related Data

Three strategies to resolve foreign keys:

1. **`include[]` parameter** — expand associations inline in one call

```
qobrix_get_property({ id: "...", include: ["Agents", "PropertyViewings"] })
```

2. **Separate get call** — take the UUID from an FK field and call the appropriate tool

```
// property.agent → UUID
qobrix_get_agent({ id: "<agent-uuid>" })
```

3. **Search by FK** — find related records via search expression

```
qobrix_search_properties({ search: 'agent == "<agent-uuid>"' })
```

Only `include[]` values marked **Verified** in tool descriptions are guaranteed to work. When `include[]` is unavailable for an association, use search-by-FK.

---

### Testing

The project includes **167 automated tests** across **47** `describe` suites (integration, multi-step scenarios, RESO workflows, and cache behavior):

```bash
# Integration tests — individual tool mechanics
npm test

# Scenario tests — multi-step tool chains (18 real-world scenarios)
npm run test:scenarios

# Workflow tests — canonical RE business processes (8 RESO-aligned suites)
npm run test:workflows

# Cache tests — read-through, single-flight, LRU eviction (no API needed)
npm run test:cache

# Run everything
npm run test:all
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| Integration | 55 | Every tool, pagination edge cases, include/fields mechanics |
| Scenarios | 54 | Agent morning brief, buyer search, lead triage, FK chains, pipeline reports |
| Workflows | 39 | Listing lifecycle, lead funnel, sales pipeline, showing, transaction, media, activity, schema |
| Cache | 19 | Read-through cache, single-flight coalescing, LRU eviction, key canonicalization (no live API) |

---

### Architecture

```
src/
├── index.ts          # MCP server entry point + RESO workflow instructions
├── client.ts         # QobrixClient — HTTP + read-through response cache
├── cache.ts          # LRU memory tier, optional Redis, single-flight coalescing
├── types.ts          # TypeScript interfaces
├── schemas.ts        # Zod schemas with rich LLM-facing descriptions
└── tools/
    ├── index.ts      # Tool registration hub
    ├── properties.ts # Listing Lifecycle tools
    ├── contacts.ts   # Lead-Contact Lifecycle tools
    ├── agents.ts     # RESO Member tools
    ├── opportunities.ts # Sales Pipeline tools
    ├── viewings.ts   # Showing Lifecycle tools
    ├── tasks.ts      # Follow-up & Pipeline Management tools
    ├── media.ts      # Media Lifecycle tools
    ├── projects.ts   # Project/Development tools
    ├── offers.ts     # Transaction Lifecycle tools
    ├── contracts.ts  # Transaction close tools
    ├── activities.ts # Activity Tracking (calls, meetings, emails)
    ├── analytics.ts  # qobrix_count, qobrix_top_values
    ├── cache.ts      # qobrix_cache_stats, qobrix_cache_clear
    └── meta.ts       # Schema Discovery tools
test-suite/
├── integration.test.mjs  # 55 integration tests
├── scenarios.test.mjs    # 54 scenario tests
├── workflows.test.mjs    # 39 workflow tests
└── cache.test.mjs        # 19 cache unit tests
```

### How the LLM Learns

The server teaches the LLM at three levels:

1. **Server instructions** — top-level `instructions` field in the MCP `initialize` response provides the full data model, six canonical workflows with tool recipes, search syntax, FK resolution strategies, and known quirks.

2. **Tool descriptions** — each of the **46** tool descriptions includes its canonical workflow role, RESO equivalent, verified `include[]` options, FK field mappings, response shape, and search examples.

3. **Parameter descriptions** — Zod schemas provide per-parameter help with concrete examples, valid enum values, and cross-tool references.

---

### Technology

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript 5.7 |
| MCP SDK | `@modelcontextprotocol/sdk` 1.26 |
| Validation | Zod 3.24 |
| Optional cache | `redis` 4.x (node-redis) when `QOBRIX_REDIS_URL` is set |
| Transport | stdio (standard MCP transport) |
| API Auth | `X-Api-User` + `X-Api-Key` headers |
| Testing | Node.js built-in test runner (`node:test`) |

### License

[Apache License 2.0](LICENSE) — Copyright 2025–2026 SharpSir Group

---

<p align="center">
  <sub>Part of the <a href="https://github.com/sharpsir-group"><strong>Sharp Matrix</strong></a> platform · <a href="https://sharpsir.group">sharpsir.group</a></sub>
</p>
