#!/usr/bin/env bash
#
# sso-audit.sh — Twenty-side fork audit against the cross-app SSO contract.
#
# ============================================================================
# Covers the fork-side rows of awais786/sso-rules-moneta:openspec/specs/
# proxy-auth-middleware/spec.md that a deterministic bash check can verify
# against Twenty's source tree. Catches regressions BEFORE they reach
# foss-server-bundle-devstack, where the same rows currently emit `?` (no
# fork code on disk in the bundle CI).
#
# Together with the bundle-side audit and the per-fork audits in Plane /
# Outline / Penpot / SurfSense, the cross-app contract is now ~14 of 21
# rows deterministic without any LLM invocation.
#
# Exit codes:
#   0 — all rows ✅ or n/a / informational
#   1 — at least one SECURITY-CRITICAL row failed (today: row 20 session-
#       identity reconciliation). These violations re-open the cross-user
#       identity-leak class of bug.
#
# Rows covered:
#   Row 14 — logout shape: SPA logout file (packages/twenty-front/src/
#            modules/auth/hooks/useAuth.ts) MUST NOT call /oauth2/sign_out.
#            (The portal-host redirect target uses buildPortalUrl — verified
#            elsewhere; this row only enforces no /oauth2/sign_out literal.)
#   Row 20 — session-identity reconciliation (Rule 2 mismatch flush):
#            JwtAuthGuard MUST call response.clearCookie('tokenPair', ...)
#            on identity mismatch when AUTH_TYPE === 'SSO'. Without this,
#            the stale-session-on-user-switch leak returns.  SECURITY-CRITICAL.
#   Row 21 — email-shape detection MUST NOT use polynomial-backtracking
#            regex. Twenty uses indexOf-based detection in
#            normalizeProxyEmail today; this row fires only if a regex is
#            reintroduced.
#
# Source of truth: awais786/sso-rules-moneta:openspec/specs/proxy-auth-
# middleware/spec.md. When upstream adds a new fork-side row, vendor the
# updated check here.
# ============================================================================

set -euo pipefail

JWT_GUARD="packages/twenty-server/src/engine/guards/jwt-auth.guard.ts"
USE_AUTH="packages/twenty-front/src/modules/auth/hooks/useAuth.ts"

declare -a ROW_STATUS=()
declare -a ROW_TITLES=(
  "logout shape: SPA logout does not call /oauth2/sign_out"
  "session-identity reconciliation present (Rule 2 mismatch flush)"
  "email-shape detection uses indexOf, not polynomial regex"
)
declare -a ROW_NOTES=()
declare -a ROW_NUMBERS=(14 20 21)

# Security-critical row indices (0-indexed into ROW_NUMBERS above).
SECURITY_CRITICAL=(1)   # index 1 → row 20
SECURITY_CRITICAL_FAILS=0

record() {
  local idx=$1 status=$2 note=$3
  ROW_STATUS[$idx]="$status"
  ROW_NOTES[$idx]="$note"
  if [[ "$status" == "❌" ]]; then
    for c in "${SECURITY_CRITICAL[@]}"; do
      if [[ "$c" -eq "$idx" ]]; then
        SECURITY_CRITICAL_FAILS=$((SECURITY_CRITICAL_FAILS + 1))
        return
      fi
    done
  fi
}

# ============================================================================
# Row 14 (idx 0): logout shape — narrow check
#
# SPA logout MUST NOT contain `/oauth2/sign_out` literal. Twenty's logout
# uses `buildPortalUrl` to compute the redirect target; this audit only
# verifies the SPA doesn't try to clear the upstream proxy cookie itself.
# ============================================================================
check_row_14() {
  if [[ ! -f "$USE_AUTH" ]]; then
    record 0 "?" "$USE_AUTH not found — skipping"
    return
  fi

  if grep -qE '/oauth2/sign_?out' "$USE_AUTH"; then
    local line
    line=$(grep -nE '/oauth2/sign_?out' "$USE_AUTH" | head -1)
    record 0 "❌" "Logout calls \`/oauth2/sign_out\` at $USE_AUTH:$line — per logout-flow spec, per-app Logout is navigation-only. Drop the call; portal 'Logout all' handles oauth2-proxy clearing."
    return
  fi

  record 0 "✅" "$USE_AUTH does not invoke \`/oauth2/sign_out\` (this row verifies only that the SPA doesn't try to clear the upstream proxy cookie itself; that's the portal's job)"
}

