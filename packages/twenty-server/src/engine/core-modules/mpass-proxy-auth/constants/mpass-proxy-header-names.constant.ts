export const MPASS_EDGE_SECRET_HEADER_NAME = 'x-mpass-edge-secret';
export const PROXY_EMAIL_HEADER_NAME = 'x-auth-request-email';
export const PROXY_USER_HEADER_NAME = 'x-auth-request-user';
export const PROXY_PREFERRED_USERNAME_HEADER_NAME =
  'x-auth-request-preferred-username';
export const PROXY_ACCESS_TOKEN_HEADER_NAME = 'x-auth-request-access-token';

export const PROXY_IDENTITY_HEADER_NAMES = [
  PROXY_EMAIL_HEADER_NAME,
  PROXY_USER_HEADER_NAME,
  PROXY_PREFERRED_USERNAME_HEADER_NAME,
  PROXY_ACCESS_TOKEN_HEADER_NAME,
] as const;
