import { type MpassTokenClaims } from 'src/engine/core-modules/mpass-proxy-auth/types/mpass-token-claims.type';

// Cognito access tokens name the client in client_id; id_tokens in aud.
export const tokenAudienceMatches = (
  claims: MpassTokenClaims,
  clientId: string,
): boolean => {
  if (claims.token_use === 'access') {
    return claims.client_id === clientId;
  }

  if (claims.token_use === 'id') {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

    return audiences.includes(clientId);
  }

  return false;
};
