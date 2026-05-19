import type {
  QobrixPaginatedResponse,
  QobrixSingleResponse,
  QobrixErrorResponse,
  ListOpts,
  GetOpts,
  ChangesOpts,
} from "./types.js";
import { getCache, cacheKey } from "./cache.js";

export class QobrixClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor() {
    const url = process.env.QOBRIX_API_URL;
    const apiUser = process.env.QOBRIX_API_USER;
    const apiKey = process.env.QOBRIX_API_KEY;

    if (!url || !apiUser || !apiKey) {
      throw new Error(
        "Missing required environment variables: QOBRIX_API_URL, QOBRIX_API_USER, QOBRIX_API_KEY"
      );
    }

    this.baseUrl = url.replace(/\/+$/, "");
    this.headers = {
      "X-Api-User": apiUser,
      "X-Api-Key": apiKey,
      Accept: "application/json",
    };

    const locale = process.env.QOBRIX_LOCALE;
    if (locale) {
      this.headers["X-Locale"] = locale;
    }
  }

  private buildUrl(path: string, params?: Record<string, string | string[] | boolean | number | undefined>): string {
    const url = new URL(`${this.baseUrl}/api/v2/${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;

        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(`${key}[]`, item);
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  async request<T>(path: string, params?: Record<string, string | string[] | boolean | number | undefined>): Promise<T> {
    const cache = getCache();
    if (!cache.enabled) {
      return this.fetchUpstream<T>(path, params);
    }
    const key = cacheKey("request", path, params);
    return cache.fetch<T>(key, () => this.fetchUpstream<T>(path, params));
  }

  /** Bypass response cache — use for audit / change-log reads that must be fresh. */
  async requestFresh<T>(
    path: string,
    params?: Record<string, string | string[] | boolean | number | undefined>
  ): Promise<T> {
    return this.fetchUpstream<T>(path, params);
  }

  private changesParams(opts: ChangesOpts = {}): Record<string, string | string[] | boolean | number | undefined> {
    const params: Record<string, string | string[] | boolean | number | undefined> = {
      limit: opts.limit,
      page: opts.page,
      search: opts.search,
    };
    if (opts.sort !== undefined) {
      params.sort = Array.isArray(opts.sort) ? opts.sort : opts.sort;
    }
    if (opts.fields) params.fields = opts.fields;
    return params;
  }

  async listChanges(resource: string, opts: ChangesOpts = {}): Promise<QobrixPaginatedResponse> {
    return this.request<QobrixPaginatedResponse>(`${resource}/changes`, this.changesParams(opts));
  }

  async getRecordChanges(
    resource: string,
    id: string,
    opts: ChangesOpts = {}
  ): Promise<QobrixPaginatedResponse> {
    return this.request<QobrixPaginatedResponse>(
      `${resource}/${id}/changes`,
      this.changesParams(opts)
    );
  }

  private async fetchUpstream<T>(
    path: string,
    params?: Record<string, string | string[] | boolean | number | undefined>
  ): Promise<T> {
    const url = this.buildUrl(path, params);

    const response = await fetch(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      let errorBody: string;
      try {
        const errJson = (await response.json()) as QobrixErrorResponse;
        errorBody = errJson.errors
          ?.map((e) => e.message || JSON.stringify(e))
          .join("; ") || `HTTP ${response.status}`;
      } catch {
        errorBody = `HTTP ${response.status} ${response.statusText}`;
      }
      throw new Error(`Qobrix API error: ${errorBody}`);
    }

    return (await response.json()) as T;
  }

  async list(resource: string, opts: ListOpts = {}): Promise<QobrixPaginatedResponse> {
    // Defaults: compact payloads. Qobrix's own defaults expand all FKs into
    // nested objects and inline media metadata, which blows up tool outputs
    // (a single Properties row can be 30 KB+). Default expand/media to false
    // so list/get tools return short, FK-as-UUID rows. Callers can opt in
    // explicitly with expand: true or media: true.
    const params: Record<string, string | string[] | boolean | number | undefined> = {
      limit: opts.limit,
      page: opts.page,
      search: opts.search,
      expand: opts.expand ?? false,
      media: opts.media ?? false,
      trashed: opts.trashed,
      segment: opts.segment,
      related_model: opts.related_model,
      related_id: opts.related_id,
    };

    if (opts.sort) params.sort = opts.sort;
    if (opts.fields) params.fields = opts.fields;
    if (opts.include) params.include = opts.include;

    return this.request<QobrixPaginatedResponse>(resource, params);
  }

  async get(resource: string, id: string, opts: GetOpts = {}): Promise<QobrixSingleResponse> {
    const params: Record<string, string | string[] | boolean | number | undefined> = {
      expand: opts.expand ?? false,
      trashed: opts.trashed,
    };

    if (opts.include) params.include = opts.include;

    return this.request<QobrixSingleResponse>(`${resource}/${id}`, params);
  }

  async getSubresource(resource: string, id: string, sub: string, params?: Record<string, string | string[] | boolean | number | undefined>): Promise<unknown> {
    return this.request<unknown>(`${resource}/${id}/${sub}`, params);
  }

  async getPath(path: string, params?: Record<string, string | string[] | boolean | number | undefined>): Promise<unknown> {
    return this.request<unknown>(path, params);
  }
}

let _client: QobrixClient | null = null;

export function getClient(): QobrixClient {
  if (!_client) {
    _client = new QobrixClient();
  }
  return _client;
}
