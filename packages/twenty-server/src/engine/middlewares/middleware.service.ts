import { Injectable } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { type Request, type Response } from 'express';
import { type APP_LOCALES, SOURCE_LOCALE } from 'twenty-shared/translations';
import { isDefined } from 'twenty-shared/utils';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { getAuthExceptionRestStatus } from 'src/engine/core-modules/auth/utils/get-auth-exception-rest-status.util';
import { ExceptionHandlerService } from 'src/engine/core-modules/exception-handler/exception-handler.service';
import { ErrorCode } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';
import { INTERNAL_SERVER_ERROR } from 'src/engine/middlewares/constants/default-error-message.constant';
import { bindDataToRequestObject } from 'src/engine/utils/bind-data-to-request-object.util';
import {
  handleException,
  handleExceptionAndConvertToGraphQLError,
} from 'src/engine/utils/global-exception-handler.util';
import {
  CorporateIdError,
  assertCorporateId,
  clearTokenPairCookie,
  matchesProxyIdentity,
} from 'src/engine/utils/proxy-identity.util';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { type CustomException } from 'src/utils/custom-exception';

@Injectable()
export class MiddlewareService {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceStorageCacheService: WorkspaceCacheStorageService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
    private readonly exceptionHandlerService: ExceptionHandlerService,
    private readonly jwtWrapperService: JwtWrapperService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  public isTokenPresent(request: Request): boolean {
    const token = this.jwtWrapperService.extractJwtFromRequest()(request);

    return !!token;
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  public writeRestResponseOnExceptionCaught(res: Response, error: any) {
    const statusCode = this.getStatus(error);

    // capture and handle custom exceptions
    handleException({
      exception: error as CustomException,
      exceptionHandlerService: this.exceptionHandlerService,
      statusCode,
    });

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.write(
      JSON.stringify({
        statusCode,
        messages: [error?.message || INTERNAL_SERVER_ERROR],
        error: error?.code || ErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );

    res.end();
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  public writeGraphqlResponseOnExceptionCaught(res: Response, error: any) {
    let errors;

    if (error instanceof AuthException) {
      try {
        const authFilter = new AuthGraphqlApiExceptionFilter();

        authFilter.catch(error);
      } catch (transformedError) {
        errors = [transformedError];
      }
    } else {
      errors = [
        handleExceptionAndConvertToGraphQLError(
          error as Error,
          this.exceptionHandlerService,
        ),
      ];
    }

    const statusCode = 200;

    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
    });

    res.write(
      JSON.stringify({
        errors,
      }),
    );

    res.end();
  }

  public async hydrateRestRequest(request: Request, response?: Response) {
    const data = await this.accessTokenService.validateTokenByRequest(request);

    this.assertProxyIdentityMatchesUser(request, response, data.user?.email);
    this.assertCorporateIdMatches(request);

    const metadataVersion = data.workspace
      ? await this.workspaceStorageCacheService.getMetadataVersion(
          data.workspace.id,
        )
      : undefined;

    if (!data.workspace) {
      throw new Error('No data sources found');
    }

    if (!isNonEmptyString(data.workspace.databaseSchema)) {
      throw new Error('No data sources found');
    }

    bindDataToRequestObject(data, request, metadataVersion);
  }

  public async hydrateGraphqlRequest(request: Request, response?: Response) {
    if (!this.isTokenPresent(request)) {
      request.locale =
        (request.headers['x-locale'] as keyof typeof APP_LOCALES) ??
        SOURCE_LOCALE;

      return;
    }

    const data = await this.accessTokenService.validateTokenByRequest(request);

    this.assertProxyIdentityMatchesUser(request, response, data.user?.email);
    this.assertCorporateIdMatches(request);

    const metadataVersion = data.workspace
      ? await this.workspaceStorageCacheService.getMetadataVersion(
          data.workspace.id,
        )
      : undefined;

    bindDataToRequestObject(data, request, metadataVersion);
  }

  /**
   * SSO stale-session detection for the GraphQL and REST data API paths.
   * Mirrors the JwtAuthGuard check applied to the REST controller path. When
   * oauth2-proxy asserts a different identity than what the JWT was issued
   * for, clear the tokenPair cookie and refuse — the browser then has no
   * tokenPair on the next request, so the SPA bootstrap hits
   * /auth/sso/proxy-login and gets a fresh tokenPair for the new identity.
   *
   * Gating:
   *   - AUTH_TYPE=SSO       — non-SSO deployments use Twenty's native auth
   *   - jwtEmail isDefined  — only browser SSO sessions carry a User
   */
  private assertProxyIdentityMatchesUser(
    request: Request,
    response: Response | undefined,
    jwtEmail: string | undefined,
  ): void {
    if (this.twentyConfigService.get('AUTH_TYPE') !== 'SSO') {
      return;
    }

    if (!isDefined(jwtEmail)) {
      return;
    }

    if (matchesProxyIdentity(request, jwtEmail, this.twentyConfigService)) {
      return;
    }

    clearTokenPairCookie(response);

    throw new AuthException(
      'Proxy identity differs from JWT user; tokenPair cleared',
      AuthExceptionCode.UNAUTHENTICATED,
    );
  }

  // Layer 2 corporate ID enforcement. When SMB_CORPORATE_ID is set,
  // every authenticated request must carry an access token with matching
  // custom:corporate_id. Gated on AUTH_TYPE=SSO so non-SSO deployments
  // are unaffected.
  private assertCorporateIdMatches(request: Request): void {
    if (this.twentyConfigService.get('AUTH_TYPE') !== 'SSO') {
      return;
    }

    try {
      assertCorporateId(request, this.twentyConfigService);
    } catch (error) {
      if (error instanceof CorporateIdError) {
        throw new AuthException(
          error.message,
          AuthExceptionCode.FORBIDDEN_EXCEPTION,
        );
      }

      throw error;
    }
  }

  private hasErrorStatus(error: unknown): error is { status: number } {
    return isDefined((error as { status: number })?.status);
  }

  // oxlint-disable-next-line @typescripttypescript/no-explicit-any
  private getStatus(error: any): number {
    if (this.hasErrorStatus(error)) {
      return error.status;
    }

    if (error instanceof AuthException) {
      return getAuthExceptionRestStatus(error);
    }

    return 500;
  }
}
