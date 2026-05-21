# Spec: Role-based access control

## Purpose

Every workspace has a set of roles. A role grants capabilities through (a) coarse boolean flags on the role row (`canUpdateAllSettings`, `canAccessAllTools`, …) and (b) per-feature **permission flags** (the `PermissionFlagType` enum). Resolvers gate operations on these.

## Surface

- Permission service: `packages/twenty-server/src/engine/metadata-modules/permissions/permissions.service.ts`
- Settings guard: `packages/twenty-server/src/engine/guards/settings-permission.guard.ts`
- Role entity: `packages/twenty-server/src/engine/metadata-modules/role/role.entity.ts`
- Flag enum: `packages/twenty-shared/src/constants/PermissionFlagType.ts`
- Object permission cache: `packages/twenty-server/src/engine/metadata-modules/role/services/workspace-roles-permissions-cache.service.ts`
- Standard role constants: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant.ts`

## Contract

### 1. Role shape

A role is a row in `core."role"` (`role.entity.ts`) with:

- Universal identifier (UUID) — the seed `Admin` role has `20202020-02c2-43f2-b94d-cab1f2b532eb` (`standard-role.constant.ts:2`).
- Capability flags as boolean columns: `canUpdateAllSettings`, `canAccessAllTools`, `canReadAllObjectRecords`, `canUpdateAllObjectRecords`, `canSoftDeleteAllObjectRecords`, `canDestroyAllObjectRecords` (`role.entity.ts` lines ~27-46).
- A `permissionFlags` relation: zero or more `{ flag: PermissionFlagType, … }` rows that opt the role into a specific gated feature.

Roles are workspace-scoped. The Admin role exists in every workspace by default and has `canUpdateAllSettings = true`.

### 2. `PermissionFlagType` semantics

Defined in `packages/twenty-shared/src/constants/PermissionFlagType.ts`. The enum is split into **two categories** — and which category a flag belongs to determines which role-level boolean bypasses the check (see §3).

| Category | Flags | Source of truth |
|---|---|---|
| **Settings permissions** | `API_KEYS_AND_WEBHOOKS`, `WORKSPACE`, `WORKSPACE_MEMBERS`, `ROLES`, `DATA_MODEL`, `SECURITY`, `WORKFLOWS`, `IMPERSONATE`, `SSO_BYPASS`, `APPLICATIONS`, `MARKETPLACE_APPS`, `LAYOUTS`, `BILLING`, `AI_SETTINGS` | Top half of `PermissionFlagType.ts` (under `// Settings permissions`) |
| **Tool permissions** | `AI`, `VIEWS`, `UPLOAD_FILE`, `DOWNLOAD_FILE`, `SEND_EMAIL_TOOL`, `HTTP_REQUEST_TOOL`, `CODE_INTERPRETER_TOOL`, `IMPORT_CSV`, `EXPORT_CSV`, `CONNECTED_ACCOUNTS`, `PROFILE_INFORMATION` | `permissions/constants/tool-permission-flags.ts` (`TOOL_PERMISSION_FLAGS` array) |

The default value for **every** flag on a newly created (non-admin) role is `false` (`permissions.service.ts:100-128`, `getDefaultUserWorkspacePermissions`).

### 3. Settings guard

Resolvers gate gated operations with `@UseGuards(SettingsPermissionGuard(PermissionFlagType.<FLAG>))` (despite the name, this guard handles **both** settings and tool flags). The guard (`settings-permission.guard.ts`) calls `permissionsService.userHasWorkspaceSettingPermission(...)`, which delegates to `checkRolePermissions` (`permissions.service.ts:232-249`).

`checkRolePermissions` returns true if **either**:

1. The role-level bypass is true:
   - For **settings flags**: `role.canUpdateAllSettings === true`
   - For **tool flags**: `role.canAccessAllTools === true`
   (The guard picks which boolean via `isToolPermission(flag)`, which tests membership in `TOOL_PERMISSION_FLAGS`.)
2. OR the role's `permissionFlags` relation contains an entry with `flag === <FLAG>`.

There is also a **workspace-activation bypass**: while the workspace is in `PENDING_CREATION` or `ONGOING_CREATION` status, the guard returns true unconditionally (`settings-permission.guard.ts:35-42`). This lets the bootstrap flow create roles before any role exists to permit creating them.

### 4. Object permission cache (second enforcement layer)

For settings flags that also gate visibility of data (workflows, workspace members), `workspace-roles-permissions-cache.service.ts` produces a per-object `{ canRead, canUpdate, canSoftDelete, canDestroy }` map via `hasSettingsGatedObjectPermissions(role, flags, FLAG)`. When the gating flag is false on the role, all four are forced to `false` for the relevant standard objects.

Currently mapped:
- `WORKFLOWS` → `workflow`, `workflowRun`, `workflowVersion` standard objects (`workspace-roles-permissions-cache.service.ts:144-162`).
- `WORKSPACE_MEMBERS` → `workspaceMember` object (same file, immediately below the workflow branch). Note: `canRead` is forced to `true` on workspace members regardless, so non-permitted users can still see who's in the workspace; only mutations are blocked.

This means **revoking a workflow flag both blocks mutations AND hides the data** — a single source of truth.

### 5. Worked example: workflows

Every workflow resolver carries `@UseGuards(SettingsPermissionGuard(PermissionFlagType.WORKFLOWS))`:

- `engine/core-modules/workflow/resolvers/workflow-builder.resolver.ts:25`
- `engine/core-modules/workflow/resolvers/workflow-version.resolver.ts:26`
- `engine/core-modules/workflow/resolvers/workflow-trigger.resolver.ts:32`
- `engine/core-modules/workflow/resolvers/workflow-version-step.resolver.ts:36`
- `engine/core-modules/workflow/resolvers/workflow-version-edge.resolver.ts:25`
- `engine/metadata-modules/logic-function/logic-function.resolver.ts` (7 mutations)

A user can therefore create / read / edit workflows **only** if their workspace role has `canUpdateAllSettings = true` (Admin) **or** an explicit `permissionFlags` row with `flag = WORKFLOWS`. The data-hiding from §4 means non-permitted users see workflows as if they did not exist.

**To grant access:** `/settings/roles` → edit the role → toggle **Workflows** on. This adds the `permissionFlags` row. No code or DB write is needed.

## Gotchas

- **Don't confuse `canUpdateAllSettings` with `canAccessFullAdminPanel`.** The former is on the workspace role row; the latter is on `core.user` and gates the instance Admin Panel — see [admin-panel.md](./admin-panel.md).
- **Default-off is intentional.** Every flag is `false` for any newly created role. There is no "Member with extras" preset; either you have a flag or you don't.
- **Adding a new gated feature?** Add the flag value to `PermissionFlagType.ts`, then to the default map in `permissions.service.ts:getDefaultUserWorkspacePermissions`, then guard the resolvers with `SettingsPermissionGuard(PermissionFlagType.<NEW_FLAG>)`. If the feature also has user-visible data records, extend `workspace-roles-permissions-cache.service.ts` to zero out the object permissions when the flag is off.
- **The guard runs on the resolver, not the service.** Internal service-to-service calls bypass the guard. Any code path reachable from a tool/job/cron must enforce the flag itself if untrusted user data drives it.
