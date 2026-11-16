import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { MEMBER_ROLE_UNIVERSAL_IDENTIFIER } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { DataSource, type QueryRunner, Repository } from 'typeorm';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { PreInstalledAppsService } from 'src/engine/core-modules/application/pre-installed-apps/pre-installed-apps.service';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { FeatureFlagService } from 'src/engine/core-modules/feature-flag/services/feature-flag.service';
import { SdkClientGenerationService } from 'src/engine/core-modules/sdk-client/sdk-client-generation.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UpgradeMigrationService } from 'src/engine/core-modules/upgrade/services/upgrade-migration.service';
import { UpgradeSequenceReaderService } from 'src/engine/core-modules/upgrade/services/upgrade-sequence-reader.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { RoleService } from 'src/engine/metadata-modules/role/role.service';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { WorkspaceSchemaService } from 'src/engine/workspace-datasource/workspace-schema.service';
import { SMB_WORKSPACE_FEATURE_FLAGS } from 'src/engine/workspace-manager/smb-workspace-bootstrap/constants/smb-workspace-feature-flags.constant';
import { TwentyStandardApplicationService } from 'src/engine/workspace-manager/twenty-standard-application/services/twenty-standard-application.service';

// The activation steps of WorkspaceService.activateWorkspace minus the creator
// user and the sample records. The caller holds the ONGOING_CREATION claim.
@Injectable()
export class SmbWorkspaceActivationService {
  private readonly logger = new Logger(SmbWorkspaceActivationService.name);

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
    private readonly preInstalledAppsService: PreInstalledAppsService,
    private readonly sdkClientGenerationService: SdkClientGenerationService,
  ) {}

  async activate(workspaceId: string): Promise<void> {
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

    await this.synchronizeOrCompleteStandardApplication(
      workspaceId,
      twentyStandardFlatApplication,
    );

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
  }

  private async synchronizeOrCompleteStandardApplication(
    workspaceId: string,
    twentyStandardFlatApplication: FlatApplication,
  ): Promise<void> {
    const hasStandardObjects = await this.coreDataSource
      .getRepository(ObjectMetadataEntity)
      .exists({
        where: { workspaceId, applicationId: twentyStandardFlatApplication.id },
      });

    if (hasStandardObjects) {
      await this.twentyStandardApplicationService.completeTwentyStandardApplicationSetupOrThrow(
        { workspaceId },
      );

      return;
    }

    await this.twentyStandardApplicationService.synchronizeTwentyStandardApplicationOrThrow(
      { workspaceId },
    );
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
      const { affected } = await entityManager.update(
        WorkspaceEntity,
        {
          id: workspaceId,
          activationStatus: WorkspaceActivationStatus.ONGOING_CREATION,
        },
        { activationStatus: WorkspaceActivationStatus.ACTIVE },
      );

      if (affected !== 1) {
        throw new Error(
          `Lost the activation claim on workspace ${workspaceId}; another bootstrap changed its status.`,
        );
      }

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
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      )
      .forEach((result) =>
        this.logger.warn(
          `Non-critical post-activation job failed to enqueue for workspace ${workspaceId}: ${String(result.reason)}`,
        ),
      );
  }
}
