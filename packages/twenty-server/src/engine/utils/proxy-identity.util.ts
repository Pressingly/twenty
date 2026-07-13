import { Logger } from '@nestjs/common';

import { type Request, type Response } from 'express';

import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

export const TOKEN_PAIR_COOKIE_NAME = 'tokenPair';

const logger = new Logger('ProxyIdentity');

/**
 * Compare the proxy-asserted identity against an authenticated user's email
 * with bidirectional normalisation. Mirrors SSO proxy-login resolution:
 * prefer `x-auth-request-email`, then fall back to `x-auth-request-user`.
 *
 * Returns true on match OR when both proxy headers are absent (per
 * proxy-auth-middleware spec: header absence is NOT a logout signal —
 * internal calls, OPTIONS preflight, and direct backend hits legitimately
 * arrive without it).
 */
export const matchesProxyIdentity = (
  request: Request,
  jwtEmail: string,
  configService: TwentyConfigService,
): boolean => {
  const headerRaw = resolveProxyIdentity(request);

  if (!headerRaw) {
    return true;
  }

  const normalizedProxyIdentity = normalizeProxyIdentity(
    headerRaw,
    configService,
  );

  if (!normalizedProxyIdentity) {
    return false;
  }

  // Bidirectional normalisation: both sides MUST be lowercased AND
  // whitespace-trimmed before comparison. Asymmetric normalisation
  // (e.g. trimming the header but not the JWT side) is observationally
  // equivalent to no normalisation — any whitespace-padded value in
  // the User row (legacy data, fixtures, non-SSO provisioning paths)
  // would spuriously trigger mismatch and clear the cookie on every
  // request. Mirrors Plane's `_normalise_email` + Outline's
  // `normalizeProxyEmail` + `(user.email ?? "").toLowerCase().trim()`
  // patterns; required by
  // openspec/specs/proxy-auth-middleware/spec.md
  // "Match is case- and whitespace-insensitive".
  return normalizedProxyIdentity === jwtEmail.toLowerCase().trim();
};

export const resolveProxyIdentity = (request: Request): string | null => {
  const proxyEmail = request.get('x-auth-request-email')?.trim();

  if (proxyEmail) {
    return proxyEmail;
  }

  const proxyUser = request.get('x-auth-request-user')?.trim();

  if (proxyUser) {
    return proxyUser;
  }

  return null;
};

/**
 * Normalise a raw proxy identity header value into the canonical email
 * used for user lookup, matching SSO proxy-login semantics.
 *
 * - Lowercased and whitespace-trimmed.
 * - Any value containing `@` is treated as an email as-is, matching
 *   SsoProxyLoginController.resolveEmail().
 * - If it doesn't contain `@` (e.g. oauth2-proxy is forwarding a bare
 *   Cognito username via user_id_claim=cognito:username), synthesise
 *   `<local>@${DEFAULT_EMAIL_DOMAIN}` so the resulting key matches the
 *   one Twenty's SSO proxy-login flow uses to provision the user.
 * - If bare usernames are present but DEFAULT_EMAIL_DOMAIN is missing,
 *   return null so the caller can fail closed rather than comparing
 *   against an invalid synthesized identity.
 */
export const normalizeProxyIdentity = (
  raw: string,
  configService: TwentyConfigService,
): string | null => {
  const trimmed = raw.toLowerCase().trim();

  if (trimmed.includes('@')) {
    return trimmed;
  }

  const domain = configService.get('DEFAULT_EMAIL_DOMAIN');

  if (!domain) {
    logger.warn(
      'Proxy identity contains a bare username but DEFAULT_EMAIL_DOMAIN is not configured.',
    );

    return null;
  }

  return `${trimmed}@${domain}`;
};

/**
 * Layer 2 tenant isolation: verify that the caller's mPass access token
 * carries `custom:corporate_id` matching this deployment's
 * `SMB_CORPORATE_ID`. When the env var is empty the check is skipped
 * entirely (backward-compatible default).
 *
 * The JWT signature is NOT verified here — oauth2-proxy already did that
 * before forwarding the request. We only base64-decode the payload.
 *
 * Throws `AuthException` with FORBIDDEN code on mismatch.
 */
export const assertCorporateId = (
  request: Request,
  configService: TwentyConfigService,
): void => {
  const expectedCorporateId = configService.get('SMB_CORPORATE_ID');

  if (!expectedCorporateId) {
    return;
  }

  const accessToken = request.get('x-auth-request-access-token');

  if (!accessToken) {
    throw new CorporateIdError('Access denied: missing access token');
  }

  try {
    const parts = accessToken.split('.');

    if (parts.length < 2) {
      throw new CorporateIdError('Access denied: malformed access token');
    }

    const payloadB64 = parts[1];
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    );

    if (payload['custom:is_corporate'] !== 'true') {
      throw new CorporateIdError('Access denied: not a corporate account');
    }

    if (payload['custom:corporate_id'] !== expectedCorporateId) {
      throw new CorporateIdError('Access denied: corporate ID mismatch');
    }
  } catch (error) {
    if (error instanceof CorporateIdError) {
      throw error;
    }

    throw new CorporateIdError('Access denied: invalid access token');
  }
};

/**
 * Typed error for corporate ID enforcement so callers can distinguish
 * it from other errors and map to a 403 response.
 */
export class CorporateIdError extends Error {
  readonly statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = 'CorporateIdError';
  }
}

/**
 * Expire the tokenPair cookie. Defensive: in some test harnesses
 * `response.clearCookie` may not be wired up, so guard with a typeof
 * check before calling.
 */
export const clearTokenPairCookie = (response: Response | undefined): void => {
  if (typeof response?.clearCookie === 'function') {
    response.clearCookie(TOKEN_PAIR_COOKIE_NAME, { path: '/' });
  }
};
