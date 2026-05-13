<p align="center">
  <a href="https://sharpsir.group">
    <img src="https://raw.githubusercontent.com/sharpsir-group/.github/main/brand/logo-blue.png" alt="Sharp Sotheby's International Realty" width="400" />
  </a>
</p>

<h3 align="center">Qobrix CRM — MCP Server</h3>

<p align="center">
  Read-only <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> server for <a href="https://qobrix.com/">Qobrix CRM</a>.<br />
  42 tools across 13 entity groups, aligned with <a href="https://www.reso.org/data-dictionary/">RESO Data Dictionary 2.0</a> canonical real-estate workflows.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/MCP-000000?style=flat&logo=anthropic&logoColor=white" alt="MCP" />
  <img src="https://img.shields.io/badge/Qobrix_CRM-4A90D9?style=flat&logoColor=white" alt="Qobrix" />
  <img src="https://img.shields.io/badge/RESO_DD_2.0-1A1A2E?style=flat&logoColor=white" alt="RESO" />
  <img src="https://img.shields.io/badge/Zod-3E67B1?style=flat&logo=zod&logoColor=white" alt="Zod" />
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue?style=flat" alt="License" />
</p>

---

### What It Does

An AI assistant connected to this server can browse properties, qualify leads, track showings, review offers and contracts, audit follow-up activity, and discover CRM field schemas — all through natural language. Every tool description teaches the LLM which canonical real-estate workflow it belongs to, which RESO resource it maps to, and which tools to chain next.

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

42 read-only tools organized by CRM entity:

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

### Usage with Cursor

Add to `~/.cursor/mcp.json`:

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

The project includes a comprehensive test suite (148 tests across 41 suites):

```bash
# Integration tests — individual tool mechanics
npm test

# Scenario tests — multi-step tool chains (18 real-world scenarios)
npm run test:scenarios

# Workflow tests — canonical RE business processes (8 RESO-aligned suites)
npm run test:workflows

# Run everything
npm run test:all
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| Integration | 55 | Every tool, pagination edge cases, include/fields mechanics |
| Scenarios | 54 | Agent morning brief, buyer search, lead triage, FK chains, pipeline reports |
| Workflows | 39 | Listing lifecycle, lead funnel, sales pipeline, showing, transaction, media, activity, schema |

---

### Architecture

```
src/
├── index.ts          # MCP server entry point + RESO workflow instructions
├── client.ts         # QobrixClient — HTTP abstraction for /api/v2/
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
    └── meta.ts       # Schema Discovery tools
test-suite/
├── integration.test.mjs  # 55 integration tests
├── scenarios.test.mjs    # 54 scenario tests
└── workflows.test.mjs    # 39 workflow tests
```

### How the LLM Learns

The server teaches the LLM at three levels:

1. **Server instructions** — top-level `instructions` field in the MCP `initialize` response provides the full data model, six canonical workflows with tool recipes, search syntax, FK resolution strategies, and known quirks.

2. **Tool descriptions** — each of the 42 tool descriptions includes its canonical workflow role, RESO equivalent, verified `include[]` options, FK field mappings, response shape, and search examples.

3. **Parameter descriptions** — Zod schemas provide per-parameter help with concrete examples, valid enum values, and cross-tool references.

---

### Technology

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript 5.7 |
| MCP SDK | `@modelcontextprotocol/sdk` 1.26 |
| Validation | Zod 3.24 |
| Transport | stdio (standard MCP transport) |
| API Auth | `X-Api-User` + `X-Api-Key` headers |
| Testing | Node.js built-in test runner (`node:test`) |

### License

[Apache License 2.0](LICENSE) — Copyright 2025 SharpSir Group

---

<p align="center">
  <sub>Part of the <a href="https://github.com/sharpsir-group"><strong>Sharp Matrix</strong></a> platform · <a href="https://sharpsir.group">sharpsir.group</a></sub>
</p>
