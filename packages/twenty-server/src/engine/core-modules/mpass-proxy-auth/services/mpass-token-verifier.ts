import { type KeyObject } from 'crypto';

import { Logger } from '@nestjs/common';

import { isNonEmptyString, isObject } from '@sniptt/guards';
import * as jwt from 'jsonwebtoken';
import { isDefined } from 'twenty-shared/utils';

import {
  ALLOWED_TOKEN_ALGORITHM,
  CLOCK_SKEW_LEEWAY_SECONDS,
  JWKS_FAILURE_BACKOFF_MS,
  JWKS_LIFESPAN_MS,
  JWKS_STALE_GRACE_MS,
  REQUIRED_TOKEN_CLAIMS,
} from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-token-verification.constant';
import { InvalidMpassTokenError } from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { type MpassTokenClaims } from 'src/engine/core-modules/mpass-proxy-auth/types/mpass-token-claims.type';
import {
  type FetchJwksSigningKeys,
  type JwksSigningKeys,
} from 'src/engine/core-modules/mpass-proxy-auth/utils/fetch-jwks-signing-keys.util';
import { tokenAudienceMatches } from 'src/engine/core-modules/mpass-proxy-auth/utils/token-audience-matches.util';

type CachedJwks = {
  keys: JwksSigningKeys;
  fetchedAt: number;
};

export type MpassTokenVerifierOptions = {
  issuers: string[];
  clientId: string;
  fetchJwksSigningKeys: FetchJwksSigningKeys;
  now?: () => number;
};

type UnverifiedToken = {
  issuer: string;
  keyId: string;
};

const readUnverifiedToken = (token: string): UnverifiedToken => {
  const decoded = jwt.decode(token, { complete: true });

  if (!isDefined(decoded) || !isObject(decoded.payload)) {
    throw new InvalidMpassTokenError('malformed');
  }

  if (decoded.header.alg !== ALLOWED_TOKEN_ALGORITHM) {
    throw new InvalidMpassTokenError('disallowed_algorithm');
  }

  const issuer = (decoded.payload as jwt.JwtPayload).iss;

  return {
    issuer: isNonEmptyString(issuer) ? issuer : '',
    keyId: decoded.header.kid ?? '',
  };
};

const toInvalidTokenError = (error: unknown): InvalidMpassTokenError => {
  if (error instanceof jwt.TokenExpiredError) {
    return new InvalidMpassTokenError('expired');
  }

  if (error instanceof jwt.JsonWebTokenError) {
    if (error.message === 'invalid signature') {
      return new InvalidMpassTokenError('bad_signature');
    }

    if (error.message.startsWith('jwt issuer invalid')) {
      return new InvalidMpassTokenError('untrusted_issuer');
    }
  }

  return new InvalidMpassTokenError('invalid');
};

const hasRequiredClaims = (claims: MpassTokenClaims): boolean =>
  REQUIRED_TOKEN_CLAIMS.every((claim) => isDefined(claims[claim]));

const isIssuedInFuture = (
  claims: MpassTokenClaims,
  nowSeconds: number,
): boolean =>
  typeof claims.iat !== 'number' ||
  claims.iat > nowSeconds + CLOCK_SKEW_LEEWAY_SECONDS;

// Verifies the mPass token oauth2-proxy forwards in X-Auth-Request-Access-Token
// against the JWKS of each allowlisted issuer, and nothing else.
export class MpassTokenVerifier {
  private readonly issuers: ReadonlySet<string>;
  private readonly clientId: string;
  private readonly fetchJwksSigningKeys: FetchJwksSigningKeys;
  private readonly now: () => number;
  private readonly jwksByIssuer = new Map<string, CachedJwks>();
  private readonly jwksFailedAtByIssuer = new Map<string, number>();
  private readonly jwksFetchesInFlight = new Map<
    string,
    Promise<JwksSigningKeys>
  >();
  private readonly logger = new Logger(MpassTokenVerifier.name);

  constructor({
    issuers,
    clientId,
    fetchJwksSigningKeys,
    now = Date.now,
  }: MpassTokenVerifierOptions) {
    this.issuers = new Set(issuers.filter(isNonEmptyString));
    this.clientId = clientId;
    this.fetchJwksSigningKeys = fetchJwksSigningKeys;
    this.now = now;
  }

  get isConfigured(): boolean {
    return this.issuers.size > 0 && isNonEmptyString(this.clientId);
  }

