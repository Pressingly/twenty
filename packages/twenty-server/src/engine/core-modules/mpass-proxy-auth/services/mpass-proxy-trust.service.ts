import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
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
import { type MpassTokenClaims } from 'src/engine/core-modules/mpass-proxy-auth/types/mpass-token-claims.type';
import { type ProxyIdentityHeaders } from 'src/engine/core-modules/mpass-proxy-auth/types/proxy-identity-headers.type';
import { CONFIG_PLACEHOLDER_PREFIX } from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-token-verification.constant';
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

export type CorporateMismatchReason =
  | 'not_corporate'
  | 'wrong_organization'
  | 'placeholder_config';

// A CHANGE_ME_ corporate id is a deployment that meant to set one, so it
// keeps the gate on and refuses everyone instead of failing open.
type CorporateGate =
  | { state: 'off' }
  | { state: 'placeholder' }
  | { state: 'on'; corporateId: string };

const resolveCorporateGate = (rawCorporateId: unknown): CorporateGate => {
  const corporateId =
    typeof rawCorporateId === 'string' ? rawCorporateId.trim() : '';

  if (!isNonEmptyString(corporateId)) {
    return { state: 'off' };
  }

  return corporateId.startsWith(CONFIG_PLACEHOLDER_PREFIX)
    ? { state: 'placeholder' }
    : { state: 'on', corporateId };
};

export type CorporateRejectionReason =
  | InvalidMpassTokenReason
  | CorporateMismatchReason
  | 'missing_token';

const corporateClaimsMismatch = (
  claims: MpassTokenClaims,
  expectedCorporateId: string,
): CorporateMismatchReason | undefined => {
  if (claims['custom:is_corporate'] !== 'true') {
    return 'not_corporate';
  }

  if (claims['custom:corporate_id'] !== expectedCorporateId) {
    return 'wrong_organization';
  }

  return undefined;
};

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

    const gate = this.corporateGate();

    if (gate.state === 'placeholder') {
      this.logger.error(
        'SMB_CORPORATE_ID is a CHANGE_ME_ placeholder: every mPass login is refused',
      );
    }

    if (gate.state === 'on' && !this.mpassTokenVerifier.isConfigured) {
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

  // Strict: proxy-login establishes a session only on a verified token of
  // this organization, so any verification failure refuses.
  async findCorporateRejection(
    trustedHeaders: ProxyIdentityHeaders,
  ): Promise<CorporateRejectionReason | undefined> {
    const gate = this.corporateGate();

    if (gate.state !== 'on') {
      return gate.state === 'placeholder' ? 'placeholder_config' : undefined;
    }

    if (!isDefined(trustedHeaders.accessToken)) {
      return 'missing_token';
    }

    try {
      const claims = await this.mpassTokenVerifier.verify(
        trustedHeaders.accessToken,
      );

      return corporateClaimsMismatch(claims, gate.corporateId);
    } catch (error) {
      if (error instanceof InvalidMpassTokenError) {
        return error.reason;
      }

      throw error;
    }
  }

  // Lenient, for every request of a signed-in session: only a validly signed
  // token from another organization refuses. Expiry or a JWKS outage must not
  // lock out users whose login already passed the strict check.
  async findCorporateMismatch(
    trustedHeaders: ProxyIdentityHeaders,
  ): Promise<CorporateMismatchReason | undefined> {
    const gate = this.corporateGate();

    if (gate.state === 'off' || !isDefined(trustedHeaders.accessToken)) {
      return undefined;
    }

    if (gate.state === 'placeholder') {
      return 'placeholder_config';
    }

    try {
      const claims = await this.mpassTokenVerifier.verify(
        trustedHeaders.accessToken,
      );

      return corporateClaimsMismatch(claims, gate.corporateId);
    } catch (error) {
      if (!(error instanceof InvalidMpassTokenError)) {
        throw error;
      }

      this.logger.warn(
        `mPass token not verified on a signed-in request; corporate gate skipped reason=${error.reason}`,
      );

      return undefined;
    }
  }

  private corporateGate(): CorporateGate {
    return resolveCorporateGate(
      this.twentyConfigService.get('SMB_CORPORATE_ID'),
    );
  }

  private edgeSecret(): string {
    return configuredValue(this.twentyConfigService.get('MPASS_EDGE_SECRET'));
  }
}
