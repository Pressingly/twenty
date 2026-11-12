import { generateKeyPairSync, type KeyObject } from 'crypto';

import { Logger } from '@nestjs/common';

import * as jwt from 'jsonwebtoken';

import { InvalidMpassTokenError } from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { parseJwksSigningKeys } from 'src/engine/core-modules/mpass-proxy-auth/utils/fetch-jwks-signing-keys.util';

const COGNITO_ISSUER =
  'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool';
const PROXY_ISSUER = 'https://auth.example.test';
const CLIENT_ID = 'mpass-client';
const KEY_ID = 'key-1';
const NOW_MS = Date.UTC(2026, 10, 12, 12, 0, 0);
const NOW_SECONDS = NOW_MS / 1000;

const generateRsaKeyPair = () =>
  generateKeyPairSync('rsa', { modulusLength: 2048 });

const signingKeyPair = generateRsaKeyPair();
const otherKeyPair = generateRsaKeyPair();

const jwksFor = (publicKey: KeyObject, kid = KEY_ID) =>
  parseJwksSigningKeys({
    keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig' }],
  });

const accessClaims = (overrides: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries({
      iss: COGNITO_ISSUER,
      token_use: 'access',
      client_id: CLIENT_ID,
      iat: NOW_SECONDS - 10,
      exp: NOW_SECONDS + 3600,
      'custom:corporate_id': 'corp-1',
      ...overrides,
    }).filter(([, value]) => value !== undefined),
  );

const signToken = (
  claims: Record<string, unknown>,
  {
    privateKey = signingKeyPair.privateKey,
    kid = KEY_ID,
    omitIssuedAt = false,
  }: { privateKey?: KeyObject; kid?: string; omitIssuedAt?: boolean } = {},
) =>
  jwt.sign(claims, privateKey, {
    algorithm: 'RS256',
    keyid: kid,
    noTimestamp: omitIssuedAt,
  });

const unsignedToken = (claims: Record<string, unknown>) =>
  [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KEY_ID })),
    Buffer.from(JSON.stringify(claims)),
  ]
    .map((part) => part.toString('base64url'))
    .join('.') + '.';

const buildVerifier = ({
  fetchJwksSigningKeys = jest
    .fn()
    .mockResolvedValue(jwksFor(signingKeyPair.publicKey)),
  issuers = [COGNITO_ISSUER, PROXY_ISSUER],
  clientId = CLIENT_ID,
  clock = { now: NOW_MS },
}: {
  fetchJwksSigningKeys?: jest.Mock;
  issuers?: string[];
  clientId?: string;
  clock?: { now: number };
} = {}) => ({
  fetchJwksSigningKeys,
  clock,
  verifier: new MpassTokenVerifier({
    issuers,
    clientId,
    fetchJwksSigningKeys,
    now: () => clock.now,
  }),
});

const rejectionReason = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InvalidMpassTokenError) {
      return error.reason;
    }

    throw error;
  }

  return 'accepted';
};

