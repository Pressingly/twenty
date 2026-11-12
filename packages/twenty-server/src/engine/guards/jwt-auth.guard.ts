import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { type Request, type Response } from 'express';
import { isDefined } from 'twenty-shared/utils';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserSessionCookieService } from 'src/engine/core-modules/user-session/services/user-session-cookie.service';
import { bindDataToRequestObject } from 'src/engine/utils/bind-data-to-request-object.util';
import {
  clearSessionCookie,
  matchesProxyIdentity,
} from 'src/engine/utils/proxy-identity.util';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceStorageCacheService: WorkspaceCacheStorageService,
    private readonly twentyConfigService: TwentyConfigService,
    // Resolved app-wide: JwtAuthGuard runs in modules that never import UserSessionModule
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    try {
      const data =
        await this.accessTokenService.validateTokenByRequest(request);

      if (
        this.twentyConfigService.get('AUTH_TYPE') === 'SSO' &&
        !this.isTrustedProxyIdentityAccepted(
          request,
          response,
          data.user?.email,
        )
      ) {
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

  // A stale session (portal "Logout all" then a different upstream user) is
  // refused and its cookie cleared so the SPA re-enters proxy-login, which is
  // where the SMB corporate gate runs.
  private isTrustedProxyIdentityAccepted(
    request: Request,
    response: Response,
    jwtEmail: string | undefined,
  ): boolean {
    const trustedHeaders = this.moduleRef
      .get(MpassProxyTrustService, { strict: false })
      .readTrustedProxyHeaders(request);

    if (
      !isDefined(jwtEmail) ||
      matchesProxyIdentity(trustedHeaders, jwtEmail, this.twentyConfigService)
    ) {
      return true;
    }

    clearSessionCookie(
      response,
      this.moduleRef.get(UserSessionCookieService, { strict: false }),
    );
    this.logger.warn(
      'Auth refused: proxy identity differs from JWT user; session cookie cleared',
    );

    return false;
  }
}
