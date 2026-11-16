import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { QueryFailedError } from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { SmbWorkspaceBootstrapService } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-bootstrap.service';

const pendingWorkspace = (
  overrides?: Partial<WorkspaceEntity>,
): Partial<WorkspaceEntity> => ({
  id: 'pending-id',
  subdomain: 'askii',
  inviteHash: 'random-hash',
  activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
  defaultRoleId: undefined,
  deletedAt: undefined,
  ...overrides,
});

const buildService = (overrides?: {
  existingWorkspace?: Partial<WorkspaceEntity> | null;
  otherWorkspaces?: Partial<WorkspaceEntity>[];
  claimedRows?: number[];
  rereadWorkspace?: Partial<WorkspaceEntity>;
  saveError?: Error;
}) => {
  const claimedRows = [...(overrides?.claimedRows ?? [1])];
  const entityManager = {
    queryRunner: { id: 'query-runner' },
    create: jest.fn((_entity, values) => values),
    save: jest.fn(async (_entity, values) => {
      if (overrides?.saveError) {
        throw overrides.saveError;
      }

      return values;
    }),
  };
  const workspaceRepository = {
    findOne: jest.fn().mockResolvedValue(overrides?.existingWorkspace ?? null),
    findOneByOrFail: jest
      .fn()
      .mockResolvedValue(overrides?.rereadWorkspace ?? pendingWorkspace()),
    find: jest.fn().mockResolvedValue(overrides?.otherWorkspaces ?? []),
    update: jest.fn(
      async (_criteria: Record<string, unknown>, _values: unknown) => ({
        affected: claimedRows.shift() ?? 1,
      }),
    ),
  };
  const coreDataSource = {
    transaction: jest.fn(async (work) => work(entityManager)),
  };
  const applicationService = {
    createWorkspaceCustomApplication: jest.fn().mockResolvedValue({}),
  };
  const workspaceCacheService = {
    invalidateAndRecompute: jest.fn().mockResolvedValue(undefined),
  };
  const workspaceCacheStorageService = {
    flush: jest.fn().mockResolvedValue(undefined),
  };
  const coreEntityCacheService = {
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
  const smbWorkspaceActivationService = {
    activate: jest.fn().mockResolvedValue(undefined),
  };

  const service = new SmbWorkspaceBootstrapService(
    workspaceRepository as any,
    coreDataSource as any,
    applicationService as any,
    workspaceCacheService as any,
    workspaceCacheStorageService as any,
    coreEntityCacheService as any,
    smbWorkspaceActivationService as any,
  );

  return {
    service,
    entityManager,
    workspaceRepository,
    applicationService,
    smbWorkspaceActivationService,
  };
};

describe('SmbWorkspaceBootstrapService', () => {
  it('creates an already-claimed workspace without a public invite link, then activates it', async () => {
    const {
      service,
      entityManager,
      workspaceRepository,
      applicationService,
      smbWorkspaceActivationService,
    } = buildService();

    const result = await service.bootstrap('askii');

    expect(result.outcome).toBe('created');

    const savedWorkspace = entityManager.save.mock.calls[0][1];

    expect(savedWorkspace).toMatchObject({
      id: result.workspaceId,
      subdomain: 'askii',
      displayName: 'Askii',
      isPublicInviteLinkEnabled: false,
      activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
    });
    expect(savedWorkspace.inviteHash).not.toMatch(/dev-invite-hash$/);
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
    expect(smbWorkspaceActivationService.activate).toHaveBeenCalledWith(
      result.workspaceId,
    );
    expect(workspaceRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('looks the subdomain up including soft-deleted workspaces', async () => {
    const { service, workspaceRepository } = buildService();

    await service.bootstrap('askii');

    expect(workspaceRepository.findOne).toHaveBeenCalledWith({
      where: { subdomain: 'askii' },
      withDeleted: true,
    });
  });

  it('is a no-op for a finished workspace, even without a default role', async () => {
    const { service, workspaceRepository, smbWorkspaceActivationService } =
      buildService({
        existingWorkspace: pendingWorkspace({
          id: 'suspended-id',
          activationStatus: WorkspaceActivationStatus.SUSPENDED,
        }),
      });

    const result = await service.bootstrap('askii');

    expect(result).toEqual({
      workspaceId: 'suspended-id',
      outcome: 'already-bootstrapped',
    });
    expect(workspaceRepository.update).not.toHaveBeenCalled();
    expect(smbWorkspaceActivationService.activate).not.toHaveBeenCalled();
  });

  it('claims a pending workspace before resuming its activation', async () => {
    const { service, workspaceRepository, smbWorkspaceActivationService } =
      buildService({ existingWorkspace: pendingWorkspace() });

    const result = await service.bootstrap('askii');

    expect(result).toEqual({ workspaceId: 'pending-id', outcome: 'resumed' });
    expect(workspaceRepository.update).toHaveBeenCalledWith(
      {
        id: 'pending-id',
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      },
      { activationStatus: WorkspaceActivationStatus.ONGOING_CREATION },
    );
    expect(smbWorkspaceActivationService.activate).toHaveBeenCalledWith(
      'pending-id',
    );
  });

  it('reclaims an ONGOING workspace only through the stale-claim update', async () => {
    const { service, workspaceRepository } = buildService({
      existingWorkspace: pendingWorkspace({
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      }),
      claimedRows: [0, 1],
    });

    await expect(service.bootstrap('askii')).resolves.toMatchObject({
      outcome: 'resumed',
    });

    const [staleCriteria] = workspaceRepository.update.mock.calls[1];

    expect(staleCriteria).toMatchObject({
      activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
    });
    expect(staleCriteria.updatedAt).toBeDefined();
  });

  it('reports a bootstrap in progress when the claim is held by another run', async () => {
    const { service, smbWorkspaceActivationService } = buildService({
      existingWorkspace: pendingWorkspace({
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      }),
      claimedRows: [0, 0],
      rereadWorkspace: pendingWorkspace({
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      }),
    });

    await expect(service.bootstrap('askii')).rejects.toThrow(
      'Another workspace:bootstrap-smb is activating workspace "askii"',
    );
    expect(smbWorkspaceActivationService.activate).not.toHaveBeenCalled();
  });

  it('is a no-op when the other run finished before the claim', async () => {
    const { service } = buildService({
      existingWorkspace: pendingWorkspace(),
      claimedRows: [0, 0],
      rereadWorkspace: pendingWorkspace({
        activationStatus: WorkspaceActivationStatus.ACTIVE,
      }),
    });

    await expect(service.bootstrap('askii')).resolves.toEqual({
      workspaceId: 'pending-id',
      outcome: 'already-bootstrapped',
    });
  });

  it('releases the claim back to PENDING_CREATION when activation fails', async () => {
    const { service, workspaceRepository, smbWorkspaceActivationService } =
      buildService({ existingWorkspace: pendingWorkspace() });

    smbWorkspaceActivationService.activate.mockRejectedValueOnce(
      new Error('sync failed'),
    );

    await expect(service.bootstrap('askii')).rejects.toThrow('sync failed');
    expect(workspaceRepository.update).toHaveBeenLastCalledWith(
      {
        id: 'pending-id',
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
      },
      { activationStatus: WorkspaceActivationStatus.PENDING_CREATION },
    );
  });

  it.each([
    ['the seed workspace id', { id: SEED_APPLE_WORKSPACE_ID }],
    ['a dev-seed invite hash', { inviteHash: 'apple.dev-invite-hash' }],
  ])(
    'refuses to resume an unfinished legacy dev-seed workspace (%s)',
    async (_label, legacyFields) => {
      const { service, smbWorkspaceActivationService } = buildService({
        existingWorkspace: pendingWorkspace(legacyFields),
      });

      await expect(service.bootstrap('askii')).rejects.toThrow(
        'unfinished dev-seed workspace; reset the Twenty database',
      );
      expect(smbWorkspaceActivationService.activate).not.toHaveBeenCalled();
    },
  );

  it('refuses a soft-deleted workspace with the same subdomain', async () => {
    const { service, smbWorkspaceActivationService } = buildService({
      existingWorkspace: pendingWorkspace({
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        deletedAt: new Date(),
      }),
    });

    await expect(service.bootstrap('askii')).rejects.toThrow(
      'is soft-deleted; restore or hard-delete it first',
    );
    expect(smbWorkspaceActivationService.activate).not.toHaveBeenCalled();
  });

  it('refuses to create a second workspace when another subdomain exists', async () => {
    const { service, entityManager } = buildService({
      otherWorkspaces: [
        { subdomain: 'apple' },
        { subdomain: 'old', deletedAt: new Date() },
      ],
    });

    await expect(service.bootstrap('askii')).rejects.toThrow(
      'Workspace "apple, old (soft-deleted)" already exists; refusing to create a second workspace "askii"',
    );
    expect(entityManager.save).not.toHaveBeenCalled();
  });

  it('reports a concurrent creation instead of a raw unique violation', async () => {
    const uniqueViolation = Object.assign(
      new QueryFailedError('INSERT', [], new Error('duplicate key')),
      { code: '23505' },
    );
    const { service, smbWorkspaceActivationService } = buildService({
      saveError: uniqueViolation,
    });

    await expect(service.bootstrap('askii')).rejects.toThrow(
      'was created concurrently by another bootstrap',
    );
    expect(smbWorkspaceActivationService.activate).not.toHaveBeenCalled();
  });
});
