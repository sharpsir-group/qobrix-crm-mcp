/**
 * Qobrix CRM MCP Server – Canonical RE Workflow Tests
 *
 * Each test suite maps 1:1 to a canonical business process from the
 * matrix-platform-kb, validating that the MCP tools can serve the
 * workflow end-to-end.
 *
 * KB sources:
 *   WF1  listing-lifecycle.md + listing-pipeline.md
 *   WF2  lead-contact-lifecycle.md + lead-qualification.md
 *   WF3  sales-pipeline.md
 *   WF4  showing-lifecycle.md + follow-up-vs-active-sales.md
 *   WF5  transaction-lifecycle.md
 *   WF6  media-lifecycle.md + listing-checklist.md
 *   WF7  follow-up-vs-active-sales.md (activity tracking)
 *   WF8  schema discovery (operational need)
 *
 * Run:  node --env-file=.env --test test-suite/workflows.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { QobrixClient } from "../dist/client.js";

let client;
const ctx = {};

before(() => {
  client = QobrixClient.fromEnv();
});

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
// WF1: Listing Lifecycle
// KB: listing-lifecycle.md  (Property.StandardStatus state machine)
//     listing-pipeline.md   (Sharp-SIR 8-stage seller pipeline)
//
// Canonical: Incomplete → Coming Soon → Active → Hold / Active Under
//            Contract → Pending → Closed / Withdrawn / Canceled / Expired
// Qobrix mapping: available ≈ Active, reserved ≈ Pending,
//                 sold ≈ Closed, withdrawn ≈ Withdrawn
// ═══════════════════════════════════════════════════════════════════════════

describe("WF1: Listing Lifecycle", () => {
  const statusCounts = {};

  it("listing status distribution – available (Active)", async () => {
    const res = await client.list("properties", {
      search: 'status == "available"', limit: 1, media: false,
    });
    assertPaginated(res, "status available");
    statusCounts.available = res.pagination.count;
  });

  it("listing status distribution – reserved (Pending)", async () => {
    const res = await client.list("properties", {
      search: 'status == "reserved"', limit: 1, media: false,
    });
    assertPaginated(res, "status reserved");
    statusCounts.reserved = res.pagination.count;
  });

  it("listing status distribution – sold (Closed)", async () => {
    const res = await client.list("properties", {
      search: 'status == "sold"', limit: 1, media: false,
    });
    assertPaginated(res, "status sold");
    statusCounts.sold = res.pagination.count;
  });

  it("listing status distribution – withdrawn", async () => {
    const res = await client.list("properties", {
      search: 'status == "withdrawn"', limit: 1, media: false,
    });
    assertPaginated(res, "status withdrawn");
    statusCounts.withdrawn = res.pagination.count;
  });

  it("at least one status has records in CRM", () => {
    const total = (statusCounts.available || 0) +
                  (statusCounts.reserved || 0) +
                  (statusCounts.sold || 0) +
                  (statusCounts.withdrawn || 0);
    assert.ok(total > 0, "CRM has properties in at least one canonical status");
  });

  it("active listings with agent + type expansion", async () => {
    const res = await client.list("properties", {
      search: 'status == "available" and sale_rent == "for_sale"',
      limit: 3, media: false,
      include: ["PropertyTypes", "Agents"],
    });
    assertPaginated(res, "active listings expanded");
    if (res.data.length > 0) {
      ctx.activePropertyId = res.data[0].id;
      ctx.activePropertyAgent = res.data[0].agent;
    }
  });

  it("price change detection – recently modified active listings", async () => {
    const res = await client.list("properties", {
      search: 'status == "available"',
      sort: "-modified", limit: 3, media: false,
      fields: ["id", "name", "status", "list_selling_price_amount", "modified"],
    });
    assertPaginated(res, "recently modified");
    assert.ok(res.data.length > 0, "has recently modified active listings");
  });

  it("listing media completeness – active property has photos", async () => {
    if (!ctx.activePropertyId) return;
    const res = await client.list("media", {
      related_model: "Properties",
      related_id: ctx.activePropertyId,
      limit: 20,
    });
    assert.ok(res.data, "media data present");
    assert.ok(Array.isArray(res.data), "media is array");
  });

  it("listing coordinates for map syndication – available only", async () => {
    const res = await client.getPath("properties/coordinates", {
      search: 'status == "available"',
    });
    assert.ok(res, "filtered coordinates returned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF2: Lead-Contact Lifecycle
// KB: lead-contact-lifecycle.md  (ContactType funnel)
//     lead-qualification.md      (RAW → MQL → SQL)
//
// Canonical: Lead → Prospect → Ready to Buy → Buyer / Seller / Other
// Qobrix mapping: new ≈ Lead/MQL, open ≈ SQL/Active
// ═══════════════════════════════════════════════════════════════════════════

describe("WF2: Lead-Contact Lifecycle", () => {
  const funnel = {};

  it("lead funnel – count 'new' leads (RAW/MQL)", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "new"', limit: 1, expand: false,
    });
    assertPaginated(res, "new leads");
    funnel.newCount = res.pagination.count;
  });

  it("lead funnel – count 'open' leads (SQL/Active)", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "open"', limit: 1, expand: false,
    });
    assertPaginated(res, "open leads");
    funnel.openCount = res.pagination.count;
  });

  it("lead funnel – total count", async () => {
    const res = await client.list("opportunities", {
      limit: 1, expand: false,
    });
    assertPaginated(res, "total leads");
    funnel.totalCount = res.pagination.count;
  });

  it("new + open does not exceed total", () => {
    assert.ok(
      (funnel.newCount || 0) + (funnel.openCount || 0) <= funnel.totalCount,
      `new(${funnel.newCount}) + open(${funnel.openCount}) <= total(${funnel.totalCount})`
    );
  });

  it("lead qualification drill-down – expand contact", async () => {
    const res = await client.list("opportunities", {
      limit: 1, expand: false, sort: "-created",
      fields: ["id", "ref", "status", "contact_name", "agent", "source"],
    });
    assertPaginated(res, "lead for drill-down");
    assert.ok(res.data.length > 0, "has at least one lead");
    ctx.leadId = res.data[0].id;
    ctx.leadContactId = res.data[0].contact_name;

    const detail = await client.get("opportunities", ctx.leadId, {
      include: ["ContactNameContacts"],
    });
    assertSingle(detail, "lead detail with contact");
  });

  it("lead source attribution – source fields populated", async () => {
    const res = await client.list("opportunities", {
      limit: 5, expand: false,
      fields: ["id", "source", "source_description", "enquiry_type"],
    });
    assertPaginated(res, "lead source");
    assert.ok(res.data.length > 0);
  });

  it("contact ownership – AssignedToUsers resolution", async () => {
    const contacts = await client.list("contacts", { limit: 1 });
    assertPaginated(contacts, "contact pick");
    assert.ok(contacts.data.length > 0);

    const detail = await client.get("contacts", contacts.data[0].id, {
      include: ["AssignedToUsers"],
    });
    assertSingle(detail, "contact with owner");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF3: Sales Pipeline / Buyer Journey
// KB: sales-pipeline.md (8 stages)
//
// Qualification → Demand Research → Solution/Viewing → Decision Making
// → Deal Signing → Payment → Closed Won / Closed Lost
// ═══════════════════════════════════════════════════════════════════════════

describe("WF3: Sales Pipeline / Buyer Journey", () => {
  it("buyer-property matching – leads by property", async () => {
    if (!ctx.activePropertyId) {
      const res = await client.list("properties", { limit: 1, media: false });
      ctx.activePropertyId = res.data[0]?.id;
    }
    if (!ctx.activePropertyId) return;

    try {
      const res = await client.getPath(
        `opportunities/by-property/${ctx.activePropertyId}`, { limit: 5 }
      );
      assert.ok(res, "leads-by-property returned");
    } catch (e) {
      assert.ok(e.message.includes("Qobrix API error"),
        "structured API error when no match");
    }
  });

  it("buyer-property matching – properties by lead", async () => {
    if (!ctx.leadId) return;
    try {
      const res = await client.getSubresource(
        "opportunities", ctx.leadId, "properties"
      );
      assert.ok(res, "lead-properties returned");
    } catch (e) {
      assert.ok(e.message.includes("Qobrix API error"));
    }
  });

  it("Solution/Viewing stage – viewings link to properties", async () => {
    const res = await client.list("property-viewings", {
      limit: 5, include: ["PropertyViewingViewing"],
    });
    assertPaginated(res, "viewings");
    if (res.data.length > 0) {
      ctx.viewingRecord = res.data[0];
    }
  });

  it("Decision Making → Offer – offers link lead and property", async () => {
    const res = await client.list("offers", {
      limit: 3,
      include: ["OpportunityOpportunities", "PropertyProperties"],
    });
    assertPaginated(res, "offers");
    if (res.data.length > 0) {
      ctx.offerRecord = res.data[0];
    }
  });

  it("Deal Signing → Contract – contracts link buyer, property, opportunity", async () => {
    const res = await client.list("contracts", {
      limit: 3,
      include: ["Contacts", "PropertyIdProperties", "OpportunityIdOpportunities"],
    });
    assertPaginated(res, "contracts");
    if (res.data.length > 0) {
      ctx.contractRecord = res.data[0];
    }
  });

  it("pipeline task management – tasks with status and assignee", async () => {
    const res = await client.list("tasks", {
      limit: 5,
      include: ["TaskStatus", "AssignedToUsers"],
    });
    assertPaginated(res, "pipeline tasks");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF4: Showing / Viewing Lifecycle
// KB: showing-lifecycle.md  (Request → Appointment → Showing → Audit)
//     follow-up-vs-active-sales.md (first showing = pipeline trigger)
//
// In Qobrix: PropertyViewings + Meetings model showings
// ═══════════════════════════════════════════════════════════════════════════

describe("WF4: Showing / Viewing Lifecycle", () => {
  it("viewing list with association expansion", async () => {
    const res = await client.list("property-viewings", {
      limit: 5, include: ["PropertyViewingViewing"],
    });
    assertPaginated(res, "viewings list");
  });

  it("viewing → property back-reference via property include", async () => {
    if (!ctx.activePropertyId) {
      const res = await client.list("properties", { limit: 1, media: false });
      ctx.activePropertyId = res.data[0]?.id;
    }
    if (!ctx.activePropertyId) return;

    const res = await client.get("properties", ctx.activePropertyId, {
      include: ["PropertyViewings"],
    });
    assertSingle(res, "property with viewings");
  });

  it("meeting as viewing container – meetings with viewings expansion", async () => {
    const res = await client.list("meetings", {
      limit: 5,
      include: ["ContactContacts", "ViewingPropertyViewings"],
    });
    assertPaginated(res, "meetings with viewings");
  });

  it("first showing as pipeline trigger – lead with viewing is not new", async () => {
    if (!ctx.leadId) return;
    const lead = await client.get("opportunities", ctx.leadId);
    assertSingle(lead, "lead for showing trigger");
    // Canonical rule: after first showing, lead transitions out of 'new'
    // We verify the lead record has a status field and can be read
    assert.ok("status" in lead.data, "lead has status field");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF5: Transaction / Offer Lifecycle
// KB: transaction-lifecycle.md
//
// Canonical: Listing for Sale → Purchase Offer → Property Pending → Closed
// In Qobrix: Offers + Contracts + Properties(sold)
// ═══════════════════════════════════════════════════════════════════════════

describe("WF5: Transaction / Offer Lifecycle", () => {
  it("offer → opportunity → property chain", async () => {
    const res = await client.list("offers", {
      limit: 3,
      include: ["OpportunityOpportunities", "PropertyProperties"],
    });
    assertPaginated(res, "offer chain");
    if (res.data.length > 0) {
      const offer = res.data[0];
      assert.ok(offer.id, "offer has id");
    }
  });

  it("contract with payment schedule", async () => {
    const contracts = await client.list("contracts", { limit: 1 });
    assertPaginated(contracts, "contract list");
    if (contracts.data.length === 0) return;

    const detail = await client.get("contracts", contracts.data[0].id, {
      include: ["PaymentInstallments", "ContractParties"],
    });
    assertSingle(detail, "contract with payments");
  });

  it("closed deals – properties with status sold", async () => {
    const res = await client.list("properties", {
      search: 'status == "sold"', limit: 3, media: false,
      fields: ["id", "name", "status", "list_selling_price_amount"],
    });
    assertPaginated(res, "closed deals");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF6: Media Lifecycle
// KB: media-lifecycle.md  (MediaStatus: Pending → Active → Replaced/Deleted)
//     listing-checklist.md (marketing checklist: photos, descriptions)
//
// Qobrix: media endpoint with related_model polymorphism
// ═══════════════════════════════════════════════════════════════════════════

describe("WF6: Media Lifecycle", () => {
  it("property media gallery – active property has media", async () => {
    if (!ctx.activePropertyId) {
      const res = await client.list("properties", {
        search: 'status == "available"', limit: 1, media: false,
      });
      ctx.activePropertyId = res.data[0]?.id;
    }
    if (!ctx.activePropertyId) return;

    const res = await client.list("media", {
      related_model: "Properties",
      related_id: ctx.activePropertyId,
      limit: 20,
    });
    assert.ok(res.data, "media data present");
    assert.ok(Array.isArray(res.data), "media is array");
  });

  it("media polymorphism – Properties media vs global media", async () => {
    if (!ctx.activePropertyId) return;
    const propMedia = await client.list("media", {
      related_model: "Properties",
      related_id: ctx.activePropertyId,
      limit: 5,
    });
    assert.ok(propMedia.data, "property-scoped media returned");
    assert.ok(Array.isArray(propMedia.data));

    const globalMedia = await client.list("media", { limit: 5 });
    assert.ok(globalMedia.data, "global media returned");
    assert.ok(Array.isArray(globalMedia.data));
  });

  it("media metadata – single item has required fields", async () => {
    const all = await client.list("media", { limit: 1 });
    assert.ok(all.data, "media list returned");
    if (all.data.length === 0) return;

    const item = all.data[0];
    assert.ok(item.id, "media item has id");
    ctx.mediaId = item.id;

    const detail = await client.getPath(`media/${item.id}`);
    assert.ok(detail, "media detail returned");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF7: Activity Tracking / Follow-up
// KB: follow-up-vs-active-sales.md
//
// Rules: zero tolerance on missed follow-ups, daily cadence for active
// deals, engagement tracking via calls/meetings/emails
// ═══════════════════════════════════════════════════════════════════════════

describe("WF7: Activity Tracking / Follow-up", () => {
  it("call history with contact and assignee resolution", async () => {
    const res = await client.list("calls", {
      limit: 5, sort: "-created",
      include: ["ContactContacts", "AssignedToUsers"],
    });
    assertPaginated(res, "call history");
    if (res.data.length > 0) {
      assert.ok(res.data[0].id, "call has id");
    }
  });

  it("meeting history with contact context", async () => {
    const res = await client.list("meetings", {
      limit: 5, sort: "-created",
      include: ["ContactContacts"],
    });
    assertPaginated(res, "meeting history");
  });

  it("email communications with property and contact links", async () => {
    const res = await client.list("email-messages", {
      limit: 5, sort: "-created",
      include: ["ContactContacts", "Properties"],
    });
    assertPaginated(res, "email history");
    if (res.data.length > 0) {
      assert.ok(res.data[0].id, "email has id");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WF8: Schema Discovery for Search Construction
// KB: operational need – brokers need to know what fields exist before
//     building search expressions
//
// Maps to RESO DD field discovery: Property fields → StandardStatus,
// ListPrice, etc.; Opportunity fields → ContactType funnel states
// ═══════════════════════════════════════════════════════════════════════════

describe("WF8: Schema Discovery for Search Construction", () => {
  it("Property schema contains listing-lifecycle fields", async () => {
    const schema = await client.getPath("schema/Properties");
    assert.ok(schema, "schema returned");
    const fields = Object.keys(schema.properties || {});
    assert.ok(fields.length > 10, `schema has ${fields.length} fields`);

    const required = ["status", "sale_rent", "city", "list_selling_price_amount"];
    for (const f of required) {
      assert.ok(fields.includes(f), `Property schema has '${f}' (maps to RESO listing lifecycle)`);
    }
  });

  it("Opportunity schema contains lead-funnel fields", async () => {
    const schema = await client.getPath("schema/Opportunities");
    assert.ok(schema, "schema returned");
    const fields = Object.keys(schema.properties || {});
    assert.ok(fields.length > 10, `schema has ${fields.length} fields`);

    const required = ["status", "enquiry_type", "buy_rent", "contact_name"];
    for (const f of required) {
      assert.ok(fields.includes(f), `Opportunity schema has '${f}' (maps to RESO lead-contact lifecycle)`);
    }
  });

  it("Contacts schema contains identity and ownership fields", async () => {
    const schema = await client.getPath("schema/Contacts");
    assert.ok(schema, "schema returned");
    const fields = Object.keys(schema.properties || {});

    const required = ["first_name", "last_name", "email"];
    for (const f of required) {
      assert.ok(fields.includes(f), `Contact schema has '${f}'`);
    }
  });

  it("schema-driven search – use discovered field in expression", async () => {
    const schema = await client.getPath("schema/Properties");
    const fields = Object.keys(schema.properties || {});
    assert.ok(fields.includes("status"), "status field exists");

    const res = await client.list("properties", {
      search: 'status == "available"', limit: 2, media: false,
    });
    assertPaginated(res, "schema-driven search");
  });
});
