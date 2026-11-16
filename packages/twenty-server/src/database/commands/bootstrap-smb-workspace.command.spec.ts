import { Logger } from '@nestjs/common';

import { BootstrapSmbWorkspaceCommand } from 'src/database/commands/bootstrap-smb-workspace.command';
import { type SmbWorkspaceBootstrapOutcome } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-bootstrap.service';

type ConfigKey = 'SMB_NAME' | 'SMB_DEFAULT_WORKSPACE_NAME';

const buildCommand = (overrides?: {
  config?: Partial<Record<ConfigKey, string>>;
  outcome?: SmbWorkspaceBootstrapOutcome;
}) => {
  const config = overrides?.config ?? { SMB_NAME: 'askii' };
  const smbWorkspaceBootstrapService = {
    bootstrap: jest.fn().mockResolvedValue({
      workspaceId: 'workspace-id-1',
      outcome: overrides?.outcome ?? 'created',
    }),
  };
  const twentyConfigService = {
    get: jest.fn((key: ConfigKey) => config[key]),
  };

  const command = new BootstrapSmbWorkspaceCommand(
    smbWorkspaceBootstrapService as any,
    twentyConfigService as any,
  );

  return { command, smbWorkspaceBootstrapService };
};

describe('BootstrapSmbWorkspaceCommand', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bootstraps the workspace named by SMB_NAME', async () => {
    const { command, smbWorkspaceBootstrapService } = buildCommand();

    await command.run();

    expect(smbWorkspaceBootstrapService.bootstrap).toHaveBeenCalledWith(
      'askii',
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('created and activated'),
    );
  });

  it('prefers SMB_DEFAULT_WORKSPACE_NAME over SMB_NAME', async () => {
    const { command, smbWorkspaceBootstrapService } = buildCommand({
      config: { SMB_DEFAULT_WORKSPACE_NAME: 'moneta', SMB_NAME: 'portal' },
    });

    await command.run();

    expect(smbWorkspaceBootstrapService.bootstrap).toHaveBeenCalledWith(
      'moneta',
    );
  });

  it('reports a no-op when the workspace is already bootstrapped', async () => {
    const { command } = buildCommand({ outcome: 'already-bootstrapped' });

    await command.run();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('already bootstrapped, nothing to do'),
    );
  });

  it('throws without bootstrapping when no SMB workspace name is configured', async () => {
    const { command, smbWorkspaceBootstrapService } = buildCommand({
      config: {},
    });

    await expect(command.run()).rejects.toThrow(
      'SMB_DEFAULT_WORKSPACE_NAME (or SMB_NAME) is not configured',
    );
    expect(smbWorkspaceBootstrapService.bootstrap).not.toHaveBeenCalled();
  });

  it('propagates bootstrap failures so the process exits non-zero', async () => {
    const { command, smbWorkspaceBootstrapService } = buildCommand();

    smbWorkspaceBootstrapService.bootstrap.mockRejectedValueOnce(
      new Error('sync failed'),
    );

    await expect(command.run()).rejects.toThrow('sync failed');
  });
});
