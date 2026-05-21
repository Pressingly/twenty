# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Twenty is an open-source CRM built with modern technologies in a monorepo structure. The codebase is organized as an Nx workspace with multiple packages.

## Key Commands

### Development
```bash
# Start development environment (frontend + backend + worker)
yarn start

# Individual package development
npx nx start twenty-front     # Start frontend dev server
npx nx start twenty-server    # Start backend server
npx nx run twenty-server:worker  # Start background worker
```

### Testing
```bash
# Preferred: run a single test file (fast)
npx jest path/to/test.test.ts --config=packages/PROJECT/jest.config.mjs

# Run all tests for a package
npx nx test twenty-front      # Frontend unit tests
npx nx test twenty-server     # Backend unit tests
npx nx run twenty-server:test:integration:with-db-reset  # Integration tests with DB reset
# To run an indivual test or a pattern of tests, use the following command:
cd packages/{workspace} && npx jest "pattern or filename"

# Storybook
npx nx storybook:build twenty-front
npx nx storybook:test twenty-front

# When testing the UI end to end, click on "Continue with Email" and use the prefilled credentials.
```

### Code Quality
```bash
# Linting (diff with main - fastest, always prefer this)
npx nx lint:diff-with-main twenty-front
npx nx lint:diff-with-main twenty-server
npx nx lint:diff-with-main twenty-front --configuration=fix  # Auto-fix

# Linting (full project - slower, use only when needed)
npx nx lint twenty-front
npx nx lint twenty-server

# Type checking
npx nx typecheck twenty-front
npx nx typecheck twenty-server

# Format code
npx nx fmt twenty-front
npx nx fmt twenty-server
```

### Build
```bash
# Build packages (twenty-shared must be built first)
npx nx build twenty-shared
npx nx build twenty-front
npx nx build twenty-server
```

### Database Operations
```bash
# Database management
npx nx database:reset twenty-server         # Reset database
npx nx run twenty-server:database:init:prod # Initialize database
npx nx run twenty-server:database:migrate:prod # Run instance commands (fast only)

# Generate an instance command (fast or slow)
npx nx run twenty-server:database:migrate:generate --name <name> --type <fast|slow>
```

### Database Inspection (Postgres MCP)

A read-only Postgres MCP server is configured in `.mcp.json`. Use it to:
- Inspect workspace data, metadata, and object definitions while developing
- Verify migration results (columns, types, constraints) after running migrations
- Explore the multi-tenant schema structure (core, metadata, workspace-specific schemas)
- Debug issues by querying raw data to confirm whether a bug is frontend, backend, or data-level
- Inspect metadata tables to debug GraphQL schema generation issues

This server is read-only — for write operations (reset, migrations, sync), use the CLI commands above.

### GraphQL
```bash
# Generate GraphQL types (run after schema changes)
npx nx run twenty-front:graphql:generate
npx nx run twenty-front:graphql:generate --configuration=metadata
```

## Architecture Overview

### Tech Stack
- **Frontend**: React 18, TypeScript, Jotai (state management), Linaria (styling), Vite
- **Backend**: NestJS, TypeORM, PostgreSQL, Redis, GraphQL (with GraphQL Yoga)
- **Monorepo**: Nx workspace managed with Yarn 4

### Package Structure
```
packages/
├── twenty-front/          # React frontend application
├── twenty-server/         # NestJS backend API
├── twenty-ui/             # Shared UI components library
├── twenty-shared/         # Common types and utilities
├── twenty-emails/         # Email templates with React Email
├── twenty-website/        # Next.js documentation website
├── twenty-zapier/         # Zapier integration
└── twenty-e2e-testing/    # Playwright E2E tests
```

### Key Development Principles
- **Functional components only** (no class components)
- **Named exports only** (no default exports)
- **Types over interfaces** (except when extending third-party interfaces)
- **String literals over enums** (except for GraphQL enums)
- **No 'any' type allowed** — strict TypeScript enforced
- **Event handlers preferred over useEffect** for state updates
- **Props down, events up** — unidirectional data flow
- **Composition over inheritance**
- **No abbreviations** in variable names (`user` not `u`, `fieldMetadata` not `fm`)

