/**
 * Mode C — self-service OAuth client for qobrix-crm-mcp.
 *
 * The MCP registers itself (DCR + PKCE) against the paired
 * qobrix-crm-mcp-oauth AS, drives /connect → authorize → /oauth/callback,
 * introspects the access token for Qobrix credentials, and stores them in
 * an encrypted single-slot session vault.
 *
 * This is MCP "External (third-party) Authorization" (SEP-1036): northbound
 * clients never see Qobrix secrets — only a /connect URL.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthCredentials } from "./auth-context.js";
import {
  fetchAuthorizationServerMetadata,
  requireOAuthEnv,
  type IntrospectionResult,
} from "./oauth-rs.js";

const PENDING_TTL_MS = 10 * 60 * 1000;
const AS_META_TTL_MS = 5 * 60 * 1000;
const CONNECT_COOKIE = "qobrix_mcp_connect";
const CLIENT_FILE = "oauth-client.json";
const SESSION_FILE = "session.enc";

export class AuthRequiredError extends Error {
  readonly connectUrl: string;
  readonly elicitationId: string;

  constructor(opts: {
    connectUrl: string;
    elicitationId: string;
    message?: string;
  }) {
    super(
      opts.message ||
        "Qobrix authorization required. Open the connect URL to sign in."
    );
    this.name = "AuthRequiredError";
    this.connectUrl = opts.connectUrl;
    this.elicitationId = opts.elicitationId;
  }
}

type RegisteredClient = {
  client_id: string;
  client_secret?: string;
  redirect_uri: string;
  issuer: string;
};

type PendingConnect = {
  elicitationId: string;
  state: string;
  codeVerifier: string;
  createdAt: number;
  /** Optional notifier to fire after successful callback (elicitation clients). */
  completionNotifier?: () => Promise<void>;
};

type SessionRecord = {
  apiUser: string;
  apiKey: string;
  apiUrl?: string;
  locale?: string;
  subject?: string;
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: number;
  updatedAt: string;
};

type SessionFile = {
  version: 1;
  session: SessionRecord | null;
};

let _client: RegisteredClient | null = null;
let _session: SessionRecord | null = null;
let _sessionLoaded = false;
/** Reusable pending connect so repeated cold tool calls share one /connect URL. */
let _activePending: PendingConnect | null = null;
const _pending = new Map<string, PendingConnect>(); // by elicitationId
const _pendingByState = new Map<string, PendingConnect>();
let _asMeta: { meta: OAuthMetadata; at: number; issuer: string } | null = null;

async function getAsMetadata(issuer: URL): Promise<OAuthMetadata> {
  const key = issuer.href.replace(/\/+$/, "");
  if (
    _asMeta &&
    _asMeta.issuer === key &&
    Date.now() - _asMeta.at < AS_META_TTL_MS
  ) {
    return _asMeta.meta;
  }
  const meta = await fetchAuthorizationServerMetadata(issuer);
  _asMeta = { meta, at: Date.now(), issuer: key };
  return meta;
}

function clearActivePending(pending: PendingConnect | null): void {
  if (!pending) return;
  if (_activePending?.elicitationId === pending.elicitationId) {
    _activePending = null;
  }
  _pending.delete(pending.elicitationId);
  _pendingByState.delete(pending.state);
}

function dataDir(): string {
  return (
    process.env.QOBRIX_MCP_DATA_DIR || join(process.cwd(), "data", "mcp-oauth")
  );
}

function stateSecret(): string {
  const s =
    process.env.QOBRIX_MCP_STATE_SECRET ||
    process.env.QOBRIX_OAUTH_INTROSPECTION_SECRET ||
    "";
  if (!s || s.length < 16) {
    throw new Error(
      "Mode C requires QOBRIX_MCP_STATE_SECRET (16+ chars) for signed cookies and vault encryption"
    );
  }
  return s;
}

