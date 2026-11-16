import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import {
  DataSource,
  LessThan,
  QueryFailedError,
  type QueryRunner,
  Repository,
} from 'typeorm';
import { v4 } from 'uuid';

import { POSTGRESQL_ERROR_CODES } from 'src/engine/api/graphql/workspace-query-runner/constants/postgres-error-codes.constants';
import { type QueryFailedErrorWithCode } from 'src/engine/api/graphql/workspace-query-runner/utils/workspace-query-runner-graphql-api-exception-handler.util';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { SMB_WORKSPACE_ACTIVATION_STALE_CLAIM_MS } from 'src/engine/workspace-manager/smb-workspace-bootstrap/constants/smb-workspace-activation-stale-claim.constant';
import { SmbWorkspaceActivationService } from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-activation.service';
import { buildSmbWorkspaceDisplayName } from 'src/engine/workspace-manager/smb-workspace-bootstrap/utils/build-smb-workspace-display-name.util';
import { isLegacyDevSeedWorkspace } from 'src/engine/workspace-manager/smb-workspace-bootstrap/utils/is-legacy-dev-seed-workspace.util';
import { isSmbWorkspaceActivationUnfinished } from 'src/engine/workspace-manager/smb-workspace-bootstrap/utils/is-smb-workspace-activation-unfinished.util';

export type SmbWorkspaceBootstrapOutcome =
  | 'created'
  | 'resumed'
  | 'already-bootstrapped';

export type SmbWorkspaceBootstrapResult = {
  workspaceId: string;
  outcome: SmbWorkspaceBootstrapOutcome;
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as QueryFailedErrorWithCode).code ===
    POSTGRESQL_ERROR_CODES.UNIQUE_VIOLATION;

// Production counterpart of the dev seed for single-tenant SMB stacks. Two
// callers can race (the compose one-shot and provision-workspaces.sh), so
// activation is claimed through activationStatus like WorkspaceService does.
@Injectable()
export class SmbWorkspaceBootstrapService {
  private readonly logger = new Logger(SmbWorkspaceBootstrapService.name);

  constructor(
    // oxlint-disable-next-line twenty/inject-workspace-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    private readonly applicationService: ApplicationService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceCacheStorageService: WorkspaceCacheStorageService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly smbWorkspaceActivationService: SmbWorkspaceActivationService,
  ) {}

  async bootstrap(subdomain: string): Promise<SmbWorkspaceBootstrapResult> {
    const existingWorkspace = await this.workspaceRepository.findOne({
      where: { subdomain },
      withDeleted: true,
    });

    if (isDefined(existingWorkspace)) {
      return await this.resumeOrSkip(existingWorkspace);
    }

    await this.assertNoOtherWorkspace(subdomain);

    const workspaceId = await this.createClaimedWorkspace(subdomain);

    await this.runClaimedActivation(workspaceId);

    return { workspaceId, outcome: 'created' };
  }

  private async resumeOrSkip(
    workspace: WorkspaceEntity,
  ): Promise<SmbWorkspaceBootstrapResult> {
    if (isDefined(workspace.deletedAt)) {
      throw new Error(
        `Workspace "${workspace.subdomain}" (${workspace.id}) is soft-deleted; restore or hard-delete it first.`,
      );
    }

    if (!isSmbWorkspaceActivationUnfinished(workspace)) {
      this.warnIfDefaultRoleMissing(workspace);

      return { workspaceId: workspace.id, outcome: 'already-bootstrapped' };
    }

    if (isLegacyDevSeedWorkspace(workspace)) {
      throw new Error(
        `Workspace "${workspace.subdomain}" is an unfinished dev-seed workspace; reset the Twenty database and run workspace:bootstrap-smb again.`,
      );
    }

    if (!(await this.claimActivation(workspace.id))) {
      return await this.reportUnclaimedWorkspace(workspace.id);
    }

    await this.runClaimedActivation(workspace.id);

    return { workspaceId: workspace.id, outcome: 'resumed' };
  }

