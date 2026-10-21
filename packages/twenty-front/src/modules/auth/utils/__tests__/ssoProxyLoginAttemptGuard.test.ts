import { clearSessionLocalStorageKeys } from '@/auth/utils/clearSessionLocalStorageKeys';
import {
  SSO_PROXY_LOGIN_ATTEMPT_WINDOW_MS,
  SSO_PROXY_LOGIN_MAX_ATTEMPTS,
  canAttemptSsoProxyLogin,
  clearSsoProxyLoginAttempts,
  getSsoProxyLoginAttemptStorage,
  recordSsoProxyLoginAttempt,
} from '@/auth/utils/ssoProxyLoginAttemptGuard';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

const recordAttempts = (
  storage: ReturnType<typeof createStorage>,
  count: number,
  at: number,
) => {
  Array.from({ length: count }).forEach(() =>
    recordSsoProxyLoginAttempt(storage, at),
  );
};

describe('ssoProxyLoginAttemptGuard', () => {
  const now = 1_000_000;

  it('allows an attempt when nothing was recorded', () => {
    expect(canAttemptSsoProxyLogin(createStorage(), now)).toBe(true);
  });

  it('allows attempts until the maximum is reached', () => {
    const storage = createStorage();

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS - 1, now);
    expect(canAttemptSsoProxyLogin(storage, now)).toBe(true);

    recordAttempts(storage, 1, now);
    expect(canAttemptSsoProxyLogin(storage, now)).toBe(false);
  });

  it('forgets attempts older than the window', () => {
    const storage = createStorage();

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS, now);

    expect(
      canAttemptSsoProxyLogin(storage, now + SSO_PROXY_LOGIN_ATTEMPT_WINDOW_MS),
    ).toBe(true);
  });

  it('stops counting attempts just inside the window and drops them just outside', () => {
    const storage = createStorage();

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS, now);

    expect(canAttemptSsoProxyLogin(storage, now + 59_000)).toBe(false);
    expect(canAttemptSsoProxyLogin(storage, now + 61_000)).toBe(true);
  });

  it('treats attempts stored in the future as stale after the clock moves back', () => {
    const storage = createStorage();

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS, now);

    expect(canAttemptSsoProxyLogin(storage, now - 3_600_000)).toBe(true);
  });

  it('treats corrupted storage content as no attempts', () => {
    const storage = createStorage({ ssoProxyLoginAttempts: '{not json' });

    expect(canAttemptSsoProxyLogin(storage, now)).toBe(true);
  });

  it('ignores non-numeric entries', () => {
    const storage = createStorage({
      ssoProxyLoginAttempts: JSON.stringify(['a', null, { x: 1 }, now]),
    });

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS - 2, now);

    expect(canAttemptSsoProxyLogin(storage, now)).toBe(true);
  });

  it('does not throw when the storage rejects writes', () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };

    expect(() => recordSsoProxyLoginAttempt(storage, now)).not.toThrow();
  });

  it('does not mutate previously stored attempts in place', () => {
    const storage = createStorage();

    recordAttempts(storage, 1, now);
    const before = storage.getItem('ssoProxyLoginAttempts');
    canAttemptSsoProxyLogin(storage, now);

    expect(storage.getItem('ssoProxyLoginAttempts')).toBe(before);
  });

  it('allows attempts again after the attempts are cleared', () => {
    const storage = createStorage();

    recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS, now);
    clearSsoProxyLoginAttempts(storage);

    expect(canAttemptSsoProxyLogin(storage, now)).toBe(true);
  });

  describe('against the browser storage', () => {
    beforeEach(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    it('keeps the cap tripped across the clearSession cleanup', () => {
      const storage = getSsoProxyLoginAttemptStorage();

      recordAttempts(storage, SSO_PROXY_LOGIN_MAX_ATTEMPTS - 1, now);

      window.sessionStorage.clear();
      clearSessionLocalStorageKeys();

      recordAttempts(storage, 1, now);
      window.sessionStorage.clear();
      clearSessionLocalStorageKeys();

      expect(canAttemptSsoProxyLogin(storage, now)).toBe(false);
    });
  });
});
