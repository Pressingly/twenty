import { useHasAccessTokenPair } from '@/auth/hooks/useHasAccessTokenPair';
import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { isSsoSignOutInProgressState } from '@/auth/states/isSsoSignOutInProgressState';
import { buildSsoProxyLoginUrl } from '@/auth/utils/buildSsoProxyLoginUrl';
import { replaceBrowserLocation } from '@/auth/utils/browserNavigation';
import {
  canAttemptSsoProxyLogin,
  recordSsoProxyLoginAttempt,
} from '@/auth/utils/ssoProxyLoginAttemptGuard';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useEffect } from 'react';
import { REACT_APP_SERVER_BASE_URL } from '~/config';

export const useSsoProxyLoginRedirect = () => {
  const isSsoEnabled = useIsSsoEnabled();
  const hasAccessTokenPair = useHasAccessTokenPair();
  const isSsoSignOutInProgress = useAtomStateValue(isSsoSignOutInProgressState);

  const shouldRedirect =
    isSsoEnabled && !hasAccessTokenPair && !isSsoSignOutInProgress;

  useEffect(() => {
    if (!shouldRedirect) {
      return;
    }

    const now = Date.now();

    if (!canAttemptSsoProxyLogin(window.sessionStorage, now)) {
      return;
    }

    recordSsoProxyLoginAttempt(window.sessionStorage, now);

    replaceBrowserLocation(
      buildSsoProxyLoginUrl(
        REACT_APP_SERVER_BASE_URL || window.location.origin,
        window.location,
      ),
    );
  }, [shouldRedirect]);
};
