import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useIsSsoEnabled } from '@/auth/hooks/useIsSsoEnabled';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SetOrChangePassword } from '@/settings/profile/components/SetOrChangePassword';
import { DeleteAccount } from '@/settings/profile/components/DeleteAccount';
import { EmailField } from '@/settings/profile/components/EmailField';
import { NameFields } from '@/settings/profile/components/NameFields';
import { ProfileTwoFactorAuthenticationSection } from '@/settings/profile/components/ProfileTwoFactorAuthenticationSection';
import { WorkspaceMemberPictureUploader } from '@/settings/workspace-member/components/WorkspaceMemberPictureUploader';
import { useCanChangePassword } from '@/settings/profile/hooks/useCanChangePassword';
import { SubMenuTopBarContainer } from '@/ui/layout/page/components/SubMenuTopBarContainer';
import { Trans, useLingui } from '@lingui/react/macro';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { SettingsPath } from 'twenty-shared/types';
import { getSettingsPath } from 'twenty-shared/utils';
import { H2Title } from 'twenty-ui/display';
import { Section } from 'twenty-ui/layout';

export const SettingsProfile = () => {
  const { t } = useLingui();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  const isSsoEnabled = useIsSsoEnabled();

  const { canChangePassword } = useCanChangePassword();

  if (!currentWorkspaceMember?.id) {
    return null;
  }

  return (
    <SubMenuTopBarContainer
      title={t`Profile`}
      links={[
        {
          children: <Trans>User</Trans>,
          href: getSettingsPath(SettingsPath.ProfilePage),
        },
        { children: <Trans>Profile</Trans> },
      ]}
    >
      <SettingsPageContainer>
        <Section>
          <H2Title title={t`Picture`} />
          <WorkspaceMemberPictureUploader
            workspaceMemberId={currentWorkspaceMember.id}
          />
        </Section>
        <Section>
          <H2Title
            title={t`Name`}
            description={t`Your name as it will be displayed`}
          />
          <NameFields />
        </Section>
        <Section>
          <H2Title
            title={t`Email`}
            description={t`The email associated to your account`}
          />
          <EmailField />
        </Section>
        <ProfileTwoFactorAuthenticationSection />
        {canChangePassword && (
          <Section>
            <SetOrChangePassword />
          </Section>
        )}
        {!isSsoEnabled && (
          <Section>
            <DeleteAccount />
          </Section>
        )}
      </SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