  async verify(token: string): Promise<MpassTokenClaims> {
    if (!this.isConfigured) {
      throw new InvalidMpassTokenError('verifier_unconfigured');
    }

    const { issuer, keyId } = readUnverifiedToken(token);

    if (!this.issuers.has(issuer)) {
      throw new InvalidMpassTokenError('untrusted_issuer');
    }

    const signingKey = await this.findSigningKey(issuer, keyId);
    const claims = this.verifySignature(token, signingKey, issuer);

    if (!tokenAudienceMatches(claims, this.clientId)) {
      throw new InvalidMpassTokenError('wrong_audience');
    }

    return claims;
  }

  private verifySignature(
    token: string,
    signingKey: KeyObject,
    issuer: string,
  ): MpassTokenClaims {
    const nowSeconds = Math.floor(this.now() / 1000);
    let claims: MpassTokenClaims;

    try {
      claims = jwt.verify(token, signingKey, {
        algorithms: [ALLOWED_TOKEN_ALGORITHM],
        issuer,
        clockTolerance: CLOCK_SKEW_LEEWAY_SECONDS,
        clockTimestamp: nowSeconds,
      }) as MpassTokenClaims;
    } catch (error) {
      throw toInvalidTokenError(error);
    }

    if (!hasRequiredClaims(claims) || isIssuedInFuture(claims, nowSeconds)) {
      throw new InvalidMpassTokenError('invalid');
    }

    return claims;
  }

  private async findSigningKey(
    issuer: string,
    keyId: string,
  ): Promise<KeyObject> {
    const cached = this.jwksByIssuer.get(issuer);
    const cachedKey = cached?.keys.get(keyId);

    if (
      isDefined(cached) &&
      isDefined(cachedKey) &&
      this.ageOf(cached) < JWKS_LIFESPAN_MS
    ) {
      return cachedKey;
    }

    // A kid missing from a just-fetched set is unknown, not a rotation; this
    // stops forged kids from turning every request into a JWKS fetch.
    if (
      isDefined(cached) &&
      !isDefined(cachedKey) &&
      this.ageOf(cached) < JWKS_FAILURE_BACKOFF_MS
    ) {
      throw new InvalidMpassTokenError('unknown_signing_key');
    }

    const keys = await this.refreshOrServeStale(issuer, cached);
    const signingKey = keys.get(keyId);

    if (!isDefined(signingKey)) {
      throw new InvalidMpassTokenError('unknown_signing_key');
    }

    return signingKey;
  }

  // A JWKS outage must not lock out every login: the last good set stays
  // trusted for a bounded grace, and only an issuer with none fails closed.
  private async refreshOrServeStale(
    issuer: string,
    cached: CachedJwks | undefined,
  ): Promise<JwksSigningKeys> {
    try {
      return await this.refreshJwks(issuer);
    } catch (error) {
      if (!isDefined(cached) || this.ageOf(cached) >= JWKS_STALE_GRACE_MS) {
        throw error;
      }

      this.logger.warn(
        `JWKS refresh unavailable for issuer=${issuer}; serving the last good key set fetched ${Math.round(this.ageOf(cached) / 1000)}s ago`,
      );

      return cached.keys;
    }
  }

  private refreshJwks(issuer: string): Promise<JwksSigningKeys> {
    if (this.failedRecently(issuer)) {
      return Promise.reject(new InvalidMpassTokenError('jwks_unavailable'));
    }

    const inFlight = this.jwksFetchesInFlight.get(issuer);

    if (isDefined(inFlight)) {
      return inFlight;
    }

    const fetch = this.fetchAndCacheJwks(issuer).finally(() =>
      this.jwksFetchesInFlight.delete(issuer),
    );

    this.jwksFetchesInFlight.set(issuer, fetch);

    return fetch;
  }

  private async fetchAndCacheJwks(issuer: string): Promise<JwksSigningKeys> {
    try {
      const keys = await this.fetchJwksSigningKeys(issuer);

      this.jwksByIssuer.set(issuer, { keys, fetchedAt: this.now() });
      this.jwksFailedAtByIssuer.delete(issuer);

      return keys;
    } catch {
      this.jwksFailedAtByIssuer.set(issuer, this.now());

      throw new InvalidMpassTokenError('jwks_unavailable');
    }
  }

  private ageOf(cached: CachedJwks): number {
    return this.now() - cached.fetchedAt;
  }

  private failedRecently(issuer: string): boolean {
    const failedAt = this.jwksFailedAtByIssuer.get(issuer);

    return (
      isDefined(failedAt) && this.now() - failedAt < JWKS_FAILURE_BACKOFF_MS
    );
  }
}
