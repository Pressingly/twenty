import { SubTitle } from '@/auth/components/SubTitle';
import { Title } from '@/auth/components/Title';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { buildPortalUrl } from '@/auth/utils/buildPortalUrl';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { MainButton } from 'twenty-ui/components/input';
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
  onRetry: () => void;
};

const goToPortal = () =>
  navigateBrowserTo(
    buildPortalUrl(window.location.host, window.location.protocol),
  );

export const SsoLoginRecovery = ({ onRetry }: SsoLoginRecoveryProps) => {
  const { t } = useLingui();

  return (
    <StyledContainer>
      <div>
        <Title noMarginTop>{t`We could not sign you in`}</Title>
        <SubTitle>
          {t`The sign-in redirect did not complete. Try again or go back to the portal.`}
        </SubTitle>
      </div>
      <StyledButtonsContainer>
        <MainButton onClick={onRetry} fullWidth>{t`Try again`}</MainButton>
        <MainButton
          onClick={goToPortal}
          variant="outline"
          fullWidth
        >{t`Go to the portal`}</MainButton>
      </StyledButtonsContainer>
    </StyledContainer>
  );
};
