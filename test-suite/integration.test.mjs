/**
 * Qobrix CRM MCP Server – Integration Test Suite
 *
 * Hits every MCP tool path against the live Qobrix API to verify:
 *   1. List endpoints return { data: [], pagination: {} }
 *   2. Get-by-id endpoints return { data: {} }
 *   3. Search endpoints accept expressions and return filtered results
 *   4. Special endpoints (coordinates, by-lead, schema, field-options) respond
 *   5. Pagination metadata is structurally valid
 *   6. Expand (include[]) and partial responses (fields[]) work
 *
 * Run:  node --env-file=.env test/integration.test.mjs
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { QobrixClient } from "../dist/client.js";
import {
  paginateAll,
  topRecords,
} from "../dist/tools/analytics.js";
import { runDeals } from "../dist/tools/deals.js";

let client;

// IDs harvested during list calls so get-by-id tests can use real UUIDs
const ids = {};

// ─── helpers ────────────────────────────────────────────────────────────────

function assertPaginated(res, label) {
  assert.ok(res.data, `${label}: missing data`);
  assert.ok(Array.isArray(res.data), `${label}: data is not an array`);
  assert.ok(res.pagination, `${label}: missing pagination`);
  assert.equal(typeof res.pagination.count, "number", `${label}: pagination.count`);
  assert.equal(typeof res.pagination.current_page, "number", `${label}: pagination.current_page`);
  assert.equal(typeof res.pagination.has_next_page, "boolean", `${label}: pagination.has_next_page`);
  assert.equal(typeof res.pagination.limit, "number", `${label}: pagination.limit`);
}

function assertSingle(res, label) {
  assert.ok(res.data, `${label}: missing data`);
  assert.equal(typeof res.data, "object", `${label}: data is not an object`);
  assert.ok(!Array.isArray(res.data), `${label}: data should not be an array`);
}

function storeId(resource, res) {
  if (res.data?.length > 0 && res.data[0].id) {
    ids[resource] = res.data[0].id;
  }
}

// ─── setup ──────────────────────────────────────────────────────────────────

before(() => {
  client = new QobrixClient();
});

// ─── 1. Properties ──────────────────────────────────────────────────────────

describe("Properties", () => {
  it("list – basic pagination", async () => {
    const res = await client.list("properties", { limit: 2, media: false });
    assertPaginated(res, "list properties");
    assert.ok(res.data.length <= 2, "respects limit");
    assert.ok(res.pagination.count > 0, "has data in CRM");
    storeId("properties", res);
  });

  it("list – fields[] partial response", async () => {
    const res = await client.list("properties", {
      limit: 1, media: false,
      fields: ["name", "status", "city"],
    });
    assertPaginated(res, "list properties fields");
    if (res.data.length > 0) {
      assert.ok("name" in res.data[0], "name field present");
    }
  });

  it("list – include[] association expansion", async () => {
    const res = await client.list("properties", {
      limit: 1, media: false,
      include: ["PropertyTypes"],
    });
    assertPaginated(res, "list properties include");
  });

  it("list – sort descending", async () => {
    const res = await client.list("properties", {
      limit: 2, media: false, sort: "-created",
    });
    assertPaginated(res, "list properties sort");
  });

  it("search – expression filter", async () => {
    const res = await client.list("properties", {
      search: 'status == "available" and sale_rent == "for_sale"',
      limit: 2, media: false,
    });
    assertPaginated(res, "search properties");
  });

  it("get – single by id", async () => {
    if (!ids.properties) return; // skip if list returned nothing
    const res = await client.get("properties", ids.properties);
    assertSingle(res, "get property");
    assert.equal(res.data.id, ids.properties);
  });

  it("get – with include[]", async () => {
    if (!ids.properties) return;
    const res = await client.get("properties", ids.properties, {
      include: ["PropertyTypes", "Agents"],
    });
    assertSingle(res, "get property include");
  });

  it("coordinates endpoint", async () => {
    const res = await client.getPath("properties/coordinates");
    assert.ok(res, "coordinates returned a response");
  });
});

// ─── 2. Contacts ────────────────────────────────────────────────────────────

describe("Contacts", () => {
  it("list – basic", async () => {
    const res = await client.list("contacts", { limit: 2 });
    assertPaginated(res, "list contacts");
    assert.ok(res.pagination.count > 0);
    storeId("contacts", res);
  });

  it("list – fields[]", async () => {
    const res = await client.list("contacts", {
      limit: 1,
      fields: ["first_name", "last_name", "email"],
    });
    assertPaginated(res, "list contacts fields");
  });

  it("search", async () => {
    const res = await client.list("contacts", {
      search: 'email contains "@"',
      limit: 2,
    });
    assertPaginated(res, "search contacts");
  });

  it("get – single", async () => {
    if (!ids.contacts) return;
    const res = await client.get("contacts", ids.contacts);
    assertSingle(res, "get contact");
    assert.equal(res.data.id, ids.contacts);
  });
});

// ─── 3. Agents ──────────────────────────────────────────────────────────────

describe("Agents", () => {
  it("list", async () => {
    const res = await client.list("agents", { limit: 2 });
    assertPaginated(res, "list agents");
    storeId("agents", res);
  });

  it("get – single", async () => {
    if (!ids.agents) return;
    const res = await client.get("agents", ids.agents);
    assertSingle(res, "get agent");
  });

  it("search", async () => {
    const res = await client.list("agents", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search agents");
  });
});

// ─── 4. Opportunities / Leads ───────────────────────────────────────────────

describe("Opportunities", () => {
  it("list – with expand false to avoid Locations FK issue", async () => {
    const res = await client.list("opportunities", {
      limit: 2,
      fields: ["ref", "status", "enquiry_type", "contact_name"],
      expand: false,
    });
    assertPaginated(res, "list opportunities");
    storeId("opportunities", res);
  });

  it("search", async () => {
    const res = await client.list("opportunities", {
      search: 'status == "new"',
      limit: 2,
      expand: false,
    });
    assertPaginated(res, "search opportunities");
  });

  it("get – single", async () => {
    if (!ids.opportunities) return;
    const res = await client.get("opportunities", ids.opportunities);
    assertSingle(res, "get opportunity");
  });

  it("get leads by property", async () => {
    if (!ids.properties) return;
    try {
      const res = await client.getPath(
        `opportunities/by-property/${ids.properties}`,
        { limit: 2 }
      );
      assert.ok(res, "leads by property returned");
    } catch (e) {
      // some properties may not have matching leads – that's ok
      assert.ok(e.message.includes("Qobrix API error"), "expected API error shape");
    }
  });

  it("get lead properties", async () => {
    if (!ids.opportunities) return;
    try {
      const res = await client.getSubresource(
        "opportunities", ids.opportunities, "properties"
      );
      assert.ok(res, "lead properties returned");
    } catch (e) {
      assert.ok(e.message.includes("Qobrix API error"));
    }
  });
});

// ─── 5. Property Viewings ───────────────────────────────────────────────────

describe("Property Viewings", () => {
  it("list", async () => {
    const res = await client.list("property-viewings", { limit: 2 });
    assertPaginated(res, "list viewings");
    storeId("viewings", res);
  });

  it("get – single", async () => {
    if (!ids.viewings) return;
    const res = await client.get("property-viewings", ids.viewings);
    assertSingle(res, "get viewing");
  });

  it("search", async () => {
    const res = await client.list("property-viewings", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search viewings");
  });
});

// ─── 6. Tasks ───────────────────────────────────────────────────────────────

describe("Tasks", () => {
  it("list", async () => {
    const res = await client.list("tasks", { limit: 2 });
    assertPaginated(res, "list tasks");
    storeId("tasks", res);
  });

  it("get – single", async () => {
    if (!ids.tasks) return;
    const res = await client.get("tasks", ids.tasks);
    assertSingle(res, "get task");
  });

  it("search", async () => {
    const res = await client.list("tasks", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search tasks");
  });
});

// ─── 7. Media ───────────────────────────────────────────────────────────────
// Qobrix media endpoint returns { data: [...] } without pagination metadata.

describe("Media", () => {
  it("list", async () => {
    const res = await client.list("media", { limit: 2 });
    assert.ok(res.data, "list media: has data");
    assert.ok(Array.isArray(res.data), "list media: data is array");
    if (res.data.length > 0 && res.data[0].id) {
      ids.media = res.data[0].id;
    }
  });

  it("list – filtered by related_model", async () => {
    if (!ids.properties) return;
    const res = await client.list("media", {
      limit: 2,
      related_model: "Properties",
      related_id: ids.properties,
    });
    assert.ok(res.data, "list media filtered: has data");
    assert.ok(Array.isArray(res.data), "list media filtered: data is array");
  });

  it("get – single metadata", async () => {
    if (!ids.media) return;
    const res = await client.getPath(`media/${ids.media}`);
    assert.ok(res, "get media returned");
  });
});

// ─── 8. Projects ────────────────────────────────────────────────────────────

describe("Projects", () => {
  it("list", async () => {
    const res = await client.list("projects", { limit: 2 });
    assertPaginated(res, "list projects");
    storeId("projects", res);
  });

  it("get – single", async () => {
    if (!ids.projects) return;
    const res = await client.get("projects", ids.projects);
    assertSingle(res, "get project");
  });

  it("search", async () => {
    const res = await client.list("projects", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search projects");
  });

  it("coordinates", async () => {
    const res = await client.getPath("projects/coordinates");
    assert.ok(res, "project coordinates returned");
  });
});

// ─── 9. Offers ──────────────────────────────────────────────────────────────

describe("Offers", () => {
  it("list", async () => {
    const res = await client.list("offers", { limit: 2 });
    assertPaginated(res, "list offers");
    storeId("offers", res);
  });

  it("get – single", async () => {
    if (!ids.offers) return;
    const res = await client.get("offers", ids.offers);
    assertSingle(res, "get offer");
  });

  it("search", async () => {
    const res = await client.list("offers", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search offers");
  });
});

// ─── 10. Contracts ──────────────────────────────────────────────────────────

describe("Contracts", () => {
  it("list", async () => {
    const res = await client.list("contracts", { limit: 2 });
    assertPaginated(res, "list contracts");
    storeId("contracts", res);
  });

  it("get – single", async () => {
    if (!ids.contracts) return;
    const res = await client.get("contracts", ids.contracts);
    assertSingle(res, "get contract");
  });

  it("search", async () => {
    const res = await client.list("contracts", {
      limit: 2,
      search: 'id != ""',
    });
    assertPaginated(res, "search contracts");
  });
});

// ─── 11. Calls ──────────────────────────────────────────────────────────────

describe("Calls", () => {
  it("list", async () => {
    const res = await client.list("calls", { limit: 2 });
    assertPaginated(res, "list calls");
    storeId("calls", res);
  });

  it("get – single", async () => {
    if (!ids.calls) return;
    const res = await client.get("calls", ids.calls);
    assertSingle(res, "get call");
  });
});

// ─── 12. Meetings ───────────────────────────────────────────────────────────

describe("Meetings", () => {
  it("list", async () => {
    const res = await client.list("meetings", { limit: 2 });
    assertPaginated(res, "list meetings");
    storeId("meetings", res);
  });

  it("get – single", async () => {
    if (!ids.meetings) return;
    const res = await client.get("meetings", ids.meetings);
    assertSingle(res, "get meeting");
  });
});

// ─── 13. Email Messages ─────────────────────────────────────────────────────

describe("Email Messages", () => {
  it("list", async () => {
    const res = await client.list("email-messages", { limit: 2 });
    assertPaginated(res, "list email-messages");
    storeId("email-messages", res);
  });

  it("get – single", async () => {
    if (!ids["email-messages"]) return;
    const res = await client.get("email-messages", ids["email-messages"]);
    assertSingle(res, "get email-message");
  });
});

// ─── 14. Schema / Metadata ──────────────────────────────────────────────────

describe("Schema / Metadata", () => {
  it("get schema – Properties", async () => {
    const res = await client.getPath("schema/Properties");
    assert.ok(res, "schema returned");
    assert.equal(typeof res, "object");
  });

  it("get schema – Contacts", async () => {
    const res = await client.getPath("schema/Contacts");
    assert.ok(res, "schema returned");
  });

  it("get schema – Opportunities", async () => {
    const res = await client.getPath("schema/Opportunities");
    assert.ok(res, "schema returned");
  });

  it("get schema – Tasks", async () => {
    const res = await client.getPath("schema/Tasks");
    assert.ok(res, "schema returned");
  });

  it("get schema – Agents", async () => {
    const res = await client.getPath("schema/Agents");
    assert.ok(res, "schema returned");
  });

  it("get schema – Projects", async () => {
    const res = await client.getPath("schema/Projects");
    assert.ok(res, "schema returned");
  });

  it("field-options list", async () => {
    const res = await client.list("field-options", { limit: 5 });
    assertPaginated(res, "list field-options");
  });
});

// ─── 15. Analytics & Deals (top_records, aggregate, qobrix_deals) ───────────

const CLOSED_SALES_2026 =
  'contract_type == "cos" and contract_status == "agreed" ' +
  'and date_of_contract >= "2026-01-01" ' +
  'and date_of_contract < "2027-01-01"';

describe("Analytics & Deals", () => {
  it("topRecords – contracts by final_selling_price_amount (2026 closed sales)", async () => {
    const res = await topRecords({
      resource: "contracts",
      sort_by: "final_selling_price_amount",
      search: CLOSED_SALES_2026,
      top: 5,
    });
    assert.equal(res.resource, "contracts");
    assert.equal(res.sort_by, "final_selling_price_amount");
    assert.equal(res.desc, true);
    assert.ok(res.total_matched >= 1, "has 2026 closed sales");
    assert.ok(res.rows.length >= 1, "returns at least one row");

    // Sort must be in-process descending.
    const prices = res.rows
      .map((r) => Number(r.final_selling_price_amount))
      .filter((n) => Number.isFinite(n));
    for (let i = 1; i < prices.length; i++) {
      assert.ok(prices[i - 1] >= prices[i], "rows sorted desc by price");
    }

    // Always-resolve set should expand property_id into a richer object.
    if (res.rows[0].property_id) {
      assert.ok(res.rows[0].property, "property_id resolved to property obj");
      assert.equal(typeof res.rows[0].property, "object");
    }
  });

  it("paginateAll + manual sum – aggregate-style 2026 closed sales volume", async () => {
    // Smokes the same paginate/sum path qobrix_aggregate uses.
    const scan = await paginateAll({
      resource: "contracts",
      search: CLOSED_SALES_2026,
      expand: false,
    });
    let sum = 0;
    let withValue = 0;
    for (const row of scan.rows) {
      const n = Number(row.final_selling_price_amount);
      if (Number.isFinite(n) && n > 0) {
        sum += n;
        withValue++;
      }
    }
    assert.ok(withValue >= 1, "found at least one priced 2026 sale");
    assert.ok(sum > 0, "total 2026 closed-sale volume is positive");
  });

  it("qobrix_deals – defaults (kind=sale year=2026 top=5)", async () => {
    const res = await runDeals({ year: 2026, top: 5 });
    assert.equal(res.effective_filters.kind, "sale");
    assert.deepEqual(res.effective_filters.contract_types, ["cos"]);
    assert.deepEqual(res.effective_filters.contract_statuses, ["agreed"]);
    assert.equal(res.effective_filters.date_field, "date_of_contract");

    assert.ok(Array.isArray(res.deals));
    assert.ok(res.deals.length >= 1, "found 2026 closed sales");
    assert.ok(res.summary, "summary present");
    assert.ok(res.summary.count >= 1);
    assert.ok(res.summary.total_selling_volume > 0);
    assert.equal(typeof res.summary.by_status, "object");
    assert.equal(typeof res.summary.by_type, "object");

    // Top deal must have a selling price and (ideally) a resolved property.
    const top = res.deals[0];
    assert.ok(top.final_selling_price_amount > 0);
  });

  it("qobrix_deals – kind=rental switches defaults", async () => {
    const res = await runDeals({ kind: "rental", year: 2026, top: 5 });
    assert.deepEqual(res.effective_filters.contract_types, [
      "tenancy_agreement",
    ]);
    assert.equal(res.effective_filters.date_field, "start_date");
    // Rentals may not exist for every tenant; assert structure not row count.
    assert.ok(Array.isArray(res.deals));
    assert.ok(res.summary);
    assert.equal(typeof res.summary.total_rental_volume, "number");
  });

  it("qobrix_deals – contract_statuses=[reserved,agreed] mixes pipeline + closed", async () => {
    const res = await runDeals({
      contract_statuses: ["reserved", "agreed"],
      year: 2026,
      top: 5,
    });
    assert.deepEqual(
      [...res.effective_filters.contract_statuses].sort(),
      ["agreed", "reserved"]
    );
    assert.ok(Array.isArray(res.deals));
    assert.ok(res.summary);
    // by_status keys should be a subset of {reserved, agreed} for matched rows.
    for (const k of Object.keys(res.summary.by_status)) {
      assert.ok(
        k === "reserved" || k === "agreed" || k === "(none)",
        `unexpected status bucket: ${k}`
      );
    }
  });

  it("qobrix_deals – kind=any + by=commission sorts by commission_value_amount", async () => {
    const res = await runDeals({ kind: "any", year: 2026, by: "commission", top: 5 });
    assert.equal(res.effective_filters.kind, "any");
    assert.equal(res.effective_filters.sort_axis, "commission");
    assert.equal(res.effective_filters.sort_field, "commission_value_amount");
    // contract_types filter omitted entirely when kind=any.
    assert.equal(res.effective_filters.contract_types, null);

    const commissions = res.deals
      .map((d) => d.commission_value_amount)
      .filter((n) => typeof n === "number" && Number.isFinite(n));
    for (let i = 1; i < commissions.length; i++) {
      assert.ok(
        commissions[i - 1] >= commissions[i],
        "deals sorted desc by commission"
      );
    }
  });
});

// ─── 16. Cross-cutting: Pagination edge cases ───────────────────────────────

describe("Pagination edge cases", () => {
  it("page=1 has has_prev_page=false", async () => {
    const res = await client.list("properties", { limit: 1, page: 1, media: false });
    assert.equal(res.pagination.current_page, 1);
    assert.equal(res.pagination.has_prev_page, false);
  });

  it("limit=100 is accepted (max)", async () => {
    const res = await client.list("contacts", { limit: 100, page: 1 });
    assertPaginated(res, "max limit");
    assert.ok(res.data.length <= 100);
  });

  it("page=2 has has_prev_page=true", async () => {
    const res = await client.list("properties", { limit: 1, page: 2, media: false });
    assert.equal(res.pagination.current_page, 2);
    assert.equal(res.pagination.has_prev_page, true);
  });
});
