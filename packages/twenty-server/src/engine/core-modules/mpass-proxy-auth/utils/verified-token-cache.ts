import { createHash } from 'crypto';

import { isDefined } from 'twenty-shared/utils';

import { type MpassTokenClaims } from 'src/engine/core-modules/mpass-proxy-auth/types/mpass-token-claims.type';

type CachedVerification = {
  claims: MpassTokenClaims;
  expiresAtMs: number;
};

const tokenDigest = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

// Least-recently-used, keyed by token digest so raw tokens never sit in
// memory longer than the request that carried them.
export class VerifiedTokenCache {
  private readonly entries = new Map<string, CachedVerification>();

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(token: string): MpassTokenClaims | undefined {
    const key = tokenDigest(token);
    const entry = this.entries.get(key);

    if (!isDefined(entry)) {
      return undefined;
    }

    this.entries.delete(key);

    if (entry.expiresAtMs <= this.now()) {
      return undefined;
    }

    this.entries.set(key, entry);

    return entry.claims;
  }

  set(token: string, claims: MpassTokenClaims): void {
    if (typeof claims.exp !== 'number') {
      return;
    }

    const key = tokenDigest(token);

    this.entries.delete(key);
    this.entries.set(key, { claims, expiresAtMs: claims.exp * 1000 });

    const oldestKey = this.entries.keys().next().value;

    if (this.entries.size > this.maxEntries && isDefined(oldestKey)) {
      this.entries.delete(oldestKey);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
