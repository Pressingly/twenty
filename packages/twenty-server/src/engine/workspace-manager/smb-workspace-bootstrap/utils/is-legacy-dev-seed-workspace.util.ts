import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const DEV_SEED_INVITE_HASH_SUFFIX = '.dev-invite-hash';

export const isLegacyDevSeedWorkspace = (
  workspace: Pick<WorkspaceEntity, 'id' | 'inviteHash'>,
): boolean =>
  workspace.id === SEED_APPLE_WORKSPACE_ID ||
  workspace.inviteHash?.endsWith(DEV_SEED_INVITE_HASH_SUFFIX) === true;
