import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  getSmbWorkspaceSubdomain,
  getSmbWorkspaceSubdomainFromProcessEnv,
  isSmbBundleDeployment,
} from 'src/engine/core-modules/twenty-config/utils/get-smb-workspace-subdomain.util';

describe('getSmbWorkspaceSubdomain utils', () => {
  const buildConfig = (values: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as TwentyConfigService;

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('prefers SMB_DEFAULT_WORKSPACE_NAME from process env', () => {
    process.env.SMB_DEFAULT_WORKSPACE_NAME = 'acme-team';
    process.env.SMB_NAME = 'acme';

    expect(getSmbWorkspaceSubdomainFromProcessEnv()).toBe('acme-team');
  });

  it('prefers SMB_DEFAULT_WORKSPACE_NAME from config', () => {
    const config = buildConfig({
      SMB_DEFAULT_WORKSPACE_NAME: 'acme-team',
      SMB_NAME: 'acme',
    });

    expect(getSmbWorkspaceSubdomain(config)).toBe('acme-team');
    expect(isSmbBundleDeployment(config)).toBe(true);
  });

  it('falls back to SMB_NAME when default workspace name is unset', () => {
    const config = buildConfig({
      SMB_DEFAULT_WORKSPACE_NAME: '',
      SMB_NAME: 'acme',
    });

    expect(getSmbWorkspaceSubdomain(config)).toBe('acme');
  });
});
