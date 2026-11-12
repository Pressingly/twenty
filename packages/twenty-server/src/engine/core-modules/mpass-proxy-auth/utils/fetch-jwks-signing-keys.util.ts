import { createPublicKey, type JsonWebKey, type KeyObject } from 'crypto';

import { Logger } from '@nestjs/common';

import { isNonEmptyString, isObject } from '@sniptt/guards';

import { JWKS_FETCH_TIMEOUT_MS } from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-token-verification.constant';
import { jwksUrl } from 'src/engine/core-modules/mpass-proxy-auth/utils/jwks-url.util';

const logger = new Logger('FetchJwksSigningKeys');

export type JwksSigningKeys = ReadonlyMap<string, KeyObject>;

export type FetchJwksSigningKeys = (issuer: string) => Promise<JwksSigningKeys>;

type RsaSigningJwk = JsonWebKey & { kid: string };

const isRsaSigningJwk = (key: unknown): key is RsaSigningJwk =>
  isObject(key) &&
  isNonEmptyString((key as RsaSigningJwk).kid) &&
  (key as RsaSigningJwk).kty === 'RSA' &&
  ((key as RsaSigningJwk).use ?? 'sig') === 'sig';

export const parseJwksSigningKeys = (document: unknown): JwksSigningKeys => {
  const keys = isObject(document)
    ? (document as { keys?: unknown }).keys
    : undefined;

  if (!Array.isArray(keys)) {
    throw new Error('JWKS document has no keys array');
  }

  return new Map(
    keys.filter(isRsaSigningJwk).flatMap((jwk): [string, KeyObject][] => {
      try {
        return [[jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]];
      } catch {
        logger.warn(`Skipping unusable JWKS key kid=${jwk.kid}`);

        return [];
      }
    }),
  );
};

// Plain fetch, not Twenty's outbound HTTP client: the issuer is operator
// config, and safe mode or the internal-host allowlist must not block it.
export const fetchJwksSigningKeys: FetchJwksSigningKeys = async (issuer) => {
  const response = await fetch(jwksUrl(issuer), {
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`JWKS fetch failed with HTTP ${response.status}`);
  }

  return parseJwksSigningKeys(await response.json());
};
