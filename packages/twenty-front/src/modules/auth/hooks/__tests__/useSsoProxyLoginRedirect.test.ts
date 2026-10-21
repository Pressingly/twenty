import { act, renderHook } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { StrictMode } from 'react';

import {
  SSO_SIGN_OUT_STALLED_AFTER_MS,
  useSsoProxyLoginRedirect,
} from '@/auth/hooks/useSsoProxyLoginRedirect';
import { isSsoProxyLoginRedirectRequestedState } from '@/auth/states/isSsoProxyLoginRedirectRequestedState';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { replaceBrowserLocation } from '@/auth/utils/browserNavigation';
import { clearSessionLocalStorageKeys } from '@/auth/utils/clearSessionLocalStorageKeys';
import { SSO_PROXY_LOGIN_MAX_ATTEMPTS } from '@/auth/utils/ssoProxyLoginAttemptGuard';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';

jest.mock('@/auth/utils/browserNavigation', () => ({
  replaceBrowserLocation: jest.fn(),
}));

const replaceSpy = jest.mocked(replaceBrowserLocation);

const tokenPair = {
  accessOrWorkspaceAgnosticToken: { expiresAt: '', token: 'access' },
  refreshToken: { expiresAt: '', token: 'refresh' },
};

const simulatePageLoad = () =>
  getDefaultStore().set(isSsoProxyLoginRedirectRequestedState.atom, false);

const renderRedirect = (options?: { strict?: boolean }) =>
  renderHook(
    () => {
      const redirect = useSsoProxyLoginRedirect();

      return {
        ...redirect,
        setTokenPair: useSetAtomState(tokenPairState),
        setSignOutInProgress: useSetAtomState(isSsoSignOutInProgressState),
      };
    },
    options?.strict ? { wrapper: StrictMode } : undefined,
  );

describe('useSsoProxyLoginRedirect', () => {
  beforeAll(() => {
    if (!Object.prototype.hasOwnProperty.call(window, '_env_')) {
      Object.defineProperty(window, '_env_', {
        value: {},
        writable: true,
        configurable: true,
      });
    }
  });

  beforeEach(() => {
    replaceSpy.mockClear();
    simulatePageLoad();
    window.history.pushState({}, '', '/welcome');
    window.localStorage.clear();
    jest.replaceProperty(window, '_env_', { AUTH_TYPE: 'SSO' });
  });

  afterEach(async () => {
    const { result } = renderRedirect();

    await act(async () => {
      result.current.setTokenPair(null);
      result.current.setSignOutInProgress(false);
    });
  });

  it('redirects to proxy-login without returnToPath when on the sign-in page', () => {
    renderRedirect();

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/sso\/proxy-login$/),
    );
  });

  it('does not redirect when SSO is disabled', () => {
    jest.replaceProperty(window, '_env_', { AUTH_TYPE: 'PASSWORD' });

    renderRedirect();

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('does not redirect when a token pair already exists', async () => {
    const { result } = renderHook(() => useSetAtomState(tokenPairState));

    await act(async () => {
      result.current(tokenPair);
    });

    renderRedirect();

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('does not redirect while an SSO sign-out is in progress', async () => {
    const { result } = renderHook(() =>
      useSetAtomState(isSsoSignOutInProgressState),
    );

    await act(async () => {
      result.current(true);
    });

    renderRedirect();

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('stops redirecting after the attempt cap within one tab session', () => {
    Array.from({ length: SSO_PROXY_LOGIN_MAX_ATTEMPTS + 2 }).forEach(() => {
      simulatePageLoad();
      renderRedirect().unmount();
    });

    expect(replaceSpy).toHaveBeenCalledTimes(SSO_PROXY_LOGIN_MAX_ATTEMPTS);
  });

  it('redirects again once the token pair is cleared', async () => {
    const { result } = renderRedirect();

    await act(async () => {
      result.current.setTokenPair(tokenPair);
    });
    replaceSpy.mockClear();
    simulatePageLoad();
    window.history.pushState({}, '', '/welcome');

    await act(async () => {
      result.current.setTokenPair(null);
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('records a single attempt per mount under StrictMode', () => {
    renderRedirect({ strict: true });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });

  it('needs recovery once the attempt cap blocks the redirect', () => {
    Array.from({ length: SSO_PROXY_LOGIN_MAX_ATTEMPTS }).forEach(() => {
      simulatePageLoad();
      renderRedirect().unmount();
    });

    simulatePageLoad();
    const { result } = renderRedirect();

    expect(result.current.needsRecovery).toBe(true);
  });

  it('keeps the cap after the clearSession cleanup between attempts', () => {
    Array.from({ length: SSO_PROXY_LOGIN_MAX_ATTEMPTS }).forEach(() => {
      simulatePageLoad();
      renderRedirect().unmount();
      window.sessionStorage.clear();
      clearSessionLocalStorageKeys();
    });
    replaceSpy.mockClear();
    simulatePageLoad();

    renderRedirect();

    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it('retry clears the cap and redirects again', async () => {
    Array.from({ length: SSO_PROXY_LOGIN_MAX_ATTEMPTS }).forEach(() => {
      simulatePageLoad();
      renderRedirect().unmount();
    });
    replaceSpy.mockClear();
    simulatePageLoad();
    const { result } = renderRedirect();

    await act(async () => {
      result.current.retry();
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(result.current.needsRecovery).toBe(false);
  });

  describe('stalled sign-out', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('needs recovery when the sign-out stays in progress, and retry resumes the redirect', async () => {
      const { result } = renderRedirect();

      await act(async () => {
        result.current.setSignOutInProgress(true);
      });

      expect(result.current.needsRecovery).toBe(false);

      await act(async () => {
        jest.advanceTimersByTime(SSO_SIGN_OUT_STALLED_AFTER_MS);
      });

      expect(result.current.needsRecovery).toBe(true);
      replaceSpy.mockClear();

      await act(async () => {
        result.current.retry();
      });

      expect(replaceSpy).toHaveBeenCalledTimes(1);
      expect(result.current.needsRecovery).toBe(false);
    });
  });
});
