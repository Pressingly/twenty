import { Global, Module } from '@nestjs/common';

import { MpassProxyTrustService } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-proxy-trust.service';
import { MpassTokenVerifier } from 'src/engine/core-modules/mpass-proxy-auth/services/mpass-token-verifier';
import { fetchJwksSigningKeys } from 'src/engine/core-modules/mpass-proxy-auth/utils/fetch-jwks-signing-keys.util';
import { resolveTrustedIssuers } from 'src/engine/core-modules/mpass-proxy-auth/utils/resolve-trusted-issuers.util';
import { configuredValue } from 'src/engine/core-modules/mpass-proxy-auth/utils/configured-value.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const buildMpassTokenVerifier = (
  twentyConfigService: TwentyConfigService,
): MpassTokenVerifier => {
  const { cognitoIssuer, tokenIssuer } = resolveTrustedIssuers({
    cognitoIssuerUrl: twentyConfigService.get('MPASS_COGNITO_ISSUER_URL'),
    cognitoAwsRegion: twentyConfigService.get('COGNITO_AWS_REGION'),
    cognitoUserPoolId: twentyConfigService.get('COGNITO_USER_POOL_ID'),
    tokenIssuerUrl: twentyConfigService.get('MPASS_TOKEN_ISSUER_URL'),
  });

  // Without a Cognito issuer the gate stays unconfigured even when the
  // optional mpass-auth-proxy issuer is set, matching the startup error.
  return new MpassTokenVerifier({
    issuers: cognitoIssuer ? [cognitoIssuer, tokenIssuer] : [],
    clientId: configuredValue(twentyConfigService.get('MPASS_OIDC_CLIENT_ID')),
    fetchJwksSigningKeys,
  });
};

@Global()
@Module({
  providers: [
    {
      provide: MpassTokenVerifier,
      useFactory: buildMpassTokenVerifier,
      inject: [TwentyConfigService],
    },
    MpassProxyTrustService,
  ],
  exports: [MpassProxyTrustService],
})
export class MpassProxyAuthModule {}
