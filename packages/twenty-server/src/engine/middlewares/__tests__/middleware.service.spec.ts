import { type AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { type ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { type JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { MiddlewareService } from 'src/engine/middlewares/middleware.service';
import { type WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

type RequestStub = {
  get: jest.Mock;
  headers?: Record<string, string>;
};

type ResponseStub = {
  clearCookie: jest.Mock;
};

const buildRequest = (
  proxyHeaders: { email?: string; user?: string } = {},
): RequestStub => ({
  get: jest.fn((header: string) => {
    if (header === 'x-auth-request-email') return proxyHeaders.email;
    if (header === 'x-auth-request-user') return proxyHeaders.user;

    return undefined;
  }),
  headers: {},
});

const buildResponse = (): ResponseStub => ({ clearCookie: jest.fn() });

type BuildOpts = {
  authContext?: Record<string, unknown>;
  config?: Partial<Record<string, string>>;
  tokenPresent?: boolean;
};

const buildService = ({
  authContext = {
    user: { email: 'alice@example.com' },
    workspace: { id: 'w-1', databaseSchema: 'workspace_1' },
    userWorkspaceId: 'uw-1',
  },
  config = { AUTH_TYPE: 'SSO' },
  tokenPresent = true,
}: BuildOpts = {}) => {
  const accessTokenService = {
    validateTokenByRequest: jest.fn().mockResolvedValue(authContext),
  } as unknown as AccessTokenService;

  const workspaceCacheStorageService = {
    getMetadataVersion: jest.fn().mockResolvedValue(undefined),
  } as unknown as WorkspaceCacheStorageService;

  const flatEntityMapsCacheService =
    {} as WorkspaceManyOrAllFlatEntityMapsCacheService;

  const exceptionHandlerService = {} as ExceptionHandlerService;

  const jwtWrapperService = {
    extractJwtFromRequest: jest.fn(() => () => (tokenPresent ? 'token' : null)),
  } as unknown as JwtWrapperService;

  const twentyConfigService = {
    get: jest.fn((key: string) => config[key] ?? ''),
  } as unknown as TwentyConfigService;

  return {
    service: new MiddlewareService(
      accessTokenService,
      workspaceCacheStorageService,
      flatEntityMapsCacheService,
      exceptionHandlerService,
      jwtWrapperService,
      twentyConfigService,
    ),
    accessTokenService,
  };
};

describe('MiddlewareService — SSO proxy identity reconciliation', () => {
  describe('hydrateGraphqlRequest', () => {
    it('passes through when proxy email matches JWT user email', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: 'alice@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('throws AuthException and clears tokenPair when proxy email differs', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      expect(response.clearCookie).toHaveBeenCalledWith('tokenPair', {
        path: '/',
      });
    });

    it('passes through when proxy headers are absent (not a logout signal)', async () => {
      const { service } = buildService();
      const request = buildRequest();
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('skips identity check when AUTH_TYPE !== SSO', async () => {
      const { service } = buildService({ config: { AUTH_TYPE: 'PASSWORD' } });
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('skips identity check when JWT carries no user (API key / application context)', async () => {
      const { service } = buildService({
        authContext: {
          apiKey: { id: 'ak-1' },
          workspace: { id: 'w-1', databaseSchema: 'workspace_1' },
        },
      });
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('short-circuits when no token is present (sets locale, never validates)', async () => {
      const { service, accessTokenService } = buildService({
        tokenPresent: false,
      });
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await service.hydrateGraphqlRequest(request as never, response as never);

      expect(accessTokenService.validateTokenByRequest).not.toHaveBeenCalled();
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('falls back to x-auth-request-user when x-auth-request-email is absent', async () => {
      const { service } = buildService({
        config: { AUTH_TYPE: 'SSO', DEFAULT_EMAIL_DOMAIN: 'example.com' },
      });
      const request = buildRequest({ user: 'alice' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('fails closed when proxy sends bare username and DEFAULT_EMAIL_DOMAIN is missing', async () => {
      const { service } = buildService();
      const request = buildRequest({ user: 'alice' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      expect(response.clearCookie).toHaveBeenCalledWith('tokenPair', {
        path: '/',
      });
    });
  });

  describe('hydrateRestRequest', () => {
    it('passes through when proxy email matches JWT user email', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: 'alice@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateRestRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('throws AuthException and clears tokenPair when proxy email differs', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateRestRequest(request as never, response as never),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

      expect(response.clearCookie).toHaveBeenCalledWith('tokenPair', {
        path: '/',
      });
    });

    it('skips identity check when AUTH_TYPE !== SSO', async () => {
      const { service } = buildService({ config: { AUTH_TYPE: 'PASSWORD' } });
      const request = buildRequest({ email: 'mallory@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateRestRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('tolerates missing response object (defensive — older callers)', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: 'mallory@example.com' });

      await expect(
        service.hydrateRestRequest(request as never, undefined as never),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });
  });

  describe('case- and whitespace-variant proxy emails match the JWT user', () => {
    // Regression guard for the bidirectional-normalisation requirement in
    // openspec/specs/proxy-auth-middleware/spec.md "Match is case- and
    // whitespace-insensitive". oauth2-proxy may forward a header value
    // with different case or surrounding whitespace than the canonical
    // lowercase user.email stored at provisioning time. If either side
    // drops `.toLowerCase().trim()`, every case-variant header silently
    // kicks the cookie-authed request back to ForwardAuth on every
    // request. Tests both directions so neither side can regress.

    it('matches when proxy header is uppercased + whitespace-padded', async () => {
      const { service } = buildService();
      const request = buildRequest({ email: '  ALICE@EXAMPLE.COM  ' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('matches when JWT email has padding the header does not', async () => {
      // Legacy DB row with trailing whitespace; canonical proxy header.
      const { service } = buildService({
        authContext: {
          user: { email: '  alice@example.com  ' },
          workspace: { id: 'w-1', databaseSchema: 'workspace_1' },
          userWorkspaceId: 'uw-1',
        },
      });
      const request = buildRequest({ email: 'alice@example.com' });
      const response = buildResponse();

      await expect(
        service.hydrateGraphqlRequest(request as never, response as never),
      ).resolves.toBeUndefined();

      expect(response.clearCookie).not.toHaveBeenCalled();
    });
  });
});
