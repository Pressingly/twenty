// Same threshold as WorkspaceService.activateWorkspace: far longer than a real
// activation, so an older ONGOING_CREATION claim belongs to a crashed run.
export const SMB_WORKSPACE_ACTIVATION_STALE_CLAIM_MS = 5 * 60 * 1000;
