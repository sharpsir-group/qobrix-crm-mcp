/**
 * Qobrix CRM MCP Server – Cache Test Suite
 *
 * Self-contained tests (no live Qobrix API) covering:
 *   1. Cache key canonicalization (different param order → same key)
 *   2. Hit on second identical call
 *   3. Miss after clear()
 *   4. Errors not cached
 *   5. Single-flight: parallel identical requests trigger exactly 1 upstream fetch
 *   6. Disabled mode bypasses the cache entirely
 *   7. LRU eviction respects max_entries
 *
 * Run:  node --test test-suite/cache.test.mjs
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CacheStore, cacheKey } from "../dist/cache.js";

function freshCache(overrides = {}) {
  const env = {
    QOBRIX_CACHE_ENABLED: "true",
    QOBRIX_CACHE_TTL: "300",
    QOBRIX_CACHE_MAX_ENTRIES: "1000",
    QOBRIX_REDIS_URL: "",
    QOBRIX_REDIS_KEY_PREFIX: "qobrix:",
    ...overrides,
  };
  return new CacheStore(env);
}

describe("cacheKey canonicalization", () => {
  it("produces identical keys regardless of param order", () => {
    const a = cacheKey("request", "/v1/properties", { limit: 10, page: 1, status: "available" });
    const b = cacheKey("request", "/v1/properties", { status: "available", page: 1, limit: 10 });
    assert.equal(a, b);
  });

  it("normalizes array values in stable order", () => {
    const a = cacheKey("request", "/v1/properties", { include: ["Agents", "PropertyTypes"] });
    const b = cacheKey("request", "/v1/properties", { include: ["PropertyTypes", "Agents"] });
    assert.equal(a, b);
  });

  it("drops undefined params", () => {
    const a = cacheKey("request", "/v1/properties", { limit: 10, page: undefined });
    const b = cacheKey("request", "/v1/properties", { limit: 10 });
    assert.equal(a, b);
  });

  it("produces different keys for different paths", () => {
    const a = cacheKey("request", "/v1/properties", { limit: 10 });
    const b = cacheKey("request", "/v1/contacts", { limit: 10 });
    assert.notEqual(a, b);
  });

  it("includes the schema version in the key", () => {
    const k = cacheKey("request", "/v1/properties", {});
    assert.ok(k.startsWith("v1:"), `expected v1: prefix, got ${k}`);
  });
});

describe("CacheStore basic behavior", () => {
  let cache;
  beforeEach(() => {
    cache = freshCache();
  });

  it("returns undefined on miss", async () => {
    const got = await cache.get("v1:request:/missing?{}");
    assert.equal(got, undefined);
    assert.equal(cache.stats().misses, 1);
    assert.equal(cache.stats().hits, 0);
  });

  it("returns cached value on second get", async () => {
    const key = cacheKey("request", "/v1/test", { a: 1 });
    await cache.set(key, { data: "value" });
    const first = await cache.get(key);
    const second = await cache.get(key);
    assert.deepEqual(first, { data: "value" });
    assert.deepEqual(second, { data: "value" });
    assert.equal(cache.stats().hits, 2);
  });

  it("clears all entries when called without prefix", async () => {
    await cache.set(cacheKey("request", "/a", {}), { x: 1 });
    await cache.set(cacheKey("request", "/b", {}), { x: 2 });
    assert.equal(cache.stats().size, 2);
    const res = await cache.clear();
    assert.equal(res.memory_cleared, 2);
    assert.equal(cache.stats().size, 0);
  });

  it("clears only matching entries when prefix is provided", async () => {
    const propsKey = cacheKey("request", "/v1/properties", {});
    const contactsKey = cacheKey("request", "/v1/contacts", {});
    await cache.set(propsKey, { x: 1 });
    await cache.set(contactsKey, { x: 2 });
    const res = await cache.clear("v1:request:/v1/properties");
    assert.equal(res.memory_cleared, 1);
    assert.equal(cache.stats().size, 1);
    const stillThere = await cache.get(contactsKey);
    assert.deepEqual(stillThere, { x: 2 });
  });
});

describe("CacheStore.fetch (read-through + single-flight)", () => {
  it("caches the value on first call and returns it on the second", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "/v1/properties", {});
    let calls = 0;
    const loader = async () => {
      calls++;
      return { data: ["one"] };
    };
    const first = await cache.fetch(key, loader);
    const second = await cache.fetch(key, loader);
    assert.deepEqual(first, { data: ["one"] });
    assert.deepEqual(second, { data: ["one"] });
    assert.equal(calls, 1, "loader should be called exactly once across 2 sequential fetches");
  });

  it("re-fetches after clear()", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "/v1/properties", {});
    let calls = 0;
    const loader = async () => {
      calls++;
      return { call: calls };
    };
    await cache.fetch(key, loader);
    await cache.clear();
    await cache.fetch(key, loader);
    assert.equal(calls, 2);
  });

  it("does NOT cache errors", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "/v1/will-fail", {});
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("simulated upstream failure");
    };
    await assert.rejects(cache.fetch(key, failing), /simulated upstream failure/);
    await assert.rejects(cache.fetch(key, failing), /simulated upstream failure/);
    assert.equal(calls, 2, "failed requests must not be cached");
    assert.equal(cache.stats().size, 0);
  });

  it("coalesces 10 parallel identical requests into exactly 1 upstream call (single-flight)", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "/v1/expensive", {});
    let calls = 0;
    let resolveLoader;
    const slowLoader = () =>
      new Promise((resolve) => {
        calls++;
        resolveLoader = () => resolve({ heavy: "payload" });
      });

    const N = 10;
    const all = Promise.all(Array.from({ length: N }, () => cache.fetch(key, slowLoader)));
    while (typeof resolveLoader !== "function") {
      await new Promise((r) => setImmediate(r));
    }
    resolveLoader();
    const results = await all;

    assert.equal(calls, 1, `expected 1 upstream call, got ${calls}`);
    assert.equal(results.length, N);
    for (const r of results) assert.deepEqual(r, { heavy: "payload" });
  });

  it("different keys do not coalesce", async () => {
    const cache = freshCache();
    let calls = 0;
    const loader = (label) => async () => {
      calls++;
      return { label };
    };
    await Promise.all([
      cache.fetch(cacheKey("request", "/v1/a", {}), loader("a")),
      cache.fetch(cacheKey("request", "/v1/b", {}), loader("b")),
      cache.fetch(cacheKey("request", "/v1/c", {}), loader("c")),
    ]);
    assert.equal(calls, 3);
  });
});

describe("CacheStore disabled mode", () => {
  it("bypasses cache when QOBRIX_CACHE_ENABLED=false", async () => {
    const cache = freshCache({ QOBRIX_CACHE_ENABLED: "false" });
    assert.equal(cache.enabled, false);
    let calls = 0;
    const loader = async () => {
      calls++;
      return { call: calls };
    };
    const key = cacheKey("request", "/v1/x", {});
    const a = await cache.fetch(key, loader);
    const b = await cache.fetch(key, loader);
    assert.equal(calls, 2);
    assert.notDeepEqual(a, b);
    assert.equal(cache.stats().size, 0);
  });
});

describe("CacheStore LRU eviction", () => {
  it("evicts oldest entries when size exceeds max_entries", async () => {
    const cache = freshCache({ QOBRIX_CACHE_MAX_ENTRIES: "3" });
    await cache.set("k1", { v: 1 });
    await cache.set("k2", { v: 2 });
    await cache.set("k3", { v: 3 });
    assert.equal(cache.stats().size, 3);
    await cache.set("k4", { v: 4 });
    assert.equal(cache.stats().size, 3);
    assert.equal(cache.stats().evictions, 1);
    assert.equal(await cache.get("k1"), undefined, "k1 should have been evicted");
    assert.deepEqual(await cache.get("k4"), { v: 4 });
  });

  it("treats reads as recency updates (LRU not FIFO)", async () => {
    const cache = freshCache({ QOBRIX_CACHE_MAX_ENTRIES: "3" });
    await cache.set("k1", { v: 1 });
    await cache.set("k2", { v: 2 });
    await cache.set("k3", { v: 3 });
    await cache.get("k1");
    await cache.set("k4", { v: 4 });
    assert.deepEqual(await cache.get("k1"), { v: 1 }, "k1 was just read so it should survive");
    assert.equal(await cache.get("k2"), undefined, "k2 was the oldest and should be evicted");
  });
});

describe("CacheStore.stats() shape", () => {
  it("exposes the documented fields with correct types", () => {
    const cache = freshCache();
    const s = cache.stats();
    assert.equal(typeof s.enabled, "boolean");
    assert.equal(typeof s.hits, "number");
    assert.equal(typeof s.misses, "number");
    assert.equal(typeof s.sets, "number");
    assert.equal(typeof s.evictions, "number");
    assert.equal(typeof s.size, "number");
    assert.equal(typeof s.max_entries, "number");
    assert.equal(typeof s.inflight, "number");
    assert.equal(typeof s.ttl_seconds, "number");
    assert.ok(["off", "on", "degraded"].includes(s.redis));
    assert.equal(typeof s.redis_url_set, "boolean");
    assert.equal(typeof s.redis_key_prefix, "string");
  });

  it("starts with zeroed counters and reflects redis=off when no URL is configured", () => {
    const cache = freshCache();
    const s = cache.stats();
    assert.equal(s.hits, 0);
    assert.equal(s.misses, 0);
    assert.equal(s.size, 0);
    assert.equal(s.redis, "off");
    assert.equal(s.redis_url_set, false);
  });
});

describe("search / relevance page caching", () => {
  it("repeated identical search-page fetches hit cache once upstream", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "properties", {
      limit: 100,
      page: 1,
      search: 'status == "available" and sale_rent == "for_sale"',
      expand: false,
      media: false,
    });
    let calls = 0;
    const loader = async () => {
      calls++;
      return {
        data: [{ id: "1", bedrooms: 3 }],
        pagination: { has_next_page: false, count: 1, limit: 100, current_page: 1 },
      };
    };
    const first = await cache.fetch(key, loader);
    const second = await cache.fetch(key, loader);
    assert.equal(calls, 1);
    assert.deepEqual(first, second);
    assert.equal(cache.stats().hits, 1);
  });

  it("different pages of a max_scan walk are distinct cache keys", async () => {
    const cache = freshCache();
    let calls = 0;
    const loader = async () => {
      calls++;
      return { data: [], pagination: { has_next_page: false } };
    };
    await cache.fetch(
      cacheKey("request", "properties", { limit: 100, page: 1, search: 'status == "available"', expand: false, media: false }),
      loader
    );
    await cache.fetch(
      cacheKey("request", "properties", { limit: 100, page: 2, search: 'status == "available"', expand: false, media: false }),
      loader
    );
    assert.equal(calls, 2);
    // Re-fetch page 1 — should be a hit
    await cache.fetch(
      cacheKey("request", "properties", { limit: 100, page: 1, search: 'status == "available"', expand: false, media: false }),
      loader
    );
    assert.equal(calls, 2);
  });

  it("prefix clear invalidates property search pages", async () => {
    const cache = freshCache();
    const key = cacheKey("request", "properties", {
      search: 'city contains "Limassol"',
      limit: 50,
      page: 1,
    });
    let calls = 0;
    const loader = async () => {
      calls++;
      return { data: [] };
    };
    await cache.fetch(key, loader);
    await cache.clear("v1:request:properties");
    await cache.fetch(key, loader);
    assert.equal(calls, 2);
  });
});