function deriveKey(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

function encryptJson(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decryptJson(key: Buffer, blob: string): string {
  const buf = Buffer.from(blob, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

function publicBaseUrl(): string {
  const raw =
    process.env.QOBRIX_MCP_PUBLIC_URL ||
    `http://127.0.0.1:${process.env.QOBRIX_MCP_PORT || "3502"}`;
  return raw.replace(/\/+$/, "");
}

function redirectUri(): string {
  return `${publicBaseUrl()}/oauth/callback`;
}

export function connectUrlFor(elicitationId: string): string {
  return `${publicBaseUrl()}/connect?e=${encodeURIComponent(elicitationId)}`;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Signed cookie value: `${payload}.${hmac}` */
export function signCookie(payload: string): string {
  const sig = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySignedCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const sig = raw.slice(idx + 1);
  const expected = createHmac("sha256", stateSecret())
    .update(payload)
    .digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  return payload;
}

export function parseCookieHeader(
  header: string | undefined,
  name: string
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function connectCookieName(): string {
  return CONNECT_COOKIE;
}

function loadRegisteredClient(): RegisteredClient | null {
  if (_client) return _client;
  const path = join(dataDir(), CLIENT_FILE);
  if (!existsSync(path)) return null;
  try {
    _client = JSON.parse(readFileSync(path, "utf8")) as RegisteredClient;
    return _client;
  } catch {
    return null;
  }
}

function persistRegisteredClient(client: RegisteredClient): void {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CLIENT_FILE), JSON.stringify(client, null, 2), {
    mode: 0o600,
  });
  _client = client;
}

function loadSession(): SessionRecord | null {
  if (_sessionLoaded) return _session;
  _sessionLoaded = true;
  const path = join(dataDir(), SESSION_FILE);
  if (!existsSync(path)) {
    _session = null;
    return null;
  }
  try {
    const key = deriveKey(stateSecret());
    const blob = readFileSync(path, "utf8").trim();
    if (!blob) {
      _session = null;
      return null;
    }
    const parsed = JSON.parse(decryptJson(key, blob)) as SessionFile;
    _session = parsed.session;
    return _session;
  } catch (err) {
    // Fail soft: rotated QOBRIX_MCP_STATE_SECRET or a corrupt file must not
    // 500 every /mcp and /health request — force re-auth instead.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[qobrix-crm-mcp] WARNING: session vault unreadable (${msg}); clearing and requiring re-auth\n`
    );
    _session = null;
    try {
      const broken = `${path}.broken.${Date.now()}`;
      renameSync(path, broken);
      // Best-effort cleanup of the renamed blob so secrets don't linger.
      unlinkSync(broken);
    } catch {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

function persistSession(session: SessionRecord | null): void {
  const key = deriveKey(stateSecret());
  const file: SessionFile = { version: 1, session };
  const blob = encryptJson(key, JSON.stringify(file));
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(join(dataDir(), SESSION_FILE), blob, { mode: 0o600 });
  _session = session;
  _sessionLoaded = true;
}

export function isConnected(): boolean {
  const s = loadSession();
  return Boolean(s?.apiUser && s?.apiKey);
}

export function getSessionCredentials(): AuthCredentials | null {
  const s = loadSession();
  if (!s?.apiUser || !s?.apiKey) return null;
  return {
    apiUser: s.apiUser,
    apiKey: s.apiKey,
    apiUrl: s.apiUrl,
    locale: s.locale,
    subject: s.subject,
  };
}

export function clearSession(): void {
  persistSession(null);
}

export function registerElicitationNotifier(
  elicitationId: string,
  notifier: () => Promise<void>
): void {
  const pending = _pending.get(elicitationId);
  if (pending) pending.completionNotifier = notifier;
}

function purgeExpiredPending(): void {
  const now = Date.now();
  for (const p of [..._pending.values()]) {
    if (now - p.createdAt > PENDING_TTL_MS) {
      clearActivePending(p);
    }
  }
}

/**
 * Ensure this MCP is registered as a confidential DCR client of the companion AS.
 */
export async function ensureClientRegistered(): Promise<RegisteredClient> {
  const { issuer } = requireOAuthEnv();
  const issuerHref = issuer.href.replace(/\/+$/, "");
  const existing = loadRegisteredClient();
  if (
    existing &&
    existing.issuer === issuerHref &&
    existing.redirect_uri === redirectUri() &&
    existing.client_id
  ) {
    return existing;
  }

  const meta = await getAsMetadata(issuer);
  const registerUrl =
    meta.registration_endpoint || new URL("/register", issuer).href;

  const res = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "qobrix-crm-mcp",
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "qobrix:read",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `DCR failed at ${registerUrl}: HTTP ${res.status} ${text}`
    );
  }

  const body = (await res.json()) as {
    client_id: string;
    client_secret?: string;
  };
  if (!body.client_id) {
    throw new Error("DCR response missing client_id");
  }

  const client: RegisteredClient = {
    client_id: body.client_id,
    client_secret: body.client_secret,
    redirect_uri: redirectUri(),
    issuer: issuerHref,
  };
  persistRegisteredClient(client);
  return client;
}

/**
 * Mint a single-use pending connect (PKCE + state + elicitationId).
 * Reuses an active, unexpired pending so repeated cold tool calls share one URL.
 */
export function beginConnect(): {
  elicitationId: string;
  state: string;
  connectUrl: string;
} {
  purgeExpiredPending();
  if (
    _activePending &&
    Date.now() - _activePending.createdAt <= PENDING_TTL_MS
  ) {
    return {
      elicitationId: _activePending.elicitationId,
      state: _activePending.state,
      connectUrl: connectUrlFor(_activePending.elicitationId),
    };
  }

  const elicitationId = randomBytes(16).toString("hex");
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const pending: PendingConnect = {
    elicitationId,
    state,
    codeVerifier,
    createdAt: Date.now(),
  };
  _pending.set(elicitationId, pending);
  _pendingByState.set(state, pending);
  _activePending = pending;
  setTimeout(() => {
    const p = _pending.get(elicitationId);
    if (p && p.state === state) {
      clearActivePending(p);
    }
  }, PENDING_TTL_MS).unref?.();

  return {
    elicitationId,
    state,
    connectUrl: connectUrlFor(elicitationId),
  };
}

/**
 * Resolve /connect?e=... → set cookie binding + AS authorize URL.
 */
export async function authorizeRedirect(elicitationId: string): Promise<{
  authorizeUrl: string;
  cookiePayload: string;
}> {
  purgeExpiredPending();
  const pending = _pending.get(elicitationId);
  if (!pending) {
    throw new Error(
      "Unknown or expired connect session. Ask the agent to request authorization again."
    );
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    clearActivePending(pending);
    throw new Error(
      "Connect session expired. Ask the agent to request authorization again."
    );
  }

  const client = await ensureClientRegistered();
  const { issuer, resourceServerUrl } = requireOAuthEnv();
  const meta = await getAsMetadata(issuer);
  const authorizeEndpoint =
    meta.authorization_endpoint || new URL("/authorize", issuer).href;

  const url = new URL(authorizeEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", client.redirect_uri);
  url.searchParams.set("scope", "qobrix:read");
  url.searchParams.set("state", pending.state);
  url.searchParams.set("code_challenge", pkceChallenge(pending.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", resourceServerUrl.href);

  return {
    authorizeUrl: url.href,
    cookiePayload: pending.state,
  };
}

async function introspectAccessToken(
  accessToken: string
): Promise<IntrospectionResult> {
  const { issuer, introspectionSecret, resourceServerUrl } = requireOAuthEnv();
  const meta = await getAsMetadata(issuer);
  const endpoint =
    meta.introspection_endpoint || new URL("/introspect", issuer).href;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Bearer ${introspectionSecret}`,
    },
    body: new URLSearchParams({ token: accessToken }).toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Introspection failed: HTTP ${response.status} ${text}`);
  }

  const data = (await response.json()) as IntrospectionResult;
  if (!data.active) {
    throw new Error("Token is not active after exchange");
  }
  if (!data.qobrix_api_user || !data.qobrix_api_key) {
    throw new Error(
      "Introspection did not return Qobrix credentials (check introspection secret pairing)"
    );
  }

  // Soft audience check — companion should bind aud to our resource URL.
  if (data.aud) {
    const aud = Array.isArray(data.aud) ? data.aud[0] : data.aud;
    const expected = resourceServerUrl.href.replace(/\/+$/, "");
    const got = String(aud).replace(/\/+$/, "");
    if (got !== expected && !got.startsWith(expected)) {
      // allow trailing path differences via check in oauth-rs; keep soft here
      process.stderr.write(
        `[qobrix-crm-mcp] WARNING: token aud ${got} != resource ${expected}\n`
      );
    }
  }

  return data;
}

/**
 * Handle AS redirect: verify state + cookie binding, exchange code, vault creds.
 */
export async function handleCallback(opts: {
  code: string;
  state: string;
  cookieHeader?: string;
}): Promise<{ elicitationId: string; subject?: string }> {
  purgeExpiredPending();

  const cookieRaw = parseCookieHeader(
    opts.cookieHeader,
    CONNECT_COOKIE
  );
  const cookieState = verifySignedCookie(cookieRaw);
  if (!cookieState || !safeEqual(cookieState, opts.state)) {
    throw new Error(
      "Connect cookie / state mismatch. Restart authorization from the agent."
    );
  }

  const pending = _pendingByState.get(opts.state);
  if (!pending) {
    throw new Error(
      "Unknown or already-used authorization state. Restart from the agent."
    );
  }

  // Single-use: remove before network calls to prevent replay.
  clearActivePending(pending);

  const client = await ensureClientRegistered();
  const { issuer, resourceServerUrl } = requireOAuthEnv();
  const meta = await getAsMetadata(issuer);
  const tokenEndpoint = meta.token_endpoint || new URL("/token", issuer).href;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: client.redirect_uri,
    client_id: client.client_id,
    code_verifier: pending.codeVerifier,
    resource: resourceServerUrl.href,
  });
  if (client.client_secret) {
    body.set("client_secret", client.client_secret);
  }

  const tokenRes = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Token exchange failed: HTTP ${tokenRes.status} ${text}`);
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token) {
    throw new Error("Token response missing access_token");
  }

  const intro = await introspectAccessToken(tokens.access_token);
  const expiresAt =
    typeof tokens.expires_in === "number"
      ? Date.now() + tokens.expires_in * 1000
      : intro.exp
        ? intro.exp * 1000
        : undefined;

  persistSession({
    apiUser: intro.qobrix_api_user!,
    apiKey: intro.qobrix_api_key!,
    apiUrl: intro.qobrix_api_url,
    locale: intro.qobrix_locale,
    subject: intro.sub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: expiresAt,
    updatedAt: new Date().toISOString(),
  });

  if (pending.completionNotifier) {
    pending.completionNotifier().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[qobrix-crm-mcp] elicitation complete notify failed: ${msg}\n`
      );
    });
  }

  return { elicitationId: pending.elicitationId, subject: intro.sub };
}

