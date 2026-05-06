import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Command, CommandRunner } from 'nest-commander';
import { Repository } from 'typeorm';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { DevSeederPermissionsService } from 'src/engine/workspace-manager/dev-seeder/core/services/dev-seeder-permissions.service';

// Completes SSO workspace activation when the SMB_NAME workspace was left in
// PENDING_CREATION state — i.e. the dev-seeder's SMB_NAME branch in
// `dev-seeder.service.ts` (which calls
// `initMinimalPermissionsAndActivateWorkspace`) didn't run to completion.
// Symptom: Member role missing, `workspace.defaultRoleId` is null, the
// onboarded_workspace_requires_default_role check still allows the row only
// because activationStatus is PENDING_CREATION. SSO auto-provisioning then
// 500s in `resolveRoleIdForNewMember` because there is no role to assign.
//
// Idempotent: no-op when the workspace is already ACTIVE with defaultRoleId
// set. Wired into foss-server-bundle-devstack/provision/provision-twenty.sh
// between `workspace:seed:dev --light` and `workspace:bootstrap-sso-admin`
// so re-runs heal a half-baked seed without wiping the DB.
@Command({
  name: 'workspace:complete-sso-activation',
  description:
    'Idempotently activate the SMB_NAME workspace: create the Member role, set defaultRoleId, flip activationStatus to ACTIVE. Safe to re-run.',
})
export class CompleteSsoActivationCommand extends CommandRunner {
  private readonly logger = new Logger(CompleteSsoActivationCommand.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly devSeederPermissionsService: DevSeederPermissionsService,
    private readonly applicationService: ApplicationService,
  ) {
    super();
  }

  async run(): Promise<void> {
    const subdomain = this.twentyConfigService.get('SMB_NAME');

    if (!subdomain) {
      throw new Error('SMB_NAME is not configured — refusing to activate.');
    }

    const workspace = await this.workspaceRepository.findOne({
      where: { subdomain },
    });

    if (!workspace) {
      throw new Error(
        `Workspace with subdomain="${subdomain}" not found. Run \`workspace:seed:dev --light\` first.`,
      );
    }

    if (
      workspace.activationStatus === WorkspaceActivationStatus.ACTIVE &&
      workspace.defaultRoleId
    ) {
      this.logger.log(
        `Workspace "${subdomain}" already ACTIVE with defaultRoleId="${workspace.defaultRoleId}" — nothing to do.`,
      );

      return;
    }

    if (
      workspace.activationStatus !== WorkspaceActivationStatus.PENDING_CREATION
    ) {
      // Refuse to act on ONGOING_CREATION (someone else is in the middle of
      // activating) or any unexpected state — the operator should investigate
      // rather than have us paper over it.
      throw new Error(
        `Workspace "${subdomain}" is in ${workspace.activationStatus} state — expected PENDING_CREATION.`,
      );
    }

    // Same source of truth the dev-seeder uses internally — see
    // `dev-seeder.service.ts:109` where workspaceCustomFlatApplication is
    // pulled to feed into the same activation step we're calling below.
    const { workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        {
          workspaceId: workspace.id,
        },
      );

    const memberRole =
      await this.devSeederPermissionsService.initMinimalPermissionsAndActivateWorkspace(
        {
          workspaceId: workspace.id,
          workspaceCustomFlatApplication,
        },
      );

    this.logger.log(
      `Workspace "${subdomain}" activated. Member role: ${memberRole.id}`,
    );
  }
}
