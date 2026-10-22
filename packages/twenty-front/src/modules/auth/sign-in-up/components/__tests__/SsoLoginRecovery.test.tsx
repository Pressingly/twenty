import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ThemeProvider } from 'twenty-ui/theme';

import { SsoLoginRecovery } from '@/auth/sign-in-up/components/SsoLoginRecovery';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { dynamicActivate } from '~/utils/i18n/dynamicActivate';

jest.mock('@/auth/utils/browserNavigation', () => ({
  navigateBrowserTo: jest.fn(),
}));

dynamicActivate(SOURCE_LOCALE);

const renderRecovery = (onRetry = jest.fn()) =>
  render(
    <ThemeProvider colorScheme="light">
      <I18nProvider i18n={i18n}>
        <SsoLoginRecovery onRetry={onRetry} />
      </I18nProvider>
    </ThemeProvider>,
  );

describe('SsoLoginRecovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the message and both actions', () => {
    renderRecovery();

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
    renderRecovery(onRetry);

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
});
