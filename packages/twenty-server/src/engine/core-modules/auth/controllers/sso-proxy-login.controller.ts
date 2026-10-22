import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpStatus,
  Logger,
  NotFoundException,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { type Request, Response } from 'express';
import { AppPath } from 'twenty-shared/types';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { SsoUserProvisioningService } from 'src/engine/core-modules/auth/services/sso-user-provisioning.service';
import { resolveSsoReturnPath } from 'src/engine/core-modules/auth/utils/resolve-sso-return-path.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import {
  CorporateIdError,
  assertCorporateId,
} from 'src/engine/utils/proxy-identity.util';

const ROOT_PATH = '/';

@Controller('auth/sso')
@UseFilters(AuthRestApiExceptionFilter)
export class SsoProxyLoginController {
  private readonly logger = new Logger(SsoProxyLoginController.name);

  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly ssoUserProvisioningService: SsoUserProvisioningService,
    private readonly loginTokenService: LoginTokenService,
  ) {}

  // SECURITY — the trust chain for X-Auth-Request-Email / X-Auth-Request-User:
  //   1. The Twenty container exposes :3000 only on the docker network — it
  //      is not published to the host. Only Traefik can reach it from
  //      outside the cluster.
  //   2. Traefik's `twenty-secure` router applies the `strip-auth-headers`
  //      middleware BEFORE `mpass-auth`. Inbound `X-Auth-Request-*` headers
  //      from a browser are deleted at the edge.
  //   3. `mpass-auth` (oauth2-proxy ForwardAuth) re-injects the headers
  //      from the validated SSO session.
  // Removing any link of this chain — exposing :3000, dropping
  // `strip-auth-headers`, or reordering the middleware — makes this endpoint
  // an authentication-bypass primitive. Every change to the Traefik labels
  // for `twenty-secure` MUST preserve this ordering. See
  // foss-server-bundle-devstack/docs/app-rules.md.
  @Get('proxy-login')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async proxyLogin(
    @Req() req: Request,
    @Headers('x-auth-request-email') headerEmail: string | string[] | undefined,
    @Headers('x-auth-request-user') headerUser: string | string[] | undefined,
    @Res() res: Response,
  ) {
    if (this.twentyConfigService.get('AUTH_TYPE') !== 'SSO') {
      throw new NotFoundException();
    }

    // Layer 2 corporate ID enforcement — reject at login time if the
    // access token's corporate_id does not match this deployment.
    // Unlike middleware/guard paths, proxy-login is always behind
    // Traefik ForwardAuth, so a missing header with enforcement on
    // is suspicious and must be rejected.
    const expectedCorporateId =
      this.twentyConfigService.get('SMB_CORPORATE_ID');

    if (expectedCorporateId && !req.get('x-auth-request-access-token')) {
      this.logger.warn('SSO proxy-login refused: missing access token header');

      throw new ForbiddenException({ error: 'access_denied' });
    }

    try {
      assertCorporateId(req, this.twentyConfigService);
    } catch (error) {
      if (error instanceof CorporateIdError) {
        this.logger.warn(`SSO proxy-login refused: ${error.message}`);

        throw new ForbiddenException({ error: 'access_denied' });
      }

      throw error;
    }

    const email = this.resolveEmail(headerEmail, headerUser);

    if (!email) {
      // Opaque 404 — same response shape as the AUTH_TYPE!==SSO branch.
      // A diagnostic 401 would tell an internal-network attacker they hit
      // a real SSO endpoint and just need to forge a header next.
      this.logger.warn(
        'SSO proxy-login called without X-Auth-Request-Email or X-Auth-Request-User headers.',
      );
      throw new NotFoundException();
    }

    const { user, workspace } =
      await this.ssoUserProvisioningService.findOrProvision(email);

    const loginToken = await this.loginTokenService.generateLoginToken(
      user.email,
      workspace.id,
      AuthProviderEnum.SSO,
    );

    // The SPA's /verify page swaps the login token for the httpOnly session
    // cookie and marks the session active, the same hand-off upstream SSO uses.
    return res.redirect(
      HttpStatus.FOUND,
      this.buildVerifyPath(loginToken.token, req.query.returnToPath),
    );
  }

  private resolveEmail(
    rawEmail: string | string[] | undefined,
    rawUser: string | string[] | undefined,
  ): string | null {
    const headerEmail = this.firstHeaderValue(rawEmail);
    const headerUser = this.firstHeaderValue(rawUser);
    const candidate = (headerEmail || headerUser || '').trim();

    if (!candidate) {
      return null;
    }

    if (candidate.includes('@')) {
      return candidate.toLowerCase();
    }

    const domain = this.twentyConfigService.get('DEFAULT_EMAIL_DOMAIN');

    if (!domain) {
      this.logger.warn(
        'X-Auth-Request-User contains a bare username but DEFAULT_EMAIL_DOMAIN is not configured.',
      );

      return null;
    }

    return `${candidate.toLowerCase()}@${domain}`;
  }

  private firstHeaderValue(value: string | string[] | undefined) {
    if (Array.isArray(value)) {
      return value[0] ?? '';
    }

    return value ?? '';
  }

  private buildVerifyPath(loginToken: string, returnToPath: unknown): string {
    const searchParams = new URLSearchParams({ loginToken });
    const destination = resolveSsoReturnPath(returnToPath);

    if (destination !== ROOT_PATH) {
      searchParams.set('returnToPath', destination);
    }

    return `${AppPath.Verify}?${searchParams.toString()}`;
  }
}
