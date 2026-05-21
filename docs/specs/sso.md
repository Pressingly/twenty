# Spec: Workspace SSO (OIDC + SAML)

## Purpose

Allow a workspace owner to configure one or more external identity providers (OIDC or SAML) so that workspace members sign in via their corporate IdP instead of Twenty's password flow.

## Surface

- Backend module: `packages/twenty-server/src/engine/core-modules/sso/`
- Auth controller: `packages/twenty-server/src/engine/core-modules/auth/controllers/sso-auth.controller.ts`
- Guards: `auth/guards/oidc-auth.guard.ts`, `auth/guards/saml-auth.guard.ts`, `auth/guards/enterprise-features-enabled.guard.ts`
- Strategies: `auth/strategies/oidc.auth.strategy.ts`, `auth/strategies/saml.auth.strategy.ts`
- Frontend entry: `packages/twenty-front/src/modules/auth/sign-in-up/components/internal/SignInUpWithSSO.tsx`, `hooks/useSSO.ts`

## Contract

### 1. Provider entity

A workspace SSO provider is a row in `core."workspaceSSOIdentityProvider"` (`sso/workspace-sso-identity-provider.entity.ts`):

- `type` is one of `OIDC` | `SAML` (`IdentityProviderType` enum).
- `status` is `Active` | `Inactive` | `Error` (`SSOIdentityProviderStatus` enum). Only **Active** providers are surfaced to the sign-in UI.
- `workspaceId` is a foreign key — providers are workspace-scoped, never instance-global.
- OIDC providers carry `issuer`, `clientID`, `clientSecret`.
- SAML providers carry `issuer`, `ssoURL`, `certificate`, optional `fingerprint`.
- The row's `id` is the provider UUID; this UUID appears in the public URLs (see below).

### 2. HTTP routes

All routes mounted on the public Twenty server. **`EnterpriseFeaturesEnabledGuard` is re-declared on every route** via `@UseGuards` (not on the controller class) — `sso-auth.controller.ts:59-117`. Adding a new SSO route without that decorator silently bypasses the enterprise gate.

| Method | Path | Additional guard(s) | Purpose |
|---|---|---|---|
| GET | `/auth/oidc/login/:identityProviderId` | `OIDCAuthGuard` | Initiate OIDC flow → 302 to IdP |
| GET | `/auth/oidc/callback` | `OIDCAuthGuard` | IdP redirect target; mints login token |
| GET | `/auth/saml/login/:identityProviderId` | `SAMLAuthGuard` | Initiate SAML AuthnRequest |
| POST | `/auth/saml/callback/:identityProviderId` | `SAMLAuthGuard` | SAML assertion consumer |
| GET | `/auth/saml/metadata/:identityProviderId` | — | SP metadata XML |

`:identityProviderId` is the row UUID from §1. It is the only way a request selects which provider to use.

### 3. Strategy loading

- **OIDC** (`oidc.auth.strategy.ts`): uses the `openid-client` library. The guard resolves the issuer at request time via OpenID Connect Discovery and instantiates the strategy on demand. The strategy validates the `email` and `given_name`/`family_name` claims from the userinfo endpoint.
- **SAML** (`saml.auth.strategy.ts`): uses `@node-saml/passport-saml`'s `MultiSamlStrategy` so per-provider config is looked up at request time from the DB row. Certificate whitespace is stripped before passing to the strategy. The strategy validates that the SAML assertion contains an email attribute.

### 4. Login resolution

After the IdP returns a valid identity, `sso-auth.controller.ts` (`authCallback` path):

1. Reads the provider entity by `identityProviderId`.
2. Resolves a target workspace via `authService.findWorkspaceForSignInUp()` (provider's `workspaceId`).
3. Calls `authService.signInUp()` to find or create the user, attach to the workspace, and assign the workspace's `defaultRoleId` if no membership exists.
4. Mints a short-lived login token via `generateLoginToken()` and redirects to the workspace subdomain.
5. Optionally writes a SSO `ConnectedAccount` for token-claim provenance (feature-flagged).

### 5. Frontend flow

`hooks/useSSO.ts` calls the `getAuthorizationUrlForSSO` GraphQL mutation with the workspace context (read from `workspaceInviteHash` or current subdomain). The mutation returns `{ authorizationURL, type }`. Behaviour by provider count:

- **0 active providers** → SSO entry is hidden (password flow only, if enabled).
- **1 active provider** → direct `window.location = authorizationURL`.
- **>1 active providers** → `SignInUpStep.SSOIdentityProviderSelection` picker.

Active providers come from `packages/twenty-server/src/engine/core-modules/workspace/utils/get-auth-providers-by-workspace.util.ts`, which filters on `status === Active`.

### 6. Gating

Two independent gates; **both** must pass:

1. **Instance**: `EnterpriseFeaturesEnabledGuard` (`auth/guards/enterprise-features-enabled.guard.ts`) calls `enterprisePlanService.isValid()`, which validates a signed Enterprise licence JWT. There is **no plain env var** that disables SSO globally — it is licence-gated by design.
2. **Workspace**: `BillingService.hasEntitlement(BillingEntitlementKey.SSO)` checked in `sso/services/sso.service.ts` (the `featureLookUpKey` field). A workspace without the entitlement cannot register providers, even on a licensed instance.

### 7. GraphQL surface

Resolver: `sso/sso.resolver.ts`.

- `createOIDCIdentityProvider(input: SetupOIDCSsoInput)` — issuer URL, clientID, clientSecret, name.
- `createSAMLIdentityProvider(input: SetupSAMLSsoInput)` — issuer URL, ssoURL, certificate (+ optional fingerprint), name, provider UUID.
- `editSSOIdentityProvider`, `deleteSSOIdentityProvider`.
- `getAuthorizationUrlForSSO` — used by the frontend to discover the redirect URL for a given workspace.

All mutations are guarded by `WorkspaceAuthGuard` + `EnterpriseFeaturesEnabledGuard`.

## Gotchas

- **Email is the login key.** `signInUp()` keys on the IdP-provided email. If the IdP rotates a user's email, the next login creates a new `core.user` row instead of resolving the existing one. Memberships and per-user state hang off this — plan IdP changes accordingly.
- **No instance-global "disable SSO" toggle.** If you want a deploy that never authenticates via SSO, you must avoid issuing an enterprise licence, not toggle an env var. Removing existing provider rows is per-workspace.
- **`workspaceInviteHash` is the only way to select workspace at sign-in.** When a user belongs to multiple workspaces, the frontend must pass the invite hash (or the request must come from a workspace subdomain) for `findWorkspaceForSignInUp` to disambiguate.
- **Certificate whitespace.** SAML certificates pasted with stray whitespace will not pre-validate; `saml.auth.strategy.ts` strips whitespace internally, but external tools (e.g. metadata validators) may reject the same blob — store the normalised form.
