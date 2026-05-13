import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListMediaSchema,
  GetMediaSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerMediaTools(server: McpServer): void {
  server.tool(
    "qobrix_list_media",
    "List media items (RESO Media resource) — photos, documents, floor plans attached to any entity. " +
    "Core to the Media Lifecycle: every listing needs photos and floor plans; projects need brochures. " +
    "NOTE: Returns { data: [...] } WITHOUT pagination metadata (unlike other endpoints). " +
    "Must provide BOTH related_model AND related_id together, or omit both for global media. " +
    "Listing media: related_model='Properties', related_id='<property-uuid>'. " +
    "Contact documents: related_model='Contacts', related_id='<contact-uuid>'. " +
    "Project brochures: related_model='Projects', related_id='<project-uuid>'. " +
    "Alternative: qobrix_list_properties with media=true (default) embeds media in property responses. " +
    "Each item has: id, media_type, reference_id, display_order, category, created.",
    ListMediaSchema.shape,
    async ({ limit, page, related_model, related_id }) => {
      try {
        const result = await getClient().list("media", {
          limit, page, related_model, related_id,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_media",
    "Get a single media item by UUID — media detail view in the Media Lifecycle. " +
    "Returns media metadata including URL/path. " +
    "Optionally specify size variant for images: 'thumbnail', 'medium', 'large'. " +
    "Use 'thumbnail' for preview grids, 'large' for full-resolution display.",
    GetMediaSchema.shape,
    async ({ id, size }) => {
      try {
        const path = size ? `media/${id}/${size}` : `media/${id}`;
        const result = await getClient().getPath(path);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
