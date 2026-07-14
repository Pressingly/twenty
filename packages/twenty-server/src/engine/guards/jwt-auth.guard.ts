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
import {
  CorporateIdError,
  assertCorporateId,
  clearTokenPairCookie,
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
        !matchesProxyIdentity(
          request,
          data.user.email,
          this.twentyConfigService,
        )
      ) {
        clearTokenPairCookie(response);
        this.logger.warn(
          `Auth refused: proxy identity differs from JWT user; tokenPair cleared`,
        );

        return false;
      }

      // Layer 2 corporate ID enforcement — when SMB_CORPORATE_ID is set
      // and AUTH_TYPE=SSO, verify the access token's custom:corporate_id.
      if (this.twentyConfigService.get('AUTH_TYPE') === 'SSO') {
        try {
          assertCorporateId(request, this.twentyConfigService);
        } catch (error) {
          if (error instanceof CorporateIdError) {
            this.logger.warn(`Auth refused: ${error.message}`);

            return false;
          }

          throw error;
        }
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
}
