import {
  SSO_PROXY_LOGIN_ATTEMPT_WINDOW_MS,
  SSO_PROXY_LOGIN_MAX_ATTEMPTS,
  canAttemptSsoProxyLogin,
  recordSsoProxyLoginAttempt,
} from '@/auth/utils/ssoProxyLoginAttemptGuard';

const createStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
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
});
