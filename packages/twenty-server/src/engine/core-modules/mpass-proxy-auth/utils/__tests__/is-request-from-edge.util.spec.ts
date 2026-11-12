import { isRequestFromEdge } from 'src/engine/core-modules/mpass-proxy-auth/utils/is-request-from-edge.util';

const EDGE_SECRET = 'a'.repeat(64);

describe('isRequestFromEdge', () => {
  it('trusts a request presenting the configured secret', () => {
    expect(isRequestFromEdge(EDGE_SECRET, EDGE_SECRET)).toBe(true);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'b'.repeat(64)],
    ['a prefix of the secret', EDGE_SECRET.slice(0, 32)],
    ['an array value', [EDGE_SECRET]],
  ])('refuses %s', (_case, presented) => {
    expect(isRequestFromEdge(presented, EDGE_SECRET)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['shorter than 32 characters', 'short-secret'],
  ])('trusts nothing when the configured secret is %s', (_case, secret) => {
    expect(isRequestFromEdge(secret, secret)).toBe(false);
  });
});
