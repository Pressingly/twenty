import { SubTitle } from '@/auth/components/SubTitle';
import { Title } from '@/auth/components/Title';
import { type SsoLoginRecoveryReason } from '@/auth/types/SsoLoginRecoveryReason';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { buildPortalUrl } from '@/auth/utils/buildPortalUrl';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { MainButton } from 'twenty-ui/components/input';
import { isDefined } from 'twenty-shared/utils';
import { themeCssVariables } from 'twenty-ui/theme';

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[6]};
  width: 100%;
`;

const StyledButtonsContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  max-width: 240px;
  width: 100%;
`;

type SsoLoginRecoveryProps = {
  reason: SsoLoginRecoveryReason;
  onRetry?: () => void;
};

const goToPortal = () =>
  navigateBrowserTo(
    buildPortalUrl(window.location.host, window.location.protocol),
  );

export const SsoLoginRecovery = ({
  reason,
  onRetry,
}: SsoLoginRecoveryProps) => {
  const { t } = useLingui();

  const isSignOut = reason === 'signOutStalled';

  return (
    <StyledContainer>
      <div>
        <Title noMarginTop>
          {isSignOut
            ? t`Signing out is taking longer than expected`
            : t`We could not sign you in`}
        </Title>
        <SubTitle>
          {isSignOut
            ? t`Go back to the portal to finish signing out.`
            : t`The sign-in redirect did not complete. Try again or go back to the portal.`}
        </SubTitle>
      </div>
      <StyledButtonsContainer>
        {isDefined(onRetry) && (
          <MainButton onClick={onRetry} fullWidth>{t`Try again`}</MainButton>
        )}
        <MainButton
          onClick={goToPortal}
          variant="outline"
          fullWidth
        >{t`Go to the portal`}</MainButton>
      </StyledButtonsContainer>
    </StyledContainer>
  );
};
