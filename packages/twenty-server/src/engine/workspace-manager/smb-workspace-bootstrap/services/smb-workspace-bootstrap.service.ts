import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { MEMBER_ROLE_UNIVERSAL_IDENTIFIER } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource, In, type QueryRunner, Repository } from 'typeorm';
import { v4 } from 'uuid';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { PreInstalledAppsService } from 'src/engine/core-modules/application/pre-installed-apps/pre-installed-apps.service';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { SdkClientGenerationService } from 'src/engine/core-modules/sdk-client/sdk-client-generation.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { UpgradeSequenceReaderService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { CoreEntityCacheService } from 'src/engine/core-entity-cache/services/core-entity-cache.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { WorkspaceSchemaService } from 'src/engine/workspace-datasource/workspace-schema.service';
import { SMB_WORKSPACE_FEATURE_FLAGS } from 'src/engine/workspace-manager/smb-workspace-bootstrap/constants/smb-workspace-feature-flags.constant';
import { buildSmbWorkspaceDisplayName } from 'src/engine/workspace-manager/smb-workspace-bootstrap/utils/build-smb-workspace-display-name.util';
import {
  isSmbWorkspaceActivationUnfinished,
  UNFINISHED_ACTIVATION_STATUSES,
} from 'src/engine/workspace-manager/smb-workspace-bootstrap/utils/is-smb-workspace-activation-unfinished.util';
import { TwentyStandardApplicationService } from 'src/engine/workspace-manager/twenty-standard-application/services/twenty-standard-application.service';

export type SmbWorkspaceBootstrapOutcome =
  | 'created'
  | 'resumed'
  | 'already-bootstrapped';

export type SmbWorkspaceBootstrapResult = {
  workspaceId: string;
  outcome: SmbWorkspaceBootstrapOutcome;
};

// Production counterpart of the dev seed for single-tenant SMB stacks: the
// same steps as WorkspaceService.activateWorkspace, minus the creator user and
// the sample records, so the first admin comes from workspace:bootstrap-sso-admin.
@Injectable()
export class SmbWorkspaceBootstrapService {
  private readonly logger = new Logger(SmbWorkspaceBootstrapService.name);

  constructor(
    // oxlint-disable-next-line twenty/inject-workspace-repository
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectWorkspaceScopedRepository(RoleEntity)
    private readonly roleRepository: WorkspaceScopedRepository<RoleEntity>,
    @InjectDataSource()
    private readonly coreDataSource: DataSource,
    private readonly applicationService: ApplicationService,
    private readonly workspaceSchemaService: WorkspaceSchemaService,
    private readonly twentyStandardApplicationService: TwentyStandardApplicationService,
    private readonly roleService: RoleService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly upgradeMigrationService: UpgradeMigrationService,
    private readonly upgradeSequenceReaderService: UpgradeSequenceReaderService,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly workspaceCacheStorageService: WorkspaceCacheStorageService,
    private readonly coreEntityCacheService: CoreEntityCacheService,
    private readonly preInstalledAppsService: PreInstalledAppsService,
    private readonly sdkClientGenerationService: SdkClientGenerationService,
  ) {}

  async bootstrap(subdomain: string): Promise<SmbWorkspaceBootstrapResult> {
    const existingWorkspace = await this.workspaceRepository.findOne({
      where: { subdomain },
    });

    if (isDefined(existingWorkspace)) {
      return await this.resumeOrSkip(existingWorkspace);
    }

    await this.assertNoOtherWorkspace(subdomain);

    const workspaceId = await this.createPendingWorkspace(subdomain);

    await this.activate(workspaceId);

    return { workspaceId, outcome: 'created' };
  }

  private async resumeOrSkip(
    workspace: WorkspaceEntity,
  ): Promise<SmbWorkspaceBootstrapResult> {
    if (!isSmbWorkspaceActivationUnfinished(workspace)) {
      if (!isDefined(workspace.defaultRoleId)) {
        this.logger.warn(
          `Workspace ${workspace.id} is ${workspace.activationStatus} without a default role; leaving it untouched.`,
        );
      }

      return { workspaceId: workspace.id, outcome: 'already-bootstrapped' };
    }

    await this.activate(workspace.id);

    return { workspaceId: workspace.id, outcome: 'resumed' };
  }

  // SMB stacks are single-tenant: a second workspace would silently capture
  // every SSO sign-in while the real data stays in the first one.
  private async assertNoOtherWorkspace(subdomain: string): Promise<void> {
    const otherWorkspaces = await this.workspaceRepository.find({
      select: { subdomain: true },
    });

    if (otherWorkspaces.length === 0) {
      return;
    }

    const otherSubdomains = otherWorkspaces
      .map((workspace) => workspace.subdomain)
      .join(', ');

    throw new Error(
      `Workspace "${otherSubdomains}" already exists; refusing to create a second workspace "${subdomain}". Rename it to "${subdomain}" or set SMB_DEFAULT_WORKSPACE_NAME to its subdomain.`,
    );
  }

