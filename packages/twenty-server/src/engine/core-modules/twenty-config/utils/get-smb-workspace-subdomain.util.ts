import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

export const getSmbWorkspaceSubdomainFromProcessEnv = (): string => {
  const fromDefault = process.env.SMB_DEFAULT_WORKSPACE_NAME?.trim();

  if (fromDefault) {
    return fromDefault;
  }

  return process.env.SMB_NAME?.trim() ?? '';
};

export const getSmbWorkspaceSubdomain = (
  config: TwentyConfigService,
): string => {
  const fromDefault = config.get('SMB_DEFAULT_WORKSPACE_NAME');

  if (typeof fromDefault === 'string' && fromDefault.trim()) {
    return fromDefault.trim();
  }

  const fromName = config.get('SMB_NAME');

  if (typeof fromName === 'string' && fromName.trim()) {
    return fromName.trim();
  }

  return '';
};

export const isSmbBundleDeployment = (config: TwentyConfigService): boolean =>
  getSmbWorkspaceSubdomain(config).length > 0;
