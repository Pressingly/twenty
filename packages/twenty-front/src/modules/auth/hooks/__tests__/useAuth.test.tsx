import { useAuth } from '@/auth/hooks/useAuth';

import { MockedProvider } from '@apollo/client/testing/react';
import { type ReactNode, act } from 'react';
import { MemoryRouter } from 'react-router-dom';

import {
  email,
  mocks,
  password,
  results,
  token,
} from '@/auth/hooks/__mocks__/useAuth';
import { SnackBarComponentInstanceContext } from '@/ui/feedback/snack-bar-manager/contexts/SnackBarComponentInstanceContext';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { renderHook } from '@testing-library/react';

const redirectSpy = jest.fn();

jest.mock('@/auth/utils/browserNavigation', () => ({
  navigateBrowserTo: jest.fn(),
  replaceBrowserLocation: jest.fn(),
}));

const navigateBrowserToSpy = jest.mocked(navigateBrowserTo);

jest.mock('@/domain-manager/hooks/useRedirect', () => ({
  useRedirect: jest.fn().mockImplementation(() => ({
    redirect: redirectSpy,
  })),
}));

jest.mock('@/domain-manager/hooks/useOrigin', () => ({
  useOrigin: jest.fn().mockImplementation(() => ({
    origin: 'http://localhost',
  })),
}));

jest.mock('@/captcha/hooks/useRequestFreshCaptchaToken', () => ({
  useRequestFreshCaptchaToken: jest.fn().mockImplementation(() => ({
    requestFreshCaptchaToken: jest.fn(),
  })),
}));

jest.mock('@/auth/sign-in-up/hooks/useSignUpInNewWorkspace', () => ({
  useSignUpInNewWorkspace: jest.fn().mockImplementation(() => ({
    createWorkspace: jest.fn(),
  })),
}));

jest.mock('@/domain-manager/hooks/useRedirectToWorkspaceDomain', () => ({
  useRedirectToWorkspaceDomain: jest.fn().mockImplementation(() => ({
    redirectToWorkspaceDomain: jest.fn(),
  })),
}));

jest.mock('@/domain-manager/hooks/useIsCurrentLocationOnAWorkspace', () => ({
  useIsCurrentLocationOnAWorkspace: jest.fn().mockImplementation(() => ({
    isOnAWorkspace: true,
  })),
}));

jest.mock('@/domain-manager/hooks/useLastAuthenticatedWorkspaceDomain', () => ({
  useLastAuthenticatedWorkspaceDomain: jest.fn().mockImplementation(() => ({
    setLastAuthenticateWorkspaceDomain: jest.fn(),
  })),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MockedProvider mocks={Object.values(mocks)}>
    <MemoryRouter>
      <SnackBarComponentInstanceContext.Provider
        value={{ instanceId: 'test-instance-id' }}
      >
        {children}
      </SnackBarComponentInstanceContext.Provider>
    </MemoryRouter>
  </MockedProvider>
);

const renderHooks = () => {
  const { result } = renderHook(
    () => {
      return useAuth();
    },
    {
      wrapper: Wrapper,
    },
  );
  return { result };
};

describe('useAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return login token object', async () => {
    const { result } = renderHooks();

    await act(async () => {
      expect(
        await result.current.getLoginTokenFromCredentials(email, password),
      ).toStrictEqual(results.getLoginTokenFromCredentials);
    });

    expect(mocks.getLoginTokenFromCredentials.result).toHaveBeenCalled();
  });

  it('should verify user', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.getAuthTokensFromLoginToken(token);
    });

    expect(mocks.getAuthTokensFromLoginToken.result).toHaveBeenCalled();
    expect(mocks.getCurrentUser.result).toHaveBeenCalled();
  });

  it('should handle credential sign-in', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signInWithCredentialsInWorkspace(email, password);
    });

    expect(mocks.getLoginTokenFromCredentials.result).toHaveBeenCalled();
    expect(mocks.getAuthTokensFromLoginToken.result).toHaveBeenCalled();
  });

  it('should handle google sign-in', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signInWithGoogle({
        workspaceInviteHash: 'workspaceInviteHash',
        action: 'join-workspace',
      });
    });

    expect(redirectSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '/auth/google?workspaceInviteHash=workspaceInviteHash',
      ),
    );
  });

  it('should handle sign-out', async () => {
    sessionStorage.setItem('lingering-key', 'should-be-cleared');

    const { result } = renderHooks();

    await act(async () => {
      result.current.signOut();
    });

    expect(sessionStorage.length).toBe(0);
  });

  it('should handle credential sign-up', async () => {
    const { result } = renderHooks();

    await act(async () => {
      await result.current.signUpWithCredentialsInWorkspace({
        email,
        password,
      });
    });

    expect(mocks.signUpInWorkspace.result).toHaveBeenCalled();
  });

  describe('SSO sign-out', () => {
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
      jest.replaceProperty(window, '_env_', { AUTH_TYPE: 'SSO' });
    });

    it('navigates to the portal and marks the sign-out in progress', async () => {
      const { result } = renderHook(
        () => ({
          auth: useAuth(),
          isSignOutInProgress: useAtomStateValue(isSsoSignOutInProgressState),
        }),
        { wrapper: Wrapper },
      );

      expect(result.current.isSignOutInProgress).toBe(false);

      await act(async () => {
        result.current.auth.signOut();
      });

      expect(navigateBrowserToSpy).toHaveBeenCalledWith(
        `${window.location.protocol}//${window.location.host}/`,
      );
      expect(result.current.isSignOutInProgress).toBe(true);
    });

    it('endSessionLocally leaves for the portal and marks the sign-out in progress', async () => {
      const { result } = renderHook(
        () => ({
          auth: useAuth(),
          isSignOutInProgress: useAtomStateValue(isSsoSignOutInProgressState),
        }),
        { wrapper: Wrapper },
      );

      await act(async () => {
        result.current.auth.endSessionLocally();
      });

      expect(navigateBrowserToSpy).toHaveBeenCalledWith(
        `${window.location.protocol}//${window.location.host}/`,
      );
      expect(result.current.isSignOutInProgress).toBe(true);
    });

    it('endSessionLocally keeps the non-SSO behaviour', async () => {
      jest.replaceProperty(window, '_env_', { AUTH_TYPE: 'PASSWORD' });
      const { result } = renderHooks();

      await act(async () => {
        result.current.endSessionLocally();
      });

      expect(navigateBrowserToSpy).not.toHaveBeenCalled();
    });
  });
});
