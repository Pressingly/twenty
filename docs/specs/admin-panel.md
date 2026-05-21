# Spec: Admin layers (instance vs workspace)

## Purpose

Twenty has **two independent admin concepts**. They are governed by different fields, enforced by different guards, and grant different scopes. Conflating them is the most common source of admin-related bugs.

## Surface

- Instance admin guard: `packages/twenty-server/src/engine/guards/admin-panel-guard.ts`
- Admin GraphQL endpoint factory: `packages/twenty-server/src/engine/api/graphql/admin-panel.module-factory.ts`
- Admin resolvers: `packages/twenty-server/src/engine/core-modules/admin-panel/admin-panel.resolver.ts`
- User entity field: `core."user"."canAccessFullAdminPanel"` (boolean, default false)
- JWT field whitelist: `packages/twenty-server/src/engine/core-modules/auth/constants/auth-context-user-select-fields.constants.ts`
- Workspace admin role constant: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant.ts`

## Contract

### 1. The two layers

| Layer | Field / mechanism | Scope | UI surface |
|---|---|---|---|
| **Instance admin** | `User.canAccessFullAdminPanel = true` (column on `core."user"`) | The whole Twenty server: feature flags, AI model catalog, config variables, system health, all workspaces | `/settings/admin-panel` (frontend) + `/admin-panel-graphql-api` (backend) |
| **Workspace admin** | `WorkspaceMember.role` references the `Admin` role (universalIdentifier `20202020-02c2-43f2-b94d-cab1f2b532eb`) | A single workspace: its members, its settings, its roles | `/settings/members`, `/settings/general`, `/settings/roles` |

The two can be set independently. A user can be a workspace Admin without being an instance admin (the common case) or an instance admin without being an Admin of any workspace (rare; recovery scenarios only).

### 2. Instance admin enforcement

- **Endpoint isolation.** All instance-admin GraphQL operations live behind `/admin-panel-graphql-api`, a separate Yoga endpoint (`api/graphql/admin-panel.module-factory.ts`). The main `/graphql` endpoint does not expose admin resolvers — sending an admin operation there is a schema error, not an auth failure.
- **Guard.** Every operation on the admin endpoint is decorated with `@UseGuards(AdminPanelGuard)` (`admin-panel.resolver.ts` — appears on every mutation/query). The guard (`admin-panel-guard.ts`) reads `request.user.canAccessFullAdminPanel` and rejects unless `=== true`.
- **JWT baking.** `canAccessFullAdminPanel` is selected into the auth context at sign-in time (`auth-context-user-select-fields.constants.ts:12`). The current session's value is therefore frozen for the lifetime of the access token — changing the DB field does not affect an active session until the user signs in again.

### 3. Workspace admin enforcement

Workspace admin is just a role assignment. Members get the Admin role through:

- The standard role assignment flow at `/settings/members` (existing Admin/Owner promotes a member via the role dropdown). The mutation is `updateRole` on the `WorkspaceMember` object, gated on the actor being Admin or Owner of the same workspace.
- A direct DB UPDATE on `core."workspaceMember"."roleId"` (recovery only — bypasses the audit trail).

The Admin role grants `canUpdateAllSettings = true` (see [permissions.md §3](./permissions.md)), so workspace admins automatically pass every `SettingsPermissionGuard` in the workspace, including settings whose individual flags are off.

### 4. Promotion paths

| From | To | Mechanism |
|---|---|---|
| Regular member → workspace Admin | UI: `/settings/members` → role dropdown → Admin |
| Workspace Admin → instance admin | **Direct DB UPDATE** on `core."user"."canAccessFullAdminPanel"`. There is no GraphQL mutation, no UI control, no CLI shipped in this tree. |
| Self-promotion via signup | First user during initial workspace bootstrap is granted `canAccessFullAdminPanel = true` (`auth/services/sign-in-up.service.ts` — `hasServerAdmin()` returns false → grant). After any instance admin exists this path closes. |

### 5. Post-promotion requirement (sign-out + sign-in)

After flipping `canAccessFullAdminPanel` on a DB row, the user **must sign out and sign back in**. Until they do:

- The sidebar will not show the Admin Panel link (the frontend checks the JWT-cached value).
- Hitting `/admin-panel-graphql-api` directly will fail the `AdminPanelGuard` (the guard reads from the JWT-derived `request.user`, not the DB).

This is intentional — it keeps the guard cheap (no DB lookup per request) at the cost of a re-auth on permission change.

## Gotchas

- **No first-user-auto-admin on multi-workspace deploys.** `signUp` is gated by `assertSignUpEnabled` — when `IS_MULTIWORKSPACE_ENABLED=false` (default) and any workspace already exists, sign-up is closed. The first-user-becomes-admin path only fires during the very first bootstrap.
- **Workspace admins can't see other workspaces.** They have full power within their workspace and zero visibility outside. Cross-workspace operations (instance health, feature flags, AI provider config) are exclusively instance-admin territory.
- **`canImpersonate` is a separate user-level boolean.** Don't conflate with `canAccessFullAdminPanel`. Impersonation is `PermissionFlagType.IMPERSONATE` for role-level granting plus the user-level boolean for the kill switch.
- **The admin endpoint URL is not just a frontend route.** `/admin-panel-graphql-api` is a real second GraphQL endpoint with its own resolver registry. When adding a new admin operation, register it in the admin module factory — registering it in the main GraphQL module silently makes it accessible to non-admins.
