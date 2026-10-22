import { render } from '@testing-library/react';

import { TwoFactorAuthenticationSwitch } from '@/settings/security/components/TwoFactorAuthenticationSwitch';

jest.mock('@/auth/hooks/useIsSsoEnabled', () => ({
  useIsSsoEnabled: jest.fn(),
}));

const useIsSsoEnabledMock: jest.Mock = jest.requireMock(
  '@/auth/hooks/useIsSsoEnabled',
).useIsSsoEnabled;

describe('TwoFactorAuthenticationSwitch', () => {
  it('returns null when SSO is enabled', () => {
    useIsSsoEnabledMock.mockReturnValue(true);

    const { container } = render(<TwoFactorAuthenticationSwitch />);

    expect(container.firstChild).toBeNull();
    expect(useIsSsoEnabledMock).toHaveBeenCalled();
  });
});
