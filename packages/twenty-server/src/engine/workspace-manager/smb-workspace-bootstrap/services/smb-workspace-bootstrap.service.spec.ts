import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SmbWorkspaceBootstrapService } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-bootstrap.service';

const CUSTOM_APPLICATION = { id: 'custom-app-id' };
const STANDARD_APPLICATION = { id: 'standard-app-id' };

const buildService = (overrides?: {
  existingWorkspace?: Partial<WorkspaceEntity> | null;
  existingMemberRole?: { id: string } | null;
  otherWorkspaces?: Partial<WorkspaceEntity>[];
  hasStandardObjects?: boolean;
}) => {
  const entityManager = {
    queryRunner: { id: 'query-runner' },
    create: jest.fn((_entity, values) => values),
    save: jest.fn(async (_entity, values) => values),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue(overrides?.existingWorkspace ?? null),
    find: jest.fn().mockResolvedValue(overrides?.otherWorkspaces ?? []),
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
    createWorkspaceCustomApplication: jest.fn().mockResolvedValue({}),
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
  const workspaceCacheService = {
    invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
  };
  const workspaceCacheStorageService = {
    flush: jest.fn().mockResolvedValue(undefined),
  };
  const coreEntityCacheService = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
  const preInstalledAppsService = {
    enqueueInstallOnWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const sdkClientGenerationService = {
    enqueueSdkClientGenerationForWorkspace: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const service = new SmbWorkspaceBootstrapService(
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
    workspaceCacheService as any,
    workspaceCacheStorageService as any,
    coreEntityCacheService as any,
    preInstalledAppsService as any,
    sdkClientGenerationService as any,
  );

  return {
    service,
    entityManager,
    workspaceRepository,
    roleRepository,
    applicationService,
    twentyStandardApplicationService,
    roleService,
    featureFlagService,
    upgradeMigrationService,
    sdkClientGenerationService,
  };
};

describe('SmbWorkspaceBootstrapService', () => {
  it('creates a pending workspace with no demo identity, then activates it', async () => {
    const {
      service,
      entityManager,
      applicationService,
      twentyStandardApplicationService,
      roleService,
      workspaceRepository,
      featureFlagService,
      upgradeMigrationService,
    } = buildService();

    const result = await service.bootstrap('askii');

    expect(result.outcome).toBe('created');

    const savedWorkspace = entityManager.save.mock.calls[0][1];

    expect(entityManager.save.mock.calls[0][0]).toBe(WorkspaceEntity);
    expect(savedWorkspace).toMatchObject({
      id: result.workspaceId,
      subdomain: 'askii',
      displayName: 'Askii',
      activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
    });
    expect(savedWorkspace.inviteHash).not.toBe('apple.dev-invite-hash');
    expect(savedWorkspace.logo).toBeUndefined();
    expect(
      applicationService.createWorkspaceCustomApplication,
    ).toHaveBeenCalledWith(
      {
        workspaceId: result.workspaceId,
        applicationId: savedWorkspace.workspaceCustomApplicationId,
      },
      entityManager.queryRunner,
    );

    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).toHaveBeenCalledWith({ workspaceId: result.workspaceId });
    expect(
      roleService.createWorkspaceCustomApplicationRole,
    ).toHaveBeenCalledWith({
      workspaceId: result.workspaceId,
      workspaceCustomFlatApplication: CUSTOM_APPLICATION,
    });
    expect(roleService.createMemberRole).toHaveBeenCalledTimes(1);
    expect(workspaceRepository.update).toHaveBeenCalledWith(
      result.workspaceId,
      { defaultRoleId: 'new-member-role' },
    );
    expect(featureFlagService.enableFeatureFlags).toHaveBeenCalledWith(
      expect.arrayContaining(['IS_AI_CHAT_INBOX_ENABLED']),
      result.workspaceId,
    );
    expect(entityManager.update).toHaveBeenCalledWith(
      WorkspaceEntity,
      expect.objectContaining({ id: result.workspaceId }),
      { activationStatus: WorkspaceActivationStatus.ACTIVE },
    );
    expect(upgradeMigrationService.markAsWorkspaceInitial).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'initial-cursor',
        workspaceId: result.workspaceId,
      }),
    );
  });

  it('is a no-op for an active workspace with a default role', async () => {
    const {
      service,
      entityManager,
      twentyStandardApplicationService,
      workspaceRepository,
    } = buildService({
      existingWorkspace: {
        id: 'existing-id',
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        defaultRoleId: 'member-role',
      },
    });

    const result = await service.bootstrap('askii');

    expect(result).toEqual({
      workspaceId: 'existing-id',
      outcome: 'already-bootstrapped',
    });
    expect(entityManager.save).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).not.toHaveBeenCalled();
  });

  it('resumes an interrupted activation and reuses an existing member role', async () => {
    const { service, entityManager, roleService, workspaceRepository } =
      buildService({
        existingWorkspace: {
          id: 'pending-id',
          activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
          defaultRoleId: null,
        },
        existingMemberRole: { id: 'existing-member-role' },
      });

    const result = await service.bootstrap('askii');

    expect(result).toEqual({ workspaceId: 'pending-id', outcome: 'resumed' });
    expect(entityManager.save).not.toHaveBeenCalled();
    expect(roleService.createMemberRole).not.toHaveBeenCalled();
    expect(workspaceRepository.update).toHaveBeenCalledWith('pending-id', {
      defaultRoleId: 'existing-member-role',
    });
  });

  it('skips the standard sync when a resumed workspace already has standard objects', async () => {
    const { service, twentyStandardApplicationService, roleService } =
      buildService({
        existingWorkspace: {
          id: 'pending-id',
          activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
          defaultRoleId: null,
        },
        hasStandardObjects: true,
      });

    await expect(service.bootstrap('askii')).resolves.toMatchObject({
      outcome: 'resumed',
    });
    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).not.toHaveBeenCalled();
    expect(roleService.createWorkspaceCustomApplicationRole).toHaveBeenCalled();
  });

  it('leaves a finished workspace untouched even without a default role', async () => {
    const { service, twentyStandardApplicationService, workspaceRepository } =
      buildService({
        existingWorkspace: {
          id: 'suspended-id',
          activationStatus: WorkspaceActivationStatus.SUSPENDED,
          defaultRoleId: null,
        },
      });

    const result = await service.bootstrap('askii');

    expect(result).toEqual({
      workspaceId: 'suspended-id',
      outcome: 'already-bootstrapped',
    });
    expect(
      twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow,
    ).not.toHaveBeenCalled();
    expect(workspaceRepository.update).not.toHaveBeenCalled();
  });

  it('only flips unfinished activations to ACTIVE', async () => {
    const { service, entityManager } = buildService();

    await service.bootstrap('askii');

    const [, criteria] = entityManager.update.mock.calls[0];

    expect(criteria.activationStatus.value).toEqual([
      WorkspaceActivationStatus.PENDING_CREATION,
      WorkspaceActivationStatus.ONGOING_CREATION,
    ]);
  });

  it('refuses to create a second workspace when another subdomain exists', async () => {
    const { service, entityManager } = buildService({
      otherWorkspaces: [{ subdomain: 'apple' }],
    });

    await expect(service.bootstrap('askii')).rejects.toThrow(
      'Workspace "apple" already exists; refusing to create a second workspace "askii"',
    );
    expect(entityManager.save).not.toHaveBeenCalled();
  });

  it('does not fail when a post-activation job cannot be enqueued', async () => {
    const { service, sdkClientGenerationService } = buildService();

    sdkClientGenerationService.enqueueSdkClientGenerationForWorkspace.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(service.bootstrap('askii')).resolves.toMatchObject({
      outcome: 'created',
    });
  });

  it('propagates a failed standard application sync', async () => {
    const { service, twentyStandardApplicationService } = buildService();

    twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow.mockRejectedValueOnce(
      new Error('sync failed'),
    );

    await expect(service.bootstrap('askii')).rejects.toThrow('sync failed');
  });
});
