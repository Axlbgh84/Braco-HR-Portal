# Braco Group HR Portal — Production Architecture

## 1. System overview

```
┌─────────────────┐      HTTPS/JSON       ┌──────────────────────┐      libpq       ┌─────────────────┐
│   Frontend       │ ───────────────────▶ │   Backend API          │ ───────────────▶ │   Postgres        │
│   (Netlify)       │ ◀─────────────────── │   (Render/Railway)      │ ◀─────────────── │   (Supabase)       │
│   static HTML/JS  │                       │   Node + Express         │                   │                    │
└────────┬─────────┘                       └────────┬─────────────┘                   └─────────────────┘
         │                                            │
         │ redirect                                   │ validate JWT (JWKS)
         ▼                                            ▼
┌─────────────────┐                       ┌──────────────────────┐
│  Microsoft Entra ID │                    │  Entra ID / Supabase    │
│  (staff SSO)         │                    │  Auth (freelancer OTP)  │
└─────────────────┘                       └──────────────────────┘
                                                       │
                                                       ▼
                                            ┌──────────────────────┐
                                            │  Supabase Storage       │
                                            │  (photos, IDs,          │
                                            │   contracts, invoices)  │
                                            └──────────────────────┘
```

**Frontend** — the existing HTML/CSS/JS app, unchanged visually. Its data layer is rewritten to
call the API instead of `window.storage`/`localStorage` (see `docs/MIGRATION.md`). Hosted as a
static site on Netlify.

**Backend** — a single Node/Express service, organized into feature modules (see §4). Owns all
business logic and authorization. The frontend never talks to Postgres or Supabase directly.

**Database** — Postgres, hosted on Supabase. Supabase is used here purely as *managed Postgres +
managed object storage*; the frontend does not use the Supabase client SDK or rely on Row-Level
Security as the primary security boundary — Express is.

**Auth** — two identity paths into the same `users` table:
- Staff → Microsoft Entra ID (OAuth2/OIDC), Braco Group's own Azure AD tenant.
- Freelancers → Supabase Auth email magic-link (they have no Entra account).

## 2. Authentication flow

### Staff (Entra ID)

1. Frontend uses **MSAL.js** to redirect the user to Entra ID's login page (Braco Group's tenant).
2. On success, Entra ID redirects back with an authorization code; MSAL.js exchanges it for an
   **ID token** and **access token** client-side.
