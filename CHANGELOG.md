# Changelog

All notable changes to the **Qobrix CRM MCP server** are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.4.2] - 2026-07-12

### Fixed

- When bound to loopback, `QOBRIX_MCP_ALLOWED_HOSTS` now always includes
  `127.0.0.1` / `localhost` / `::1` so local agents (e.g. ragchat →
  `http://127.0.0.1:3502/mcp`) are not rejected with `403 Invalid Host` when the
  env list only names the public reverse-proxy hostname.

---

## [1.4.1] - 2026-07-12

### Fixed

- Mode C connect cookie `Path` now follows `QOBRIX_MCP_PUBLIC_URL` pathname so
  reverse-proxy `ProxyPassReverseCookiePath` rewrites (e.g. `/` → `/eldes`) cannot
  steal the OAuth state cookie on path-mounted deployments.
- Set Express `trust proxy` when serving behind Apache/Cloudflare so
  `express-rate-limit` accepts `X-Forwarded-For`.

### Docs

- Added [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) covering Modes A → B → C.

---

## [1.4.0] - 2026-07-12

### Mode C self-service OAuth (standards-verified third-party auth)

Mode C no longer requires the northbound MCP client to carry a bearer token.
The MCP is its own OAuth client + session holder against SharpSir’s **Enterprise
OAuth** solution (`qobrix-crm-mcp-oauth`).

When a tool needs auth:

1. **Elicitation-capable clients** receive `URLElicitationRequiredError` (`-32042`)
   with a `/connect` URL (SEP-1036 / MCP 2025-11-25).
2. **Other clients** (ragchat / LangChain) receive plain tool-result text with the
   same URL — the LLM relays it; no host code changes.
3. User opens **`/connect`** (RS-hosted anti-phishing indirection + signed cookie)
   → Enterprise OAuth login → **`/oauth/callback`** → encrypted session vault.
4. Retry runs authenticated. Qobrix `401`/`403` clears the vault and re-prompts.

### Added

- `src/oauth-client.ts` — DCR, PKCE, `/connect` state, token exchange, introspection,
  AES-256-GCM session vault, refresh.
- `GET /connect` and `GET /oauth/callback` HTTP routes.
- `AuthRequiredError` + client-aware `errorResult()` (elicitation vs text fallback).
- `src/request-context.ts` — ALS for `McpServer` (capability detection + completion notify).
- Env: `QOBRIX_MCP_PUBLIC_URL`, `QOBRIX_MCP_STATE_SECRET`, `QOBRIX_MCP_DATA_DIR`.

### Changed

- Mode C drops `requireBearerAuth` / PRM on `/mcp` (client→server auth optional;
  network trust is the boundary — bind loopback).
- Mode description and docs reframed around self-service third-party authorization.

### Security

- Single shared session vault (document + warn on non-loopback bind).
- Connect state is single-use with ~10 min TTL; cookie↔state binding on callback.
- Exact-match `redirect_uri` enforced by the paired AS.

---

## [1.3.0] - 2026-07-12

### Agent-agnostic auth — Streamable HTTP + Modes A / B / C (freemium PLG)

Version 1.3.0 turns `qobrix-crm-mcp` into a **platform-agnostic MCP server** with a
clear freemium path. Modes A and B ship free in this package. **Mode C** is the
upgrade: per-user OAuth that requires SharpSir’s **Enterprise OAuth solution** —
a commercial bundle (login + 2FA + consent, per-user API-key minting, encrypted
vault, audience-bound tokens) delivered by our team **upon request**. It is not
a public download.

| Mode | Included | Role |
|------|----------|------|
| **A / B** | Free (this package) | Shared env key, or per-request headers for trusted hosts |
| **C** | **Enterprise OAuth** (upon request) | Per-agent identity via SharpSir’s Enterprise OAuth solution |

