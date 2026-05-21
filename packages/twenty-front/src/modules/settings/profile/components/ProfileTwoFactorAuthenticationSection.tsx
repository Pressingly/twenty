import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { SettingsCard } from '@/settings/components/SettingsCard';
import { useCurrentUserWorkspaceTwoFactorAuthentication } from '@/settings/two-factor-authentication/hooks/useCurrentUserWorkspaceTwoFactorAuthentication';
import { useLingui } from '@lingui/react/macro';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { H2Title, IconShield, Status } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';
import { UndecoratedLink } from 'twenty-ui/navigation';

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
    <Section>
      <H2Title
        title={t`Two Factor Authentication`}
        description={t`Enhances security by requiring a code along with your password`}
      />
      <UndecoratedLink
        to={getSettingsPath(
          SettingsPath.TwoFactorAuthenticationStrategyConfig,
          { twoFactorAuthenticationStrategy: 'TOTP' },
        )}
      >
        <SettingsCard
          title={t`Authenticator App`}
          Icon={<IconShield />}
          Status={
            has2FAMethod ? (
              <Status text={t`Active`} color="turquoise" />
            ) : (
              <Status text={t`Deactivated`} color="gray" />
            )
          }
        />
      </UndecoratedLink>
    </Section>
  );
};
