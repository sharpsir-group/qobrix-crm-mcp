import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListCallsSchema,
  GetCallSchema,
  ListMeetingsSchema,
  GetMeetingSchema,
  ListEmailMessagesSchema,
  GetEmailMessageSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerActivityTools(server: McpServer): void {
  server.tool(
    "qobrix_list_calls",
    "List call records — part of the Activity Tracking / Follow-up workflow. " +
    "Calls are touchpoints in the Lead-Contact Lifecycle; zero tolerance on missed follow-ups. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Include: ContactContacts (who was called), AssignedToUsers (who made the call), " +
    "RelatedOpportunityOpportunities (which lead), RelatedAgentAgents, RelatedContractContracts. " +
    "Workflow: use with qobrix_list_meetings and qobrix_list_email_messages for a complete activity timeline. " +
    "To audit a contact's engagement: search calls, meetings, and emails by their contact UUID.",
    ListCallsSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("calls", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_call",
    "Get a single call record by UUID — call detail in the Activity Tracking workflow. " +
    "Returns { data: { id, ... } }. " +
    "Include: AssignedToUsers, ContactContacts, RelatedOpportunityOpportunities, " +
    "RelatedAgentAgents, CreatedByUsers.",
    GetCallSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("calls", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_list_meetings",
    "List meetings — bridges the Activity Tracking and Showing Lifecycle workflows. " +
    "Meetings can wrap property viewings (RESO Showing ↔ Meeting). " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Include: ContactContacts, ViewingPropertyViewings (linked showings), AssignedToUsers, " +
    "RelatedOpportunityOpportunities, RelatedAgentAgents, CreatedByUsers, ModifiedByUsers. " +
    "Workflow: include=['ViewingPropertyViewings'] to see which meetings are property showings vs general meetings. " +
    "The first meeting/showing is the canonical trigger that moves a lead from follow-up to active sales.",
    ListMeetingsSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("meetings", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_meeting",
    "Get a single meeting by UUID — meeting detail in the Activity/Showing Lifecycle. " +
    "Returns { data: { id, ... } }. " +
    "Include: AssignedToUsers, ContactContacts, ViewingPropertyViewings (if it wraps a showing), CreatedByUsers.",
    GetMeetingSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("meetings", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_list_email_messages",
    "List email messages — part of the Activity Tracking / Follow-up workflow and marketing campaigns. " +
    "Emails are touchpoints in the Lead-Contact Lifecycle for nurturing and communication. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Include: ContactContacts (recipient/sender), Properties (listing references), " +
    "Campaign (marketing campaign), RelatedOpportunityOpportunities, RelatedAgentAgents. " +
    "Use with qobrix_list_calls and qobrix_list_meetings for a complete contact engagement timeline.",
    ListEmailMessagesSchema.shape,
    async ({ limit, page, sort, include, search }) => {
      try {
        const result = await getClient().list("email-messages", {
          limit, page, sort, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_email_message",
    "Get a single email message by UUID — email detail in the Activity Tracking workflow. " +
    "Returns { data: { id, ... } }. " +
    "Include: Properties, ContactContacts, RelatedOpportunityOpportunities, Agent, Campaign.",
    GetEmailMessageSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("email-messages", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
