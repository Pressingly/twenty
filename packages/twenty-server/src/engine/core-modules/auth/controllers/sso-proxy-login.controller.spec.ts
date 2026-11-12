import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { SsoProxyLoginController } from 'src/engine/core-modules/auth/controllers/sso-proxy-login.controller';
import { InvalidMpassTokenError } from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { type MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const EDGE_SECRET = 's'.repeat(64);

type ConfigKey =
  | 'AUTH_TYPE'
  | 'DEFAULT_EMAIL_DOMAIN'
  | 'SMB_CORPORATE_ID'
  | 'MPASS_EDGE_SECRET';

type ProxyHeaders = {
  email?: string;
  user?: string;
  accessToken?: string;
  edgeSecret?: string;
};

const buildController = (
  configOverrides?: Partial<Record<ConfigKey, unknown>>,
  verify: jest.Mock = jest.fn(),
) => {
  const config: Record<ConfigKey, unknown> = {
    AUTH_TYPE: 'SSO',
    DEFAULT_EMAIL_DOMAIN: 'askii.ai',
    SMB_CORPORATE_ID: '',
    MPASS_EDGE_SECRET: EDGE_SECRET,
    ...configOverrides,
  };

  const twentyConfigService = {
    get: jest.fn((key: ConfigKey) => config[key]),
  } as unknown as TwentyConfigService;
  const ssoUserProvisioningService = {
    findOrProvision: jest.fn().mockResolvedValue({
      user: { id: 'user-1', email: 'user@askii.ai' },
      workspace: { id: 'workspace-1', subdomain: 'askii' },
    }),
  };
  const loginTokenService = {
    generateLoginToken: jest.fn().mockResolvedValue({
      token: 'login-jwt',
      expiresAt: new Date('2026-04-29T00:00:00Z'),
    }),
  };
  const mpassProxyTrustService = new MpassProxyTrustService(
    twentyConfigService,
    { verify, isConfigured: true } as unknown as MpassTokenVerifier,
  );

  const controller = new SsoProxyLoginController(
    twentyConfigService,
    ssoUserProvisioningService as any,
    loginTokenService as any,
    mpassProxyTrustService,
  );

  const res: any = {
    cookie: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  const proxyLogin = (
    { edgeSecret = EDGE_SECRET, ...proxyHeaders }: ProxyHeaders = {},
    query: Record<string, unknown> = {},
  ) => {
    const headers: Record<string, string | undefined> = {
      'x-auth-request-email': proxyHeaders.email,
      'x-auth-request-user': proxyHeaders.user,
      'x-auth-request-access-token': proxyHeaders.accessToken,
      'x-mpass-edge-secret': edgeSecret,
    };
    const req: any = {
      query,
      path: '/auth/sso/proxy-login',
      socket: { remoteAddress: '172.18.0.5' },
      get: jest.fn((name: string) => headers[name.toLowerCase()]),
    };

    return controller.proxyLogin(req, res);
  };

  return {
    controller,
    twentyConfigService,
    ssoUserProvisioningService,
    loginTokenService,
    verify,
    res,
    proxyLogin,
  };
};

describe('SsoProxyLoginController', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('should 404 when AUTH_TYPE is not "SSO"', async () => {
    const { proxyLogin } = buildController({ AUTH_TYPE: '' });

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  it('should 404 when AUTH_TYPE is some other non-SSO value', async () => {
    const { proxyLogin } = buildController({ AUTH_TYPE: 'PASSWORD' });

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  describe('edge trust', () => {
    it.each([
      ['without the edge secret', ''],
      ['with a wrong edge secret', 'w'.repeat(64)],
    ])(
      'should 404 a forged identity %s and provision nobody',
      async (_case, edgeSecret) => {
        const { proxyLogin, ssoUserProvisioningService } = buildController();

        await expect(
          proxyLogin({ email: 'victim@askii.ai', edgeSecret }),
        ).rejects.toThrow(NotFoundException);
        expect(
          ssoUserProvisioningService.findOrProvision,
        ).not.toHaveBeenCalled();
      },
    );

    it('should 404 even a matching header when MPASS_EDGE_SECRET is too short', async () => {
      const { proxyLogin, ssoUserProvisioningService } = buildController({
        MPASS_EDGE_SECRET: 'short',
      });

      await expect(
        proxyLogin({ email: 'victim@askii.ai', edgeSecret: 'short' }),
      ).rejects.toThrow(NotFoundException);
      expect(ssoUserProvisioningService.findOrProvision).not.toHaveBeenCalled();
    });

    it('should 404, not 403, a direct call when the corporate gate is on', async () => {
      const { proxyLogin } = buildController({ SMB_CORPORATE_ID: 'corp-1' });

      await expect(
        proxyLogin({ email: 'victim@askii.ai', edgeSecret: '' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('corporate gate', () => {
    it('should not verify any token when SMB_CORPORATE_ID is unset', async () => {
      const { proxyLogin, verify, res } = buildController();

      await proxyLogin({ email: 'someone@askii.ai', accessToken: 'token' });

      expect(verify).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalled();
    });

    it('should 403 an edge request without an access token', async () => {
      const { proxyLogin } = buildController({ SMB_CORPORATE_ID: 'corp-1' });

      await expect(proxyLogin({ email: 'someone@askii.ai' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should 403 when the token fails verification', async () => {
      const { proxyLogin, ssoUserProvisioningService } = buildController(
        { SMB_CORPORATE_ID: 'corp-1' },
        jest
          .fn()
          .mockRejectedValue(new InvalidMpassTokenError('bad_signature')),
      );

      await expect(
        proxyLogin({ email: 'someone@askii.ai', accessToken: 'token' }),
      ).rejects.toThrow(ForbiddenException);
      expect(ssoUserProvisioningService.findOrProvision).not.toHaveBeenCalled();
    });

    it('should 403 a verified token from another organization', async () => {
      const { proxyLogin } = buildController(
        { SMB_CORPORATE_ID: 'corp-1' },
        jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'corp-2',
        }),
      );

      await expect(
        proxyLogin({ email: 'someone@askii.ai', accessToken: 'token' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should 403 every login when SMB_CORPORATE_ID is a CHANGE_ME_ placeholder', async () => {
      const { proxyLogin, ssoUserProvisioningService } = buildController(
        { SMB_CORPORATE_ID: 'CHANGE_ME_SMB_CORPORATE_ID' },
        jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'CHANGE_ME_SMB_CORPORATE_ID',
        }),
      );

      await expect(
        proxyLogin({ email: 'someone@askii.ai', accessToken: 'token' }),
      ).rejects.toThrow(ForbiddenException);
      expect(ssoUserProvisioningService.findOrProvision).not.toHaveBeenCalled();
    });

    it('should log in with a verified token of this organization', async () => {
      const { proxyLogin, verify, res } = buildController(
        { SMB_CORPORATE_ID: 'corp-1' },
        jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'corp-1',
        }),
      );

      await proxyLogin({ email: 'someone@askii.ai', accessToken: 'token' });

      expect(verify).toHaveBeenCalledWith('token');
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        '/verify?loginToken=login-jwt',
      );
    });
  });

  it('should 404 (opaque) when both identity headers are missing', async () => {
    const { proxyLogin } = buildController();

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  it('should provision user from X-Auth-Request-Email and redirect to /verify with a login token', async () => {
    const { ssoUserProvisioningService, res, proxyLogin } = buildController();

    await proxyLogin({ email: 'someone@askii.ai' });

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'someone@askii.ai',
    );
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      '/verify?loginToken=login-jwt',
    );
  });

  it('should carry a same-origin returnToPath through to /verify', async () => {
    const { res, proxyLogin } = buildController();

    await proxyLogin(
      { email: 'someone@askii.ai' },
      {
        returnToPath: '/authorize?clientId=abc',
      },
    );

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `/verify?loginToken=login-jwt&returnToPath=${encodeURIComponent('/authorize?clientId=abc')}`,
    );
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash', '/\\evil.com'],
    ['tab-smuggled', '/\t/evil.com'],
    ['newline-smuggled', '/\n/evil.com'],
    ['root', '/'],
    ['sign-in page', '/welcome'],
    ['mixed-case sign-in page', '/Welcome?x=1'],
    ['percent-encoded sign-in page', '/%77elcome'],
  ])('should drop a %s returnToPath', async (_label, returnToPath) => {
    const { res, proxyLogin } = buildController();

    await proxyLogin({ email: 'someone@askii.ai' }, { returnToPath });

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      '/verify?loginToken=login-jwt',
    );
  });

  it('should synthesize email when X-Auth-Request-User has no @-sign', async () => {
    const { ssoUserProvisioningService, proxyLogin } = buildController();

    await proxyLogin({ user: 'BARE_USERNAME' });

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'bare_username@askii.ai',
    );
  });

  it('should prefer X-Auth-Request-Email over X-Auth-Request-User when both present', async () => {
    const { ssoUserProvisioningService, proxyLogin } = buildController();

    await proxyLogin({ email: 'real@askii.ai', user: 'fallback' });

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'real@askii.ai',
    );
  });

  it('should 404 when bare username arrives without DEFAULT_EMAIL_DOMAIN configured', async () => {
    const { proxyLogin } = buildController({ DEFAULT_EMAIL_DOMAIN: '' });

    await expect(proxyLogin({ user: 'lone_username' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should issue the login token for the provisioned user with authProvider=SSO', async () => {
    const { loginTokenService, proxyLogin } = buildController();

    await proxyLogin({ email: 'someone@askii.ai' });

    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'user@askii.ai',
      'workspace-1',
      'sso',
    );
  });
});
