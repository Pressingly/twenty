import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ThemeProvider } from 'twenty-ui/theme';

import { SsoLoginRecovery } from '@/auth/sign-in-up/components/SsoLoginRecovery';
import { type SsoLoginRecoveryReason } from '@/auth/types/SsoLoginRecoveryReason';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

jest.mock('@/auth/utils/browserNavigation', () => ({
  navigateBrowserTo: jest.fn(),
}));

dynamicActivate(SOURCE_LOCALE);

const renderRecovery = ({
  onRetry,
  reason = 'signInFailed',
}: {
  onRetry?: () => void;
  reason?: SsoLoginRecoveryReason;
} = {}) =>
  render(
    <ThemeProvider colorScheme="light">
      <I18nProvider i18n={i18n}>
        <SsoLoginRecovery reason={reason} onRetry={onRetry} />
      </I18nProvider>
    </ThemeProvider>,
  );

describe('SsoLoginRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the message and both actions', () => {
    renderRecovery({ onRetry: jest.fn() });

    expect(screen.getByText('We could not sign you in')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Go to the portal' }),
    ).toBeInTheDocument();
  });

  it('calls onRetry when clicking Try again', async () => {
    const onRetry = jest.fn();
    renderRecovery({ onRetry });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('navigates to the portal when clicking Go to the portal', async () => {
    renderRecovery();

    await userEvent.click(
      screen.getByRole('button', { name: 'Go to the portal' }),
    );

    expect(navigateBrowserTo).toHaveBeenCalledWith(
      `${window.location.protocol}//${window.location.host}/`,
    );
  });

  it('offers only the portal when a sign-out stalled', async () => {
    renderRecovery({ reason: 'signOutStalled' });

    expect(
      screen.getByText('Signing out is taking longer than expected'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Go to the portal' }),
    );

    expect(navigateBrowserTo).toHaveBeenCalledWith(
      `${window.location.protocol}//${window.location.host}/`,
    );
  });
});
