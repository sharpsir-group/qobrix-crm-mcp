import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
import {
  ListOffersSchema,
  GetOfferSchema,
  SearchOffersSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerOfferTools(server: McpServer): void {
  server.tool(
    "qobrix_list_offers",
    "List offers (RESO TransactionManagement) — the 'Decision Making' stage of the Sales Pipeline. " +
    "An Offer formalizes a buyer's intent: it links an Opportunity (the lead) to a Property (the listing) with a price. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Include: OpportunityOpportunities (the lead), PropertyProperties (the listing), CreatedByUsers, ModifiedByUsers. " +
    "Canonical transaction chain: Lead → Viewing → Offer → Contract → Close. " +
    "After an offer is accepted, the next step is Contract creation (qobrix_list_contracts).",
    ListOffersSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("offers", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_offer",
    "Get a single offer by UUID — offer detail view in the Transaction Lifecycle. " +
    "Returns { data: { id, ... } }. " +
    "Include: OpportunityOpportunities (the lead/buyer intent), PropertyProperties (the listing), " +
    "CreatedByUsers, ModifiedByUsers. " +
    "Use to trace the deal chain: Offer → Opportunity → Contact + Property → Contract.",
    GetOfferSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("offers", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_offers",
    "Relevance-ranked offer search (F1-optimized). " +
    "TWO-TIER: `search` = hard must-haves; `boost[]` = soft weighted preferences; `limit`/`max_scan` for top-N and pool. " +
    "With boost: `_relevance` + `_matched`; pagination.mode='ranked'. " +
    "Call qobrix_search_dsl_help({resource:'Offers'}) for fields. " +
    "Example: search='created >= THIS_MONTH', boost=[{field:'created',op:'>=',value:'2026-01-01',weight:1}], limit=10, max_scan=100.",
    SearchOffersSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields }) => {
      try {
        const result = await relevanceSearch({
          resource: "offers",
          search, boost, max_scan, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
