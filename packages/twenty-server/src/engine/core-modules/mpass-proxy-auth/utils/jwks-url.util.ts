export const jwksUrl = (issuer: string): string =>
  `${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
