import { configuredValue } from 'src/engine/core-modules/mpass-proxy-auth/utils/configured-value.util';

type IssuerSettings = {
  cognitoIssuerUrl: unknown;
  cognitoAwsRegion: unknown;
  cognitoUserPoolId: unknown;
  tokenIssuerUrl: unknown;
};

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const cognitoIssuer = ({
  cognitoIssuerUrl,
  cognitoAwsRegion,
  cognitoUserPoolId,
}: IssuerSettings): string => {
  const explicit = withoutTrailingSlash(configuredValue(cognitoIssuerUrl));

  if (explicit) {
    return explicit;
  }

  const region = configuredValue(cognitoAwsRegion);
  const userPoolId = configuredValue(cognitoUserPoolId);

  return region && userPoolId
    ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
    : '';
};

// Cognito is the issuer oauth2-proxy validates; mpass-auth-proxy re-signs
// Bearer callers' id_tokens under its own issuer when email capture is on.
export const resolveTrustedIssuers = (settings: IssuerSettings) => ({
  cognitoIssuer: cognitoIssuer(settings),
  tokenIssuer: withoutTrailingSlash(configuredValue(settings.tokenIssuerUrl)),
});
