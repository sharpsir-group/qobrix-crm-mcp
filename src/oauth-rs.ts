/**
 * Mode C — OAuth 2.1 Resource Server helpers.
 *
 * Pairs exclusively with qobrix-crm-mcp-oauth (QOBRIX_OAUTH_ISSUER).
 * Validates bearer tokens via the companion's introspection endpoint and
 * resolves per-user Qobrix credentials into AuthInfo.extra for ALS.
 */

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { checkResourceAllowed } from "@modelcontextprotocol/sdk/shared/auth-utils.js";
import type { AuthCredentials } from "./auth-context.js";

export type IntrospectionResult = {
  active: boolean;
  client_id?: string;
  scope?: string;
  exp?: number;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  /** Returned only when introspection is authenticated with the shared secret. */
  qobrix_api_user?: string;
  qobrix_api_key?: string;
  qobrix_api_url?: string;
  qobrix_locale?: string;
};

export function requireOAuthEnv(): {
  issuer: URL;
  resourceServerUrl: URL;
  introspectionSecret: string;
} {
  const issuerRaw = process.env.QOBRIX_OAUTH_ISSUER;
  if (!issuerRaw) {
    throw new Error(
      "Mode C requires QOBRIX_OAUTH_ISSUER (URL of the paired qobrix-crm-mcp-oauth)"
    );
  }
  const resourceRaw =
    process.env.QOBRIX_MCP_RESOURCE_URL ||
    process.env.QOBRIX_MCP_PUBLIC_URL ||
    `http://127.0.0.1:${process.env.QOBRIX_MCP_PORT || "3502"}/mcp`;
  const secret = process.env.QOBRIX_OAUTH_INTROSPECTION_SECRET;
  if (!secret) {
    throw new Error(
      "Mode C requires QOBRIX_OAUTH_INTROSPECTION_SECRET (shared with qobrix-crm-mcp-oauth)"
    );
  }
  return {
    issuer: new URL(issuerRaw.replace(/\/+$/, "") + "/"),
    resourceServerUrl: new URL(resourceRaw),
    introspectionSecret: secret,
  };
}

export async function fetchAuthorizationServerMetadata(
  issuer: URL
): Promise<OAuthMetadata> {
  const wellKnown = new URL(
    "/.well-known/oauth-authorization-server",
    issuer
  );
  const res = await fetch(wellKnown.href, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch AS metadata from ${wellKnown.href}: HTTP ${res.status}`
    );
  }
  const meta = (await res.json()) as OAuthMetadata;
  if (!meta.issuer) {
    throw new Error(`AS metadata from ${wellKnown.href} is missing issuer`);
  }
  // Exclusive pairing: issuer must match configured companion.
  const expected = issuer.href.replace(/\/+$/, "");
  const got = String(meta.issuer).replace(/\/+$/, "");
  if (got !== expected) {
    throw new Error(
      `AS issuer mismatch: expected ${expected}, got ${got}. Mode C pairs only with qobrix-crm-mcp-oauth.`
    );
  }
  // SDK createOAuthMetadata omits introspection_endpoint; companion serves /introspect.
  if (!meta.introspection_endpoint) {
    meta.introspection_endpoint = new URL("/introspect", issuer).href;
  }
  return meta;
}

export function createCompanionTokenVerifier(opts: {
  issuer: URL;
  resourceServerUrl: URL;
  introspectionEndpoint: string;
  introspectionSecret: string;
}): OAuthTokenVerifier {
  const { issuer, resourceServerUrl, introspectionEndpoint, introspectionSecret } =
    opts;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const response = await fetch(introspectionEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${introspectionSecret}`,
        },
        body: new URLSearchParams({ token }).toString(),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Invalid or expired token: ${text || response.status}`);
      }

      const data = (await response.json()) as IntrospectionResult;
      if (!data.active) {
        throw new Error("Token is not active");
      }

      const gotIss = (data.iss || "").replace(/\/+$/, "");
      const expectedIss = issuer.href.replace(/\/+$/, "");
      if (gotIss && gotIss !== expectedIss) {
        throw new Error(
          `Token iss mismatch: expected ${expectedIss}, got ${gotIss}`
        );
      }

      if (!data.aud) {
        throw new Error("Resource Indicator (RFC 8707) missing from token");
      }
      const audUrl = Array.isArray(data.aud) ? data.aud[0] : data.aud;
      if (
        !checkResourceAllowed({
          requestedResource: new URL(audUrl),
          configuredResource: resourceServerUrl,
        })
      ) {
        throw new Error(
          `Expected audience ${resourceServerUrl.href}, got: ${audUrl}`
        );
      }

      if (!data.qobrix_api_user || !data.qobrix_api_key) {
        throw new Error(
          "Introspection did not return Qobrix credentials (check introspection secret pairing)"
        );
      }

      const creds: AuthCredentials = {
        apiUser: data.qobrix_api_user,
        apiKey: data.qobrix_api_key,
        apiUrl: data.qobrix_api_url,
        locale: data.qobrix_locale,
        subject: data.sub,
      };

      return {
        token,
        clientId: data.client_id || "unknown",
        scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
        expiresAt: data.exp,
        resource: new URL(audUrl),
        extra: { qobrix: creds },
      };
    },
  };
}

export function credentialsFromAuthInfo(
  auth: AuthInfo | undefined
): AuthCredentials | undefined {
  const q = auth?.extra?.qobrix as AuthCredentials | undefined;
  if (q?.apiUser && q?.apiKey) return q;
  return undefined;
}
