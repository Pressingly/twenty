import { NotFoundException } from '@nestjs/common';

import { SsoProxyLoginController } from 'src/engine/core-modules/auth/controllers/sso-proxy-login.controller';

type ConfigKey =
  | 'IS_SSO_ENABLED'
  | 'DEFAULT_EMAIL_DOMAIN'
  | 'ACCESS_TOKEN_EXPIRES_IN';

const buildController = (
  configOverrides?: Partial<Record<ConfigKey, unknown>>,
) => {
  const config: Record<ConfigKey, unknown> = {
    IS_SSO_ENABLED: true,
    DEFAULT_EMAIL_DOMAIN: 'askii.ai',
    ACCESS_TOKEN_EXPIRES_IN: '30m',
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
  const accessTokenService = {
    generateAccessToken: jest.fn().mockResolvedValue({
      token: 'access-jwt',
      expiresAt: new Date('2026-04-29T00:00:00Z'),
    }),
  };
  const refreshTokenService = {
    generateRefreshToken: jest.fn().mockResolvedValue({
      token: 'refresh-jwt',
      expiresAt: new Date('2026-06-29T00:00:00Z'),
    }),
  };

  const controller = new SsoProxyLoginController(
    twentyConfigService as any,
    ssoUserProvisioningService as any,
    accessTokenService as any,
    refreshTokenService as any,
  );

  const res: any = {
    cookie: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };

  return {
    controller,
    twentyConfigService,
    ssoUserProvisioningService,
    accessTokenService,
    refreshTokenService,
    res,
  };
};

describe('SsoProxyLoginController', () => {
  it('should 404 when IS_SSO_ENABLED is false', async () => {
    const { controller, res } = buildController({ IS_SSO_ENABLED: false });

    await expect(
      controller.proxyLogin({ headers: {} } as any, res),
    ).rejects.toThrow(NotFoundException);
  });

  it('should 401 when both identity headers are missing', async () => {
    const { controller, res } = buildController();

    await controller.proxyLogin({ headers: {} } as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Missing SSO identity headers' }),
    );
  });

  it('should provision user from X-Auth-Request-Email and redirect', async () => {
    const { controller, ssoUserProvisioningService, res } = buildController();

    await controller.proxyLogin(
      {
        headers: { 'x-auth-request-email': 'someone@askii.ai' },
      } as any,
      res,
    );

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'someone@askii.ai',
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'tokenPair',
      expect.stringContaining('access-jwt'),
      expect.objectContaining({
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: false,
      }),
    );
    expect(res.redirect).toHaveBeenCalledWith(302, '/');
  });

  it('should synthesize email when X-Auth-Request-User has no @-sign', async () => {
    const { controller, ssoUserProvisioningService, res } = buildController();

    await controller.proxyLogin(
      {
        headers: { 'x-auth-request-user': 'BARE_USERNAME' },
      } as any,
      res,
    );

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'bare_username@askii.ai',
    );
  });

  it('should prefer X-Auth-Request-Email over X-Auth-Request-User when both present', async () => {
    const { controller, ssoUserProvisioningService, res } = buildController();

    await controller.proxyLogin(
      {
        headers: {
          'x-auth-request-email': 'real@askii.ai',
          'x-auth-request-user': 'fallback',
        },
      } as any,
      res,
    );

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'real@askii.ai',
    );
  });

  it('should use the first value when X-Auth-Request-Email is array-valued', async () => {
    const { controller, ssoUserProvisioningService, res } = buildController();

    await controller.proxyLogin(
      {
        headers: {
          'x-auth-request-email': ['first@askii.ai', 'second@askii.ai'],
        },
      } as any,
      res,
    );

    expect(ssoUserProvisioningService.findOrProvision).toHaveBeenCalledWith(
      'first@askii.ai',
    );
  });

  it('should set tokenPair cookie maxAge from ACCESS_TOKEN_EXPIRES_IN', async () => {
    const { controller, res } = buildController({
      ACCESS_TOKEN_EXPIRES_IN: '15m',
    });

    await controller.proxyLogin(
      { headers: { 'x-auth-request-email': 'someone@askii.ai' } } as any,
      res,
    );

    expect(res.cookie).toHaveBeenCalledWith(
      'tokenPair',
      expect.any(String),
      expect.objectContaining({ maxAge: 15 * 60 * 1000 }),
    );
  });

  it('should pass authProvider=SSO when issuing tokens', async () => {
    const { controller, accessTokenService, refreshTokenService, res } =
      buildController();

    await controller.proxyLogin(
      {
        headers: { 'x-auth-request-email': 'someone@askii.ai' },
      } as any,
      res,
    );

    expect(accessTokenService.generateAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        authProvider: 'sso',
      }),
    );
    expect(refreshTokenService.generateRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        authProvider: 'sso',
      }),
    );
  });
});
