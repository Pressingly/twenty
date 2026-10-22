import { getSsoProxyLoginReturnToPath } from '@/auth/utils/getSsoProxyLoginReturnToPath';
import { isDefined } from 'twenty-shared/utils';

// Forward the inner target (MCP /authorize), never /welcome itself: /verify drops a returnToPath pointing at sign-in.
export const buildSsoProxyLoginUrl = (base: string, search: string): string => {
  const proxyUrl = new URL('/auth/sso/proxy-login', base);
  const returnToPath = getSsoProxyLoginReturnToPath(search);

  if (isDefined(returnToPath)) {
    proxyUrl.searchParams.set('returnToPath', returnToPath);
  }

  return proxyUrl.toString();
};
