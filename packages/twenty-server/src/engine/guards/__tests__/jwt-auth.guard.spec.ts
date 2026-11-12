import { type ExecutionContext } from '@nestjs/common';
import { type ModuleRef } from '@nestjs/core';

import { type AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { type MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { InvalidMpassTokenError } from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { type MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { type TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserSessionCookieService } from 'src/engine/core-modules/user-session/services/user-session-cookie.service';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { type WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

type RequestStub = {
  get: jest.Mock;
  headers?: Record<string, string>;
  bypassesEdge?: boolean;
};

const EDGE_SECRET = 'g'.repeat(64);

type ResponseStub = {
  clearCookie: jest.Mock;
};

type ServiceStubs = {
  accessTokenService: AccessTokenService;
  workspaceCacheStorageService: WorkspaceCacheStorageService;
  twentyConfigService: TwentyConfigService;
  moduleRef: ModuleRef;
};

const buildExecutionContext = (
  request: RequestStub,
  response: ResponseStub,
): ExecutionContext => {
  // bind-data-to-request-object reads request.headers['x-locale'].
  // Inject an empty headers bag if the test didn't supply one — keeps
  // the per-test setup focused on the auth-flow inputs.
  if (!request.headers) {
    request.headers = {};
  }

  const readHeader = request.get.getMockImplementation() ?? (() => undefined);

  // Simulates Traefik's twenty-secure router unless the test calls Twenty
  // directly on the backend network.
  request.get.mockImplementation((header: string) =>
    header === 'x-mpass-edge-secret'
      ? request.bypassesEdge
        ? undefined
        : EDGE_SECRET
      : readHeader(header),
  );

  return {
    switchToHttp: jest.fn(() => ({
      getRequest: () => request,
      getResponse: () => ({ ...response, req: request }),
    })),
  } as unknown as ExecutionContext;
};

const buildServices = (
  authContext: Record<string, unknown>,
  config: Partial<Record<string, string>> = {},
  verify: jest.Mock = jest.fn(),
): ServiceStubs & { verify: jest.Mock } => {
  const values: Partial<Record<string, string>> = {
    MPASS_EDGE_SECRET: EDGE_SECRET,
    ...config,
  };
  const twentyConfigService = {
    get: jest.fn((key: string) => values[key] ?? ''),
  } as unknown as TwentyConfigService;
  const mpassProxyTrustService = new MpassProxyTrustService(
    twentyConfigService,
    { verify, isConfigured: true } as unknown as MpassTokenVerifier,
  );

  const userSessionCookieService = new UserSessionCookieService(
    twentyConfigService,
    { incrementCounterBy: jest.fn() } as unknown as MetricsService,
  );

  return {
    accessTokenService: {
      validateTokenByRequest: jest.fn().mockResolvedValue(authContext),
    } as unknown as AccessTokenService,
    workspaceCacheStorageService: {
      getMetadataVersion: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceCacheStorageService,
    twentyConfigService,
    moduleRef: {
      get: jest.fn((token: unknown) =>
        token === MpassProxyTrustService
          ? mpassProxyTrustService
          : userSessionCookieService,
      ),
    } as unknown as ModuleRef,
    verify,
  };
};

describe('JwtAuthGuard', () => {
  describe('SSO mode — proxy identity reconciliation', () => {
    it('passes through when proxy email matches JWT user email', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'alice@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
          workspace: { id: 'w-1' },
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('passes through when proxy header is absent (header absence is not a logout signal)', async () => {
      const request: RequestStub = {
        get: jest.fn(() => undefined),
        headers: {},
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('passes through when proxy header is whitespace only', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? '   ' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('falls back to X-Auth-Request-User when X-Auth-Request-Email is absent', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-user' ? 'alice@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('refuses and clears the session cookie when proxy email differs from JWT user', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'bob@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
      expect(response.clearCookie).toHaveBeenCalledWith(
        'twenty-session',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('treats case- and whitespace-variant proxy email as matching the JWT user', async () => {
      // Bidirectional normalisation guard. Header value comes through
      // normalised to lowercase + trimmed; JWT user email comes through
      // `.toLowerCase()`. Dropping normalisation on either side falsely
      // registers a mismatch on every case-variant request.
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email'
            ? '  ALICE@Example.COM  '
            : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('treats proxy identities containing @ as email-shaped even without a dot suffix', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'Alice@corp' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@corp' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO', DEFAULT_EMAIL_DOMAIN: 'askii.ai' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('refuses mismatched proxy identities containing @ even without a dot suffix', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'Alice@corp' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'bob@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO', DEFAULT_EMAIL_DOMAIN: 'askii.ai' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
      expect(response.clearCookie).toHaveBeenCalledWith(
        'twenty-session',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('prefers X-Auth-Request-Email over X-Auth-Request-User when both are present', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) => {
          if (header === 'x-auth-request-email') {
            return 'bob@example.com';
          }

          if (header === 'x-auth-request-user') {
            return 'alice@example.com';
          }

          return undefined;
        }),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
      expect(response.clearCookie).toHaveBeenCalledWith(
        'twenty-session',
        expect.objectContaining({ path: '/' }),
      );
    });

    it('synthesises bare username against DEFAULT_EMAIL_DOMAIN before comparing', async () => {
      // When the Cognito pool is configured with user_id_claim=cognito:username,
      // X-Auth-Request-Email carries a bare username (no @). The guard MUST
      // synthesise the same shape Twenty's SSO proxy-login uses to provision
      // the user — otherwise the match check spuriously fails on every
      // request even though the upstream identity hasn't changed.
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? '1020010000019120' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: '1020010000019120@askii.ai' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO', DEFAULT_EMAIL_DOMAIN: 'askii.ai' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('synthesises bare X-Auth-Request-User against DEFAULT_EMAIL_DOMAIN before comparing', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-user' ? '1020010000019120' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: '1020010000019120@askii.ai' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO', DEFAULT_EMAIL_DOMAIN: 'askii.ai' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('refuses and clears the session cookie when bare proxy identity arrives without DEFAULT_EMAIL_DOMAIN configured', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-user' ? 'bare_username' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
      expect(response.clearCookie).toHaveBeenCalledWith(
        'twenty-session',
        expect.objectContaining({ path: '/' }),
      );
    });
  });

  describe('Non-SSO bypass paths', () => {
    it('does not run the mismatch check when AUTH_TYPE is not SSO', async () => {
      // In non-SSO deployments the X-Auth-Request-* headers carry no
      // weight. Even with a mismatched header, the JWT is the source of
      // truth and the request must pass.
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'bob@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        // AUTH_TYPE intentionally unset
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('does not run the mismatch check for API-key auth (no user on context)', async () => {
      // API keys are programmatic identity. They don't carry a User
      // object on the auth context, so the proxy-identity comparison
      // is not applicable.
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'bob@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          apiKey: { id: 'k-1' },
          workspace: { id: 'w-1' },
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('does not run the mismatch check for application-context auth (no user)', async () => {
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'bob@example.com' : undefined,
        ),
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        {
          application: { id: 'app-1' },
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('Edge trust and corporate gate', () => {
    const buildGuard = (services: ServiceStubs) =>
      new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

    const headerReader =
      (headers: Record<string, string>) => (header: string) =>
        headers[header];

    it('ignores a forged mismatched identity sent without the edge secret', async () => {
      const request: RequestStub = {
        get: jest.fn(
          headerReader({ 'x-auth-request-email': 'mallory@example.com' }),
        ),
        bypassesEdge: true,
      };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices(
        { user: { email: 'alice@example.com' }, userWorkspaceId: 'uw-1' },
        { AUTH_TYPE: 'SSO' },
      );

      const result = await buildGuard(services).canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(true);
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('lets an API key through with a forged access token and the gate on', async () => {
      const request: RequestStub = {
        get: jest.fn(
          headerReader({ 'x-auth-request-access-token': 'forged.jwt' }),
        ),
        bypassesEdge: true,
      };
      const services = buildServices(
        { apiKey: { id: 'k-1' }, workspace: { id: 'w-1' } },
        { AUTH_TYPE: 'SSO', SMB_CORPORATE_ID: 'corp-1' },
      );

      const result = await buildGuard(services).canActivate(
        buildExecutionContext(request, { clearCookie: jest.fn() }),
      );

      expect(result).toBe(true);
      expect(services.verify).not.toHaveBeenCalled();
    });

    it('refuses an edge request whose token fails verification', async () => {
      const request: RequestStub = {
        get: jest.fn(
          headerReader({
            'x-auth-request-email': 'alice@example.com',
            'x-auth-request-access-token': 'tampered.jwt',
          }),
        ),
      };
      const services = buildServices(
        { user: { email: 'alice@example.com' }, userWorkspaceId: 'uw-1' },
        { AUTH_TYPE: 'SSO', SMB_CORPORATE_ID: 'corp-1' },
        jest
          .fn()
          .mockRejectedValue(new InvalidMpassTokenError('bad_signature')),
      );

      const result = await buildGuard(services).canActivate(
        buildExecutionContext(request, { clearCookie: jest.fn() }),
      );

      expect(result).toBe(false);
      expect(services.verify).toHaveBeenCalledWith('tampered.jwt');
    });

    it('accepts an edge request with a verified token of this organization', async () => {
      const request: RequestStub = {
        get: jest.fn(
          headerReader({
            'x-auth-request-email': 'alice@example.com',
            'x-auth-request-access-token': 'valid.jwt',
          }),
        ),
      };
      const services = buildServices(
        { user: { email: 'alice@example.com' }, userWorkspaceId: 'uw-1' },
        { AUTH_TYPE: 'SSO', SMB_CORPORATE_ID: 'corp-1' },
        jest.fn().mockResolvedValue({
          'custom:is_corporate': 'true',
          'custom:corporate_id': 'corp-1',
        }),
      );

      const result = await buildGuard(services).canActivate(
        buildExecutionContext(request, { clearCookie: jest.fn() }),
      );

      expect(result).toBe(true);
    });
  });

  describe('Failure mode hygiene', () => {
    it('refuses cleanly when response.clearCookie is unavailable', async () => {
      // Defensive: some test harnesses or pre-flight ExpressRouter slices
      // may not have clearCookie wired. The guard must still refuse the
      // request rather than throwing.
      const request: RequestStub = {
        get: jest.fn((header: string) =>
          header === 'x-auth-request-email' ? 'bob@example.com' : undefined,
        ),
      };
      const response = {} as ResponseStub;
      const services = buildServices(
        {
          user: { email: 'alice@example.com' },
          userWorkspaceId: 'uw-1',
        },
        { AUTH_TYPE: 'SSO' },
      );
      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
    });

    it('returns false when validateTokenByRequest throws', async () => {
      const request: RequestStub = { get: jest.fn(() => undefined) };
      const response: ResponseStub = { clearCookie: jest.fn() };
      const services = buildServices({}, { AUTH_TYPE: 'SSO' });

      (
        services.accessTokenService.validateTokenByRequest as jest.Mock
      ).mockRejectedValueOnce(new Error('Invalid token'));

      const guard = new JwtAuthGuard(
        services.accessTokenService,
        services.workspaceCacheStorageService,
        services.twentyConfigService,
        services.moduleRef,
      );

      const result = await guard.canActivate(
        buildExecutionContext(request, response),
      );

      expect(result).toBe(false);
    });
  });
});
