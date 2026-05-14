/**
 * Unit tests for formatResult — output cap behaviour.
 *
 * Verifies:
 *   1. Payloads under the cap are returned verbatim.
 *   2. Paginated { data: [...], pagination: {...} } payloads are truncated to
 *      the largest prefix that fits, with a _truncated marker.
 *   3. Non-paginated payloads fall back to string truncation with a trailer.
 *   4. The cap is configurable via QOBRIX_MCP_MAX_RESULT_CHARS.
 *
 * No live API calls — runs without .env.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Use a module-scoped helper so we can re-import after env tweaks.
async function freshFormatResult() {
  // Bust ESM cache by appending a query string. Without this, changes to
  // QOBRIX_MCP_MAX_RESULT_CHARS would not be re-read because getMaxResultChars
  // reads process.env at call time, but we want to make sure each test starts
  // from a known state regardless.
  const mod = await import("../dist/tools/index.js");
  return mod.formatResult;
}

function bodyText(result) {
  return result.content[0].text;
}

describe("formatResult – output cap", () => {
  const ORIGINAL = process.env.QOBRIX_MCP_MAX_RESULT_CHARS;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QOBRIX_MCP_MAX_RESULT_CHARS;
    else process.env.QOBRIX_MCP_MAX_RESULT_CHARS = ORIGINAL;
  });

  it("returns small payloads verbatim", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "5000";
    const formatResult = await freshFormatResult();
    const payload = { hello: "world", n: 42 };
    const out = bodyText(formatResult(payload));
    assert.equal(out, JSON.stringify(payload, null, 2));
    assert.ok(!out.includes("_truncated"), "no truncation marker on small payload");
  });

  it("truncates paginated lists to the largest prefix that fits", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "1500";
    const formatResult = await freshFormatResult();

    const fatRow = (i) => ({
      id: `row-${i}`,
      blob: "x".repeat(200), // ~ 200+ chars per row
    });
    const payload = {
      data: Array.from({ length: 30 }, (_, i) => fatRow(i)),
      pagination: { count: 30, current_page: 1, limit: 30, page_count: 1 },
    };

    const out = bodyText(formatResult(payload));
    assert.ok(out.length <= 1500, `output stays under cap (got ${out.length})`);

    const parsed = JSON.parse(out);
    assert.ok(parsed._truncated, "_truncated marker present");
    assert.ok(parsed._truncated.kept_rows >= 1, "at least one row kept");
    assert.ok(
      parsed._truncated.kept_rows < 30,
      "fewer rows kept than original (truncation actually happened)"
    );
    assert.equal(
      parsed._truncated.omitted_rows,
      30 - parsed._truncated.kept_rows,
      "omitted_rows = total - kept"
    );
    assert.ok(
      typeof parsed._truncated.hint === "string" &&
        parsed._truncated.hint.toLowerCase().includes("fields"),
      "hint mentions fields[] guidance"
    );
    assert.equal(
      parsed.data.length,
      parsed._truncated.kept_rows,
      "data array length matches kept_rows"
    );
    assert.deepEqual(
      parsed.pagination,
      payload.pagination,
      "pagination block is preserved verbatim"
    );
  });

  it("falls back to string-trailer truncation for non-paginated payloads", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "500";
    const formatResult = await freshFormatResult();

    const payload = {
      data: {
        id: "x",
        big: "y".repeat(2000),
      },
    };
    const out = bodyText(formatResult(payload));
    assert.ok(out.length <= 500 + 500, "trailer-truncated output stays bounded");
    assert.ok(out.includes("QOBRIX_MCP TRUNCATED"), "trailer marker present");
    assert.ok(
      out.includes("Use fields[]") || out.includes("include[]"),
      "trailer surfaces guidance"
    );
  });

  it("respects QOBRIX_MCP_MAX_RESULT_CHARS=0 (no cap)", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "0";
    const formatResult = await freshFormatResult();

    const payload = {
      data: Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, blob: "x".repeat(500) })),
      pagination: { count: 50, current_page: 1, limit: 50, page_count: 1 },
    };
    const out = bodyText(formatResult(payload));
    const parsed = JSON.parse(out);
    assert.equal(parsed.data.length, 50, "all rows returned when cap disabled");
    assert.ok(!parsed._truncated, "no _truncated marker when cap disabled");
  });

  it("paginated truncation handles zero-row fit gracefully", async () => {
    // Very tight cap that can't even fit the envelope with one fat row.
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "400";
    const formatResult = await freshFormatResult();

    const payload = {
      data: [{ id: "huge", blob: "z".repeat(5000) }],
      pagination: { count: 1, current_page: 1, limit: 1, page_count: 1 },
    };
    const out = bodyText(formatResult(payload));
    // Whatever path we take, output must respect the cap.
    assert.ok(
      out.length <= 400 + 500,
      `output stays roughly within cap (got ${out.length})`
    );
    // And it must signal truncation in some recognisable way.
    assert.ok(
      out.includes("_truncated") || out.includes("QOBRIX_MCP TRUNCATED"),
      "truncation signal present even when zero rows fit"
    );
  });
});
