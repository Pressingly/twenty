import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { useCurrentUserWorkspaceTwoFactorAuthentication } from '@/settings/two-factor-authentication/hooks/useCurrentUserWorkspaceTwoFactorAuthentication';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { Section } from 'twenty-ui/components/layout';
import { IconShield } from 'twenty-ui/icon';
import { Status } from 'twenty-ui/primitives/data-display';

// Under SSO the IdP owns MFA — Twenty's local TOTP setup is a dead control.
// Outer component bails out before inner hooks run.
export const ProfileTwoFactorAuthenticationSection = () => {
  const isSsoEnabled = useIsSsoEnabled();

  if (isSsoEnabled) {
    return null;
  }

  return <ProfileTwoFactorAuthenticationSectionInner />;
};

const ProfileTwoFactorAuthenticationSectionInner = () => {
  const { t } = useLingui();

  const { currentUserWorkspaceTwoFactorAuthenticationMethods } =
    useCurrentUserWorkspaceTwoFactorAuthentication();

  const has2FAMethod =
    currentUserWorkspaceTwoFactorAuthenticationMethods['TOTP']?.status ===
    'VERIFIED';

  return (
    <Section.Root>
      <Section.Header
        title={t`Two Factor Authentication`}
        description={t`Enhances security by requiring a code along with your password`}
      />
      <SettingsCard
        to={getSettingsPath(
          SettingsPath.TwoFactorAuthenticationStrategyConfig,
          { twoFactorAuthenticationStrategy: 'TOTP' },
        )}
        title={t`Authenticator App`}
        Icon={<IconShield />}
        Status={
          has2FAMethod ? (
            <Status color="turquoise">{t`Active`}</Status>
          ) : (
            <Status color="gray">{t`Deactivated`}</Status>
          )
        }
      />
    </Section.Root>
  );
};
