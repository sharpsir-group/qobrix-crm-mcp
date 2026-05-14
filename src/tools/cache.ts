import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCache } from "../cache.js";
import { CacheStatsSchema, CacheClearSchema } from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerCacheTools(server: McpServer): void {
  server.tool(
    "qobrix_cache_stats",
    "Inspect the response cache: hits/misses, in-memory size, in-flight coalesced requests, " +
    "TTL (seconds), and Redis tier status. " +
    "Use to verify the cache is paying off (high hits, low misses on repeated workflows) " +
    "or to diagnose why a query feels slow (cold cache, Redis degraded). " +
    "Stats are process-local; restart resets them.",
    CacheStatsSchema.shape,
    async () => {
      try {
        return formatResult(getCache().stats());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_cache_clear",
    "Invalidate cached Qobrix responses. " +
    "Use this when CRM data was edited in Qobrix and you need fresh reads before the " +
    "TTL (default 300s) expires. " +
    "Without 'prefix': clears the whole cache (memory + Redis). " +
    "With 'prefix': clears only matching keys, e.g. 'v1:request:opportunities' to refresh " +
    "lead lists, or 'v1:request:properties' to refresh listings. " +
    "Returns the number of cleared entries in each tier.",
    CacheClearSchema.shape,
    async ({ prefix }) => {
      try {
        const cleared = await getCache().clear(prefix);
        return formatResult({
          prefix: prefix ?? "(all)",
          ...cleared,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
