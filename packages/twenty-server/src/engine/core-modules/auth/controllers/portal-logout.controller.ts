import {
  Controller,
  Get,
  Logger,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';

import { type Response } from 'express';

import { AuthRestApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-rest-api-exception.filter';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { PublicEndpointGuard } from 'src/engine/guards/public-endpoint.guard';
import { clearTokenPairCookie } from 'src/engine/utils/proxy-identity.util';

@Controller('auth')
@UseFilters(AuthRestApiExceptionFilter)
export class PortalLogoutController {
  private readonly logger = new Logger(PortalLogoutController.name);

  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  /**
   * GET /auth/portal-logout?next=<absolute_url>
   *
   * Cross-origin redirect-chain entry-point for the foss-server-bundle
   * portal's "Log out of all apps" flow. Clears the `tokenPair` cookie
   * and 302s to `next` (validated against PLATFORM_DOMAIN).
   *
   * CSRF-exempt by design: the portal cannot share Twenty's session
   * cookie cross-origin. Residual force-logout risk is acknowledged —
   * only the `tokenPair` cookie is cleared; the SPA's next request
   * automatically routes through `/auth/sso/proxy-login` and re-issues
   * a fresh tokenPair, so the user is auto-relogged in unless they've
   * also signed out at oauth2-proxy.
   */
  @Get('portal-logout')
  @UseGuards(PublicEndpointGuard, NoPermissionGuard)
  portalLogout(
    @Query('next') nextRaw: string | undefined,
    @Res() res: Response,
  ): void {
    clearTokenPairCookie(res);

    const next = (nextRaw ?? '').trim();
    if (next && this.isAllowedNext(next)) {
      res.redirect(302, next);
      return;
    }
    res.status(200).send();
  }

  private isAllowedNext(url: string): boolean {
    // Suffix match enforces a dot boundary so foss.arbisoft.com.evil
    // does NOT match the foss.arbisoft.com PLATFORM_DOMAIN.
    const platformDomain = (
      this.twentyConfigService.get('PLATFORM_DOMAIN') ?? ''
    )
      .toLowerCase()
      .trim()
      .replace(/^\.+/, '');
    if (!platformDomain) return false;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === platformDomain || host.endsWith('.' + platformDomain);
  }
}
