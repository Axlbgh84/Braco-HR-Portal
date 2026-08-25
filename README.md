# Braco Group HR & Employee Portal — Backend

Production backend for the existing HTML/CSS/JS frontend: Node/Express API, Postgres on
Supabase, Microsoft Entra ID (staff) + Supabase magic-link (freelancers) auth, role-based
access control, and modules for leave, loans, employee directory, freelancers & invoicing,
contracts, service agreements, notifications, audit logs, and reporting.

## Where to start

| Document | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagram, auth flow, RBAC design, module map, how this grows into a bigger platform |
| [`database/schema.sql`](database/schema.sql) | Full Postgres schema — run this in Supabase's SQL editor |
| [`api/API.md`](api/API.md) | Every endpoint, method, required role |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Step-by-step: Supabase, Entra ID app registration, Render/Railway, Netlify |
| [`docs/MIGRATION.md`](docs/MIGRATION.md) | How to rewire the *existing* frontend to call this API instead of `window.storage` |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security decisions made, and what's still open before go-live |
| [`backend/`](backend/) | The actual Express application |

## What's fully implemented vs. scaffolded

**Fully implemented** (routing, permissions, and business logic all real and tested to boot
cleanly): Auth (Entra ID + freelancer magic-link), Employees (incl. encrypted banking,
onboarding checklist, directory), Leave (full 2-stage approval + balance calculation), Loans
(full 3-stage approval + disbursement + repayment schedule), Freelancers (CRUD + Finance
approval), Work Submissions & Invoicing (full 4-actor pipeline), Contracts (template + generate
+ amend), Service Agreements (template + generate), Notifications, Audit Log, Admin
(users/roles/companies), 2 of the Reporting endpoints, Documents (real Supabase Storage upload).

**Scaffolded, not yet written**: a few reporting aggregations (`leave-utilization`,
`loan-exposure`, `freelancer-spend`, CSV export) — the routing and permissions are live, marked
with `notImplemented()`; follow the pattern in `reports.routes.js`'s two working examples
(`headcount`, `contract-expiry`).

## Quick start (local dev)

```bash
cd backend
cp .env.example .env       # fill in real values — see docs/DEPLOYMENT.md
npm install
npm run dev
# → http://localhost:4000/health should return {"status":"ok"}
```

You'll need a Supabase project (with `database/schema.sql` already run) and an Entra ID app
registration before login will actually work end-to-end — see `docs/DEPLOYMENT.md` for both.

## Verification already done

Every file in `backend/src/` has been syntax-checked, and the full 40+ file require-graph
(every route → controller → service → middleware cross-reference) has been booted end-to-end
against mocked dependencies to confirm there are no wiring errors — imports resolve, exports
match, route ordering doesn't shadow itself (e.g. `/templates` vs `/:id`). What hasn't been
tested is runtime behavior against a real Postgres instance — that's the natural next step once
this is deployed to Supabase.
