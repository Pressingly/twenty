import { CONFIG_PLACEHOLDER_PREFIX } from 'src/engine/core-modules/mpass-proxy-auth/constants/mpass-token-verification.constant';

export const configuredValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';

  return text.startsWith(CONFIG_PLACEHOLDER_PREFIX) ? '' : text;
};