  private warnIfDefaultRoleMissing(workspace: WorkspaceEntity): void {
    if (isDefined(workspace.defaultRoleId)) {
      return;
    }

    this.logger.warn(
      `Workspace ${workspace.id} is ${workspace.activationStatus} without a default role; leaving it untouched.`,
    );
  }

  private async claimActivation(workspaceId: string): Promise<boolean> {
    const fromPending = await this.workspaceRepository.update(
      {
        id: workspaceId,
        activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
      },
      { activationStatus: WorkspaceActivationStatus.ONGOING_CREATION },
    );

    if ((fromPending.affected ?? 0) > 0) {
      return true;
    }

    const fromStaleClaim = await this.workspaceRepository.update(
      {
        id: workspaceId,
        activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
        updatedAt: LessThan(
          new Date(Date.now() - SMB_WORKSPACE_ACTIVATION_STALE_CLAIM_MS),
        ),
      },
      { activationStatus: WorkspaceActivationStatus.ONGOING_CREATION },
    );

    return (fromStaleClaim.affected ?? 0) > 0;
  }

  private async reportUnclaimedWorkspace(
    workspaceId: string,
  ): Promise<SmbWorkspaceBootstrapResult> {
    const workspace = await this.workspaceRepository.findOneByOrFail({
      id: workspaceId,
    });

    if (!isSmbWorkspaceActivationUnfinished(workspace)) {
      return { workspaceId, outcome: 'already-bootstrapped' };
    }

    throw new Error(
      `Another workspace:bootstrap-smb is activating workspace "${workspace.subdomain}"; re-run once it finishes (a crashed run is reclaimed after 5 minutes).`,
    );
  }

  private async assertNoOtherWorkspace(subdomain: string): Promise<void> {
    const otherWorkspaces = await this.workspaceRepository.find({
      select: { subdomain: true, deletedAt: true },
      withDeleted: true,
    });

    if (otherWorkspaces.length === 0) {
      return;
    }

    const otherSubdomains = otherWorkspaces
      .map(({ subdomain: otherSubdomain, deletedAt }) =>
        isDefined(deletedAt)
          ? `${otherSubdomain} (soft-deleted)`
          : otherSubdomain,
      )
      .join(', ');

    throw new Error(
      `Workspace "${otherSubdomains}" already exists; refusing to create a second workspace "${subdomain}". Rename it to "${subdomain}" or set SMB_DEFAULT_WORKSPACE_NAME to its subdomain.`,
    );
  }

  private async createClaimedWorkspace(subdomain: string): Promise<string> {
    const workspaceId = v4();
    const workspaceCustomApplicationId = v4();

    try {
      await this.coreDataSource.transaction(async (entityManager) => {
        await entityManager.save(
          WorkspaceEntity,
          entityManager.create(WorkspaceEntity, {
            id: workspaceId,
            subdomain,
            displayName: buildSmbWorkspaceDisplayName(subdomain),
            inviteHash: v4(),
            isPublicInviteLinkEnabled: false,
            workspaceCustomApplicationId,
            activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
          }),
        );

        await this.applicationService.createWorkspaceCustomApplication(
          { workspaceId, applicationId: workspaceCustomApplicationId },
          entityManager.queryRunner as QueryRunner,
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error(
          `Workspace "${subdomain}" was created concurrently by another bootstrap; re-run workspace:bootstrap-smb.`,
        );
      }

      throw error;
    }

    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      'flatApplicationMaps',
    ]);

    return workspaceId;
  }

  private async runClaimedActivation(workspaceId: string): Promise<void> {
    try {
      await this.smbWorkspaceActivationService.activate(workspaceId);
    } catch (error) {
      await this.workspaceRepository.update(
        {
          id: workspaceId,
          activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
        },
        { activationStatus: WorkspaceActivationStatus.PENDING_CREATION },
      );
      await this.invalidateWorkspaceCaches(workspaceId);

      throw error;
    }

    await this.invalidateWorkspaceCaches(workspaceId);
  }

  private async invalidateWorkspaceCaches(workspaceId: string): Promise<void> {
    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspaceId,
    );
    await this.workspaceCacheStorageService.flush(workspaceId);
  }
}
