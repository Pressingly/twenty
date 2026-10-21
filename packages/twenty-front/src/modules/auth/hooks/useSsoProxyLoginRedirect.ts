import { useHasAccessTokenPair } from '@/auth/hooks/useHasAccessTokenPair';
import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { isSsoProxyLoginRedirectRequestedState } from '@/auth/states/isSsoProxyLoginRedirectRequestedState';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { replaceBrowserLocation } from '@/auth/utils/browserNavigation';
import { buildSsoProxyLoginUrl } from '@/auth/utils/buildSsoProxyLoginUrl';
import {
  canAttemptSsoProxyLogin,
  clearSsoProxyLoginAttempts,
  getSsoProxyLoginAttemptStorage,
  recordSsoProxyLoginAttempt,
} from '@/auth/utils/ssoProxyLoginAttemptGuard';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useStore } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

export const SSO_SIGN_OUT_STALLED_AFTER_MS = 5_000;

export const useSsoProxyLoginRedirect = () => {
  const isSsoEnabled = useIsSsoEnabled();
  const hasAccessTokenPair = useHasAccessTokenPair();
  const [isSsoSignOutInProgress, setIsSsoSignOutInProgress] = useAtomState(
    isSsoSignOutInProgressState,
  );
  const [isBlocked, setIsBlocked] = useState(false);
  const [isSignOutStalled, setIsSignOutStalled] = useState(false);
  const store = useStore();

  const shouldRedirect =
    isSsoEnabled && !hasAccessTokenPair && !isSsoSignOutInProgress;

  const redirect = useCallback(() => {
    if (store.get(isSsoProxyLoginRedirectRequestedState.atom)) {
      return;
    }

    const storage = getSsoProxyLoginAttemptStorage();
    const now = Date.now();

    if (!canAttemptSsoProxyLogin(storage, now)) {
      setIsBlocked(true);
      return;
    }

    store.set(isSsoProxyLoginRedirectRequestedState.atom, true);
    setIsBlocked(false);
    recordSsoProxyLoginAttempt(storage, now);

    replaceBrowserLocation(
      buildSsoProxyLoginUrl(
        REACT_APP_SERVER_BASE_URL || window.location.origin,
        window.location,
      ),
    );
  }, [store]);

  useEffect(() => {
    if (!shouldRedirect) {
      store.set(isSsoProxyLoginRedirectRequestedState.atom, false);
      return;
    }

    redirect();
  }, [shouldRedirect, redirect, store]);

  useEffect(() => {
    if (!isSsoSignOutInProgress) {
      setIsSignOutStalled(false);
      return;
    }

    const timer = setTimeout(
      () => setIsSignOutStalled(true),
      SSO_SIGN_OUT_STALLED_AFTER_MS,
    );

    return () => clearTimeout(timer);
  }, [isSsoSignOutInProgress]);

  const retry = useCallback(() => {
    clearSsoProxyLoginAttempts(getSsoProxyLoginAttemptStorage());
    store.set(isSsoProxyLoginRedirectRequestedState.atom, false);
    setIsSignOutStalled(false);
    setIsSsoSignOutInProgress(false);
    redirect();
  }, [redirect, setIsSsoSignOutInProgress, store]);

  return { needsRecovery: isBlocked || isSignOutStalled, retry };
};
