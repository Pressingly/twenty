const STORAGE_KEY = 'ssoProxyLoginAttempts';

export const SSO_PROXY_LOGIN_MAX_ATTEMPTS = 3;
export const SSO_PROXY_LOGIN_ATTEMPT_WINDOW_MS = 60_000;

type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const unavailableStorage: AttemptStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const getSsoProxyLoginAttemptStorage = (): AttemptStorage => {
  try {
    return window.localStorage;
  } catch {
    return unavailableStorage;
  }
};

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const readRecentAttempts = (storage: AttemptStorage, now: number): number[] => {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');

    return Array.isArray(parsed)
      ? parsed
          .filter(isTimestamp)
          .filter((at) => now - at < SSO_PROXY_LOGIN_ATTEMPT_WINDOW_MS)
      : [];
  } catch {
    return [];
  }
};

export const canAttemptSsoProxyLogin = (
  storage: AttemptStorage,
  now: number,
): boolean =>
  readRecentAttempts(storage, now).length < SSO_PROXY_LOGIN_MAX_ATTEMPTS;

export const recordSsoProxyLoginAttempt = (
  storage: AttemptStorage,
  now: number,
): void => {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify([...readRecentAttempts(storage, now), now]),
    );
  } catch {
    return;
  }
};

export const clearSsoProxyLoginAttempts = (storage: AttemptStorage): void => {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
};
