# Twenty SSO Workspace Bootstrap — Design

**Date:** 2026-05-04
**Author:** awais.qureshi@arbisoft.com
**Status:** Spec — pending implementation
**Target branch:** `sso-auth`
**Devstack repo:** `foss-server-bundle-devstack`
**Supersedes:** Manual bootstrap path documented in `2026-04-28-twenty-sso-design.md` §10 (known issue #5)

---

## 1. Goal

Replace the manual Askii-workspace bootstrap step (currently a known issue) with an idempotent nest CLI command callable from the devstack provisioning pipeline. The command must produce a workspace whose `subdomain` matches `ASKII_WORKSPACE_SUBDOMAIN`, so first-time SSO logins resolve to it without a 500.

Each SMB runs on a dedicated AWS instance — no multi-tenant concerns. One Twenty per instance, one Askii workspace per Twenty.

## 2. Problem

`SsoUserProvisioningService.findOrProvision` looks up the landing workspace via `subdomain = ASKII_WORKSPACE_SUBDOMAIN`. If no workspace with that subdomain exists, every SSO login fails with `500 / SSO workspace not provisioned`. Twenty's normal sign-up flow generates a random subdomain and assumes a human at a browser; the devstack bring-up has neither.

Raw SQL seeding is unsafe — a workspace requires a per-workspace Postgres schema, default roles (admin, member), default views, and a `WorkspaceCustomApplication`. Skipping any of these leaves the workspace in an unusable state that surfaces only on first record write.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Bootstrap layer | Nest CLI command in `twenty-server` | Reuses Twenty's own `WorkspaceManagerService.init` + `WorkspaceService.activateWorkspace` — schema, roles, app, views all created by code paths Twenty already maintains. |
| Trigger location | Bundle `provision.sh`, after `compose up -d twenty twenty-worker` healthy | Twenty container must be running for `docker exec`; provisioning is the canonical "post-stack-up" hook. |
| Idempotency | Check `workspaceRepository.findOne({where:{subdomain}})` first | Re-runs become no-ops; provisioning script can be replayed safely. |
| Parameterization | `--subdomain` + `--admin-email` (+ `--display-name` optional), default to env (`ASKII_WORKSPACE_SUBDOMAIN`, `ADMIN_EMAIL`) | Flags keep the command testable; env defaults match how the running container is already configured, so the bundle Makefile target stays a one-liner. |
| Admin user creation | Reuse `signInUpService.signUpOnNewWorkspace` with `newUserWithPicture` payload | Inherits transaction handling, application creation, onboarding state. We patch the auto-generated subdomain after the transaction commits. |
| Workspace activation | Call `workspaceService.activateWorkspace` after subdomain patch | Triggers schema creation, default-role setup, prefill, upgrade-state init — the full chain a normal sign-up gets. |
| Admin role assignment | Implicit via `setupDefaultRoles` (called by `activateWorkspace → workspaceManagerService.init`) | The bootstrap user is the only `userWorkspace` row at activation time, so `setupDefaultRoles` assigns admin to it automatically (existing code path, line 130–146 of `workspace-manager.service.ts`). |
| Local auth coexistence | Bootstrap admin keeps a randomly-generated password it never receives | Frontend hides local auth UI when `AUTH_TYPE=SSO`; backend `/auth/sign-in` is still wired but unreachable for an unknown password. The admin lands via SSO like any other user (matching email). |

## 4. Architecture

### 4.1 Provisioning flow

```
foss-server-bundle-devstack/provision.sh
  └── make dev.bootstrap.twenty
       └── docker exec foss-devstack-twenty \
             yarn command:prod workspace:bootstrap-sso \
               --subdomain "$ASKII_WORKSPACE_SUBDOMAIN" \
               --admin-email "$ADMIN_EMAIL" \
               --display-name "$ASKII_WORKSPACE_DISPLAY_NAME"
            └── BootstrapSsoWorkspaceCommand.run
                 ├─ workspaceRepository.findOne({subdomain})
                 │    ├─ found → log "already bootstrapped"; exit 0
                 │    └─ not found → continue
                 ├─ signInUpService.signUpOnNewWorkspace({newUserWithPicture})
                 │    → returns { user, workspace }   (workspace.subdomain = random)
                 ├─ workspaceRepository.update(workspace.id, { subdomain: <flag> })
                 ├─ workspaceService.activateWorkspace(user, workspace, { displayName })
                 │    → schema creation, default app, default roles, prefill, upgrade state
                 └─ log "bootstrapped subdomain=X admin=Y"
```

### 4.2 Runtime impact on `findOrProvision`

After bootstrap, the workspace row exists with the configured subdomain. `SsoUserProvisioningService.findOrProvision` proceeds as designed:

1. `workspaceRepository.findOne({where:{subdomain}})` → hit.
2. `findOrCreateUser(email)` → existing admin row returned (when admin's own email comes in via SSO) or new row created (any other email).
3. `userWorkspaceService.addUserToWorkspaceIfUserNotInWorkspace(user, workspace)` → assigns the workspace's `defaultRoleId` (member) to non-admin users; admin already has admin role from setup.

No change to `sso-user-provisioning.service.ts` is required.

## 5. Component design

### 5.1 New file

`packages/twenty-server/src/engine/core-modules/auth/commands/bootstrap-sso-workspace.command.ts`

```typescript
@Command({
  name: 'workspace:bootstrap-sso',
  description:
    'Idempotently create a workspace bound to a fixed subdomain. Used by foss-server-bundle-devstack provisioning to seed the Askii landing workspace before any SSO login.',
})
export class BootstrapSsoWorkspaceCommand extends CommandRunner {
  // injected:
  //   workspaceRepository (WorkspaceEntity)
  //   signInUpService
  //   workspaceService
  //
  // flags:
  //   --subdomain     <string>   required
  //   --admin-email   <string>   required
  //   --display-name  <string>   optional, default = subdomain title-cased
  //
  // contract:
  //   exit 0 if workspace with --subdomain already exists
  //   exit 0 after successful bootstrap
  //   non-zero (with stack) on any internal failure
}
```

### 5.2 Module wiring

`AuthModule` providers list grows by one entry: `BootstrapSsoWorkspaceCommand`. AuthModule already imports `WorkspaceModule` (where `WorkspaceService` lives) and the entities we need (`WorkspaceEntity` via TypeOrmModule.forFeature). No new module imports.

### 5.3 No new types, DTOs, or migrations

The command operates entirely through existing services. No schema change to `core` or workspace schemas.

## 6. Idempotency contract

- Pre-condition check: `SELECT … FROM core.workspace WHERE subdomain = $1` → if row exists, log + exit 0.
- Post-condition: exactly one row in `core.workspace` with the requested subdomain, in `ACTIVE` state, owned by an admin user with the requested email.
- Concurrent runs: not supported. The provisioning pipeline is single-threaded; if two runs race the second loses to the unique-constraint on `subdomain` and surfaces a clean error.

## 7. Bundle integration (separate repo)

Lives outside this branch — implemented in `foss-server-bundle-devstack` on `feat/twenty-crm`:

- `Makefile` target `dev.bootstrap.twenty` reads `ASKII_WORKSPACE_SUBDOMAIN`, `ADMIN_EMAIL`, optional `ASKII_WORKSPACE_DISPLAY_NAME` from `.env` and shells out via `docker exec`.
- `provision.sh` calls `make dev.bootstrap.twenty` after `wait-ready.sh` confirms `foss-devstack-twenty` healthcheck has flipped green. Failure of this step fails the whole provision (same as Plane/Outline workspace seeding does today).
- New env vars added to `.env.example` with `CHANGE_ME_*` placeholders where needed; `ASKII_WORKSPACE_SUBDOMAIN` defaults to `askii`.

## 8. Failure modes & handling

| Failure | Detection | Response |
|---|---|---|
| Twenty container not healthy when bootstrap runs | `docker exec` fails with non-zero | `provision.sh` fails fast with the docker error; user re-runs after fixing twenty. |
| Subdomain already taken by another row (e.g. partial previous run) | UniqueConstraint on `subdomain` from `signUpOnNewWorkspace`'s auto-generated value | Auto-generated subdomain is random — collision impossible. Patch via `update` is guarded by the pre-flight `findOne` check (no row exists with the target subdomain when we reach the patch). |
| `assertWorkspaceCreationAllowed` blocks (e.g. payment plan check, sign-up disabled) | Throws `AuthException` from inside `signUpOnNewWorkspace` | Caught by command runner, logged, non-zero exit. Operator sets `IS_SIGN_UP_ENABLED=true` for the bootstrap container or we add a `--force` flag (deferred — not needed for OSS dev path). |
| Activation partially completes, command crashes mid-way | Workspace ends up in `ONGOING_CREATION` | Re-run does NOT skip (because `findOne({subdomain})` will hit the row). Manual cleanup required. Documented in known issues. Not blocking the OSS dev path; add a recovery flag in v2 if it bites in production. |
| User tries to bootstrap with an email that already owns a workspace | `signUpOnNewWorkspace` happily creates a new workspace and adds the existing user to it | Acceptable. The constraint is on workspace.subdomain, not user.email. |

## 9. Open issues / non-goals

- **Non-goal:** changing the SSO provisioning flow itself. `findOrProvision` stays as-is.
- **Non-goal:** auto-bootstrap on Twenty container start (option C from brainstorming). Coupling app startup to deployment env was rejected.
- **Open:** whether to set `WorkspaceActivationStatus.ACTIVE` explicitly after `activateWorkspace`. Need to confirm `activateWorkspace` reaches `ACTIVE` and not just `ONGOING_CREATION` — to verify during implementation by reading `activateAndInitializeUpgradeState`.
- **Open:** onboarding state. The bootstrap admin will never log in via local auth; their onboarding flags are irrelevant. Default `signUpOnNewWorkspace` behavior — including `setOnboardingInviteTeamPending(true)` — is harmless and left alone.
- **Open:** whether to expose this command via a Makefile target in `twenty-server` for local dev convenience. Deferred — bundle Makefile is the consumer.

## 10. Acceptance criteria

1. `yarn command:prod workspace:bootstrap-sso` (flags omitted; reads `ASKII_WORKSPACE_SUBDOMAIN` + `ADMIN_EMAIL` from env) exits 0 on a fresh DB, and the resulting workspace row in `core.workspace` shows `subdomain='askii'`, `activationStatus='ACTIVE'`, with a per-workspace schema visible in `pg_namespace`.
2. Re-running the same command exits 0 with a "already bootstrapped" log line and no DB changes.
3. After bootstrap, hitting `https://foss-twenty.local.moneta.dev/` and signing in via Cognito (any email) lands the SPA on the dashboard with no 500 from `/auth/sso/proxy-login`.
4. The admin email lands with admin role; subsequent SSO emails land with the workspace's `defaultRoleId` (member).

## 11. Implementation steps (rough)

1. Read `WorkspaceModule` exports to confirm `WorkspaceService` is exported and importable from `AuthModule`.
2. Implement `BootstrapSsoWorkspaceCommand` per §5.1.
3. Register provider in `AuthModule`.
4. Verify build: `npx nx build twenty-shared && npx nx build twenty-emails && npx nx typecheck twenty-server`.
5. Smoke test inside running container: `docker exec foss-devstack-twenty yarn command:prod workspace:bootstrap-sso --subdomain test1 --admin-email a@b.com`. Inspect DB.
6. Run twice to verify idempotency.
7. Hit the SSO landing flow end-to-end in the browser.
8. Bundle-side Makefile + provision.sh changes (separate repo, separate branch, separate review).
