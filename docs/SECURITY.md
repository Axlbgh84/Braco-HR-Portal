# Security Notes

This summarizes the security-relevant decisions made across the schema, API, and backend code —
useful as a single reference for a security review before go-live.

## Authentication
- Staff: Microsoft Entra ID (OIDC), tenant-restricted, PKCE (no client secret in the SPA).
- Freelancers: Supabase Auth email magic-link (no passwords, nothing to leak/brute-force).
- The API issues and validates its **own** short-lived session JWT after either flow succeeds —
  downstream code never re-validates raw Entra/Supabase tokens, keeping revocation and expiry
  logic in one place (`middleware/auth.js`).
- New Entra logins are JIT-provisioned with **zero roles**. An admin/HR user must explicitly grant
  a role before the account can do anything beyond see its own (empty) profile. This is the single
  most important control against SSO auto-provisioning turning into silent privilege escalation.

## Authorization
- Every route declares required permission(s) via `requirePermission(...)`.
- Ownership/scope (e.g. "a supervisor can only approve their own team's requests") is
  **re-checked server-side** on every write (`requireOwnershipOrScope`, `requireSelfOrPermission`)
  — never trust that the UI only showed the "right" records.
- Every approval `decide()` function re-validates the caller's permission matches the request's
  *current* stage, not just "approves this type of thing in general" — prevents an HR user from
  approving something still sitting in manager review, for example.
- Self-approval is explicitly blocked at the service layer (leave, loans) — someone cannot approve
  their own request even if they happen to hold the relevant permission.

## Data protection
- Banking account numbers are encrypted at rest (`pgcrypto`'s `pgp_sym_encrypt`), decrypted only
  server-side. The API returns a masked value (last 4 digits) by default — no endpoint currently
  returns the full plaintext number; add a dedicated, audit-logged "reveal" endpoint if a real
  need for the full number arises (e.g. payroll export), rather than loosening the default.
- Files (photos, IDs, contracts, invoices) live in Supabase Storage, never as base64 in Postgres.
  Access is via short-lived (5 min) signed URLs generated per-request, not permanent links.
- `BANKING_ENCRYPTION_KEY` and `SESSION_JWT_SECRET` must be long, random, and **different per
  environment** (dev/staging/prod) — rotating either invalidates existing sessions/encrypted data
  respectively, so plan key rotation deliberately (re-encrypt banking rows on key rotation).

## Input validation & injection
- Every request body is validated with `zod` schemas at the controller boundary before touching
  the database.
- All SQL uses parameterized queries (`$1, $2, ...`) — never string concatenation of user input.
- File uploads are capped (8MB) and typed via `multer`; validate MIME type server-side too if
  accepting arbitrary file types becomes a concern (currently relies on the client-declared type).

## Transport & session security
- `helmet()` sets standard security headers.
- CORS is locked to `FRONTEND_ORIGIN` — a single known origin, not a wildcard.
- Session cookie: `httpOnly`, `secure`, `sameSite=strict` — mitigates XSS token theft and CSRF.
- Rate limiting: tight on `/auth/*` (20 req/15min), a looser global baseline (120 req/min)
  elsewhere. Tune based on real traffic once staff start using it.

## Audit trail
- Every state-changing action across every implemented module calls `recordAudit()` — actor,
  action, entity, detail, IP, timestamp. This is what makes "who approved this loan" or "who
  changed this person's role" answerable after the fact.
- Audit log writes never block or fail the primary action (errors are caught and logged, not
  thrown) — a logging outage should not become a functional outage.

## Known gaps to close before handling real production data
- [ ] Add a formal key-rotation runbook for `BANKING_ENCRYPTION_KEY`.
- [ ] Add MIME-type sniffing/validation on uploads (not just trusting the client's declared type).
- [ ] Add a "reveal full banking number" endpoint with its own audit-logged permission, if needed,
      rather than ever widening the default masked response.
- [ ] Penetration test / dependency audit (`npm audit`) before go-live, and on a recurring basis.
- [ ] Formal incident response plan (who's notified, how sessions get revoked en masse) — not a
      code change, but should exist before this holds real employee/financial data.
