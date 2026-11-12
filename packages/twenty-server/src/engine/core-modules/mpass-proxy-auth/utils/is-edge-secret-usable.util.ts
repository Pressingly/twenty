import { MIN_EDGE_SECRET_LENGTH } from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-token-verification.constant';

export const isEdgeSecretUsable = (secret: string): boolean =>
  secret.length >= MIN_EDGE_SECRET_LENGTH;
