import { act, renderHook } from '@testing-library/react';

import { useSsoProxyLoginRedirect } from '@/auth/hooks/useSsoProxyLoginRedirect';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { tokenPairState } from '@/auth/states/tokenPairState';
import { replaceBrowserLocation } from '@/auth/utils/browserNavigation';
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

const renderRedirect = () =>
  renderHook(() => {
    useSsoProxyLoginRedirect();

    return {
      setTokenPair: useSetAtomState(tokenPairState),
      setSignOutInProgress: useSetAtomState(isSsoSignOutInProgressState),
    };
  });

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
    window.history.pushState({}, '', '/welcome');
    window.sessionStorage.clear();
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
    window.history.pushState({}, '', '/welcome');

    await act(async () => {
      result.current.setTokenPair(null);
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
});
