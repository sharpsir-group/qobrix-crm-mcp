import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import { registerPropertyTools } from "./properties.js";
import { registerContactTools } from "./contacts.js";
import { registerAgentTools } from "./agents.js";
import { registerOpportunityTools } from "./opportunities.js";
import { registerViewingTools } from "./viewings.js";
import { registerTaskTools } from "./tasks.js";
import { registerMediaTools } from "./media.js";
import { registerProjectTools } from "./projects.js";
import { registerOfferTools } from "./offers.js";
import { registerContractTools } from "./contracts.js";
import { registerActivityTools } from "./activities.js";
import { registerMetaTools } from "./meta.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerDealTools } from "./deals.js";
import { registerReportTools } from "./reports.js";
import { registerPipelineTools } from "./pipeline.js";
import { registerProductivityTools } from "./productivity.js";
import { registerCustomerTools } from "./customers.js";
import { registerCacheTools } from "./cache.js";
import { registerAuditTools } from "./audit.js";
import { AuthRequiredError, registerElicitationNotifier } from "../oauth-client.js";
import {
  clientSupportsUrlElicitation,
  getRequestMcpServer,
} from "../request-context.js";

// Hard cap on tool result size, in characters of the rendered JSON text.
// Default 30 000 chars ≈ 7.5 K tokens, which keeps a multi-tool turn well under
// any modern LLM context window. Override with QOBRIX_MCP_MAX_RESULT_CHARS.
// Set to 0 to disable capping entirely (not recommended in production).
function getMaxResultChars(): number {
  const raw = process.env.QOBRIX_MCP_MAX_RESULT_CHARS;
  if (raw === undefined) return 30_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 30_000;
  return n;
}

function isPaginatedListPayload(
  data: unknown
): data is { data: unknown[]; pagination?: Record<string, unknown>; [k: string]: unknown } {
  return (
    typeof data === "object" &&
    data !== null &&
    Array.isArray((data as { data?: unknown }).data)
  );
}

export function formatResult(data: unknown) {
  const max = getMaxResultChars();
  const fullText = JSON.stringify(data, null, 2);

  if (max === 0 || fullText.length <= max) {
    return {
      content: [
        {
          type: "text" as const,
          text: fullText,
        },
      ],
    };
  }

  const originalChars = fullText.length;

  // Smart truncation for paginated/list-shaped payloads: keep the largest
  // prefix of `data.data` that fits, attach a `_truncated` marker so the
  // caller knows to scope further (fields[], smaller limit, search filter).
  if (isPaginatedListPayload(data)) {
    const rows = data.data;
    const total = rows.length;

    const buildEnvelope = (kept: unknown[]) => {
      const omitted = total - kept.length;
      return {
        ...data,
        data: kept,
        _truncated: {
          omitted_rows: omitted,
          kept_rows: kept.length,
          total_rows_in_page: total,
          original_chars: originalChars,
          max_chars: max,
          hint:
            "Result truncated to fit MCP output cap. To get more rows per call, " +
            "pass fields[] to whitelist the columns you actually need, reduce " +
            "limit, or add a search filter. Use expand=false (default) and " +
            "media=false (default) to keep rows compact.",
        },
      };
    };

    // Binary search for the largest prefix that fits.
    let lo = 0;
    let hi = total;
    let best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = JSON.stringify(buildEnvelope(rows.slice(0, mid)), null, 2);
      if (candidate.length <= max) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const text = JSON.stringify(buildEnvelope(rows.slice(0, best)), null, 2);
    return {
      content: [
        {
          type: "text" as const,
          text,
        },
      ],
    };
  }

  // Fallback for single-object / custom-shape payloads: clip text and append
  // a structured trailer the LLM can recognise.
  const head = fullText.slice(0, Math.max(0, max - 400));
  const trailer =
    "\n\n... [QOBRIX_MCP TRUNCATED — original " +
    originalChars +
    " chars, cap " +
    max +
    " chars. " +
    "Use fields[] / include[] / a tighter search filter to scope the result. " +
    "Set expand=false (default) and media=false (default) to keep payloads compact.]";
  return {
    content: [
      {
        type: "text" as const,
        text: head + trailer,
      },
    ],
  };
}

export function errorResult(error: unknown) {
  // Let the SDK convert this to JSON-RPC -32042 for elicitation-capable clients.
  if (error instanceof UrlElicitationRequiredError) {
    throw error;
  }

  if (error instanceof AuthRequiredError) {
    if (clientSupportsUrlElicitation()) {
      const mcp = getRequestMcpServer();
      if (mcp) {
        try {
          const notifier = mcp.server.createElicitationCompletionNotifier(
            error.elicitationId
          );
          registerElicitationNotifier(error.elicitationId, notifier);
        } catch {
          // Client may not support the notification path; URL still works.
        }
      }
      throw new UrlElicitationRequiredError(
        [
          {
            mode: "url",
            elicitationId: error.elicitationId,
            url: error.connectUrl,
            message:
              "Qobrix authorization is required. Open the link to sign in with your Qobrix account.",
          },
        ],
        "Qobrix authorization required"
      );
    }

    // Fallback for clients without elicitation (ragchat / LangChain): plain
    // tool-result text the LLM relays to the user. isError:false so the model
    // does not treat it as a hard failure to retry blindly.
    return {
      content: [
        {
          type: "text" as const,
          text:
            "Qobrix needs authorization before this tool can run.\n\n" +
            "Ask the user to open this link to sign in (login + 2FA + consent):\n\n" +
            `${error.connectUrl}\n\n` +
            "After they finish, retry the same request — the MCP will use their Qobrix credentials.",
        },
      ],
      isError: false as const,
    };
  }

  const message =
    error instanceof Error ? error.message : "An unknown error occurred";
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${message}`,
      },
    ],
    isError: true as const,
  };
}

export function registerTools(server: McpServer): void {
  registerPropertyTools(server);
  registerContactTools(server);
  registerAgentTools(server);
  registerOpportunityTools(server);
  registerViewingTools(server);
  registerTaskTools(server);
  registerMediaTools(server);
  registerProjectTools(server);
  registerOfferTools(server);
  registerContractTools(server);
  registerActivityTools(server);
  registerMetaTools(server);
  registerAnalyticsTools(server);
  registerDealTools(server);
  registerReportTools(server);
  registerPipelineTools(server);
  registerProductivityTools(server);
  registerCustomerTools(server);
  registerCacheTools(server);
  registerAuditTools(server);
}
