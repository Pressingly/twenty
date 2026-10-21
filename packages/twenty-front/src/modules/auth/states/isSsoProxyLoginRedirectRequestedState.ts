import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isSsoProxyLoginRedirectRequestedState = createAtomState<boolean>({
  key: 'isSsoProxyLoginRedirectRequestedState',
  defaultValue: false,
});
