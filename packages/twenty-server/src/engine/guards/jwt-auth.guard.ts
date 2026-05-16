import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

import { type Request, type Response } from 'express';
import { isDefined } from 'twenty-shared/utils';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { bindDataToRequestObject } from 'src/engine/utils/bind-data-to-request-object.util';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

const TOKEN_PAIR_COOKIE_NAME = 'tokenPair';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceStorageCacheService: WorkspaceCacheStorageService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    try {
      const data =
        await this.accessTokenService.validateTokenByRequest(request);

      // SSO stale-session detection (proxy-auth-middleware Rule 2). When
      // oauth2-proxy asserts a different identity than what this JWT was
      // issued for, the tokenPair cookie that produced this Bearer is stale.
      //
      // Repro: portal "Logout all" clears the shared _oauth2_proxy cookie
      // and Cognito SSO but NOT Twenty's tokenPair cookie on its subdomain.
      // A different user then logs in upstream and refreshes the Twenty tab.
      // Without this check, validateTokenByRequest happily decodes the
      // stale Bearer and we serve the previous user.
      //
      // On mismatch: clear the tokenPair cookie BEFORE returning false so
      // the browser stops sending the stale Bearer. The frontend bootstrap
      // then has no tokenPair → routes through /auth/sso/proxy-login →
      // new tokens issued for the new upstream user.
      //
      // Gating:
      //   - AUTH_TYPE=SSO  — non-SSO deployments use Twenty's native auth,
      //                     no upstream identity to compare against
      //   - data.user      — only browser SSO sessions carry a User; API
      //                     keys, application contexts, and tokens without
      //                     a resolved user bypass this check unchanged
      if (
        this.twentyConfigService.get('AUTH_TYPE') === 'SSO' &&
        isDefined(data.user?.email) &&
        !this.matchesProxyIdentity(request, data.user.email)
      ) {
        this.clearTokenPairCookie(response);
        this.logger.warn(
          `Auth refused: proxy identity differs from JWT user; tokenPair cleared`,
        );

        return false;
      }

      const metadataVersion = data.workspace
        ? await this.workspaceStorageCacheService.getMetadataVersion(
            data.workspace.id,
          )
        : undefined;

      if (
        !isDefined(data.apiKey) &&
        !isDefined(data.userWorkspaceId) &&
        !isDefined(data.application)
      ) {
        this.logger.warn(
          `Auth failed: no apiKey, userWorkspaceId, or application in context`,
        );

        return false;
      }

      bindDataToRequestObject(data, request, metadataVersion);

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.warn(`Auth failed: ${errorMessage}`);

      return false;
    }
  }

  /**
   * Compare the proxy-asserted identity against the JWT user's email with
   * bidirectional normalisation. Mirrors SSO proxy-login resolution:
   * prefer `x-auth-request-email`, then fall back to `x-auth-request-user`.
   *
   * Returns true on match OR when both proxy headers are absent (per
   * proxy-auth-middleware spec: header absence is NOT a logout signal —
   * internal calls, OPTIONS preflight, and direct backend hits legitimately
   * arrive without it).
   */
  private matchesProxyIdentity(request: Request, jwtEmail: string): boolean {
    const headerRaw = this.resolveProxyIdentity(request);

    if (!headerRaw) {
      return true;
    }

    const normalizedProxyIdentity = this.normalizeProxyIdentity(headerRaw);

    if (!normalizedProxyIdentity) {
      return true;
    }

    return normalizedProxyIdentity === jwtEmail.toLowerCase();
  }

  private resolveProxyIdentity(request: Request): string | null {
    const proxyEmail = request.get('x-auth-request-email')?.trim();

    if (proxyEmail) {
      return proxyEmail;
    }

    const proxyUser = request.get('x-auth-request-user')?.trim();

    if (proxyUser) {
      return proxyUser;
    }

    return null;
  }

  /**
   * Normalise a raw proxy identity header value into the canonical email
   * used for user lookup, matching SSO proxy-login semantics.
   *
   * - Lowercased and whitespace-trimmed.
   * - Any value containing `@` is treated as an email as-is, matching
   *   SsoProxyLoginController.resolveEmail().
   * - If it doesn't contain `@` (e.g. oauth2-proxy is forwarding a bare
   *   Cognito username via user_id_claim=cognito:username), synthesise
   *   `<local>@${DEFAULT_EMAIL_DOMAIN}` so the resulting key matches the
   *   one Twenty's SSO proxy-login flow uses to provision the user.
   */
  private normalizeProxyIdentity(raw: string): string | null {
    const trimmed = raw.toLowerCase().trim();

    if (trimmed.includes('@')) {
      return trimmed;
    }

    const domain = this.twentyConfigService.get('DEFAULT_EMAIL_DOMAIN');

    if (!domain) {
      this.logger.warn(
        'Proxy identity contains a bare username but DEFAULT_EMAIL_DOMAIN is not configured.',
      );

      return null;
    }

    return `${trimmed}@${domain}`;
  }

  /**
   * Expire the tokenPair cookie. Defensive: in some test harnesses
   * `response.clearCookie` may not be wired up, so guard with a typeof
   * check before calling.
   */
  private clearTokenPairCookie(response: Response): void {
    if (typeof response?.clearCookie === 'function') {
      response.clearCookie(TOKEN_PAIR_COOKIE_NAME, { path: '/' });
    }
  }
}
