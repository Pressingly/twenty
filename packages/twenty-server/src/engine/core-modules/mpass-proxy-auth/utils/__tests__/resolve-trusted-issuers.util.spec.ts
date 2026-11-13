import { resolveTrustedIssuers } from 'src/engine/core-modules/mpass-proxy-auth/utils/resolve-trusted-issuers.util';

const NO_SETTINGS = {
  cognitoIssuerUrl: '',
  cognitoAwsRegion: '',
  cognitoUserPoolId: '',
  tokenIssuerUrl: '',
};

describe('resolveTrustedIssuers', () => {
  it('strips the trailing slash from explicit issuers', () => {
    expect(
      resolveTrustedIssuers({
        ...NO_SETTINGS,
        cognitoIssuerUrl: 'https://cognito-idp.eu-west-1.amazonaws.com/pool/',
        tokenIssuerUrl: 'https://auth.example.test/',
      }),
    ).toEqual({
      cognitoIssuer: 'https://cognito-idp.eu-west-1.amazonaws.com/pool',
      tokenIssuer: 'https://auth.example.test',
    });
  });

  it('builds the Cognito issuer from region and pool when no URL is set', () => {
    expect(
      resolveTrustedIssuers({
        ...NO_SETTINGS,
        cognitoAwsRegion: 'ap-southeast-1',
        cognitoUserPoolId: 'ap-southeast-1_abc',
      }).cognitoIssuer,
    ).toBe(
      'https://cognito-idp.ap-southeast-1.amazonaws.com/ap-southeast-1_abc',
    );
  });

  it('treats CHANGE_ME_ placeholders as unset', () => {
    expect(
      resolveTrustedIssuers({
        cognitoIssuerUrl: 'CHANGE_ME_OIDC_BASE_URI',
        cognitoAwsRegion: 'CHANGE_ME_REGION',
        cognitoUserPoolId: 'pool',
        tokenIssuerUrl: 'CHANGE_ME_ISSUER',
      }),
    ).toEqual({ cognitoIssuer: '', tokenIssuer: '' });
  });
});