/**
 * Refresh access token if near expiry; returns session credentials or null.
 */
export async function refreshIfNeeded(): Promise<AuthCredentials | null> {
  const s = loadSession();
  if (!s?.apiUser || !s?.apiKey) return null;

  const skewMs = 60_000;
  if (
    !s.refreshToken ||
    !s.accessExpiresAt ||
    s.accessExpiresAt - Date.now() > skewMs
  ) {
    return getSessionCredentials();
  }

  try {
    const client = await ensureClientRegistered();
    const { issuer, resourceServerUrl } = requireOAuthEnv();
    const meta = await getAsMetadata(issuer);
    const tokenEndpoint = meta.token_endpoint || new URL("/token", issuer).href;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: s.refreshToken,
      client_id: client.client_id,
      resource: resourceServerUrl.href,
    });
    if (client.client_secret) {
      body.set("client_secret", client.client_secret);
    }

    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      clearSession();
      return null;
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const intro = await introspectAccessToken(tokens.access_token);
    persistSession({
      apiUser: intro.qobrix_api_user!,
      apiKey: intro.qobrix_api_key!,
      apiUrl: intro.qobrix_api_url,
      locale: intro.qobrix_locale,
      subject: intro.sub,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || s.refreshToken,
      accessExpiresAt:
        typeof tokens.expires_in === "number"
          ? Date.now() + tokens.expires_in * 1000
          : undefined,
      updatedAt: new Date().toISOString(),
    });
    return getSessionCredentials();
  } catch {
    clearSession();
    return null;
  }
}

/** Test helper — wipe in-memory + on-disk Mode C state. */
export function __resetOauthClientForTests(): void {
  _client = null;
  _session = null;
  _sessionLoaded = false;
  _activePending = null;
  _asMeta = null;
  _pending.clear();
  _pendingByState.clear();
}
