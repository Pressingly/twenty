import { NotFoundException } from '@nestjs/common';

import { SsoProxyLoginController } from 'src/engine/core-modules/auth/controllers/sso-proxy-login.controller';

type ConfigKey = 'AUTH_TYPE' | 'DEFAULT_EMAIL_DOMAIN' | 'SMB_CORPORATE_ID';

type Headers = string | string[] | undefined;

const buildController = (
  configOverrides?: Partial<Record<ConfigKey, unknown>>,
) => {
  const config: Record<ConfigKey, unknown> = {
    AUTH_TYPE: 'SSO',
    DEFAULT_EMAIL_DOMAIN: 'askii.ai',
    SMB_CORPORATE_ID: '',
    ...configOverrides,
  };

  const twentyConfigService = {
    get: jest.fn((key: ConfigKey) => config[key]),
  };
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

  const controller = new SsoProxyLoginController(
    twentyConfigService as any,
    ssoUserProvisioningService as any,
    loginTokenService as any,
  );

  const res: any = {
    cookie: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  const proxyLogin = (
    headerEmail: Headers = undefined,
    headerUser: Headers = undefined,
    query: Record<string, unknown> = {},
  ) => {
    const req: any = { query, get: jest.fn(() => undefined) };

    return controller.proxyLogin(req, headerEmail, headerUser, res);
  };

  return {
    controller,
    twentyConfigService,
    ssoUserProvisioningService,
    loginTokenService,
    res,
    proxyLogin,
  };
};

describe('SsoProxyLoginController', () => {
  it('should 404 when AUTH_TYPE is not "SSO"', async () => {
    const { proxyLogin } = buildController({ AUTH_TYPE: '' });

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  it('should 404 when AUTH_TYPE is some other non-SSO value', async () => {
    const { proxyLogin } = buildController({ AUTH_TYPE: 'PASSWORD' });

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  it('should 404 (opaque) when both identity headers are missing', async () => {
    const { proxyLogin } = buildController();

    await expect(proxyLogin()).rejects.toThrow(NotFoundException);
  });

  it('should 404 when X-Auth-Request-Email is an empty-string array', async () => {
    const { proxyLogin } = buildController();

    await expect(proxyLogin([''], undefined)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should provision user from X-Auth-Request-Email and redirect to /verify with a login token', async () => {
    const { ssoUserProvisioningService, res, proxyLogin } = buildController();

    await proxyLogin('someone@askii.ai');

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

    await proxyLogin('someone@askii.ai', undefined, {
      returnToPath: '/authorize?clientId=abc',
    });

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      `/verify?loginToken=login-jwt&returnToPath=${encodeURIComponent('/authorize?clientId=abc')}`,
    );
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash', '/\\evil.com'],
    ['sign-in page', '/welcome'],
    ['mixed-case sign-in page', '/Welcome?x=1'],
    ['percent-encoded sign-in page', '/%77elcome'],
  ])('should drop a %s returnToPath', async (_label, returnToPath) => {
    const { res, proxyLogin } = buildController();

    await proxyLogin('someone@askii.ai', undefined, { returnToPath });

    expect(res.redirect).toHaveBeenCalledWith(
      302,
      '/verify?loginToken=login-jwt',
    );
  });

  it('should synthesize email when X-Auth-Request-User has no @-sign', async () => {
    const { ssoUserProvisioningService, proxyLogin } = buildController();

    await proxyLogin(undefined, 'BARE_USERNAME');

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'bare_username@askii.ai',
    );
  });

  it('should prefer X-Auth-Request-Email over X-Auth-Request-User when both present', async () => {
    const { ssoUserProvisioningService, proxyLogin } = buildController();

    await proxyLogin('real@askii.ai', 'fallback');

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'real@askii.ai',
    );
  });

  it('should use the first value when X-Auth-Request-Email is array-valued', async () => {
    const { ssoUserProvisioningService, proxyLogin } = buildController();

    await proxyLogin(['first@askii.ai', 'second@askii.ai']);

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'first@askii.ai',
    );
  });

  it('should 404 when bare username arrives without DEFAULT_EMAIL_DOMAIN configured', async () => {
    const { proxyLogin } = buildController({ DEFAULT_EMAIL_DOMAIN: '' });

    await expect(proxyLogin(undefined, 'lone_username')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should issue the login token for the provisioned user with authProvider=SSO', async () => {
    const { loginTokenService, proxyLogin } = buildController();

    await proxyLogin('someone@askii.ai');

    expect(loginTokenService.generateLoginToken).toHaveBeenCalledWith(
      'user@askii.ai',
      'workspace-1',
      'sso',
    );
  });
});