### Naming Conventions
- **Variables/functions**: camelCase
- **Constants**: SCREAMING_SNAKE_CASE
- **Types/Classes**: PascalCase (suffix component props with `Props`, e.g. `ButtonProps`)
- **Files/directories**: kebab-case with descriptive suffixes (`.component.tsx`, `.service.ts`, `.entity.ts`, `.dto.ts`, `.module.ts`)
- **TypeScript generics**: descriptive names (`TData` not `T`)

### File Structure
- Components under 300 lines, services under 500 lines
- Components in their own directories with tests and stories
- Use `index.ts` barrel exports for clean imports
- Import order: external libraries first, then internal (`@/`), then relative

### Comments
- Use short-form comments (`//`), not JSDoc blocks
- Explain WHY (business logic), not WHAT
- Do not comment obvious code
- Multi-line comments use multiple `//` lines, not `/** */`

### State Management
- **Jotai** for global state: atoms for primitive state, selectors for derived state, atom families for dynamic collections
- Component-specific state with React hooks (`useState`, `useReducer` for complex logic)
- GraphQL cache managed by Apollo Client
- Use functional state updates: `setState(prev => prev + 1)`

### Backend Architecture
- **NestJS modules** for feature organization
- **TypeORM** for database ORM with PostgreSQL
- **GraphQL** API with code-first approach
- **Redis** for caching and session management
- **BullMQ** for background job processing

### Database & Upgrade Commands
- **PostgreSQL** as primary database
- **Redis** for caching and sessions
- **ClickHouse** for analytics (when enabled)
- When changing entity files, generate an **instance command** (`database:migrate:generate --name <name> --type <fast|slow>`)
- **Fast** instance commands handle schema changes; **slow** ones add a `runDataMigration` step for data backfills
- **Workspace commands** iterate over all active/suspended workspaces for per-workspace upgrades
- Commands use `@RegisteredInstanceCommand` and `@RegisteredWorkspaceCommand` decorators for automatic discovery
- Include both `up` and `down` logic in instance commands
- Never delete or rewrite committed instance command `up`/`down` logic
- See `packages/twenty-server/docs/UPGRADE_COMMANDS.md` for full documentation

### Utility Helpers
Use existing helpers from `twenty-shared` instead of manual type guards:
- `isDefined()`, `isNonEmptyString()`, `isNonEmptyArray()`

## Access Control & Permissions

Twenty has **two independent admin layers** — do not conflate them:

| Layer | Field / role | Scope | UI |
|---|---|---|---|
| **Instance admin** | `User.canAccessFullAdminPanel = true` (on `core.user`) | Whole Twenty instance — feature flags, system health, AI models, config variables | `/settings/admin-panel` |
| **Workspace admin** | `WorkspaceMember.role = "Admin"` (universalIdentifier `20202020-02c2-43f2-b94d-cab1f2b532eb`) | One workspace — members, settings within it | `/settings/members`, `/settings/general` |

- Instance admin is enforced by `AdminPanelGuard` (`packages/twenty-server/src/engine/guards/admin-panel-guard.ts`) on every admin GraphQL op. Admin endpoint is `/admin-panel-graphql-api`, separate from `/graphql`.
- `canAccessFullAdminPanel` is **baked into the JWT at sign-in time** (`auth-context-user-select-fields.constants.ts:12`). After flipping it in the DB, the user MUST sign out and back in for the change to take effect.
- There is **no GraphQL mutation** to toggle `canAccessFullAdminPanel`. Only paths are the CLI bootstrap command (in deployment bundles) or a direct DB UPDATE on `core."user"`.
- Admin role universal identifier: `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant.ts:2`.

### Permission flags (`PermissionFlagType`)

Many features are gated by `SettingsPermissionGuard(PermissionFlagType.<FLAG>)` at the resolver layer. Flags split into two categories (`packages/twenty-shared/src/constants/PermissionFlagType.ts`):

