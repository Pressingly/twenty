import { render } from '@testing-library/react';

import { SignOutOnOtherTabSignOutEffect } from '@/auth/effect-components/SignOutOnOtherTabSignOutEffect';
import { subscribeToSignOutFromOtherTabs } from '@/auth/utils/crossTabSignOut';

const endSessionLocallyMock = jest.fn();
const clearSessionMock = jest.fn();

jest.mock('@/auth/hooks/useAuth', () => ({
  useAuth: () => ({
    clearSession: clearSessionMock,
    endSessionLocally: endSessionLocallyMock,
  }),
}));

jest.mock('@/auth/utils/crossTabSignOut', () => ({
  subscribeToSignOutFromOtherTabs: jest.fn(() => () => undefined),
}));

describe('SignOutOnOtherTabSignOutEffect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ends the session locally when another tab signs out', () => {
    render(<SignOutOnOtherTabSignOutEffect />);

    const onSignOut = jest.mocked(subscribeToSignOutFromOtherTabs).mock
      .calls[0][0];
    onSignOut();

    expect(endSessionLocallyMock).toHaveBeenCalledTimes(1);
    expect(clearSessionMock).not.toHaveBeenCalled();
  });
});
