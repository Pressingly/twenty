import { Logger } from '@nestjs/common';

import { type Response } from 'express';

import { type ProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/types/proxy-identity-headers.type';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type UserSessionCookieService } from 'src/engine/core-modules/user-session/services/user-session-cookie.service';

const logger = new Logger('ProxyIdentity');

/**
 * Compare the trusted proxy-asserted identity against an authenticated
 * user's email. Mirrors SSO proxy-login resolution: prefer
 * `x-auth-request-email`, then fall back to `x-auth-request-user`.
 *
 * Returns true on match OR when both proxy headers are absent (per
 * proxy-auth-middleware spec: header absence is NOT a logout signal —
 * internal calls, OPTIONS preflight, and direct backend hits legitimately
 * arrive without it).
 */
export const matchesProxyIdentity = (
  trustedHeaders: ProxyIdentityHeaders,
  jwtEmail: string,
  configService: TwentyConfigService,
): boolean => {
  const headerRaw = resolveProxyIdentity(trustedHeaders);

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

  // Both sides lowercased and trimmed: asymmetric normalisation would clear
  // the cookie on every request for whitespace-padded legacy emails.
  return normalizedProxyIdentity === jwtEmail.toLowerCase().trim();
};

export const resolveProxyIdentity = (
  trustedHeaders: ProxyIdentityHeaders,
): string | null => trustedHeaders.email ?? trustedHeaders.user ?? null;

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
 * Expire the session cookie. Defensive: in some test harnesses
 * `response.clearCookie` may not be wired up, so guard with a typeof
 * check before calling.
 */
export const clearSessionCookie = (
  response: Response | undefined,
  userSessionCookieService: UserSessionCookieService,
): void => {
  if (typeof response?.clearCookie !== 'function') {
    return;
  }

  userSessionCookieService.clearSessionCookie(response);
};
