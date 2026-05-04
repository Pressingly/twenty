import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Command, CommandRunner, Option } from 'nest-commander';
import { Repository } from 'typeorm';

import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';

type BootstrapSsoWorkspaceOptions = {
  subdomain?: string;
  adminEmail?: string;
  displayName?: string;
};

@Command({
  name: 'workspace:bootstrap-sso',
  description:
    'Idempotently create a workspace bound to a fixed subdomain. Used by foss-server-bundle-devstack provisioning to seed the SSO landing workspace before any SSO login.',
})
// oxlint-disable-next-line twenty/inject-workspace-repository
export class BootstrapSsoWorkspaceCommand extends CommandRunner {
  private readonly logger = new Logger(BootstrapSsoWorkspaceCommand.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly signInUpService: SignInUpService,
    private readonly workspaceService: WorkspaceService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {
    super();
  }

  @Option({
    flags: '--subdomain <subdomain>',
    description:
      'Workspace subdomain to bind. Defaults to ASKII_WORKSPACE_SUBDOMAIN env var.',
  })
  parseSubdomain(value: string): string {
    return value;
  }

  @Option({
    flags: '--admin-email <email>',
    description:
      'Email of the bootstrap admin user. Defaults to ADMIN_EMAIL env var.',
  })
  parseAdminEmail(value: string): string {
    return value;
  }

  @Option({
    flags: '--display-name <name>',
    description:
      'Display name for the workspace. Defaults to title-cased subdomain.',
  })
  parseDisplayName(value: string): string {
    return value;
  }

  async run(
    _passedParams: string[],
    options: BootstrapSsoWorkspaceOptions,
  ): Promise<void> {
    const subdomain =
      options.subdomain ??
      this.twentyConfigService.get('ASKII_WORKSPACE_SUBDOMAIN');

    if (!subdomain) {
      this.logger.error(
        'No subdomain provided. Pass --subdomain or set ASKII_WORKSPACE_SUBDOMAIN.',
      );
      throw new Error('Missing subdomain');
    }

    const adminEmail =
      options.adminEmail ?? process.env.ADMIN_EMAIL ?? undefined;

    if (!adminEmail) {
      this.logger.error(
        'No admin email provided. Pass --admin-email or set ADMIN_EMAIL.',
      );
      throw new Error('Missing admin email');
    }

    const existing = await this.workspaceRepository.findOne({
      where: { subdomain },
    });

    if (existing) {
      this.logger.log(
        `Workspace subdomain="${subdomain}" already exists (id=${existing.id}, status=${existing.activationStatus}); skipping.`,
      );

      return;
    }

    this.logger.log(
      `Bootstrapping workspace subdomain="${subdomain}" admin="${adminEmail}"`,
    );

    const { user, workspace } = await this.signInUpService.signUpOnNewWorkspace(
      {
        type: 'newUserWithPicture',
        newUserWithPicture: {
          email: adminEmail,
          firstName: '',
          lastName: '',
        },
      },
    );

    await this.workspaceRepository.update(workspace.id, { subdomain });
    workspace.subdomain = subdomain;

    const displayName = options.displayName ?? this.titleCase(subdomain);

    // UserEntity has Date timestamps; FlatAuthContextUser claims string. The
    // activate path only reads user.id, so the cast is benign — fields with
    // type drift are never accessed.
    await this.workspaceService.activateWorkspace(
      user as unknown as AuthContextUser,
      workspace,
      { displayName },
    );

    this.logger.log(
      `Bootstrapped workspace id=${workspace.id} subdomain="${subdomain}" displayName="${displayName}" admin="${adminEmail}"`,
    );
  }

  private titleCase(value: string): string {
    if (value.length === 0) {
      return value;
    }

    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }
}