3. Frontend calls `POST /auth/entra/callback` with the ID token.
4. Express validates the token: signature checked against Entra's JWKS endpoint
   (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`), issuer/audience checked
   against the registered app, expiry checked.
5. Express reads the `oid` (object id — stable, unique per user per tenant) and `email` claims.
   If no `users` row exists with that `entra_object_id`, one is created (JIT provisioning) with
   `auth_provider = 'entra_id'`. **New users get no role by default** — an admin/HR must
   explicitly grant a role via `PATCH /admin/users/:id/roles` before they can do anything beyond
   view their own (empty) profile. This prevents silent privilege creep from SSO auto-provisioning.
6. Express issues its own short-lived session JWT (its own signing key, ~1 hour) + refresh token
   (httpOnly, secure, sameSite=strict cookie). All subsequent API calls use the Express-issued
   token, not the raw Entra token — this keeps token validation logic in one place and lets you
   revoke sessions without touching Entra.

### Freelancers (magic link)

1. Freelancer enters their email at `/auth/freelancer/request-link`.
2. Backend checks a `freelancers` row exists with that email; if so, uses **Supabase Auth**
   (`signInWithOtp`) to send a magic link.
3. Freelancer clicks the link, lands back on the frontend with a Supabase session token.
4. Frontend calls `/auth/freelancer/verify`; Express validates the Supabase JWT (Supabase's own
   JWKS), links it to the `users` row (`auth_provider = 'email_magic_link'`), issues its own
   session JWT exactly as above.

This means **downstream code (RBAC middleware, route handlers) never needs to know or care**
which provider a given user authenticated with — by the time a request hits business logic, it's
just "a validated Express session with a user id and roles."

## 3. Authorization (RBAC)

Five roles, matching the existing prototype 1:1 conceptually, formalized with a real
permissions table (schema §2):

| Role | Scope |
|---|---|
| `employee` | Self-service only: own profile, submit leave/loans, view own documents |
| `supervisor` | Everything `employee` has, plus: approve leave/loans/freelancer work for direct reports |
| `hr` | Full employee lifecycle: records, onboarding, contracts, second-stage leave/loan approval, freelancer/vendor management |
| `finance` | Loan approval + disbursement, freelancer approval, invoice payment, financial reporting |
| `admin` | System administration: user accounts, role grants, companies/departments, integrations — deliberately *not* the same as HR (an admin manages the system; HR manages people) |

A user can hold **more than one role** (`user_roles` is a many-to-many join) — e.g. someone who
is both a supervisor and does HR work. Middleware checks the **union** of permissions across all
roles held.

**Enforcement pattern** — every route declares required permission(s); a generic middleware
checks them before the handler runs:

```js
router.post('/leave/:id/approve',
  requireAuth,
  requirePermission('leave.approve.manager', 'leave.approve.hr'),
  requireOwnershipOrScope('leave'),   // e.g. supervisor can only act on their own team's requests
  leaveController.approve
);
```

`requireOwnershipOrScope` is the piece that encodes "a supervisor can only approve *their own
team's* requests, not anyone's" — this must be enforced server-side; the prototype's client-side
version of this check was cosmetic only and must not be trusted going forward.

## 4. Module map

The backend is organized as one Express router + controller + service per domain, all
independent of each other except through shared `db` and `auth` utilities. This mirrors the
"section" structure already visible in the current frontend tabs:

```
src/
  routes/         one file per module, only route definitions + middleware wiring
  controllers/    request/response handling, calls into services
  services/       business logic + DB queries, no HTTP concerns — reusable, unit-testable
  middleware/     auth, rbac, audit logging, error handling, file upload
  config/         env, db pool, Entra/Supabase clients
```

Modules: `auth`, `employees`, `documents`, `leave`, `loans`, `freelancers`, `workSubmissions`,
`contracts`, `serviceAgreements`, `notifications`, `auditLog`, `reports`, `admin`.

Each module is self-contained enough to be split into its own deployable service later without
a rewrite — see §6.

## 5. Security posture (production, not prototype)

The current single-file prototype was explicitly a demo: shared 4-digit PINs, no encryption,
client-side "authorization." None of that carries over. Production baseline:

- **No shared credentials, ever.** Every user is a real Entra ID or Supabase-authenticated identity.
- **Banking account numbers encrypted at rest** (`pgcrypto`'s `pgp_sym_encrypt`), decrypted only
  server-side, only when returned to someone with `employees.write` or the account owner
  themselves — and even then, the API should return a masked value by default with a separate
  "reveal" endpoint that's itself audit-logged.
- **Files never touch the database as base64.** Uploads go to Supabase Storage; the API returns
  short-lived signed URLs, never permanent public links.
- **All state-changing endpoints require CSRF protection** (double-submit cookie or
  `SameSite=strict` + custom header check) since sessions are cookie-based.
- **Rate limiting** on `/auth/*` and any endpoint accepting freeform input.
- **Every approval action, role change, banking edit, and document access is audit-logged**
  (`audit_log` table) — actor, action, entity, timestamp, IP.
- **Input validation** at the API boundary (e.g. `zod` or `joi` schemas per route) — never trust
  client-supplied `role`, `status`, or `amount` fields without server-side re-validation of
  business rules (loan cap, leave balance, approval-stage ordering).
- **Least privilege DB user** — the Express service connects to Postgres with a role that has
  only the grants it needs, not the Supabase project's superuser/service-role key.

## 6. Growing into a modular company platform

You mentioned this might grow beyond HR into an all-in-one company portal (payroll, expenses,
assets, performance reviews, recruiting, timesheets, etc.). The architecture above is deliberately
shaped to make that growth additive rather than a rewrite:

- **Each module already owns its own routes/controllers/services and its own schema tables.**
  A new module (e.g. `payroll`) is a new folder following the same pattern, a new set of tables,
  and new rows in `permissions` — it does not require touching existing modules.
- **The permissions table is the extension point for access control**, not hardcoded role checks.
  Adding a new role or a new fine-grained permission is a data change, not a code change, in most
  cases.
- **`documents`, `notifications`, and `audit_log` are already generic/polymorphic** (`owner_type`
  + `owner_id`, `entity_type` + `entity_id`) — new modules plug into them for free instead of each
  reinventing file storage, notifications, or audit trails.
- **When it's time to split the monolith**, the module boundaries above map directly onto
  separate services (e.g. a standalone Payroll service) communicating either via internal REST
  calls or an event bus (e.g. publishing `leave.approved`, `employee.created` events that other
  modules subscribe to) — this is a natural fit given the module map already avoids cross-module
  imports.
- **Recommendation for the next phase**: before adding a second major module, introduce a thin
  internal event system (even a simple Postgres `NOTIFY`/`LISTEN` or a queue like the one
  Supabase/Render make easy to add) so modules communicate through events rather than direct
  function calls — this is the difference between "a bigger monolith" and "a modular platform"
  in practice.

If/when you want to build out a specific next module (payroll, timesheets, asset tracking,
recruiting), that's a good scope for a dedicated follow-up design pass rather than bolting it on
here speculatively.