describe('MpassTokenVerifier', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('accepts a Cognito access token issued to the client', async () => {
    const { verifier, fetchJwksSigningKeys } = buildVerifier();

    const claims = await verifier.verify(signToken(accessClaims()));

    expect(claims['custom:corporate_id']).toBe('corp-1');
    expect(fetchJwksSigningKeys).toHaveBeenCalledWith(COGNITO_ISSUER);
  });

  it('accepts an id_token re-signed by the mpass-auth-proxy issuer', async () => {
    const { verifier, fetchJwksSigningKeys } = buildVerifier();
    const token = signToken(
      accessClaims({
        iss: PROXY_ISSUER,
        token_use: 'id',
        client_id: undefined,
        aud: ['other', CLIENT_ID],
      }),
    );

    await expect(verifier.verify(token)).resolves.toBeDefined();
    expect(fetchJwksSigningKeys).toHaveBeenCalledWith(PROXY_ISSUER);
  });

  it('caches the JWKS per issuer', async () => {
    const { verifier, fetchJwksSigningKeys } = buildVerifier();

    await verifier.verify(signToken(accessClaims()));
    await verifier.verify(signToken(accessClaims()));

    expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'bad signature',
      () => signToken(accessClaims(), { privateKey: otherKeyPair.privateKey }),
      'bad_signature',
    ],
    [
      'expired token',
      () => signToken(accessClaims({ exp: NOW_SECONDS - 61 })),
      'expired',
    ],
    [
      'untrusted issuer',
      () => signToken(accessClaims({ iss: 'https://evil.example.test' })),
      'untrusted_issuer',
    ],
    [
      'access token for another client',
      () => signToken(accessClaims({ client_id: 'other-client' })),
      'wrong_audience',
    ],
    [
      'id_token for another audience',
      () =>
        signToken(
          accessClaims({ token_use: 'id', client_id: undefined, aud: 'x' }),
        ),
      'wrong_audience',
    ],
    [
      'unknown token_use',
      () => signToken(accessClaims({ token_use: 'refresh' })),
      'wrong_audience',
    ],
    [
      'missing token_use',
      () => signToken(accessClaims({ token_use: undefined })),
      'invalid',
    ],
    [
      'missing exp',
      () => signToken(accessClaims({ exp: undefined })),
      'invalid',
    ],
    [
      'missing iat',
      () => signToken(accessClaims({ iat: undefined }), { omitIssuedAt: true }),
      'invalid',
    ],
    [
      'iat beyond the leeway',
      () => signToken(accessClaims({ iat: NOW_SECONDS + 120 })),
      'invalid',
    ],
    ['alg none', () => unsignedToken(accessClaims()), 'disallowed_algorithm'],
    [
      'HS256 signed with the public key',
      () =>
        jwt.sign(
          accessClaims(),
          signingKeyPair.publicKey.export({ format: 'pem', type: 'spki' }),
          { algorithm: 'HS256', keyid: KEY_ID },
        ),
      'disallowed_algorithm',
    ],
    ['malformed token', () => 'not-a-jwt', 'malformed'],
  ])('rejects %s', async (_case, buildToken, reason) => {
    const { verifier } = buildVerifier();

    expect(await rejectionReason(verifier.verify(buildToken()))).toBe(reason);
  });

  it('tolerates 60 seconds of clock skew on exp', async () => {
    const { verifier } = buildVerifier();

    await expect(
      verifier.verify(signToken(accessClaims({ exp: NOW_SECONDS - 30 }))),
    ).resolves.toBeDefined();
  });

  it('refuses everything when no issuer or client id is configured', async () => {
    const token = signToken(accessClaims());

    expect(
      await rejectionReason(
        buildVerifier({ issuers: [] }).verifier.verify(token),
      ),
    ).toBe('verifier_unconfigured');
    expect(
      await rejectionReason(
        buildVerifier({ clientId: '' }).verifier.verify(token),
      ),
    ).toBe('verifier_unconfigured');
  });

  it('reports jwks_unavailable on fetch failure and backs off for 30 seconds', async () => {
    const fetchJwksSigningKeys = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(jwksFor(signingKeyPair.publicKey));
    const { verifier, clock } = buildVerifier({ fetchJwksSigningKeys });
    const token = signToken(accessClaims());

    expect(await rejectionReason(verifier.verify(token))).toBe(
      'jwks_unavailable',
    );
    clock.now += 29_000;
    expect(await rejectionReason(verifier.verify(token))).toBe(
      'jwks_unavailable',
    );
    expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(1);

    clock.now += 2_000;
    await expect(verifier.verify(token)).resolves.toBeDefined();
    expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(2);
  });

  it('reports jwks_unavailable when the JWKS document cannot be parsed', async () => {
    const fetchJwksSigningKeys = jest.fn(async () =>
      parseJwksSigningKeys({ unexpected: true }),
    );
    const { verifier } = buildVerifier({ fetchJwksSigningKeys });

    expect(
      await rejectionReason(verifier.verify(signToken(accessClaims()))),
    ).toBe('jwks_unavailable');
  });

  it('refetches once for an unknown kid, then rejects it without refetching', async () => {
    const { verifier, fetchJwksSigningKeys, clock } = buildVerifier();
    const rotatedToken = signToken(accessClaims(), { kid: 'key-2' });

    await verifier.verify(signToken(accessClaims()));
    clock.now += 31_000;
    expect(await rejectionReason(verifier.verify(rotatedToken))).toBe(
      'unknown_signing_key',
    );
    expect(await rejectionReason(verifier.verify(rotatedToken))).toBe(
      'unknown_signing_key',
    );

    expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(2);
  });

  it('picks up a rotated key on refetch', async () => {
    const fetchJwksSigningKeys = jest
      .fn()
      .mockResolvedValueOnce(jwksFor(signingKeyPair.publicKey))
      .mockResolvedValue(jwksFor(otherKeyPair.publicKey, 'key-2'));
    const { verifier, clock } = buildVerifier({ fetchJwksSigningKeys });

    await verifier.verify(signToken(accessClaims()));
    clock.now += 31_000;

    await expect(
      verifier.verify(
        signToken(accessClaims(), {
          privateKey: otherKeyPair.privateKey,
          kid: 'key-2',
        }),
      ),
    ).resolves.toBeDefined();
  });

  describe('stale key grace', () => {
    const HOUR_MS = 3_600_000;

    const buildWithFailingRefresh = () =>
      buildVerifier({
        fetchJwksSigningKeys: jest
          .fn()
          .mockResolvedValueOnce(jwksFor(signingKeyPair.publicKey))
          .mockRejectedValue(new Error('JWKS endpoint down')),
      });

    it('serves the last good key set when a refresh fails, and during the backoff', async () => {
      const { verifier, fetchJwksSigningKeys, clock } =
        buildWithFailingRefresh();

      await verifier.verify(signToken(accessClaims()));
      clock.now += 2 * HOUR_MS;

      const lateToken = signToken(
        accessClaims({
          iat: clock.now / 1000 - 10,
          exp: clock.now / 1000 + 600,
        }),
      );

      await expect(verifier.verify(lateToken)).resolves.toBeDefined();
      await expect(verifier.verify(lateToken)).resolves.toBeDefined();
      expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('serving the last good key set'),
      );
    });

    it('fails closed once the last good key set is older than 24 hours', async () => {
      const { verifier, clock } = buildWithFailingRefresh();

      await verifier.verify(signToken(accessClaims()));
      clock.now += 24 * HOUR_MS;

      const lateToken = signToken(
        accessClaims({
          iat: clock.now / 1000 - 10,
          exp: clock.now / 1000 + 600,
        }),
      );

      expect(await rejectionReason(verifier.verify(lateToken))).toBe(
        'jwks_unavailable',
      );
    });

    it('rejects a kid absent from the stale set instead of trusting it', async () => {
      const { verifier, clock } = buildWithFailingRefresh();

      await verifier.verify(signToken(accessClaims()));
      clock.now += 2 * HOUR_MS;

      const unknownKidToken = signToken(
        accessClaims({
          iat: clock.now / 1000 - 10,
          exp: clock.now / 1000 + 600,
        }),
        { kid: 'key-2' },
      );

      expect(await rejectionReason(verifier.verify(unknownKidToken))).toBe(
        'unknown_signing_key',
      );
    });
  });

  it('shares one in-flight JWKS fetch between concurrent verifications', async () => {
    let resolveFetch: (keys: ReturnType<typeof jwksFor>) => void = () => {};
    const fetchJwksSigningKeys = jest.fn(
      () =>
        new Promise<ReturnType<typeof jwksFor>>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { verifier } = buildVerifier({ fetchJwksSigningKeys });
    const token = signToken(accessClaims());

    const verifications = [verifier.verify(token), verifier.verify(token)];

    resolveFetch(jwksFor(signingKeyPair.publicKey));

    await expect(Promise.all(verifications)).resolves.toHaveLength(2);
    expect(fetchJwksSigningKeys).toHaveBeenCalledTimes(1);
  });
});
