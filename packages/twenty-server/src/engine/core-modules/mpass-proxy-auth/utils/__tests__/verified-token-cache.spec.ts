import { VerifiedTokenCache } from 'src/engine/core-modules/mpass-proxy-auth/utils/verified-token-cache';

const NOW_MS = 1_000_000_000;
const claimsExpiringIn = (seconds: number) => ({
  exp: NOW_MS / 1000 + seconds,
});

describe('VerifiedTokenCache', () => {
  it('evicts the least recently used entry beyond its bound', () => {
    const cache = new VerifiedTokenCache(2, () => NOW_MS);

    cache.set('token-a', claimsExpiringIn(60));
    cache.set('token-b', claimsExpiringIn(60));
    cache.get('token-a');
    cache.set('token-c', claimsExpiringIn(60));

    expect(cache.size).toBe(2);
    expect(cache.get('token-a')).toBeDefined();
    expect(cache.get('token-b')).toBeUndefined();
    expect(cache.get('token-c')).toBeDefined();
  });

  it('drops an entry once its token expires', () => {
    let now = NOW_MS;
    const cache = new VerifiedTokenCache(10, () => now);

    cache.set('token', claimsExpiringIn(30));
    now += 31_000;

    expect(cache.get('token')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('ignores claims without a numeric exp', () => {
    const cache = new VerifiedTokenCache(10, () => NOW_MS);

    cache.set('token', { exp: 'soon' });

    expect(cache.size).toBe(0);
  });
});
