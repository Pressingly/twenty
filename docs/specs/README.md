# Twenty specs

In-repo specifications for cross-cutting capabilities of this Twenty tree. The goal: a future engineer (human or LLM) can confirm what THIS codebase is supposed to do without leaving the repo.

These specs describe **observed contract**, not aspirational design. When code changes, update the spec in the same PR.

## Scope

These specs cover **upstream Twenty as it lives in this repository**. They do not describe forks (e.g. `Pressingly/twenty`) or deployment bundles. If a behaviour exists only in a downstream fork, it is out of scope here — document it in that fork.

## Index

| Spec | What it covers |
|---|---|
| [sso.md](./sso.md) | Workspace-scoped SSO: OIDC + SAML providers, routes, strategies, enterprise gating, login resolution |
| [permissions.md](./permissions.md) | Role-based access control: settings permission flags, `SettingsPermissionGuard`, role capabilities (`canUpdateAllSettings`, etc.), and the dual-layer object-permission cache. Includes the workflow-access example. |
| [admin-panel.md](./admin-panel.md) | The two independent admin layers (instance vs workspace), `AdminPanelGuard`, JWT-baked admin flag, bootstrap reality |

## Conventions

- Each spec opens with a one-sentence **Purpose** and a **Surface** list (what's in scope).
- The **Contract** section lists numbered, testable rules. Cite `file/path.ts:line` for every rule that is enforced in code.
- A **Gotchas** section captures non-obvious failure modes that have bitten past sessions.
- Specs evolve. Verify the cited line numbers before quoting in a PR — they drift.
