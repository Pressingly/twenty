import { useIsLogged } from '@/auth/hooks/useIsLogged';
import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { isCookieAuthActiveState } from '@/auth/states/isCookieAuthActiveState';
import { isSsoProxyLoginRedirectRequestedState } from '@/auth/states/isSsoProxyLoginRedirectRequestedState';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { type SsoLoginRecoveryReason } from '@/auth/types/SsoLoginRecoveryReason';
import { replaceBrowserLocation } from '@/auth/utils/browserNavigation';
import { buildSsoProxyLoginUrl } from '@/auth/utils/buildSsoProxyLoginUrl';
import {
  canAttemptSsoProxyLogin,
  clearSsoProxyLoginAttempts,
  getSsoProxyLoginAttemptStorage,
  recordSsoProxyLoginAttempt,
} from '@/auth/utils/ssoProxyLoginAttemptGuard';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useStore } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { isDefined } from 'twenty-shared/utils';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

export const SSO_REDIRECT_STALLED_AFTER_MS = 5_000;

type StallableReason = Exclude<SsoLoginRecoveryReason, 'signInFailed'>;

// Without a redirect, the sign-in page only waits for something else to navigate away; if nothing does, it must not spin forever.
const getStallableReason = ({
  isSsoEnabled,
  shouldRedirect,
  isSsoSignOutInProgress,
}: {
  isSsoEnabled: boolean;
  shouldRedirect: boolean;
  isSsoSignOutInProgress: boolean;
}): StallableReason | null => {
  if (!isSsoEnabled || shouldRedirect) {
    return null;
  }

  return isSsoSignOutInProgress ? 'signOutStalled' : 'signInStalled';
};

export const useSsoProxyLoginRedirect = () => {
  const isSsoEnabled = useIsSsoEnabled();
  const isLogged = useIsLogged();
  const isSsoSignOutInProgress = useAtomStateValue(isSsoSignOutInProgressState);
  const [isBlocked, setIsBlocked] = useState(false);
  const [stalledReason, setStalledReason] = useState<StallableReason | null>(
    null,
  );
  const store = useStore();

  const shouldRedirect = isSsoEnabled && !isLogged && !isSsoSignOutInProgress;
  const stallableReason = getStallableReason({
    isSsoEnabled,
    shouldRedirect,
    isSsoSignOutInProgress,
  });

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
        window.location.search,
      ),
    );
  }, [store]);

  useEffect(() => {
    if (!shouldRedirect) {
      store.set(isSsoProxyLoginRedirectRequestedState.atom, false);
      setIsBlocked(false);
      return;
    }

    redirect();
  }, [shouldRedirect, redirect, store]);

  useEffect(() => {
    setStalledReason(null);

    if (!isDefined(stallableReason)) {
      return;
    }

    const timer = setTimeout(
      () => setStalledReason(stallableReason),
      SSO_REDIRECT_STALLED_AFTER_MS,
    );

    return () => clearTimeout(timer);
  }, [stallableReason]);

  const retryAfterFailure = useCallback(() => {
    clearSsoProxyLoginAttempts(getSsoProxyLoginAttemptStorage());
    store.set(isSsoProxyLoginRedirectRequestedState.atom, false);
    redirect();
  }, [redirect, store]);

  // Treats the session as unusable and re-authenticates through the capped redirect, never around the cap.
  const retryAfterStall = useCallback(() => {
    store.set(isCookieAuthActiveState.atom, false);
  }, [store]);

  const recoveryReason: SsoLoginRecoveryReason | null = isBlocked
    ? 'signInFailed'
    : stalledReason;

  const retryByReason: Record<
    SsoLoginRecoveryReason,
    (() => void) | undefined
  > = {
    signInFailed: retryAfterFailure,
    signInStalled: retryAfterStall,
    signOutStalled: undefined,
  };

  const retry = isDefined(recoveryReason)
    ? retryByReason[recoveryReason]
    : undefined;

  return { recoveryReason, retry };
};
