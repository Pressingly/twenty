import { Logger } from '@nestjs/common';

import { Command, CommandRunner } from 'nest-commander';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { getSmbWorkspaceSubdomain } from 'src/engine/core-modules/twenty-config/utils/get-smb-workspace-subdomain.util';
import {
  type SmbWorkspaceBootstrapOutcome,
  SmbWorkspaceBootstrapService,
} from 'src/engine/workspace-manager/smb-workspace-bootstrap/services/smb-workspace-bootstrap.service';

const OUTCOME_DESCRIPTIONS: Record<SmbWorkspaceBootstrapOutcome, string> = {
  created: 'created and activated',
  resumed: 'found unfinished, activation completed',
  'already-bootstrapped': 'already bootstrapped, nothing to do',
};

@Command({
  name: 'workspace:bootstrap-smb',
  description:
    'Create the SMB workspace (subdomain from SMB_DEFAULT_WORKSPACE_NAME or SMB_NAME) with standard objects and roles and no demo data. Idempotent; run before workspace:bootstrap-sso-admin.',
})
export class BootstrapSmbWorkspaceCommand extends CommandRunner {
  private readonly logger = new Logger(BootstrapSmbWorkspaceCommand.name);

  constructor(
    private readonly smbWorkspaceBootstrapService: SmbWorkspaceBootstrapService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {
    super();
  }

  async run(): Promise<void> {
    const subdomain = getSmbWorkspaceSubdomain(this.twentyConfigService);

    if (!subdomain) {
      throw new Error(
        'SMB_DEFAULT_WORKSPACE_NAME (or SMB_NAME) is not configured — refusing to bootstrap.',
      );
    }

    const { workspaceId, outcome } =
      await this.smbWorkspaceBootstrapService.bootstrap(subdomain);

    this.logger.log(
      `SMB workspace "${subdomain}" (${workspaceId}): ${OUTCOME_DESCRIPTIONS[outcome]}.`,
    );
  }
}