# ============================================================================
# Row 20 (idx 1): session-identity reconciliation
#
# JwtAuthGuard MUST clear the tokenPair cookie on identity mismatch:
#   response.clearCookie('tokenPair', { path: '/' })
#
# AND it MUST gate the mismatch check on AUTH_TYPE === 'SSO' so non-SSO
# deployments are unaffected.
#
# Deterministic signal:
#   - SSO gate: get('AUTH_TYPE') === 'SSO'
#   - mismatch operands: X-Auth-Request-Email + data.user.email
#   - token flush: clearCookie('tokenPair', ...)
# All must exist in the same nearby block (within ±25 lines), so unrelated
# AUTH_TYPE/clearCookie references elsewhere in the file cannot false-pass.
#
# SECURITY-CRITICAL: without this, the stale-session leak returns.
# ============================================================================
check_row_20() {
  if [[ ! -f "$JWT_GUARD" ]]; then
    record 1 "?" "$JWT_GUARD not found — skipping"
    return
  fi

  local clear_cookie_lines
  clear_cookie_lines=$(grep -nE "clearCookie\(\s*['\"]tokenPair['\"]" "$JWT_GUARD" || true)

  local auth_type_lines
  auth_type_lines=$(grep -nE "get\(\s*['\"]AUTH_TYPE['\"]\s*\)\s*===\s*['\"]SSO['\"]" "$JWT_GUARD" || true)

  local mismatch_header_lines
  mismatch_header_lines=$(grep -nE "X-Auth-Request-Email" "$JWT_GUARD" || true)

  local mismatch_user_lines
  mismatch_user_lines=$(grep -nE "data\.user\.email" "$JWT_GUARD" || true)

  if [[ -n "$clear_cookie_lines" && -n "$auth_type_lines" && -n "$mismatch_header_lines" && -n "$mismatch_user_lines" ]]; then
    local nearby_match=0
    local clear_line auth_line header_line user_line

    while IFS=: read -r clear_line _; do
      [[ -z "$clear_line" ]] && continue
      while IFS=: read -r auth_line _; do
        [[ -z "$auth_line" ]] && continue
        (( clear_line - auth_line > 25 || auth_line - clear_line > 25 )) && continue
        while IFS=: read -r header_line _; do
          [[ -z "$header_line" ]] && continue
          (( clear_line - header_line > 25 || header_line - clear_line > 25 )) && continue
          while IFS=: read -r user_line _; do
            [[ -z "$user_line" ]] && continue
            (( clear_line - user_line > 25 || user_line - clear_line > 25 )) && continue
            nearby_match=1
            break 4
          done <<< "$mismatch_user_lines"
        done <<< "$mismatch_header_lines"
      done <<< "$auth_type_lines"
    done <<< "$clear_cookie_lines"

    if [[ "$nearby_match" -eq 1 ]]; then
      record 1 "✅" "$JWT_GUARD contains nearby SSO gate + identity-mismatch comparison + \`clearCookie('tokenPair'\` (within ±25 lines) — Rule 2 mismatch flush in place"
      return
    fi
  fi

  if [[ -z "$clear_cookie_lines" ]]; then
    record 1 "❌" "$JWT_GUARD does NOT call \`response.clearCookie('tokenPair', ...)\`. The cross-app spec (proxy-auth-middleware Rule 2) requires the guard to clear the tokenPair cookie when oauth2-proxy asserts a different identity than the JWT user. Without it, the stale-session-on-user-switch leak returns. Fix: add a comparison of \`X-Auth-Request-Email\` vs \`data.user.email\` after \`validateTokenByRequest\`, and on mismatch call \`response.clearCookie('tokenPair', { path: '/' })\` then return false. Gate the check on \`AUTH_TYPE === 'SSO'\`."
    return
  fi

  record 1 "❌" "$JWT_GUARD has \`clearCookie('tokenPair'\` but missing a nearby full Rule 2 block: \`get('AUTH_TYPE') === 'SSO'\` + \`X-Auth-Request-Email\` vs \`data.user.email\` comparison in the same conditional path. Keep these checks colocated to avoid false passes from unrelated references."
}

