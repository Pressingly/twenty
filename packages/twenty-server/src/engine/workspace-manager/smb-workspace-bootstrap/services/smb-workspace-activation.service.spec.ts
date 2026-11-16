import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SmbWorkspaceActivationService } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-activation.service';

const WORKSPACE_ID = 'workspace-id';
const CUSTOM_APPLICATION = { id: 'custom-app-id' };
const STANDARD_APPLICATION = { id: 'standard-app-id' };

const buildService = (overrides?: {
  existingMemberRole?: { id: string } | null;
  hasStandardObjects?: boolean;
  activatedRows?: number;
}) => {
  const entityManager = {
    queryRunner: { id: 'query-runner' },
    update: jest
      .fn()
      .mockResolvedValue({ affected: overrides?.activatedRows ?? 1 }),
  };
  const workspaceRepository = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const roleRepository = {
    findOne: jest.fn().mockResolvedValue(overrides?.existingMemberRole ?? null),
  };
  const coreDataSource = {
    transaction: jest.fn(async (work) => work(entityManager)),
    getRepository: jest.fn(() => ({
      exists: jest
        .fn()
        .mockResolvedValue(overrides?.hasStandardObjects ?? false),
    })),
  };
  const applicationService = {
    createTwentyStandardApplication: jest.fn().mockResolvedValue({}),
    findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest
      .fn()
      .mockResolvedValue({
        twentyStandardFlatApplication: STANDARD_APPLICATION,
        workspaceCustomFlatApplication: CUSTOM_APPLICATION,
      }),
  };
  const workspaceSchemaService = {
    createWorkspaceDBSchema: jest.fn().mockResolvedValue('workspace_schema'),
  };
  const twentyStandardApplicationService = {
    synchronizeTwentyStandardApplicationOrThrow: jest
      .fn()
      .mockResolvedValue(undefined),
    completeTwentyStandardApplicationSetupOrThrow: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const roleService = {
    createWorkspaceCustomApplicationRole: jest
      .fn()
      .mockResolvedValue(undefined),
    createMemberRole: jest.fn().mockResolvedValue({ id: 'new-member-role' }),
  };
  const featureFlagService = {
    enableFeatureFlags: jest.fn().mockResolvedValue(undefined),
  };
  const upgradeMigrationService = {
    getLastAttemptedInstanceCommandOrThrow: jest
      .fn()
      .mockResolvedValue({ name: 'instance-command' }),
    markAsWorkspaceInitial: jest.fn().mockResolvedValue(undefined),
  };
  const upgradeSequenceReaderService = {
    getInitialCursorForNewWorkspace: jest
      .fn()
      .mockReturnValue({ name: 'initial-cursor', status: 'completed' }),
  };
  const twentyConfigService = { get: jest.fn().mockReturnValue('v26.11.2') };
  const preInstalledAppsService = {
    enqueueInstallOnWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const sdkClientGenerationService = {
    enqueueSdkClientGenerationForWorkspace: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const service = new SmbWorkspaceActivationService(
    workspaceRepository as any,
    roleRepository as any,
    coreDataSource as any,
    applicationService as any,
    workspaceSchemaService as any,
    twentyStandardApplicationService as any,
    roleService as any,
    featureFlagService as any,
    upgradeMigrationService as any,
    upgradeSequenceReaderService as any,
    twentyConfigService as any,
    preInstalledAppsService as any,
    sdkClientGenerationService as any,
  );

  return {
    service,
    entityManager,
    workspaceRepository,
    twentyStandardApplicationService,
    roleService,
    featureFlagService,
    upgradeMigrationService,
    sdkClientGenerationService,
  };
};

describe('SmbWorkspaceActivationService', () => {
  it('syncs the standard application, sets roles and flags, then activates', async () => {
    const {
      service,
      entityManager,
      workspaceRepository,
      twentyStandardApplicationService,
      roleService,
      featureFlagService,
      upgradeMigrationService,
    } = buildService();

    await service.activate(WORKSPACE_ID);

    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID });
    expect(
      twentyStandardApplicationService.completeTwentyStandardApplicationSetupOrThrow,
    ).not.toHaveBeenCalled();
    expect(
      roleService.createWorkspaceCustomApplicationRole,
    ).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      workspaceCustomFlatApplication: CUSTOM_APPLICATION,
    });
    expect(workspaceRepository.update).toHaveBeenCalledWith(WORKSPACE_ID, {
      defaultRoleId: 'new-member-role',
    });
    expect(featureFlagService.enableFeatureFlags).toHaveBeenCalledWith(
      expect.arrayContaining(['IS_AI_CHAT_INBOX_ENABLED']),
      WORKSPACE_ID,
    );
    expect(entityManager.update).toHaveBeenCalledWith(
      WorkspaceEntity,
      {
        id: WORKSPACE_ID,
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      },
      { activationStatus: WorkspaceActivationStatus.ACTIVE },
    );
    expect(upgradeMigrationService.markAsWorkspaceInitial).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'initial-cursor',
        workspaceId: WORKSPACE_ID,
        queryRunner: entityManager.queryRunner,
      }),
    );
  });

  it('completes the post-sync steps instead of re-syncing when standard objects exist', async () => {
    const { service, twentyStandardApplicationService } = buildService({
      hasStandardObjects: true,
    });

    await service.activate(WORKSPACE_ID);

    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).not.toHaveBeenCalled();
    expect(
      twentyStandardApplicationService.completeTwentyStandardApplicationSetupOrThrow,
    ).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID });
  });

  it('reuses an existing member role', async () => {
    const { service, roleService, workspaceRepository } = buildService({
      existingMemberRole: { id: 'existing-member-role' },
    });

    await service.activate(WORKSPACE_ID);

    expect(roleService.createMemberRole).not.toHaveBeenCalled();
    expect(workspaceRepository.update).toHaveBeenCalledWith(WORKSPACE_ID, {
      defaultRoleId: 'existing-member-role',
    });
  });

  it('fails without recording the upgrade cursor when the claim was lost', async () => {
    const { service, upgradeMigrationService } = buildService({
      activatedRows: 0,
    });

    await expect(service.activate(WORKSPACE_ID)).rejects.toThrow(
      'Lost the activation claim',
    );
    expect(
      upgradeMigrationService.markAsWorkspaceInitial,
    ).not.toHaveBeenCalled();
  });

  it('does not fail when a post-activation job cannot be enqueued', async () => {
    const { service, sdkClientGenerationService } = buildService();

    sdkClientGenerationService.enqueueSdkClientGenerationForWorkspace.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(service.activate(WORKSPACE_ID)).resolves.toBeUndefined();
  });

  it('propagates a failed standard application sync', async () => {
    const { service, twentyStandardApplicationService } = buildService();

    twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow.mockRejectedValueOnce(
      new Error('sync failed'),
    );

    await expect(service.activate(WORKSPACE_ID)).rejects.toThrow('sync failed');
  });
});
