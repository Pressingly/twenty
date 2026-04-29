import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { randomBytes } from 'crypto';

import { Repository } from 'typeorm';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { hashPassword } from 'src/engine/core-modules/auth/auth.util';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export type SsoProvisionResult = {
  user: UserEntity;
  workspace: WorkspaceEntity;
};

@Injectable()
// oxlint-disable-next-line twenty/inject-workspace-repository
export class SsoUserProvisioningService {
  private readonly logger = new Logger(SsoUserProvisioningService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly userWorkspaceService: UserWorkspaceService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async findOrProvision(email: string): Promise<SsoProvisionResult> {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw new AuthException(
        'Invalid email for SSO provisioning',
        AuthExceptionCode.INVALID_INPUT,
      );
    }

    const subdomain = this.twentyConfigService.get('ASKII_WORKSPACE_SUBDOMAIN');
    const workspace = await this.workspaceRepository.findOne({
      where: { subdomain },
    });

    if (!workspace) {
      this.logger.error(
        `Askii workspace (subdomain="${subdomain}") missing — run database:migrate:prod to seed.`,
      );
      throw new AuthException(
        'SSO workspace not provisioned',
        AuthExceptionCode.INTERNAL_SERVER_ERROR,
      );
    }

    const user = await this.findOrCreateUser(normalizedEmail);

    await this.userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(
      user,
      workspace,
    );

    return { user, workspace };
  }

  private async findOrCreateUser(email: string): Promise<UserEntity> {
    const existing = await this.userRepository.findOne({ where: { email } });

    if (existing) {
      return existing;
    }

    const unguessablePassword = randomBytes(32).toString('hex');
    const passwordHash = await hashPassword(unguessablePassword);

    const created = this.userRepository.create({
      email,
      firstName: '',
      lastName: '',
      passwordHash,
    });

    return await this.userRepository.save(created);
  }
}
