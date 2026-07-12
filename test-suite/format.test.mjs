/**
 * Unit tests for formatResult — output cap behaviour.
 *
 * Verifies:
 *   1. Payloads under the cap are returned verbatim.
 *   2. Paginated { data: [...], pagination: {...} } payloads are truncated to
 *      the largest prefix that fits, with a _truncated marker.
 *   3. Non-paginated payloads fall back to string truncation with a trailer.
 *   4. The cap is configurable via QOBRIX_MCP_MAX_RESULT_CHARS.
 *   5. All-oversized nested rows compact to scalars and keep >= 1 row.
 *   6. Grossly oversized payloads return status=result_too_large + _refine_required.
 *
 * No live API calls — runs without .env.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

async function freshFormatResult() {
  const mod = await import("../dist/tools/index.js");
  return mod.formatResult;
}

function bodyText(result) {
  return result.content[0].text;
}

describe("formatResult – output cap", () => {
  const ORIGINAL = process.env.QOBRIX_MCP_MAX_RESULT_CHARS;
  const ORIGINAL_REFINE = process.env.QOBRIX_MCP_REFINE_MULTIPLIER;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.QOBRIX_MCP_MAX_RESULT_CHARS;
    else process.env.QOBRIX_MCP_MAX_RESULT_CHARS = ORIGINAL;
    if (ORIGINAL_REFINE === undefined) delete process.env.QOBRIX_MCP_REFINE_MULTIPLIER;
    else process.env.QOBRIX_MCP_REFINE_MULTIPLIER = ORIGINAL_REFINE;
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
    // Keep refine threshold high so this stays on the truncation path.
    process.env.QOBRIX_MCP_REFINE_MULTIPLIER = "100";
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

  it("compacts expand/media rows and never returns zero kept rows", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "2000";
    process.env.QOBRIX_MCP_REFINE_MULTIPLIER = "100";
    const formatResult = await freshFormatResult();

    const fatExpanded = (i) => ({
      id: `prop-${i}`,
      ref: `R-${i}`,
      status: "available",
      list_selling_price_amount: 250000 + i,
      agent: {
        id: `agent-${i}`,
        name: "Agent " + "A".repeat(800),
        bio: "B".repeat(2000),
      },
      media: Array.from({ length: 10 }, (_, j) => ({
        url: `https://cdn.example.com/${i}-${j}.jpg`,
        meta: "m".repeat(400),
      })),
    });

    const payload = {
      data: Array.from({ length: 8 }, (_, i) => fatExpanded(i)),
      pagination: { count: 8, current_page: 1, limit: 8, page_count: 1 },
    };

    // Each full row alone exceeds 2000 chars → old code returned data:[].
    const oneRow = JSON.stringify(fatExpanded(0), null, 2).length;
    assert.ok(oneRow > 2000, `fixture row must exceed cap alone (got ${oneRow})`);

    const result = formatResult(payload);
    const out = bodyText(result);
    assert.ok(out.length <= 2000, `output stays under cap (got ${out.length})`);

    const parsed = JSON.parse(out);
    assert.ok(parsed._truncated, "_truncated marker present");
    assert.ok(
      parsed._truncated.kept_rows >= 1,
      "at least one row kept after compaction"
    );
    assert.equal(parsed._truncated.compacted, true, "compacted flag set");
    assert.equal(parsed.data.length, parsed._truncated.kept_rows);
    assert.ok(
      !parsed.data[0].agent && !parsed.data[0].media,
      "nested expand/media dropped from kept rows"
    );
    assert.equal(parsed.data[0].id, "prop-0");
    assert.equal(parsed.data[0].status, "available");
  });

  it("returns result_too_large refine directive for grossly oversized payloads", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "1000";
    process.env.QOBRIX_MCP_REFINE_MULTIPLIER = "8";
    const formatResult = await freshFormatResult();

    const payload = {
      data: Array.from({ length: 40 }, (_, i) => ({
        id: `row-${i}`,
        blob: "x".repeat(300),
      })),
      pagination: { count: 40, current_page: 1, limit: 40, page_count: 1 },
    };

    const originalChars = JSON.stringify(payload, null, 2).length;
    assert.ok(
      originalChars > 8 * 1000,
      `fixture must exceed refine threshold (got ${originalChars})`
    );

    const result = formatResult(payload);
    assert.equal(result.isError, false, "refine path is not a hard error");
    const out = bodyText(result);
    assert.ok(out.length <= 1000, `refine envelope under cap (got ${out.length})`);

    const parsed = JSON.parse(out);
    assert.equal(parsed.status, "result_too_large");
    assert.ok(parsed._refine_required, "_refine_required present");
    assert.ok(
      typeof parsed._refine_required.assistant_instruction === "string" &&
        parsed._refine_required.assistant_instruction.toLowerCase().includes("narrow"),
      "assistant_instruction tells the model to ask the user to narrow"
    );
    assert.ok(
      Array.isArray(parsed._refine_required.suggested_narrowing) &&
        parsed._refine_required.suggested_narrowing.length >= 2,
      "suggested_narrowing list present"
    );
    assert.ok(
      Array.isArray(parsed.returned_sample) && parsed.returned_sample.length >= 1,
      "returned_sample keeps a few rows for context"
    );
    assert.equal(parsed.matched_estimate, 40);
  });

  it("falls back to string-trailer truncation for non-paginated payloads", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "500";
    process.env.QOBRIX_MCP_REFINE_MULTIPLIER = "100";
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

  it("signals refine or truncation when a single fat row exceeds the cap", async () => {
    process.env.QOBRIX_MCP_MAX_RESULT_CHARS = "400";
    process.env.QOBRIX_MCP_REFINE_MULTIPLIER = "8";
    const formatResult = await freshFormatResult();

    const payload = {
      data: [{ id: "huge", blob: "z".repeat(5000) }],
      pagination: { count: 1, current_page: 1, limit: 1, page_count: 1 },
    };
    const out = bodyText(formatResult(payload));
    assert.ok(
      out.length <= 400 + 500,
      `output stays roughly within cap (got ${out.length})`
    );
    assert.ok(
      out.includes("result_too_large") ||
        out.includes("_truncated") ||
        out.includes("QOBRIX_MCP TRUNCATED"),
      "truncation or refine signal present"
    );
  });
});
