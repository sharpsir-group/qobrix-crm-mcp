/**
 * Unit tests for sort[] URL encoding (OpenAPI form).
 * No live API — verifies normalizeSort + buildQobrixUrl emit sort[] not sort=.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSort, buildQobrixUrl } from "../dist/client.js";

describe("normalizeSort", () => {
  it("returns undefined for empty input", () => {
    assert.equal(normalizeSort(undefined), undefined);
    assert.equal(normalizeSort(""), undefined);
    assert.equal(normalizeSort([]), undefined);
    assert.equal(normalizeSort("  ,  "), undefined);
  });

  it("wraps a single field string", () => {
    assert.deepEqual(normalizeSort("-list_selling_price_amount"), [
      "-list_selling_price_amount",
    ]);
  });

  it("splits comma-separated multi-key sort", () => {
    assert.deepEqual(normalizeSort("-price,-created"), ["-price", "-created"]);
  });

  it("passes through string arrays", () => {
    assert.deepEqual(normalizeSort(["-created", "name"]), ["-created", "name"]);
  });
});

describe("buildQobrixUrl – sort[] encoding", () => {
  it("emits sort[]= for a normalized sort array (not scalar sort=)", () => {
    const sort = normalizeSort("-list_selling_price_amount");
    const url = buildQobrixUrl("https://example.qobrix.com", "properties", {
      limit: 5,
      sort,
      expand: false,
    });
    assert.match(url, /sort%5B%5D=-list_selling_price_amount|sort\[\]=-list_selling_price_amount/);
    assert.ok(
      !/[?&]sort=-list_selling_price_amount/.test(url),
      "must not emit scalar sort= (Qobrix ignores it)"
    );
  });

  it("emits multiple sort[] entries for multi-key sort", () => {
    const url = buildQobrixUrl("https://example.qobrix.com", "properties", {
      sort: normalizeSort("-price,-created"),
    });
    const matches = url.match(/sort(%5B%5D|\[\])/g) || [];
    assert.equal(matches.length, 2, "two sort[] params");
  });

  it("emits fields[] the same way (regression)", () => {
    const url = buildQobrixUrl("https://example.qobrix.com", "properties", {
      fields: ["id", "ref"],
    });
    assert.match(url, /fields(%5B%5D|\[\])/);
  });
});
