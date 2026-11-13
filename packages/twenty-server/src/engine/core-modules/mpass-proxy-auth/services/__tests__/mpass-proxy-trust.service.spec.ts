import { Logger } from '@nestjs/common';

import { type Request } from 'express';

import { InvalidMpassTokenError } from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { type MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const EDGE_SECRET = 'e'.repeat(64);

const buildRequest = (headers: Record<string, string>) =>
  ({
    get: (name: string) => headers[name.toLowerCase()],
    path: '/auth/sso/proxy-login',
    socket: { remoteAddress: '172.18.0.9' },
  }) as unknown as Request;

const FORGED_HEADERS = {
  'x-auth-request-email': 'victim@example.com',
  'x-auth-request-user': '1020010000019120',
  'x-auth-request-access-token': 'forged.token.value',
};

const buildService = ({
  config = {},
  verify = jest.fn(),
  isConfigured = true,
}: {
  config?: Record<string, string>;
  verify?: jest.Mock;
  isConfigured?: boolean;
} = {}) => {
  const values: Record<string, string> = {
    AUTH_TYPE: 'SSO',
    MPASS_EDGE_SECRET: EDGE_SECRET,
    SMB_CORPORATE_ID: '',
    ...config,
  };
  const twentyConfigService = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as TwentyConfigService;
  const verifier = { verify, isConfigured } as unknown as MpassTokenVerifier;

  return {
    verify,
    service: new MpassProxyTrustService(twentyConfigService, verifier),
  };
};

describe('MpassProxyTrustService', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  describe('readTrustedProxyHeaders', () => {
    it('returns the identity headers of a request carrying the edge secret', () => {
      const { service } = buildService();

      expect(
        service.readTrustedProxyHeaders(
          buildRequest({
            ...FORGED_HEADERS,
            'x-mpass-edge-secret': EDGE_SECRET,
          }),
        ),
      ).toEqual({
        email: 'victim@example.com',
        user: '1020010000019120',
        accessToken: 'forged.token.value',
      });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it.each([
      ['without the edge secret', {}],
      ['with a wrong edge secret', { 'x-mpass-edge-secret': 'x'.repeat(64) }],
    ])('ignores forged identity headers %s', (_case, extraHeaders) => {
      const { service } = buildService();

      expect(
        service.readTrustedProxyHeaders(
          buildRequest({ ...FORGED_HEADERS, ...extraHeaders }),
        ),
      ).toEqual({});
      expect(warnSpy).toHaveBeenCalledTimes(1);

      const warning = warnSpy.mock.calls[0][0] as string;

      expect(warning).toContain('mpass_id=1020010000019120');
      expect(warning).toContain('path=/auth/sso/proxy-login');
      expect(warning).toContain('remote_addr=172.18.0.9');
      expect(warning).not.toContain('victim@example.com');
      expect(warning).not.toContain('forged.token.value');
    });

    it('never logs an email when the user header carries one', () => {
      const { service } = buildService();

      service.readTrustedProxyHeaders(
        buildRequest({ 'x-auth-request-user': 'victim@example.com' }),
      );

      expect(warnSpy.mock.calls[0][0]).toContain('mpass_id=-');
      expect(warnSpy.mock.calls[0][0]).not.toContain('victim@example.com');
    });

    it.each([
      ['empty', ''],
      ['shorter than 32 characters', 'short'],
      ['a CHANGE_ME_ placeholder', `CHANGE_ME_${'x'.repeat(40)}`],
    ])('trusts nothing when MPASS_EDGE_SECRET is %s', (_case, secret) => {
      const { service } = buildService({
        config: { MPASS_EDGE_SECRET: secret },
      });

      expect(
        service.readTrustedProxyHeaders(
          buildRequest({ ...FORGED_HEADERS, 'x-mpass-edge-secret': secret }),
        ),
      ).toEqual({});
    });

    it('stays silent for requests without identity headers', () => {
      const { service } = buildService();

      expect(service.readTrustedProxyHeaders(buildRequest({}))).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('findCorporateRejection', () => {
    it('neither reads nor verifies a token when SMB_CORPORATE_ID is unset', async () => {
      const { service, verify } = buildService();

      expect(
        await service.findCorporateRejection({ accessToken: 'token' }),
      ).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
    });

    it('refuses a missing token when the gate is on', async () => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
      });

      expect(await service.findCorporateRejection({})).toBe('missing_token');
    });

    it('passes the verifier reason through', async () => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
        verify: jest
          .fn()
          .mockRejectedValue(new InvalidMpassTokenError('bad_signature')),
      });

      expect(
        await service.findCorporateRejection({ accessToken: 'token' }),
      ).toBe('bad_signature');
    });

    it.each([
      [{ 'custom:is_corporate': 'false' }, 'not_corporate'],
      [
        { 'custom:is_corporate': 'true', 'custom:corporate_id': 'corp-2' },
        'wrong_organization',
      ],
      [
        { 'custom:is_corporate': 'true', 'custom:corporate_id': 'corp-1' },
        undefined,
      ],
    ])('checks verified claims %j', async (claims, expected) => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
        verify: jest.fn().mockResolvedValue(claims),
      });

      expect(
        await service.findCorporateRejection({ accessToken: 'token' }),
      ).toBe(expected);
    });
  });

  describe('findCorporateMismatch (signed-in requests)', () => {
    it('neither verifies nor refuses when the gate is off or no token is trusted', async () => {
      const off = buildService();
      const on = buildService({ config: { SMB_CORPORATE_ID: 'corp-1' } });

      expect(
        await off.service.findCorporateMismatch({ accessToken: 'token' }),
      ).toBeUndefined();
      expect(await on.service.findCorporateMismatch({})).toBeUndefined();
      expect(off.verify).not.toHaveBeenCalled();
      expect(on.verify).not.toHaveBeenCalled();
    });

    it('logs and lets the request through when verification fails', async () => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
        verify: jest
          .fn()
          .mockRejectedValue(new InvalidMpassTokenError('jwks_unavailable')),
      });

      expect(
        await service.findCorporateMismatch({ accessToken: 'raw.session.jwt' }),
      ).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('reason=jwks_unavailable'),
      );
      expect(warnSpy.mock.calls[0][0]).not.toContain('raw.session.jwt');
    });

    it.each([
      [{ 'custom:is_corporate': 'false' }, 'not_corporate'],
      [
        { 'custom:is_corporate': 'true', 'custom:corporate_id': 'corp-2' },
        'wrong_organization',
      ],
    ])('refuses verified claims %j', async (claims, expected) => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
        verify: jest.fn().mockResolvedValue(claims),
      });

      expect(
        await service.findCorporateMismatch({ accessToken: 'token' }),
      ).toBe(expected);
    });
  });

  describe('SMB_CORPORATE_ID handling', () => {
    it('refuses every proxy-login with placeholder_config for a CHANGE_ME_ value', async () => {
      const { service, verify } = buildService({
        config: { SMB_CORPORATE_ID: 'CHANGE_ME_SMB_CORPORATE_ID' },
        verify: jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'CHANGE_ME_SMB_CORPORATE_ID',
        }),
      });

      expect(await service.findCorporateRejection({})).toBe(
        'placeholder_config',
      );
      expect(
        await service.findCorporateRejection({ accessToken: 'token' }),
      ).toBe('placeholder_config');
      expect(verify).not.toHaveBeenCalled();
    });

    it('refuses signed-in requests carrying a token for a CHANGE_ME_ value', async () => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: ' CHANGE_ME_SMB_CORPORATE_ID ' },
      });

      expect(
        await service.findCorporateMismatch({ accessToken: 'token' }),
      ).toBe('placeholder_config');
      expect(await service.findCorporateMismatch({})).toBeUndefined();
    });

    it('treats a whitespace-only value as unset', async () => {
      const { service, verify } = buildService({
        config: { SMB_CORPORATE_ID: '   ' },
      });

      expect(await service.findCorporateRejection({})).toBeUndefined();
      expect(
        await service.findCorporateMismatch({ accessToken: 'token' }),
      ).toBeUndefined();
      expect(verify).not.toHaveBeenCalled();
    });

    it('trims the configured value before comparing', async () => {
      const { service } = buildService({
        config: { SMB_CORPORATE_ID: '  corp-1 ' },
        verify: jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'corp-1',
        }),
      });

      expect(
        await service.findCorporateRejection({ accessToken: 'token' }),
      ).toBeUndefined();
    });
  });

  describe('onModuleInit', () => {
    it('logs an error when the edge secret is unusable in SSO mode', () => {
      buildService({
        config: { MPASS_EDGE_SECRET: '' },
      }).service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('MPASS_EDGE_SECRET'),
      );
    });

    it('logs an error when the corporate gate is on without a configured verifier', () => {
      buildService({
        config: { SMB_CORPORATE_ID: 'corp-1' },
        isConfigured: false,
      }).service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('SMB_CORPORATE_ID'),
      );
    });

    it('logs an error for a CHANGE_ME_ corporate id', () => {
      buildService({
        config: { SMB_CORPORATE_ID: 'CHANGE_ME_SMB_CORPORATE_ID' },
      }).service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        'SMB_CORPORATE_ID is a CHANGE_ME_ placeholder: every mPass login is refused',
      );
    });

    it('stays silent outside SSO mode', () => {
      buildService({
        config: { AUTH_TYPE: '', MPASS_EDGE_SECRET: '' },
      }).service.onModuleInit();

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
