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
  sort?: string;
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

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
