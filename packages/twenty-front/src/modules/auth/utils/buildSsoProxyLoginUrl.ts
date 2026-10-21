import { AppPath } from 'twenty-shared/types';

type BrowserLocation = Pick<Location, 'pathname' | 'search' | 'hash'>;

const isSignInUpPath = (pathname: string) =>
  pathname === AppPath.SignInUp || pathname.startsWith(`${AppPath.SignInUp}/`);

const shouldCarryReturnToPath = (pathname: string) =>
  pathname !== '/' && !isSignInUpPath(pathname);

export const buildSsoProxyLoginUrl = (
  base: string,
  location: BrowserLocation,
): string => {
  const proxyUrl = new URL('/auth/sso/proxy-login', base);

  if (shouldCarryReturnToPath(location.pathname)) {
    proxyUrl.searchParams.set(
      'returnToPath',
      location.pathname + location.search + location.hash,
    );
  }

  return proxyUrl.toString();
};