  private async createPendingWorkspace(subdomain: string): Promise<string> {
    const workspaceId = v4();
    const workspaceCustomApplicationId = v4();

    await this.coreDataSource.transaction(async (entityManager) => {
      await entityManager.save(
        WorkspaceEntity,
        entityManager.create(WorkspaceEntity, {
          id: workspaceId,
          subdomain,
          displayName: buildSmbWorkspaceDisplayName(subdomain),
          inviteHash: v4(),
          workspaceCustomApplicationId,
          activationStatus: WorkspaceActivationStatus.PENDING_CREATION,
        }),
      );

      await this.applicationService.createWorkspaceCustomApplication(
        { workspaceId, applicationId: workspaceCustomApplicationId },
        entityManager.queryRunner as QueryRunner,
      );
    });

    await this.workspaceCacheService.invalidateAndRecompute(workspaceId, [
      'flatApplicationMaps',
    ]);

    return workspaceId;
  }

  private async activate(workspaceId: string): Promise<void> {
    const databaseSchema =
      await this.workspaceSchemaService.createWorkspaceDBSchema(workspaceId);

    await this.workspaceRepository.update(workspaceId, { databaseSchema });

    await this.applicationService.createTwentyStandardApplication({
      workspaceId,
    });

    const { twentyStandardFlatApplication, workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    const isStandardApplicationSynchronized = await this.coreDataSource
      .getRepository(ObjectMetadataEntity)
      .exists({
        where: { workspaceId, applicationId: twentyStandardFlatApplication.id },
      });

    // The sync is one migration, so any standard object means it completed;
    // re-running it over a synced workspace fails its own validation.
    if (!isStandardApplicationSynchronized) {
      await this.twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow(
        { workspaceId },
      );
    }

    await this.roleService.createWorkspaceCustomApplicationRole({
      workspaceId,
      workspaceCustomFlatApplication,
    });

    const memberRoleId = await this.findOrCreateMemberRoleId(
      workspaceId,
      workspaceCustomFlatApplication,
    );

    await this.workspaceRepository.update(workspaceId, {
      defaultRoleId: memberRoleId,
    });

    await this.featureFlagService.enableFeatureFlags(
      [...SMB_WORKSPACE_FEATURE_FLAGS],
      workspaceId,
    );

    await this.markActiveWithInitialUpgradeCursor(workspaceId);

    await this.enqueueNonCriticalJobs(workspaceId);

    await this.coreEntityCacheService.invalidate(
      'workspaceEntity',
      workspaceId,
    );
    await this.workspaceCacheStorageService.flush(workspaceId);
  }

  private async findOrCreateMemberRoleId(
    workspaceId: string,
    workspaceCustomFlatApplication: FlatApplication,
  ): Promise<string> {
    const existingMemberRole = await this.roleRepository.findOne(workspaceId, {
      where: { universalIdentifier: MEMBER_ROLE_UNIVERSAL_IDENTIFIER },
    });

    if (isDefined(existingMemberRole)) {
      return existingMemberRole.id;
    }

    const memberRole = await this.roleService.createMemberRole({
      workspaceId,
      ownerFlatApplication: workspaceCustomFlatApplication,
    });

    return memberRole.id;
  }

  private async markActiveWithInitialUpgradeCursor(
    workspaceId: string,
  ): Promise<void> {
    const lastAttemptedInstanceCommand =
      await this.upgradeMigrationService.getLastAttemptedInstanceCommandOrThrow();
    const initialCursor =
      this.upgradeSequenceReaderService.getInitialCursorForNewWorkspace(
        lastAttemptedInstanceCommand,
      );

    await this.coreDataSource.transaction(async (entityManager) => {
      await entityManager.update(
        WorkspaceEntity,
        {
          id: workspaceId,
          activationStatus: In(UNFINISHED_ACTIVATION_STATUSES),
        },
        { activationStatus: WorkspaceActivationStatus.ACTIVE },
      );

      await this.upgradeMigrationService.markAsWorkspaceInitial({
        name: initialCursor.name,
        workspaceId,
        executedByVersion:
          this.twentyConfigService.get('APP_VERSION') ?? 'unknown',
        status: initialCursor.status,
        queryRunner: entityManager.queryRunner as QueryRunner,
      });
    });
  }

  private async enqueueNonCriticalJobs(workspaceId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.preInstalledAppsService.enqueueInstallOnWorkspace(workspaceId),
      this.sdkClientGenerationService.enqueueSdkClientGenerationForWorkspace(
        workspaceId,
      ),
    ]);

    results
      .filter((result) => result.status === 'rejected')
      .forEach((result) =>
        this.logger.warn(
          `Non-critical post-activation job failed to enqueue for workspace ${workspaceId}: ${String((result as PromiseRejectedResult).reason)}`,
        ),
      );
  }
}