- **Settings flags** (`WORKFLOWS`, `WORKSPACE_MEMBERS`, `ROLES`, `DATA_MODEL`, `SECURITY`, `BILLING`, `AI_SETTINGS`, …) — bypassed by `role.canUpdateAllSettings = true`.
- **Tool flags** (`AI`, `VIEWS`, `UPLOAD_FILE`, `IMPORT_CSV`, `SEND_EMAIL_TOOL`, …; canonical list in `permissions/constants/tool-permission-flags.ts`) — bypassed by `role.canAccessAllTools = true`.

The guard picks which bypass-boolean via `isToolPermission(flag)`. Default value for **every** flag on a non-admin role is `false` (`permissions.service.ts:100-128`).

A role passes the guard if **either**:
- The category-appropriate bypass is true on the role, OR
- The role's `permissionFlags` array contains an explicit entry for that flag.

Check logic: `permissions.service.ts:checkRolePermissions` (~232-249). Bootstrap bypass: guard returns true while workspace is in `PENDING_CREATION`/`ONGOING_CREATION` state.

**Workflows are gated this way.** Every workflow resolver (`workflow-builder`, `workflow-version`, `workflow-trigger`, `workflow-version-step`, `workflow-version-edge`, plus `logic-function`) uses `SettingsPermissionGuard(PermissionFlagType.WORKFLOWS)`. A second enforcement layer in `workspace-roles-permissions-cache.service.ts:149-160` also sets `canRead/canUpdate/canSoftDelete/canDestroy = false` on the `workflow`, `workflowRun`, and `workflowVersion` objects when the flag is off — so workflows are hidden from listings too, not just blocked on create.

**To grant a non-admin user workflow access:** go to `/settings/roles`, edit their role, toggle the **Workflows** permission flag on. No code change needed — the default-off behavior is intentional.

## SSO (Single Sign-On)

**This repo = upstream Twenty.** Upstream supports per-workspace OIDC and SAML SSO, gated as an Enterprise feature. The header-trust / proxy-login flow used in deployment bundles (oauth2-proxy + Traefik ForwardAuth) lives in a **separate fork** and is **NOT present in this tree** — `grep` for `proxy-login` / `ProxyAuthMiddleware` / `AUTH_TYPE` returns nothing here. Don't waste a session looking for it in this repo; the bundle-side contract is owned by the bundle/fork repos, not this one. Full spec: [`docs/specs/sso.md`](docs/specs/sso.md).

### Upstream SSO surface (this repo)

- **Provider entity:** `WorkspaceSSOIdentityProvider` at `packages/twenty-server/src/engine/core-modules/sso/workspace-sso-identity-provider.entity.ts` — type (`OIDC` | `SAML`), `status` (Active/Inactive/Error), `issuer`, OIDC fields (`clientID`, `clientSecret`), SAML fields (`ssoURL`, `certificate`, `fingerprint`), `workspaceId` FK.
- **HTTP routes** (`auth/controllers/sso-auth.controller.ts`):
  - `GET /auth/oidc/login/:identityProviderId` — initiate OIDC (guard: `OIDCAuthGuard`)
  - `GET /auth/oidc/callback` — IDP callback
  - `GET /auth/saml/login/:identityProviderId` — initiate SAML (guard: `SAMLAuthGuard`)
  - `POST /auth/saml/callback/:identityProviderId` — SAML callback
  - `GET /auth/saml/metadata/:identityProviderId` — SP metadata XML
- **Strategies:** OIDC uses `openid-client` (`auth/strategies/oidc.auth.strategy.ts`); SAML uses `@node-saml/passport-saml` `MultiSamlStrategy` for per-request provider lookup (`auth/strategies/saml.auth.strategy.ts`) — certificate whitespace is sanitised at load.
- **GraphQL mutations** (`sso/sso.resolver.ts`): `createOIDCIdentityProvider`, `createSAMLIdentityProvider`, `editSSOIdentityProvider`, `deleteSSOIdentityProvider`. Frontend kicks off login via the `getAuthorizationUrlForSSO` mutation (returns `authorizationURL` + provider type).
- **Frontend:** `packages/twenty-front/src/modules/auth/sign-in-up/components/internal/SignInUpWithSSO.tsx` + `hooks/useSSO.ts`. One provider → direct redirect; multiple → picker (`SignInUpStep.SSOIdentityProviderSelection`). Active providers come from `get-auth-providers-by-workspace.util.ts`.
- **Login resolution:** controller calls `authService.findWorkspaceForSignInUp()` then `signInUp()` to link user↔workspace, then `generateLoginToken()` and redirects to the workspace subdomain. Optional `ConnectedAccount` write is feature-flagged.
- **Gating** (both must pass):
  - Instance: `EnterpriseFeaturesEnabledGuard` (`auth/guards/enterprise-features-enabled.guard.ts`) — `enterprisePlanService.isValid()` based on a signed JWT licence. There is **no plain env var** to disable SSO globally.
  - Workspace: `BillingService.hasEntitlement(BillingEntitlementKey.SSO)` per workspace.
