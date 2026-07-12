/**
 * Qobrix CRM MCP Server – Real-World Scenario Tests
 *
 * Simulates multi-step workflows that real estate staff would ask an AI assistant:
 *   - Agent checking listings and leads
 *   - Office manager reviewing pipeline
 *   - Sales team tracking opportunities, viewings, offers
 *   - Admin staff looking up contacts, contracts
 *
 * Each scenario exercises multiple MCP tools in sequence, verifying data flows
 * correctly between them (FK resolution, include[] expansion, search + drill-down).
 *
 * Run:  node --env-file=.env --test test-suite/scenarios.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { QobrixClient } from "../dist/client.js";

let client;

const ctx = {};

before(() => {
  client = QobrixClient.fromEnv();
});

// ─── helpers ────────────────────────────────────────────────────────────────

function assertPaginated(res, label) {
  assert.ok(res.data, `${label}: missing data`);
  assert.ok(Array.isArray(res.data), `${label}: data is not an array`);
  assert.ok(res.pagination, `${label}: missing pagination`);
}

function assertSingle(res, label) {
  assert.ok(res.data, `${label}: missing data`);
  assert.equal(typeof res.data, "object", `${label}: data is not an object`);
  assert.ok(!Array.isArray(res.data), `${label}: data should not be an array`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Agent Morning Brief
// "Show me my latest listings sorted by newest first, with full details"
// Tools: list_properties → get_property (with include)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 1: Agent Morning Brief – latest listings overview", () => {
  it("step 1: list recent properties sorted by newest first", async () => {
    const res = await client.list("properties", {
      limit: 5,
      sort: "-created",
      media: false,
      fields: ["id", "name", "status", "sale_rent", "city", "list_selling_price_amount", "agent", "created"],
    });
    assertPaginated(res, "morning brief list");
    assert.ok(res.data.length > 0, "CRM has properties");
    ctx.morningProperties = res.data;
    ctx.firstPropertyId = res.data[0].id;
    assert.ok(ctx.firstPropertyId, "first property has an id");
  });

  it("step 2: drill into first property with agent and type expansion", async () => {
    const res = await client.get("properties", ctx.firstPropertyId, {
      include: ["PropertyTypes", "Agents"],
    });
    assertSingle(res, "morning brief detail");
    assert.equal(res.data.id, ctx.firstPropertyId);
    ctx.propertyAgentId = res.data.agent;
  });

  it("step 3: resolve the listing agent's details", async () => {
    if (!ctx.propertyAgentId) return;
    const res = await client.get("agents", ctx.propertyAgentId);
    assertSingle(res, "agent detail");
    assert.equal(res.data.id, ctx.propertyAgentId);
    ctx.agentRecord = res.data;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Property Search & Deep Dive
// "Find available villas for sale under €1M with 3+ bedrooms, show me photos"
// Tools: search_properties → get_property → list_media (by property)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 2: Property Search & Deep Dive – buyer criteria", () => {
  it("step 1: search available for-sale properties", async () => {
    const res = await client.list("properties", {
      search: 'status == "available" and sale_rent == "for_sale"',
      limit: 5,
      sort: "-list_selling_price_amount",
      media: false,
      fields: ["id", "name", "status", "sale_rent", "property_type", "city",
               "list_selling_price_amount", "bedrooms", "bathrooms", "covered_area_amount"],
    });
    assertPaginated(res, "property search");
    ctx.searchResults = res.data;
  });

  it("step 2: get full details on top result", async () => {
    if (!ctx.searchResults?.length) return;
    const id = ctx.searchResults[0].id;
    const res = await client.get("properties", id, {
      include: ["PropertyTypes", "PropertySubtypes", "LocationLocations"],
    });
    assertSingle(res, "property deep dive");
    ctx.deepDivePropertyId = id;
  });

  it("step 3: fetch media/photos for the property", async () => {
    if (!ctx.deepDivePropertyId) return;
    const res = await client.list("media", {
      related_model: "Properties",
      related_id: ctx.deepDivePropertyId,
      limit: 10,
    });
    assert.ok(res.data, "media has data");
    assert.ok(Array.isArray(res.data), "media data is array");
    ctx.propertyMediaCount = res.data.length;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Lead Triage
// "Show me new leads, who are they, and what are they looking for?"
// Tools: list_opportunities → get_opportunity (with contact) → get_contact
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 3: Lead Triage – new enquiries drill-down", () => {
  it("step 1: list recent opportunities sorted by newest", async () => {
    const res = await client.list("opportunities", {
      limit: 5,
      sort: "-created",
      expand: false,
      fields: ["id", "ref", "status", "enquiry_type", "buy_rent", "contact_name", "agent", "created"],
    });
    assertPaginated(res, "lead triage list");
    assert.ok(res.data.length > 0, "CRM has opportunities");
    ctx.leads = res.data;
    ctx.firstLeadId = res.data[0].id;
    ctx.firstLeadContactId = res.data[0].contact_name;
  });

  it("step 2: get full lead details with contact expansion", async () => {
    const res = await client.get("opportunities", ctx.firstLeadId, {
      include: ["ContactNameContacts"],
    });
    assertSingle(res, "lead detail");
    assert.equal(res.data.id, ctx.firstLeadId);
  });

  it("step 3: get the lead's contact record separately", async () => {
    if (!ctx.firstLeadContactId) return;
    const res = await client.get("contacts", ctx.firstLeadContactId);
    assertSingle(res, "lead contact");
    assert.equal(res.data.id, ctx.firstLeadContactId);
    ctx.leadContactName = res.data.first_name || res.data.name;
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Buyer-Property Matching
// "Which leads match this property? And what properties is this lead interested in?"
// Tools: get_leads_by_property → get_lead_properties
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 4: Buyer-Property Matching – cross-reference", () => {
  it("step 1: find leads interested in a property", async () => {
    if (!ctx.firstPropertyId) return;
    try {
      const res = await client.getPath(
        `opportunities/by-property/${ctx.firstPropertyId}`,
        { limit: 5 }
      );
      assert.ok(res, "leads-by-property returned");
      ctx.matchedLeads = res.data || res;
    } catch (e) {
      assert.ok(e.message.includes("Qobrix API error") || e.message.includes("404"),
        "expected a structured API error when no matches");
    }
  });

  it("step 2: find properties linked to a lead", async () => {
    if (!ctx.firstLeadId) return;
    try {
      const res = await client.getSubresource(
        "opportunities", ctx.firstLeadId, "properties"
      );
      assert.ok(res, "lead-properties returned");
    } catch (e) {
      assert.ok(e.message.includes("Qobrix API error"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 4b: Supply→demand relevance ranking on opportunities
// Fetch open leads, score with boost clauses (same engine as qobrix_search_opportunities)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 4b: Opportunity boost ranking – supply→demand via search", () => {
  it("fetches open leads and ranks them with boost scoring", async () => {
    const { scoreRow } = await import("../dist/relevance.js");
    const res = await client.list("opportunities", {
      search: 'status in ["new","open"]',
      limit: 20,
      fields: [
        "id", "status", "buy_rent", "area_of_interest",
        "bedrooms_from", "bedrooms_to",
        "list_selling_price_from", "list_selling_price_to",
      ],
    });
    assertPaginated(res, "open leads for boost ranking");
    if (!res.data.length) return;

    const boost = [
      { field: "area_of_interest", op: "contains", value: "a", weight: 1 },
      { field: "bedrooms_from", op: ">=", value: 0, weight: 1 },
    ];
    const ranked = res.data
      .map((row) => {
        const { score, matched } = scoreRow(row, boost);
        return { id: row.id, _relevance: score, _matched: matched };
      })
      .sort((a, b) => b._relevance - a._relevance);

    assert.equal(ranked.length, res.data.length);
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1]._relevance >= ranked[i]._relevance);
    }
    assert.ok(typeof ranked[0]._relevance === "number");
    assert.ok(Array.isArray(ranked[0]._matched));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Viewing Pipeline
// "What viewings are scheduled? Show me the property and who created them."
// Tools: list_viewings (with include) → get_property → get_viewing
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 5: Viewing Pipeline – scheduled visits overview", () => {
  it("step 1: list viewings with viewing association expanded", async () => {
    const res = await client.list("property-viewings", {
      limit: 5,
      sort: "-created",
      include: ["PropertyViewingViewing"],
    });
    assertPaginated(res, "viewing pipeline list");
    if (res.data.length > 0) {
      ctx.firstViewingId = res.data[0].id;
    }
  });

  it("step 2: get single viewing detail", async () => {
    if (!ctx.firstViewingId) return;
    const res = await client.get("property-viewings", ctx.firstViewingId, {
      include: ["PropertyViewingViewing"],
    });
    assertSingle(res, "viewing detail");
    assert.equal(res.data.id, ctx.firstViewingId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Offer Tracking
// "Show all offers, which lead and property they're for"
// Tools: list_offers (with include) → get_offer → resolve opportunity + property
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 6: Offer Tracking – offers with linked entities", () => {
  it("step 1: list offers with opportunity and property expansion", async () => {
    const res = await client.list("offers", {
      limit: 5,
      include: ["OpportunityOpportunities", "PropertyProperties"],
    });
    assertPaginated(res, "offer tracking list");
    if (res.data.length > 0) {
      ctx.firstOfferId = res.data[0].id;
    }
  });

  it("step 2: get single offer with all expansions", async () => {
    if (!ctx.firstOfferId) return;
    const res = await client.get("offers", ctx.firstOfferId, {
      include: ["OpportunityOpportunities", "PropertyProperties", "CreatedByUsers"],
    });
    assertSingle(res, "offer detail");
    assert.equal(res.data.id, ctx.firstOfferId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Contact 360° View
// "Give me everything about this contact – their leads, tasks, calls, properties"
// Tools: get_contact (with multi-include) → verify associations present
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 7: Contact 360° View – full relationship expansion", () => {
  it("step 1: pick a contact from CRM", async () => {
    const res = await client.list("contacts", { limit: 1 });
    assertPaginated(res, "contact pick");
    assert.ok(res.data.length > 0, "CRM has contacts");
    ctx.contact360Id = res.data[0].id;
  });

  it("step 2: expand available associations on the contact", async () => {
    const res = await client.get("contacts", ctx.contact360Id, {
      include: [
        "AssignedToUsers",
        "User",
        "Language",
        "Organizations",
      ],
    });
    assertSingle(res, "contact 360");
    assert.equal(res.data.id, ctx.contact360Id);
  });

  it("step 3: verify contact has core identity fields", async () => {
    const res = await client.get("contacts", ctx.contact360Id);
    assertSingle(res, "contact fields check");
    const d = res.data;
    assert.ok("id" in d, "has id");
    assert.ok("first_name" in d || "name" in d, "has a name field");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Task Management
// "What tasks are pending? Who owns them and what are they linked to?"
// Tools: list_tasks (with include) → get_task
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 8: Task Management – pending tasks with context", () => {
  it("step 1: list tasks with assignee and contact expanded", async () => {
    const res = await client.list("tasks", {
      limit: 5,
      sort: "-created",
      include: ["AssignedToUsers", "ContactContacts", "TaskStatus"],
    });
    assertPaginated(res, "task mgmt list");
    if (res.data.length > 0) {
      ctx.firstTaskId = res.data[0].id;
    }
  });

  it("step 2: get task detail with all context", async () => {
    if (!ctx.firstTaskId) return;
    const res = await client.get("tasks", ctx.firstTaskId, {
      include: ["AssignedToUsers", "ContactContacts", "Properties", "TaskStatus", "TaskTypes"],
    });
    assertSingle(res, "task detail");
    assert.equal(res.data.id, ctx.firstTaskId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Project Inventory
// "What developments do we have? Show me their units and agents."
// Tools: list_projects → get_project (with properties + agents)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 9: Project Inventory – developments and units", () => {
  it("step 1: list projects", async () => {
    const res = await client.list("projects", {
      limit: 5,
      sort: "-created",
    });
    assertPaginated(res, "project inventory list");
    if (res.data.length > 0) {
      ctx.firstProjectId = res.data[0].id;
    }
  });

  it("step 2: get project with agents and developer", async () => {
    if (!ctx.firstProjectId) return;
    const res = await client.get("projects", ctx.firstProjectId, {
      include: ["Agents", "Developer", "Translations", "LocationLocations"],
    });
    assertSingle(res, "project detail");
    assert.equal(res.data.id, ctx.firstProjectId);
  });

  it("step 3: get project coordinates for map", async () => {
    const res = await client.getPath("projects/coordinates");
    assert.ok(res, "project coordinates returned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 10: Contract Review
// "Show me contracts, who's involved, and payment details"
// Tools: list_contracts (with include) → get_contract (full expansion)
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 10: Contract Review – agreements with parties & payments", () => {
  it("step 1: list contracts with contacts and property", async () => {
    const res = await client.list("contracts", {
      limit: 5,
      include: ["Contacts", "PropertyIdProperties"],
    });
    assertPaginated(res, "contract review list");
    if (res.data.length > 0) {
      ctx.firstContractId = res.data[0].id;
    }
  });

  it("step 2: get contract with full expansion", async () => {
    if (!ctx.firstContractId) return;
    const res = await client.get("contracts", ctx.firstContractId, {
      include: [
        "Contacts",
        "PropertyIdProperties",
        "OpportunityIdOpportunities",
        "PaymentInstallments",
        "ContractParties",
      ],
    });
    assertSingle(res, "contract detail");
    assert.equal(res.data.id, ctx.firstContractId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 11: Activity Timeline
// "Show me recent calls and meetings – who called whom?"
// Tools: list_calls + list_meetings (with contact/assignee) → drill down
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 11: Activity Timeline – calls & meetings history", () => {
  it("step 1: list recent calls with contact and assignee", async () => {
    const res = await client.list("calls", {
      limit: 5,
      sort: "-created",
      include: ["ContactContacts", "AssignedToUsers"],
    });
    assertPaginated(res, "calls timeline");
    if (res.data.length > 0) {
      ctx.firstCallId = res.data[0].id;
    }
  });

  it("step 2: list recent meetings with contact and viewings", async () => {
    const res = await client.list("meetings", {
      limit: 5,
      sort: "-created",
      include: ["ContactContacts", "AssignedToUsers"],
    });
    assertPaginated(res, "meetings timeline");
    if (res.data.length > 0) {
      ctx.firstMeetingId = res.data[0].id;
    }
  });

  it("step 3: drill into a call record", async () => {
    if (!ctx.firstCallId) return;
    const res = await client.get("calls", ctx.firstCallId, {
      include: ["ContactContacts", "AssignedToUsers", "RelatedOpportunityOpportunities"],
    });
    assertSingle(res, "call detail");
    assert.equal(res.data.id, ctx.firstCallId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 12: Schema Discovery → Search Construction
// "I don't know what fields Opportunities has – discover, then search"
// Tools: get_schema → use discovered field in search_opportunities
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 12: Schema Discovery → Build Search", () => {
  it("step 1: fetch Opportunities schema", async () => {
    const res = await client.getPath("schema/Opportunities");
    assert.ok(res, "schema returned");
    assert.equal(typeof res, "object");
    ctx.oppSchema = res;
  });

  it("step 2: verify schema contains expected key fields", async () => {
    const schema = ctx.oppSchema;
    if (!schema) return;
    const fieldNames = Object.keys(schema.properties || {});
    assert.ok(fieldNames.length > 10, `schema has many fields (got ${fieldNames.length})`);
    assert.ok(fieldNames.includes("status"), "schema has 'status' field");
    assert.ok(fieldNames.includes("buy_rent"), "schema has 'buy_rent' field");
  });

  it("step 3: use a schema-discovered field in a search", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "new"',
      limit: 3,
      expand: false,
    });
    assertPaginated(res, "schema-driven search");
  });

  it("step 4: fetch field options endpoint responds", async () => {
    const res = await client.list("field-options", { limit: 20 });
    assertPaginated(res, "field options");
    assert.ok(typeof res.pagination.count === "number", "field options returns valid pagination");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 13: FK Resolution Chain
// "Property → Agent → Agent's Contact → Contact's Opportunities"
// Tools: get_property → get_agent → get_contact (from agent) → list contact's leads
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 13: FK Resolution Chain – property to agent to contact", () => {
  it("step 1: get a property and extract agent FK", async () => {
    const res = await client.list("properties", {
      limit: 1, media: false,
      fields: ["id", "name", "agent"],
    });
    assertPaginated(res, "fk chain property");
    assert.ok(res.data.length > 0);
    ctx.fkPropertyAgentId = res.data[0].agent;
  });

  it("step 2: resolve agent and get their primary contact", async () => {
    if (!ctx.fkPropertyAgentId) return;
    const res = await client.get("agents", ctx.fkPropertyAgentId, {
      include: ["PrimaryContactContacts"],
    });
    assertSingle(res, "fk chain agent");
    assert.equal(res.data.id, ctx.fkPropertyAgentId);
  });

  it("step 3: get agent's brand and agency info", async () => {
    if (!ctx.fkPropertyAgentId) return;
    const res = await client.get("agents", ctx.fkPropertyAgentId, {
      include: ["Brands", "AgencyAgents"],
    });
    assertSingle(res, "fk chain agent brands");
  });

  it("step 4: get agent's user account", async () => {
    if (!ctx.fkPropertyAgentId) return;
    const res = await client.get("agents", ctx.fkPropertyAgentId, {
      include: ["User"],
    });
    assertSingle(res, "fk chain agent user");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 14: Pipeline Report
// "Count opportunities by status, show me the breakdown"
// Tools: search_opportunities multiple times with different status filters
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 14: Pipeline Report – lead status breakdown", () => {
  const statusCounts = {};

  it("count 'new' leads", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "new"', limit: 1, expand: false,
    });
    assertPaginated(res, "pipeline new");
    statusCounts.new = res.pagination.count;
  });

  it("count 'open' leads", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "open"', limit: 1, expand: false,
    });
    assertPaginated(res, "pipeline open");
    statusCounts.open = res.pagination.count;
  });

  it("count total leads", async () => {
    const res = await client.list("opportunities", {
      limit: 1, expand: false,
    });
    assertPaginated(res, "pipeline total");
    statusCounts.total = res.pagination.count;
    assert.ok(statusCounts.total >= 0, "total is valid");
  });

  it("verify counts are consistent", async () => {
    assert.ok(
      (statusCounts.new || 0) + (statusCounts.open || 0) <= statusCounts.total,
      "new + open should not exceed total"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 15: Email Communications History
// "Show recent emails, who sent them, and which properties/leads they relate to"
// Tools: list_email_messages (with include) → get_email_message
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 15: Email History – communications with context", () => {
  it("step 1: list recent emails with contact and property expanded", async () => {
    const res = await client.list("email-messages", {
      limit: 5,
      sort: "-created",
      include: ["ContactContacts", "Properties"],
    });
    assertPaginated(res, "email history list");
    if (res.data.length > 0) {
      ctx.firstEmailId = res.data[0].id;
    }
  });

  it("step 2: get email detail with all associations", async () => {
    if (!ctx.firstEmailId) return;
    const res = await client.get("email-messages", ctx.firstEmailId, {
      include: ["ContactContacts", "Properties", "RelatedOpportunityOpportunities"],
    });
    assertSingle(res, "email detail");
    assert.equal(res.data.id, ctx.firstEmailId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 16: Property Coordinates for Map
// "Show all available properties on a map, and all projects too"
// Tools: get_property_coordinates + get_project_coordinates
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 16: Map View – property & project coordinates", () => {
  it("step 1: get all property coordinates", async () => {
    const res = await client.getPath("properties/coordinates");
    assert.ok(res, "property coordinates returned");
    ctx.allPropertyCoords = res;
  });

  it("step 2: get filtered property coordinates (for-sale only)", async () => {
    const res = await client.getPath("properties/coordinates", {
      search: 'sale_rent == "for_sale"',
    });
    assert.ok(res, "filtered property coordinates returned");
  });

  it("step 3: get all project coordinates", async () => {
    const res = await client.getPath("projects/coordinates");
    assert.ok(res, "project coordinates returned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 17: Multi-Include Stress Test
// "Get a property with every safe association expanded at once"
// Tests that the API handles heavy include[] without errors
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 17: Multi-Include Stress – heavy expansion", () => {
  it("property with many associations", async () => {
    if (!ctx.firstPropertyId) {
      const res = await client.list("properties", { limit: 1, media: false });
      ctx.firstPropertyId = res.data[0]?.id;
    }
    if (!ctx.firstPropertyId) return;

    const res = await client.get("properties", ctx.firstPropertyId, {
      include: [
        "PropertyTypes",
        "PropertySubtypes",
        "Agents",
        "PropertyViewings",
        "Opportunities",
        "SalespersonUsers",
        "CreatedByUsers",
      ],
    });
    assertSingle(res, "multi-include property");
    assert.equal(res.data.id, ctx.firstPropertyId);
  });

  it("contact with many associations", async () => {
    if (!ctx.contact360Id) {
      const res = await client.list("contacts", { limit: 1 });
      ctx.contact360Id = res.data[0]?.id;
    }
    if (!ctx.contact360Id) return;

    const res = await client.get("contacts", ctx.contact360Id, {
      include: [
        "AssignedToUsers",
        "User",
        "Language",
        "Organizations",
      ],
    });
    assertSingle(res, "multi-include contact");
  });

  it("task with all context associations", async () => {
    if (!ctx.firstTaskId) {
      const res = await client.list("tasks", { limit: 1 });
      if (res.data.length > 0) ctx.firstTaskId = res.data[0].id;
    }
    if (!ctx.firstTaskId) return;

    const res = await client.get("tasks", ctx.firstTaskId, {
      include: [
        "TaskStatus",
        "TaskTypes",
        "AssignedToUsers",
        "ContactContacts",
        "Properties",
        "RelatedOpportunityOpportunities",
        "RelatedAgentAgents",
        "CreatedByUsers",
      ],
    });
    assertSingle(res, "multi-include task");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 18: Search Expression Variety
// Tests different search operators and special variables
// ═══════════════════════════════════════════════════════════════════════════

describe("Scenario 18: Search Expression Variety – operators & variables", () => {
  it("equality operator on string field", async () => {
    const res = await client.list("properties", {
      search: 'sale_rent == "for_sale"',
      limit: 2, media: false,
    });
    assertPaginated(res, "search ==");
  });

  it("inequality operator", async () => {
    const res = await client.list("properties", {
      search: 'status != "withdrawn"',
      limit: 2, media: false,
    });
    assertPaginated(res, "search !=");
  });

  it("compound AND expression", async () => {
    const res = await client.list("properties", {
      search: 'status == "available" and sale_rent == "for_sale"',
      limit: 2, media: false,
    });
    assertPaginated(res, "search AND");
  });

  it("DAYS_AGO() time variable", async () => {
    const res = await client.list("properties", {
      search: "created >= DAYS_AGO(365)",
      limit: 2, media: false,
    });
    assertPaginated(res, "search DAYS_AGO");
  });

  it("contains operator on text field", async () => {
    const res = await client.list("contacts", {
      search: 'email contains "@"',
      limit: 2,
    });
    assertPaginated(res, "search contains");
  });

  it("numeric comparison", async () => {
    const res = await client.list("properties", {
      search: "list_selling_price_amount > 0",
      limit: 2, media: false,
    });
    assertPaginated(res, "search numeric >");
  });
});
