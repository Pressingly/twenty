import { useAuth } from '@/auth/hooks/useAuth';
import { subscribeToSignOutFromOtherTabs } from '@/auth/utils/crossTabSignOut';
import { useEffect } from 'react';

export const SignOutOnOtherTabSignOutEffect = () => {
  const { endSessionLocally } = useAuth();

  useEffect(() => {
    const unsubscribe = subscribeToSignOutFromOtherTabs(() => {
      endSessionLocally();
    });

    return unsubscribe;
  }, [endSessionLocally]);

  return null;
};
