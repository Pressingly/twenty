import { isDefined } from 'twenty-shared/utils';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';

import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

export const UNFINISHED_ACTIVATION_STATUSES: WorkspaceActivationStatus[] = [
  WorkspaceActivationStatus.PENDING_CREATION,
  WorkspaceActivationStatus.ONGOING_CREATION,
];

export const isSmbWorkspaceBootstrapped = (
  workspace: Pick<WorkspaceEntity, 'activationStatus' | 'defaultRoleId'>,
): boolean =>
  !UNFINISHED_ACTIVATION_STATUSES.includes(workspace.activationStatus) &&
  isDefined(workspace.defaultRoleId);
