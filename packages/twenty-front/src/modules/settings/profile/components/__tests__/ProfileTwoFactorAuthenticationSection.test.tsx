import { render } from '@testing-library/react';

import { ProfileTwoFactorAuthenticationSection } from '@/settings/profile/components/ProfileTwoFactorAuthenticationSection';

jest.mock('@/auth/hooks/useIsSsoEnabled', () => ({
  useIsSsoEnabled: jest.fn(),
}));

jest.mock(
  '@/settings/two-factor-authentication/hooks/useCurrentUserWorkspaceTwoFactorAuthentication',
  () => ({
    useCurrentUserWorkspaceTwoFactorAuthentication: jest.fn(),
  }),
);

const useIsSsoEnabledMock: jest.Mock = jest.requireMock(
  '@/auth/hooks/useIsSsoEnabled',
).useIsSsoEnabled;

const useCurrentUserWorkspaceTwoFactorAuthenticationMock: jest.Mock =
  jest.requireMock(
    '@/settings/two-factor-authentication/hooks/useCurrentUserWorkspaceTwoFactorAuthentication',
  ).useCurrentUserWorkspaceTwoFactorAuthentication;

describe('ProfileTwoFactorAuthenticationSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Under SSO the IdP owns MFA — the outer component returns null before
  // useCurrentUserWorkspaceTwoFactorAuthentication runs. The SSO-off path
  // defers to the inner component which needs providers — out of scope here.
  it('returns null when SSO is enabled without invoking inner hooks', () => {
    useIsSsoEnabledMock.mockReturnValue(true);

    const { container } = render(<ProfileTwoFactorAuthenticationSection />);

    expect(container.firstChild).toBeNull();
    expect(useIsSsoEnabledMock).toHaveBeenCalled();
    expect(
      useCurrentUserWorkspaceTwoFactorAuthenticationMock,
    ).not.toHaveBeenCalled();
  });
});