- **Login email override.** The synthesised email from IDP claims (e.g. oauth2-proxy `cognito:username`) is what `signInUp` keys on. Workspace membership and any per-user state hangs off this — make sure it's stable across IDP rotations.

## Specs

Cross-cutting capability specs live in `docs/specs/`. They describe **what this repo actually does**, with file:line citations, and are kept in sync with code in the same PR.

- [`docs/specs/sso.md`](docs/specs/sso.md) — Workspace OIDC/SAML SSO: providers, routes, strategies, enterprise + workspace gating, login resolution.
- [`docs/specs/permissions.md`](docs/specs/permissions.md) — Role-based access control: `SettingsPermissionGuard`, `PermissionFlagType`, role capability booleans, the object-permission cache, and the workflow example.
- [`docs/specs/admin-panel.md`](docs/specs/admin-panel.md) — Instance vs workspace admin, `AdminPanelGuard`, JWT-baked `canAccessFullAdminPanel`, promotion paths and the sign-out requirement.
- [`docs/specs/README.md`](docs/specs/README.md) — Index + conventions for adding/maintaining specs.

When adding a new cross-cutting capability or changing one of the above, update the relevant spec in the same PR. Don't reach for external rule sets — this repo owns its specs.

## Development Workflow

IMPORTANT: Use Context7 for code generation, setup or configuration steps, or library/API documentation. Automatically use the Context7 MCP tools to resolve library IDs and get library docs without waiting for explicit requests.

### Before Making Changes
1. Always run linting (`lint:diff-with-main`) and type checking after code changes
2. Test changes with relevant test suites (prefer single-file test runs)
3. Ensure instance commands are generated for entity changes (`database:migrate:generate`)
4. Check that GraphQL schema changes are backward compatible
5. Run `graphql:generate` after any GraphQL schema changes

### Code Style Notes
- Use **Linaria** for styling with zero-runtime CSS-in-JS (styled-components pattern)
- Follow **Nx** workspace conventions for imports
- Use **Lingui** for internationalization
- Apply security first, then formatting (sanitize before format)

### Testing Strategy
- **Test behavior, not implementation** — focus on user perspective
- **Test pyramid**: 70% unit, 20% integration, 10% E2E
- Query by user-visible elements (text, roles, labels) over test IDs
- Use `@testing-library/user-event` for realistic interactions
- Descriptive test names: "should [behavior] when [condition]"
- Clear mocks between tests with `jest.clearAllMocks()`

## Dev Environment Setup

All dev environments (Claude Code web, Cursor, local) use one script:

```bash
bash packages/twenty-utils/setup-dev-env.sh
```

This handles everything: starts Postgres + Redis (auto-detects local services vs Docker), creates databases, and copies `.env` files. Idempotent — safe to run multiple times.

- `--docker` — force Docker mode (uses `packages/twenty-docker/docker-compose.dev.yml`)
- `--down` — stop services
- `--reset` — wipe data and restart fresh
- **Skip the setup script** for tasks that only read code — architecture questions, code review, documentation, etc.

**Note:** CI workflows (GitHub Actions) manage services via Actions service containers and run setup steps individually — they don't use this script.

## Important Files
- `nx.json` - Nx workspace configuration with task definitions
- `tsconfig.base.json` - Base TypeScript configuration
- `package.json` - Root package with workspace definitions
- `.cursor/rules/` - Detailed development guidelines and best practices