Contact: [sharpsir.group](https://sharpsir.group) · [dev@sharpsir.group](mailto:dev@sharpsir.group)

### Value proposition

**Start free. Upgrade when every agent must authenticate as themselves.**
Brokerages can put Claude, Cursor, or an internal agent host in front of live
Qobrix data today (Mode A/B). When they need per-user permissions, audit trails,
and self-serve login — not a shared service account — they request the Enterprise
OAuth solution. No third-party Authorization Servers; Mode C pairs exclusively
with that bundle.

Why this is a durable differentiator:

- **Freemium PLG.** Clone, run, prove value in Cursor / Claude — then convert to
  Enterprise OAuth when multi-user identity matters.
- **Agent-agnostic by design.** Register the remote `/mcp` URL; with Enterprise
  OAuth paired, the client discovers the AS (RFC 9728), completes DCR + PKCE,
  and opens the login page. No custom broker per host.
- **Back-compatible.** Mode A (stdio + env) is unchanged — existing setups keep
  working. Modes B and C are opt-in via env.

### Use cases / user stories

- **Brokerage IT — per-agent CRM access.** *"As IT, I want each sales agent’s MCP
  client to use their own Qobrix identity, so permissions and audit trails stay
  correct."* → Mode C + Enterprise OAuth (upon request).
- **Platform team — trusted internal host.** *"As a PeerPane / ragchat operator, I
  already have the user’s Qobrix key and want to pass it per request."* → Mode B
  (`X-Api-User` / `X-Api-Key` headers) over localhost HTTP.
- **Individual power user — local Cursor.** *"As a broker, I just want Cursor to
  talk to my CRM with one shared key."* → Mode A (default stdio + env), unchanged.

### Added

- **Streamable HTTP transport** (`QOBRIX_MCP_TRANSPORT=http`) via
  `StreamableHTTPServerTransport` on Express — keeps stdio as the default.
- **Three auth modes:**
  - **A** — stdio + shared `QOBRIX_API_*` from process env (default, free).
  - **B** — HTTP + per-request `X-Api-User` / `X-Api-Key` (trusted callers, free).
  - **C** — HTTP + OAuth 2.1 Resource Server for SharpSir’s **Enterprise OAuth
    solution** only (RFC 9728 PRM, bearer validation, introspection).
- **Request-scoped credentials** via `AsyncLocalStorage` (`auth-context.ts`).
- **`QobrixClient.fromEnv()` / `fromContext()`** with a credential-fingerprinted
  LRU so Modes B/C never share cached rows across users.
- **Mode C Resource Server helpers** (`oauth-rs.ts`): exclusive issuer check,
  audience validation, introspection → ALS credentials.
- **OAuth modes smoke test** (`test:oauth-modes`) — Mode B reject/accept +
  Mode C metadata → DCR → 401 → audience-bound introspect.
- **Node 18/20-compatible `.env` preloader** for the test suite (drops the
  Node 20-only `--env-file` dependency).

### Changed

- Modes B/C **fail closed**: no silent fallback to a shared env service account
  when the request auth scope is empty.
- HTTP handler only forwards a JSON-RPC body on `POST` — fixes SSE `GET` /
  session `DELETE` handling (Express’s empty `{}` body no longer corrupts the stream).
- Version bump to **1.3.0**; automated tests now **216**.

### Security

- Exclusive pairing: Mode C rejects any token `iss` other than the Enterprise
  OAuth issuer delivered with the bundle.
- Audience (RFC 8707) bound to the canonical `QOBRIX_MCP_RESOURCE_URL`.
- Credential-scoped cache keys prevent cross-tenant cache leaks.
- Rate limiting on the HTTP transport; warning when Mode A is bound to a
  non-loopback host.

### Notes

- Mode A remains the documented default for local Cursor / Claude Desktop.
- Mode C requires the **Enterprise OAuth solution**, delivered upon request —
  not a public package. Contact SharpSir Group to upgrade.
- No migration for existing Mode A installs.

---

## [1.2.0] - 2026-07-10

### Relevance search on every searchable resource + 2-way matching via search

Version 1.2.0 extends the F1-optimized `search` + `boost[]` + `limit` + `max_scan`
engine from properties/projects to **all** dedicated search tools: contacts, agents,
opportunities, viewings, tasks, offers, and contracts. That also unlocks
**bidirectional lead ↔ listing matching** without a bespoke match tool — including
**project → lead** ranking that the native Qobrix `opportunities/by-property`
endpoint cannot do.

### Value proposition

**AI Search turns your Qobrix CRM into a revenue engine, not a filing cabinet.**
Every agent now matches buyers to inventory in the language they actually think in —
*"downsizing retiree, sea view, step-free access, cash buyer under €400k"* — and gets
a ranked shortlist with a transparent reason for each match. The same engine runs the
match in reverse: point it at a new listing and instantly surface the warmest leads in
the pipeline. No SQL, no saved-filter maintenance, no "let me get back to you."

Why this is a durable differentiator:

- **Speed to first match.** Plain-language demand → ranked listings in one call,
  inside Cursor / Claude / any MCP client — not a 20-minute manual filter session.
- **Nothing slips through.** `max_scan` widens the candidate pool so the perfect-but-
  slightly-off-filter listing still surfaces; `_relevance` + `_matched` explain *why*.
- **Every asset is bidirectional.** New listing → hot leads. New lead → best listings.
  Same engine, same day, zero extra tooling.

### The $$ case for AI Search

Illustrative model for a **20-agent brokerage** (adjust to your desk):

- **Time reclaimed → more selling.** Manual buyer-to-inventory matching and re-checks
  eat roughly **5 hrs/agent/week**. AI Search cuts that by ~**70%** → ~**3.5 hrs/agent/week**
  back to clients. Across 20 agents that's **~3,600 selling hours/year** recovered —
  the equivalent of **~1.7 full-time agents** you don't have to hire.
- **Faster, better matches → higher conversion.** Speed-to-match and "nothing slips
  through" recall lift lead-to-viewing and viewing-to-offer rates. A conservative
  **+1 extra closed deal per agent per year** at a **€6,000 average commission** =
  **+€120,000/year** in new commission on a 20-agent desk.
- **Every stale listing gets a second look.** Reverse matching (new/relisted property →
  ranked warm leads) recycles pipeline that would otherwise go cold, shortening
  **days-on-market** and protecting price.

**Bottom line: a low-to-mid five-figure annual software footprint that plausibly
returns six figures** in recovered agent capacity plus incremental commission — before
counting the brand value of being the AI-native brokerage in your market.

### Use cases / user stories

- **Buyer's agent — demand → supply.** *"As an agent, I paste my buyer's wishlist and
  get a ranked shortlist with match reasons, so I can send curated options in minutes."*
  → `qobrix_search_properties` / `qobrix_search_projects` with `search` (must-haves) +
  `boost[]` (nice-to-haves).
- **Listing agent — supply → demand.** *"As a listing agent, when I win a new mandate I
  want the hottest matching leads instantly."* → `qobrix_search_opportunities` boosted
  on budget/location/type against the new listing's attributes (and `project → lead`
  ranking the native endpoint can't do).
- **Sales manager — pipeline hygiene.** *"As a manager, I want stale opportunities
  re-matched to fresh inventory."* → reverse matching recycles cold leads and cuts
  days-on-market.
- **Ops / back-office — everything is searchable.** Relevance ranking now spans
  contacts, agents, viewings, tasks, offers, and contracts — e.g. *"find the offers and
  contracts most relevant to this deal"* — so the whole CRM is queryable in plain
  language, not just listings.

### Added

- **Relevance ranking on 7 more search tools:**
  `qobrix_search_contacts`, `qobrix_search_agents`, `qobrix_search_opportunities`,
  `qobrix_search_viewings`, `qobrix_search_tasks`, `qobrix_search_offers`,
  `qobrix_search_contracts` — same two-tier recipe as properties/projects.
- **Opportunities & Contacts field cheatsheets** in `qobrix_search_dsl_help`.
- **Lead ↔ listing matching recipes** in server instructions and README
  (demand→supply via property/project search; supply→demand via opportunity boost).
- Unit tests for opportunity/contact-shaped boost scoring.

### Changed

- `relevanceSearch` accepts any Qobrix resource path string (not only properties/projects).
- Search schemas for the 7 resources now include `boost`, `max_scan`, and `fields`
  (where missing) so projection + boost-field union works uniformly.
- DSL help intro documents that the recipe applies to all `qobrix_search_*` tools.

### Notes

- Native match endpoints (`properties/by-lead`, `opportunities/by-property`,
  `opportunities/{id}/properties`) remain available; ranked search complements them.
- No migration: existing `search`-only calls take the fast path.

---

## [1.1.0] - 2026-07-10

### AI-native property search for MCP — the headline feature

Real-estate teams don't search in SQL. They describe what a buyer wants in plain
language: *"a 3-bed villa near the sea in Limassol, budget around half a million,
ideally new build."* Version 1.1.0 makes the Qobrix CRM MCP server turn that
free-language demand into **high-precision, high-recall listing results** — the
kind of AI-driven MLS/property search that is quickly becoming a competitive
differentiator for brokerages, portals, and PropTech products built on
Cursor, Claude, and other Model Context Protocol clients.

### Added

- **Relevance-ranked property & project search (F1-optimized).**
  `qobrix_search_properties` and `qobrix_search_projects` were rebuilt around a
  two-tier design that maximizes the F1 score (precision × recall) of results:
  - **`search`** — hard must-have constraints as a Qobrix DSL filter (server-side
    precision floor).
  - **`boost[]`** — soft, weighted nice-to-haves scored client-side over a wide
    candidate pool (recall + ranking). Each returned row carries a transparent
    **`_relevance`** score and **`_matched`** explanation of which criteria hit.
  - **`limit`** — how many ranked results to return (default 10, max 100).
  - **`max_scan`** — candidate pool size when boosting (default 100, hard cap 500).
    Raise it to reduce the chance of missing a great listing; lower it to keep the
    LLM context lean.
- **`qobrix_search_dsl_help` — an on-demand Search Expression DSL reference.**
  Teaches the LLM the full Qobrix / Symfony Expression Language grammar (operators,
  ranges, `contains`/`starts with`/`ends with`, `DISTANCE_FROM`, `IN_POLYGON`,
  `TRANSLATED`, `MIN`/`MAX`, date helpers like `DAYS_AGO(n)`, and association paths).
  Pass `resource: "Properties"` or `"Projects"` to append a field cheatsheet plus
  live, cached schema field names — so generated queries are correct on the first try.
- **New `src/relevance.ts` and `src/search-dsl.ts` modules**, with a pure,
  unit-tested `mergeBoostFields()` helper.
- **17 new relevance unit tests** and **3 new search-cache regression tests**
  (boost scoring, ranking order, `fields[]` + `boost` correctness, DSL help text,
  and cache-key stability) — all runnable offline with no live API.

### Changed

- **Search caching verified end-to-end.** Every relevance candidate page flows
  through the existing single chokepoint (`QobrixClient.request()` →
  read-through cache), so search — including each `max_scan` page — is fully
  response-cached. Boost scoring is post-fetch and does not affect the cache key,
  so re-ranking with different `boost[]` reuses the same cached candidate pages.
  Refresh after CRM edits with
  `qobrix_cache_clear({ prefix: "v1:request:properties" })`.
- **Richer LLM guidance.** The shared `SEARCH_DESCRIPTION`, both search tool
  descriptions, and the server `instructions` now document the two-tier
  `search` + `boost` recipe and the `limit` / `max_scan` overload-vs-missing
  trade-off, and point to `qobrix_search_dsl_help`.
- **README** updated with the full operator/function table, the relevance-search
  recipe, and a worked example.

### Fixed

- **`fields[]` + `boost` no longer breaks ranking.** When a caller restricted the
  response projection, boost clauses previously scored against absent fields and
  ranking silently degraded. Boost fields (plus `id`) are now always unioned into
  the fetched projection.
- Ranked-mode pagination no longer advertises a misleading `has_next_page`
  (widen the pool with `max_scan`, not `page`).

### Notes

- **100% read-only.** Every MCP tool is a `GET`; the response cache cannot corrupt
  CRM state. No Qobrix schema or credential changes are required to adopt 1.1.0.
- **No migration needed.** Existing `search`-only calls keep working (they take the
  fast path); add `boost[]` when you want relevance ranking.

---

## [1.0.0] - 2026-05

### Added

- Initial public release of the **read-only Qobrix CRM MCP server** for Cursor,
  Claude Desktop, and other Model Context Protocol clients.
- CRM entity tools (properties, projects, contacts, agents, opportunities/leads,
  viewings, tasks, media, offers, contracts, calls, meetings, email messages).
- Schema discovery (`qobrix_get_schema`, `qobrix_get_field_options`).
- Analytics (`qobrix_count`, `qobrix_top_values`, `qobrix_top_records`,
  `qobrix_aggregate`), the `qobrix_deals` shortcut, reporting tools
  (`qobrix_timeseries`, `qobrix_funnel`, `qobrix_rep_scorecard`,
  `qobrix_stale_leads`, `qobrix_win_loss`, `qobrix_days_on_market`),
  and `qobrix_cohort`.
- Optional **Redis-backed response caching** with in-memory LRU, single-flight
  coalescing, and cache controls (`qobrix_cache_stats`, `qobrix_cache_clear`).
- RESO Data Dictionary 2.0 aligned workflows and output-size capping.

[1.2.0]: https://github.com/sharpsir-group/qobrix-crm-mcp/releases/tag/v1.2.0
[1.1.0]: https://github.com/sharpsir-group/qobrix-crm-mcp/releases/tag/v1.1.0
[1.0.0]: https://github.com/sharpsir-group/qobrix-crm-mcp/releases/tag/v1.0.0
