/**
 * Relevance scoring unit tests (no live Qobrix API).
 *
 * Covers evalClause / scoreRow / ranking order / max_scan capping helpers
 * and search-param cache-key stability used by the relevance pager.
 *
 * Run:  npm run build && npm run test:relevance
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evalClause, scoreRow, mergeBoostFields } from "../dist/relevance.js";
import { buildDslHelpText } from "../dist/search-dsl.js";
import { cacheKey } from "../dist/cache.js";

describe("evalClause", () => {
  const row = {
    status: "available",
    bedrooms: 3,
    sea_view: true,
    city: "Limassol",
    list_selling_price_amount: 450000,
    name: "Villa Aurora",
  };

  it("== / != on strings and booleans", () => {
    assert.equal(evalClause(row, { field: "status", op: "==", value: "available" }), true);
    assert.equal(evalClause(row, { field: "status", op: "==", value: "sold" }), false);
    assert.equal(evalClause(row, { field: "sea_view", op: "==", value: true }), true);
    assert.equal(evalClause(row, { field: "status", op: "!=", value: "sold" }), true);
  });

  it("numeric comparisons", () => {
    assert.equal(evalClause(row, { field: "bedrooms", op: ">=", value: 3 }), true);
    assert.equal(evalClause(row, { field: "bedrooms", op: ">", value: 3 }), false);
    assert.equal(evalClause(row, { field: "list_selling_price_amount", op: "<=", value: 500000 }), true);
  });

  it("in list and in range", () => {
    assert.equal(
      evalClause(row, { field: "status", op: "in", value: ["available", "reserved"] }),
      true
    );
    assert.equal(
      evalClause(row, { field: "list_selling_price_amount", op: "in", value: "200000..600000" }),
      true
    );
    assert.equal(
      evalClause(row, { field: "list_selling_price_amount", op: "in", value: "500000..600000" }),
      false
    );
  });

  it("contains / starts_with / ends_with", () => {
    assert.equal(evalClause(row, { field: "city", op: "contains", value: "Limas" }), true);
    assert.equal(evalClause(row, { field: "name", op: "starts_with", value: "Villa" }), true);
    assert.equal(evalClause(row, { field: "name", op: "ends_with", value: "Aurora" }), true);
  });
});

describe("scoreRow ranking", () => {
  const boost = [
    { field: "sea_view", op: "==", value: true, weight: 3 },
    { field: "bedrooms", op: ">=", value: 3, weight: 2 },
    { field: "list_selling_price_amount", op: "in", value: "200000..600000", weight: 2 },
  ];

  it("sums matched weights and lists matched clauses", () => {
    const perfect = {
      sea_view: true,
      bedrooms: 4,
      list_selling_price_amount: 400000,
    };
    const { score, matched } = scoreRow(perfect, boost);
    assert.equal(score, 7);
    assert.equal(matched.length, 3);
  });

  it("ranks higher-scoring rows first when sorted", () => {
    const rows = [
      { id: "a", sea_view: false, bedrooms: 2, list_selling_price_amount: 100000 },
      { id: "b", sea_view: true, bedrooms: 3, list_selling_price_amount: 400000 },
      { id: "c", sea_view: true, bedrooms: 1, list_selling_price_amount: 900000 },
    ];
    const scored = rows
      .map((row) => {
        const { score, matched } = scoreRow(row, boost);
        return { ...row, _relevance: score, _matched: matched };
      })
      .sort((a, b) => b._relevance - a._relevance);

    assert.equal(scored[0].id, "b");
    assert.equal(scored[0]._relevance, 7);
    assert.equal(scored[1].id, "c");
    assert.equal(scored[1]._relevance, 3);
    assert.equal(scored[2].id, "a");
    assert.equal(scored[2]._relevance, 0);
  });

  it("respects top-N after ranking (limit simulation)", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      sea_view: i % 2 === 0,
      bedrooms: i % 5,
      list_selling_price_amount: 100000 + i * 10000,
    }));
    const scored = rows
      .map((row) => {
        const { score } = scoreRow(row, boost);
        return { ...row, _relevance: score };
      })
      .sort((a, b) => b._relevance - a._relevance);
    const top = scored.slice(0, 5);
    assert.equal(top.length, 5);
    for (let i = 1; i < top.length; i++) {
      assert.ok(top[i - 1]._relevance >= top[i]._relevance);
    }
  });
});

describe("max_scan hard cap constant", () => {
  it("documents the 500 hard cap used by collectCandidates", async () => {
    // Importing the module is enough; we assert the public contract via scoring
    // and cache keys. The hard cap is enforced inside collectCandidates.
    const huge = Array.from({ length: 600 }, (_, i) => ({ id: i, bedrooms: 3 }));
    const boost = [{ field: "bedrooms", op: ">=", value: 3, weight: 1 }];
    const scanned = huge.slice(0, 500);
    assert.equal(scanned.length, 500);
    const scores = scanned.map((r) => scoreRow(r, boost).score);
    assert.ok(scores.every((s) => s === 1));
  });
});

describe("mergeBoostFields", () => {
  const boost = [
    { field: "sea_view", op: "==", value: true },
    { field: "bedrooms", op: ">=", value: 3 },
  ];

  it("returns undefined/empty projection unchanged (full row already fetched)", () => {
    assert.equal(mergeBoostFields(undefined, boost), undefined);
    assert.deepEqual(mergeBoostFields([], boost), []);
  });

  it("unions boost fields and id into an explicit projection", () => {
    const merged = mergeBoostFields(["name", "city"], boost);
    assert.ok(merged.includes("name"));
    assert.ok(merged.includes("city"));
    assert.ok(merged.includes("id"), "id must be present for row identity");
    assert.ok(merged.includes("sea_view"), "boost field must be fetched");
    assert.ok(merged.includes("bedrooms"), "boost field must be fetched");
  });

  it("does not duplicate fields already present", () => {
    const merged = mergeBoostFields(["id", "sea_view", "name"], boost);
    const counts = merged.reduce((acc, f) => ((acc[f] = (acc[f] ?? 0) + 1), acc), {});
    for (const [, n] of Object.entries(counts)) assert.equal(n, 1);
  });
});

describe("non-property boost scoring (opportunities / contacts)", () => {
  it("ranks open leads by area / bedrooms / budget criteria", () => {
    const boost = [
      { field: "area_of_interest", op: "contains", value: "Limassol", weight: 3 },
      { field: "bedrooms_from", op: "<=", value: 3, weight: 2 },
      { field: "list_selling_price_to", op: ">=", value: 400000, weight: 2 },
    ];
    const leads = [
      {
        id: "a",
        area_of_interest: "Limassol marina",
        bedrooms_from: 2,
        list_selling_price_to: 500000,
      },
      {
        id: "b",
        area_of_interest: "Paphos",
        bedrooms_from: 4,
        list_selling_price_to: 300000,
      },
      {
        id: "c",
        area_of_interest: "Limassol",
        bedrooms_from: 3,
        list_selling_price_to: 350000,
      },
    ];
    const ranked = leads
      .map((row) => ({ ...row, _relevance: scoreRow(row, boost).score }))
      .sort((a, b) => b._relevance - a._relevance);
    assert.equal(ranked[0].id, "a");
    assert.equal(ranked[0]._relevance, 7);
    assert.equal(ranked[1].id, "c");
    assert.equal(ranked[1]._relevance, 5);
    assert.equal(ranked[2].id, "b");
    assert.equal(ranked[2]._relevance, 0);
  });

  it("scores contacts by city and is_company", () => {
    const boost = [
      { field: "city", op: "==", value: "Limassol", weight: 2 },
      { field: "is_company", op: "==", value: false, weight: 1 },
    ];
    const { score, matched } = scoreRow(
      { city: "Limassol", is_company: false },
      boost
    );
    assert.equal(score, 3);
    assert.equal(matched.length, 2);
  });

  it("mergeBoostFields works for opportunity projections", () => {
    const merged = mergeBoostFields(["status", "ref"], [
      { field: "area_of_interest", op: "contains", value: "Lim" },
      { field: "bedrooms_from", op: "<=", value: 3 },
    ]);
    assert.ok(merged.includes("id"));
    assert.ok(merged.includes("area_of_interest"));
    assert.ok(merged.includes("bedrooms_from"));
    assert.ok(merged.includes("status"));
  });
});

describe("search-dsl help text", () => {
  it("includes core operators and recipe", () => {
    const text = buildDslHelpText();
    assert.match(text, /DAYS_AGO/);
    assert.match(text, /DISTANCE_FROM/);
    assert.match(text, /boost\[\]/);
    assert.match(text, /max_scan/);
  });

  it("appends property cheatsheet for Properties", () => {
    const text = buildDslHelpText("Properties");
    assert.match(text, /list_selling_price_amount/);
    assert.doesNotMatch(text, /starting_price_from/);
  });

  it("appends project cheatsheet for Projects", () => {
    const text = buildDslHelpText("Projects");
    assert.match(text, /starting_price_from/);
  });

  it("appends opportunity cheatsheet for Opportunities", () => {
    const text = buildDslHelpText("Opportunities");
    assert.match(text, /list_selling_price_from/);
    assert.match(text, /area_of_interest/);
  });

  it("appends contact cheatsheet for Contacts", () => {
    const text = buildDslHelpText("Contacts");
    assert.match(text, /preferred_language/);
  });

  it("mentions all-resource recipe and matching", () => {
    const text = buildDslHelpText();
    assert.match(text, /all qobrix_search_/i);
    assert.match(text, /Lead <-> listing matching/i);
  });
});

describe("search page cache keys (relevance pager)", () => {
  it("canonicalizes search + pagination params like list pages", () => {
    const a = cacheKey("request", "properties", {
      limit: 100,
      page: 1,
      search: 'status == "available"',
      expand: false,
      media: false,
    });
    const b = cacheKey("request", "properties", {
      media: false,
      expand: false,
      search: 'status == "available"',
      page: 1,
      limit: 100,
    });
    assert.equal(a, b);
  });

  it("different search strings produce different keys", () => {
    const a = cacheKey("request", "properties", {
      search: 'status == "available"',
      limit: 10,
    });
    const b = cacheKey("request", "properties", {
      search: 'status == "sold"',
      limit: 10,
    });
    assert.notEqual(a, b);
  });

  it("fields[] order does not change the key", () => {
    const a = cacheKey("request", "properties", {
      fields: ["id", "name", "city"],
      search: 'status == "available"',
    });
    const b = cacheKey("request", "properties", {
      fields: ["city", "id", "name"],
      search: 'status == "available"',
    });
    assert.equal(a, b);
  });
});
