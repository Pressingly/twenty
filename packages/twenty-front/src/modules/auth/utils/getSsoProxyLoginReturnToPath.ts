import { isValidReturnToPath } from '@/auth/utils/isValidReturnToPath';

export const getSsoProxyLoginReturnToPath = (search: string): string | null => {
  const returnToPath = new URLSearchParams(search).get('returnToPath');

  return returnToPath !== null && isValidReturnToPath(returnToPath)
    ? returnToPath
    : null;
};
