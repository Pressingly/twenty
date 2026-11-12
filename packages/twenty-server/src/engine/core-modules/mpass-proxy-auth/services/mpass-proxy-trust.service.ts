import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { type Request } from 'express';
import { isDefined } from 'twenty-shared/utils';

import {
  MPASS_EDGE_SECRET_HEADER_NAME,
  PROXY_IDENTITY_HEADER_NAMES,
} from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-proxy-header-names.constant';
import {
  InvalidMpassTokenError,
  type InvalidMpassTokenReason,
} from 'src/engine/core-modules/mpass-proxy-auth/errors/invalid-mpass-token.error';
import { MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { type ProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/types/proxy-identity-headers.type';
import { configuredValue } from 'src/engine/core-modules/mpass-proxy-auth/utils/configured-value.util';
import { isEdgeSecretUsable } from 'src/engine/core-modules/mpass-proxy-auth/utils/is-edge-secret-usable.util';
import { isRequestFromEdge } from 'src/engine/core-modules/mpass-proxy-auth/utils/is-request-from-edge.util';
import { mpassIdForLogs } from 'src/engine/core-modules/mpass-proxy-auth/utils/mpass-id-for-logs.util';
import {
  readProxyHeader,
  type RequestWithHeaderGetter,
} from 'src/engine/core-modules/mpass-proxy-auth/utils/read-proxy-header.util';
import { readProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/utils/read-proxy-identity-headers.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

export type CorporateRejectionReason =
  | InvalidMpassTokenReason
  | 'missing_token'
  | 'not_corporate'
  | 'wrong_organization';

const NO_TRUSTED_HEADERS: ProxyIdentityHeaders = {};

const carriesIdentityHeaders = (request: RequestWithHeaderGetter): boolean =>
  PROXY_IDENTITY_HEADER_NAMES.some((headerName) =>
    isDefined(readProxyHeader(request, headerName)),
  );

// The single gate for oauth2-proxy's X-Auth-Request-* headers: they are
// honoured only on requests carrying the edge secret Traefik injects on the
// SSO router, so a direct call on the backend network cannot assert anyone.
@Injectable()
export class MpassProxyTrustService implements OnModuleInit {
  private readonly logger = new Logger(MpassProxyTrustService.name);

  constructor(
    private readonly twentyConfigService: TwentyConfigService,
    private readonly mpassTokenVerifier: MpassTokenVerifier,
  ) {}

  onModuleInit(): void {
    if (this.twentyConfigService.get('AUTH_TYPE') !== 'SSO') {
      return;
    }

    if (!isEdgeSecretUsable(this.edgeSecret())) {
      this.logger.error(
        'MPASS_EDGE_SECRET is unset or shorter than 32 characters: mPass identity headers will be ignored and SSO login is disabled',
      );
    }

    if (this.isCorporateGateOn() && !this.mpassTokenVerifier.isConfigured) {
      this.logger.error(
        'SMB_CORPORATE_ID is set but no token issuer or client id is configured (MPASS_COGNITO_ISSUER_URL, MPASS_OIDC_CLIENT_ID): every mPass login will be refused',
      );
    }
  }

  readTrustedProxyHeaders(request: Request): ProxyIdentityHeaders {
    const presentedSecret = request.get(MPASS_EDGE_SECRET_HEADER_NAME);

    if (isRequestFromEdge(presentedSecret, this.edgeSecret())) {
      return readProxyIdentityHeaders(request);
    }

    if (carriesIdentityHeaders(request)) {
      this.logger.warn(
        `mPass identity headers ignored: request lacks the edge secret mpass_id=${mpassIdForLogs(request)} path=${request.path} remote_addr=${request.socket?.remoteAddress ?? '-'}`,
      );
    }

    return NO_TRUSTED_HEADERS;
  }

  async findCorporateRejection(
    trustedHeaders: ProxyIdentityHeaders,
  ): Promise<CorporateRejectionReason | undefined> {
    if (!this.isCorporateGateOn()) {
      return undefined;
    }

    if (!isDefined(trustedHeaders.accessToken)) {
      return 'missing_token';
    }

    try {
      const claims = await this.mpassTokenVerifier.verify(
        trustedHeaders.accessToken,
      );

      if (claims['custom:is_corporate'] !== 'true') {
        return 'not_corporate';
      }

      if (
        claims['custom:corporate_id'] !==
        this.twentyConfigService.get('SMB_CORPORATE_ID')
      ) {
        return 'wrong_organization';
      }

      return undefined;
    } catch (error) {
      if (error instanceof InvalidMpassTokenError) {
        return error.reason;
      }

      throw error;
    }
  }

  private isCorporateGateOn(): boolean {
    return Boolean(this.twentyConfigService.get('SMB_CORPORATE_ID'));
  }

  private edgeSecret(): string {
    return configuredValue(this.twentyConfigService.get('MPASS_EDGE_SECRET'));
  }
}
