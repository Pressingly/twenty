import {
  Controller,
  ForbiddenException,
  Get,
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
import { isDefined } from 'twenty-shared/utils';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { SsoUserProvisioningService } from 'src/engine/core-modules/auth/services/sso-user-provisioning.service';
import { resolveSsoReturnPath } from 'src/engine/core-modules/auth/utils/resolve-sso-return-path.util';
import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { type ProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/types/proxy-identity-headers.type';
import { mpassIdForLogs } from 'src/engine/core-modules/mpass-proxy-auth/utils/mpass-id-for-logs.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import {
  normalizeProxyIdentity,
  resolveProxyIdentity,
} from 'src/engine/utils/proxy-identity.util';

@Controller('auth/sso')
@UseFilters(AuthRestApiExceptionFilter)
export class SsoProxyLoginController {
  private readonly logger = new Logger(SsoProxyLoginController.name);

  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly ssoUserProvisioningService: SsoUserProvisioningService,
    private readonly loginTokenService: LoginTokenService,
    private readonly mpassProxyTrustService: MpassProxyTrustService,
  ) {}

  // Identity headers are trusted only with the edge secret Traefik injects on
  // twenty-secure after mpass-auth; see MpassProxyTrustService.
  @Get('proxy-login')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  async proxyLogin(@Req() req: Request, @Res() res: Response) {
    if (this.twentyConfigService.get('AUTH_TYPE') !== 'SSO') {
      throw new NotFoundException();
    }

    const trustedHeaders =
      this.mpassProxyTrustService.readTrustedProxyHeaders(req);
    const email = this.resolveEmail(trustedHeaders);

    if (!email) {
      // Same opaque 404 as the non-SSO branch, so a direct caller on the
      // backend network cannot tell it reached a real SSO endpoint.
      this.logger.warn(
        'SSO proxy-login called without trusted X-Auth-Request-Email or X-Auth-Request-User headers.',
      );
      throw new NotFoundException();
    }

    const rejection =
      await this.mpassProxyTrustService.findCorporateRejection(trustedHeaders);

    if (isDefined(rejection)) {
      this.logger.warn(
        `SSO proxy-login refused: reason=${rejection} mpass_id=${mpassIdForLogs(req)} path=${req.path}`,
      );

      throw new ForbiddenException({ error: 'access_denied' });
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

  private resolveEmail(trustedHeaders: ProxyIdentityHeaders): string | null {
    const candidate = resolveProxyIdentity(trustedHeaders);

    return candidate
      ? normalizeProxyIdentity(candidate, this.twentyConfigService)
      : null;
  }

  private buildVerifyPath(loginToken: string, returnToPath: unknown): string {
    const searchParams = new URLSearchParams({ loginToken });
    const destination = resolveSsoReturnPath(returnToPath);

    if (isDefined(destination)) {
      searchParams.set('returnToPath', destination);
    }

    return `${AppPath.Verify}?${searchParams.toString()}`;
  }
}
