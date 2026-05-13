import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getClient } from "../client.js";
import {
  ListProjectsSchema,
  GetProjectSchema,
  SearchProjectsSchema,
  GetProjectCoordinatesSchema,
} from "../schemas.js";
import { formatResult, errorResult } from "./index.js";

export function registerProjectTools(server: McpServer): void {
  server.tool(
    "qobrix_list_projects",
    "List projects (property developments/complexes) — RESO Project equivalent for off-plan and new-build listings. " +
    "Projects group multiple property units under one development, relevant in the Listing Lifecycle for new-builds. " +
    "Returns { data: [...], pagination: { count, current_page, has_next_page, ... } }. " +
    "Properties reference their project via the 'project' FK. " +
    "Verified include: Agents, Developer, Translations, LocationLocations, Assignee, Recommended, Favorites. " +
    "Workflow: to see units in a project, qobrix_search_properties with project == '<uuid>'.",
    ListProjectsSchema.shape,
    async ({ limit, page, sort, fields, include, search }) => {
      try {
        const result = await getClient().list("projects", {
          limit, page, sort, fields, include, search,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_project",
    "Get a single project by UUID — development detail view for off-plan/new-build listings. " +
    "Returns { data: { id, ... } }. " +
    "Verified include: Agents, Developer, Translations, LocationLocations, Assignee, Recommended, Favorites. " +
    "To see project units: qobrix_search_properties with project == '<uuid>'. " +
    "To see project media: qobrix_list_media with related_model='Projects' and related_id=<uuid>.",
    GetProjectSchema.shape,
    async ({ id, include }) => {
      try {
        const result = await getClient().get("projects", id, { include });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_search_projects",
    "Search projects using Qobrix search expressions. " +
    "Use qobrix_get_schema with resource='Projects' to see all searchable fields.",
    SearchProjectsSchema.shape,
    async ({ search, limit, page, sort, fields }) => {
      try {
        const result = await getClient().list("projects", {
          search, limit, page, sort, fields,
        });
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "qobrix_get_project_coordinates",
    "Get lat/lng coordinates for projects, useful for map display. " +
    "Optionally filter with a search expression.",
    GetProjectCoordinatesSchema.shape,
    async ({ search }) => {
      try {
        const params: Record<string, string | undefined> = { search };
        const result = await getClient().getPath("projects/coordinates", params);
        return formatResult(result);
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
