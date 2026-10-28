# ADR-0012 - Session semantics: stateless access tokens, revoked refresh sessions

**Status:** accepted (2026-10-28)

## Context
Phase 2 introduced JWT access tokens (HS256, 15 minutes) and rotating
refresh tokens. Two security questions need an explicit decision: what
happens to an already-issued access token after logout, and how concurrent
refreshes are handled.

## Decision
1. **Access tokens are stateless and short-lived.** Logout revokes the
   refresh session immediately; an access token issued before logout may
   remain valid until its 15-minute expiry. This is a deliberate,
   documented trade-off: no database lookup on every request, bounded
   exposure window, and the refresh session cannot be extended.
2. **Refresh rotation is atomic.** A refresh token can be consumed exactly
   once. The rotation UPDATE requires `revoked_at IS NULL` and returns the
   affected row; a concurrent second refresh loses the race and receives
   `401 REFRESH_INVALID`. No two valid token branches can exist.
3. **Replay is rejected** after rotation; the replaced token is marked with
   `replaced_by` for audit.
4. **Production hardening (Phase 6):** short-lived access tokens may be
   paired with a revocation denylist or session-version claim for
   high-value tenants, after measuring the added database cost. Until then
   the 15-minute TTL is the compensating control.

## Consequences
- Logout is immediate for refresh and for new work once the access token
  expires; it is not instantaneous authority revocation.
- The browser clears local session state on logout and on refresh failure,
  so a stolen access token cannot be renewed.
- Tests cover: rotation replay rejection, concurrent-refresh single winner,
  logout server invalidation, and refresh failure returning the user to
  login.
