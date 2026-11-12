export const MIN_EDGE_SECRET_LENGTH = 32;
export const JWKS_LIFESPAN_MS = 3_600_000;
export const JWKS_FETCH_TIMEOUT_MS = 2_000;
export const JWKS_FAILURE_BACKOFF_MS = 30_000;
export const CLOCK_SKEW_LEEWAY_SECONDS = 60;
export const ALLOWED_TOKEN_ALGORITHM = 'RS256';
export const REQUIRED_TOKEN_CLAIMS = [
  'exp',
  'iat',
  'iss',
  'token_use',
] as const;
export const CONFIG_PLACEHOLDER_PREFIX = 'CHANGE_ME_';
