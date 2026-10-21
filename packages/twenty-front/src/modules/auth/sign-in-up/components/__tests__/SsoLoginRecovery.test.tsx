import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SOURCE_LOCALE } from 'twenty-shared/translations';
import { ThemeProvider } from 'twenty-ui/theme-constants';

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
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(screen.getByText('Go to the portal')).toBeInTheDocument();
  });

  it('calls onRetry when clicking Try again', () => {
    const onRetry = jest.fn();
    renderRecovery(onRetry);

    fireEvent.click(screen.getByText('Try again'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('navigates to the portal when clicking Go to the portal', () => {
    renderRecovery();

    fireEvent.click(screen.getByText('Go to the portal'));

    expect(navigateBrowserTo).toHaveBeenCalledWith(
      `${window.location.protocol}//${window.location.host}/`,
    );
  });
});