# ============================================================================
# Row 21 (idx 2): polynomial-regex avoidance in email-shape detection
#
# Twenty uses indexOf-based detection in normalizeProxyEmail (added in
# Pressingly/twenty#8). This is a regression guard — fires only if a
# polynomial-backtracking regex like /^[^\s@]+@[^\s@]+\.[^\s@]+$/ is
# reintroduced. CodeQL's `js/polynomial-redos` flags it on adversarial input.
# ============================================================================
check_row_21() {
  if [[ ! -f "$JWT_GUARD" ]]; then
    record 2 "?" "$JWT_GUARD not found — skipping"
    return
  fi

  # Look for the canonical polynomial-backtracking shape used in JS regex
  # literals: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ and variations.
  local hits
  hits=$(grep -nE '\[\^[\\\\]s@\]\+@\[\^[\\\\]s@\]\+\\\.\[\^[\\\\]s@\]\+' "$JWT_GUARD" 2>/dev/null || true)

  if [[ -n "$hits" ]]; then
    record 2 "❌" "Polynomial-backtracking email-shape regex detected in $JWT_GUARD: $hits. Rewrite to indexOf-based check per openspec proxy-auth-middleware §'email-shape detection SHALL avoid polynomial-backtracking regex'. Reference: \`normalizeProxyEmail\` in this file."
    return
  fi

  record 2 "✅" "No polynomial-backtracking email-shape regex in $JWT_GUARD; using indexOf-based detection"
}

# ============================================================================
# Run checks
# ============================================================================
check_row_14
check_row_20
check_row_21

# ============================================================================
# Print table
# ============================================================================
echo "## Twenty SSO Fork Audit"
echo
echo "Cross-app contract: https://github.com/awais786/sso-rules-moneta/blob/main/openspec/specs/proxy-auth-middleware/spec.md"
echo "Row numbers match the 21-row table at https://github.com/awais786/sso-rules-moneta/blob/main/skills/app-rules/SKILL.md#5-report"
echo
echo "| Row | Invariant | Status | Notes |"
echo "|-----|-----------|--------|-------|"
for i in "${!ROW_TITLES[@]}"; do
  printf "| %d | %s | %s | %s |\n" \
    "${ROW_NUMBERS[$i]}" "${ROW_TITLES[$i]}" "${ROW_STATUS[$i]:-?}" "${ROW_NOTES[$i]:-}"
done
echo

# ============================================================================
# Summary + exit code
# ============================================================================
TOTAL_FAILS=0
for s in "${ROW_STATUS[@]}"; do
  [[ "$s" == "❌" ]] && TOTAL_FAILS=$((TOTAL_FAILS + 1))
done

if [[ "$TOTAL_FAILS" -eq 0 ]]; then
  echo "**All fork-side invariants hold.**"
  exit 0
fi

echo "**$TOTAL_FAILS violations.** Security-critical (row 20): $SECURITY_CRITICAL_FAILS."
if [[ "$SECURITY_CRITICAL_FAILS" -gt 0 ]]; then
  exit 1
fi
exit 0
