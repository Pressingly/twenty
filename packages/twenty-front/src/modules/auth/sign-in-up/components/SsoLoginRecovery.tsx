import { Title } from '@/auth/components/Title';
import { navigateBrowserTo } from '@/auth/utils/browserNavigation';
import { buildPortalUrl } from '@/auth/utils/buildPortalUrl';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { ModalContent } from 'twenty-ui/layout';
import { MainButton } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledMessage = styled.div`
  color: ${themeCssVariables.font.color.secondary};
  margin-bottom: ${themeCssVariables.spacing[6]};
  text-align: center;
`;

const StyledActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[2]};
  width: 100%;
`;

type SsoLoginRecoveryProps = {
  onRetry: () => void;
};

export const SsoLoginRecovery = ({ onRetry }: SsoLoginRecoveryProps) => {
  const { t } = useLingui();

  const goToPortal = () =>
    navigateBrowserTo(
      buildPortalUrl(window.location.host, window.location.protocol),
    );

  return (
    <ModalContent isVerticallyCentered isHorizontallyCentered>
      <Title>{t`We could not sign you in`}</Title>
      <StyledMessage>
        {t`The sign-in redirect did not complete. Try again or go back to the portal.`}
      </StyledMessage>
      <StyledActions>
        <MainButton title={t`Try again`} onClick={onRetry} fullWidth />
        <MainButton
          title={t`Go to the portal`}
          onClick={goToPortal}
          variant="secondary"
          fullWidth
        />
      </StyledActions>
    </ModalContent>
  );
};
