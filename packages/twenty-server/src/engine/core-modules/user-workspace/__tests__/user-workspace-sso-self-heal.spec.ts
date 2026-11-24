import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { UserWorkspaceService } from 'src/engine/core-modules/user-workspace/user-workspace.service';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

const WORKSPACE_ID = 'workspace-id';
const DEFAULT_ROLE_ID = 'default-role-id';
const ORPHAN_USER_WORKSPACE_ID = 'orphan-user-workspace-id';

const user = { id: 'user-id', email: 'jane@acme.com' } as UserEntity;
const workspace = {
  id: WORKSPACE_ID,
  defaultRoleId: DEFAULT_ROLE_ID,
} as WorkspaceEntity;

const buildService = ({ hasRoleTarget }: { hasRoleTarget: boolean }) => {
  const userWorkspaceRepository = {
    findOneBy: jest.fn().mockResolvedValue({ id: ORPHAN_USER_WORKSPACE_ID }),
  };
  const roleTargetRepository = {
    exists: jest.fn().mockResolvedValue(hasRoleTarget),
  };
  const roleAssignmentWriteService = {
    assertRoleAssignableToUsersOrThrow: jest.fn().mockResolvedValue(undefined),
    assignRoleToUserWorkspaces: jest.fn().mockResolvedValue(undefined),
  };

  const unused = {} as never;

  const service = new UserWorkspaceService(
    userWorkspaceRepository as never,
    unused,
    roleTargetRepository as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    roleAssignmentWriteService as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
  );

  return {
    service,
    roleTargetRepository,
    roleAssignmentWriteService,
  };
};

describe('UserWorkspaceService SSO orphan membership self-heal', () => {
  it('should look up the role target inside the member workspace', async () => {
    const { service, roleTargetRepository } = buildService({
      hasRoleTarget: true,
    });

    await service.addUserToWorkspaceIfUserNotInWorkspace(user, workspace);

    expect(roleTargetRepository.exists).toHaveBeenCalledWith(WORKSPACE_ID, {
      where: { userWorkspaceId: ORPHAN_USER_WORKSPACE_ID },
    });
  });

  it('should leave a membership that already has a role untouched', async () => {
    const { service, roleAssignmentWriteService } = buildService({
      hasRoleTarget: true,
    });

    await service.addUserToWorkspaceIfUserNotInWorkspace(user, workspace);

    expect(
      roleAssignmentWriteService.assignRoleToUserWorkspaces,
    ).not.toHaveBeenCalled();
  });

  it('should assign the default role to a membership left without one', async () => {
    const { service, roleAssignmentWriteService } = buildService({
      hasRoleTarget: false,
    });

    await service.addUserToWorkspaceIfUserNotInWorkspace(user, workspace);

    expect(
      roleAssignmentWriteService.assertRoleAssignableToUsersOrThrow,
    ).toHaveBeenCalledWith({
      roleId: DEFAULT_ROLE_ID,
      workspaceId: WORKSPACE_ID,
    });

    expect(
      roleAssignmentWriteService.assignRoleToUserWorkspaces,
    ).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      userWorkspaceIds: [ORPHAN_USER_WORKSPACE_ID],
      roleId: DEFAULT_ROLE_ID,
    });
  });
});
