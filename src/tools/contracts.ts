import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
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
    "Search contracts using Qobrix search expressions — filter closed/pending deals. " +
    "Use to find contracts by date, property, or party. " +
    "In the Sales Pipeline, Contracts are the penultimate step before Close/Won. " +
    "Use qobrix_get_schema with resource='Contracts' to discover all searchable fields.",
    SearchContractsSchema.shape,
    async ({ search, limit, page, sort }) => {
      try {
        const result = await getClient().list("contracts", {
          search, limit, page, sort,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
