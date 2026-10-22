import { isString } from '@sniptt/guards';
import { AppPath } from 'twenty-shared/types';
import { isSafeInternalPath } from 'twenty-shared/utils';

const ROOT_PATH = '/';
const PLACEHOLDER_ORIGIN = 'http://placeholder.invalid';

const isSafePathname = (path: string) =>
  isSafeInternalPath(path) && path.startsWith('/');

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

const isMeaningfulReturnPath = (path: string) =>
  path !== ROOT_PATH && !isSignInUpPath(path);

export const resolveSsoReturnPath = (returnToPath: unknown): string | null =>
  isString(returnToPath) &&
  isSafePathname(returnToPath) &&
  isMeaningfulReturnPath(returnToPath)
    ? returnToPath
    : null;
