import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const isSsoSignOutInProgressState = createAtomState<boolean>({
  key: 'isSsoSignOutInProgressState',
  defaultValue: false,
});
