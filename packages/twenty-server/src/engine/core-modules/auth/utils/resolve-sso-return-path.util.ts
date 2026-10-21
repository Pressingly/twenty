import { AppPath } from 'twenty-shared/types';

const DEFAULT_RETURN_PATH = '/';
const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid';

const isSameOriginPath = (path: string) =>
  path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');

const normalizePathname = (pathname: string) => {
  try {
    return decodeURIComponent(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
};

const isSignInUpPath = (path: string) => {
  const pathname = normalizePathname(
    new URL(path, PLACEHOLDER_ORIGIN).pathname,
  );

  return (
    pathname === AppPath.SignInUp || pathname.startsWith(`${AppPath.SignInUp}/`)
  );
};

export const resolveSsoReturnPath = (returnToPath: unknown): string => {
  if (typeof returnToPath !== 'string' || !isSameOriginPath(returnToPath)) {
    return DEFAULT_RETURN_PATH;
  }

  return isSignInUpPath(returnToPath) ? DEFAULT_RETURN_PATH : returnToPath;
};
