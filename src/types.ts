export interface QobrixPagination {
  page_count: number;
  current_page: number;
  has_next_page: boolean;
  has_prev_page: boolean;
  count: number;
  limit: number;
}

export interface QobrixPaginatedResponse<T = Record<string, unknown>> {
  data: T[];
  pagination: QobrixPagination;
}

export interface QobrixSingleResponse<T = Record<string, unknown>> {
  data: T;
}

export interface QobrixErrorResponse {
  errors: Array<{
    message?: string;
    code?: string;
    [key: string]: unknown;
  }>;
}

export interface ListOpts {
  limit?: number;
  page?: number;
  search?: string;
  /** Maps to OpenAPI `sort[]` (array). Prefix with `-` for descending. */
  sort?: string | string[];
  fields?: string[];
  include?: string[];
  expand?: boolean;
  media?: boolean;
  trashed?: boolean;
  segment?: string;
  related_model?: string;
  related_id?: string;
}

export interface GetOpts {
  include?: string[];
  expand?: boolean;
  trashed?: boolean;
}

export interface ChangesOpts {
  limit?: number;
  page?: number;
  search?: string;
  sort?: string | string[];
  fields?: string[];
}

/** Qobrix LogAudit row from GET /{resource}/changes or /{resource}/{id}/changes */
export interface LogAuditEntry {
  id?: string;
  timestamp: string;
  primary_key: string;
  /** CRM resource name, e.g. "Opportunities" — NOT the lead source field */
  source: string;
  type?: string | null;
  user_id?: string | null;
  impersonated_user_id?: string | null;
  original?: Record<string, unknown> | null;
  changed?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parent_source?: string | null;
  destination?: string | null;
  destination_primary_key?: string | null;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
