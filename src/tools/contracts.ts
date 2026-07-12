import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import { relevanceSearch } from "../relevance.js";
import {
  ListContractsSchema,
  GetContractSchema,
  SearchContractsSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerContractTools(server: McpServer): void {
  server.tool(
    "qobrix_list_contracts",
    "List contracts (RESO TransactionManagement close) — the 'Deal Signing / Payment / Close' stage of the Sales Pipeline. " +
    "A Contract finalizes the transaction: it links the Property, buyer/seller Contacts, and the Opportunity. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Verified include: Contacts, PropertyIdProperties, OpportunityIdOpportunities, " +
    "PaymentInstallments (payment schedule), ContractParties (all signatories), CreatedByUsers. " +
    "Canonical chain: Offer → Contract → Payment → Close. " +
    "After contract signing, the property status moves to 'reserved' (Pending), then 'sold' (Closed).",
    ListContractsSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("contracts", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_contract",
    "Get a single contract by UUID — the deal close detail view in the Transaction Lifecycle. " +
    "Returns { data: { id, ... } }. " +
    "Verified include: Contacts (buyer/seller), PropertyIdProperties (the listing), " +
    "OpportunityIdOpportunities (the lead), PaymentInstallments (payment schedule), " +
    "ContractParties (all signatories), CreatedByUsers. " +
    "Use include=['PaymentInstallments'] to audit the payment timeline.",
    GetContractSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("contracts", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_contracts",
    "Relevance-ranked contract search (F1-optimized). " +
    "TWO-TIER: `search` = hard must-haves; `boost[]` = soft weighted preferences; `limit`/`max_scan` for top-N and pool. " +
    "With boost: `_relevance` + `_matched`; pagination.mode='ranked'. " +
    "Call qobrix_search_dsl_help({resource:'Contracts'}) for fields. " +
    "Example: search='contract_type == \"cos\" and contract_status == \"agreed\"', " +
    "boost=[{field:'final_selling_price_amount',op:'>=',value:300000,weight:2}], limit=10, max_scan=150. " +
    "Prefer qobrix_deals for common closed-deal questions.",
    SearchContractsSchema.shape,
    async ({ search, boost, max_scan, limit, page, sort, fields }) => {
      try {
        const result = await relevanceSearch({
          resource: "contracts",
          search, boost, max_scan, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
