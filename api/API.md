# Braco Group HR Portal — API Specification

Base URL: `https://api.bracogroup.example.com/v1`
Auth: `Authorization: Bearer <token>` on every request except `/auth/*`.
Content type: `application/json` unless noted (file uploads use `multipart/form-data`).

## Auth model

- **Staff** (employee/supervisor/hr/finance/admin) authenticate via **Entra ID** — the frontend
  runs the MSAL.js redirect flow, obtains an ID token from Braco Group's Azure AD tenant, and
  sends it as the Bearer token. Express validates the token's signature against Entra's JWKS
  endpoint and reads `oid` / `email` / `roles` claims.
- **Freelancers** authenticate via **email magic link** (Supabase Auth), since they don't have
  organizational Entra accounts. Express validates the resulting Supabase JWT instead.
- Every endpoint below lists the **roles** allowed to call it. `self` means "the authenticated
  user acting on their own record" — enforced in addition to role, not instead of it.

## Standard response envelope

```json
// success
{ "data": { ... } }
// or list
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 25, "total": 118 } }

// error
{ "error": { "code": "LEAVE_INSUFFICIENT_BALANCE", "message": "Not enough vacation days remaining." } }
```

Standard HTTP status codes: `200` OK, `201` Created, `204` No Content, `400` validation error,
`401` not authenticated, `403` not authorized, `404` not found, `409` conflict (e.g. double-approval),
`422` business-rule violation, `500` server error.

---

## Auth

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/auth/entra/callback` | public | Exchange Entra auth code for a session; JIT-provisions a `users` row on first login |
| POST | `/auth/freelancer/request-link` | public | Send a magic-link email to a freelancer's registered address |
| POST | `/auth/freelancer/verify` | public | Verify magic-link token, issue session |
| POST | `/auth/logout` | any | Invalidate current session |
| GET  | `/auth/me` | any | Current user: identity, roles, permissions, linked employee/freelancer id |

## Employees

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/employees` | hr, admin | List/search employees (filters: company, department, status, contract type) |
| GET | `/employees/:id` | self, supervisor(direct reports), hr, admin | Employee detail |
| POST | `/employees` | hr, admin | Create employee record |
| PATCH | `/employees/:id` | hr, admin | Update role/department/manager/contract info |
| PATCH | `/employees/:id/deactivate` | hr, admin | Disable login access |
| PATCH | `/employees/:id/reactivate` | hr, admin | Re-enable |
| GET | `/employees/:id/onboarding-checklist` | self, hr | Computed completeness (email verified, emergency contact, banking, photo, ID, contract type) |
| PUT | `/employees/:id/emergency-contact` | self, hr | Upsert emergency contact |
| PUT | `/employees/:id/banking` | self, hr, finance(read) | Upsert banking details (encrypted at rest) |
| PATCH | `/employees/:id/contract-terms` | hr | Set responsibilities/remuneration (feeds contract generation) |
| POST | `/employees/:id/verify-email/request` | self, hr | Generate + email a verification code |
| POST | `/employees/:id/verify-email/confirm` | self | Submit code, mark verified |
| GET | `/employees/directory` | any authenticated staff | Company-wide directory (name, title, department, company — no sensitive fields) |
| GET | `/employees/departments/allocation` | hr, admin | Headcount by department/company |
| GET | `/employees/:id/contract-progress` | hr, admin | Days remaining on a temporary contract (for dashboard tracker) |

## Files / Documents

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/documents` | varies by owner (self for own photo/ID; hr for employee docs; hr for freelancer/agreement docs) | Upload a file (headshot, ID, contract, payslip, invoice, agreement); stores to Supabase Storage, returns signed URL |
| GET | `/documents/:id` | owner, hr, admin | Get metadata + a short-lived signed download URL |
| DELETE | `/documents/:id` | hr, admin | Remove a document (and its storage object) |
| GET | `/employees/:id/documents` | self, hr | List an employee's documents |

## Leave (vacation, sick, personal, etc.)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/leave` | employee(self), supervisor(self), hr(self) | Submit a leave request |
| GET | `/leave` | self (own), supervisor (team pending), hr (all) | List/filter leave requests |
| GET | `/leave/:id` | self, supervisor(if in chain), hr | Detail incl. approval history |
| POST | `/leave/:id/approve` | supervisor (stage 1), hr (stage 2) | Advance to next stage or finalize; deducts balance on final approval |
| POST | `/leave/:id/reject` | supervisor, hr (matching current stage) | Reject with optional comment |
| POST | `/leave/:id/cancel` | self (if still pending) | Withdraw a pending request |
| POST | `/leave/sick` | employee(self) | Report a sick day (auto-flags cert required if > 2 days) |
| POST | `/leave/:id/certificate` | self, hr | Attach/verify medical certificate |
| GET | `/employees/:id/leave-balance` | self, supervisor, hr | Remaining vacation days this year |

## Loans

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/loans` | employee(self) | Submit loan request (max $1,000, validated against outstanding balance) |
| GET | `/loans` | self, supervisor(team), hr, finance | List/filter |
| GET | `/loans/:id` | self, supervisor, hr, finance | Detail incl. approval history + repayment schedule |
| POST | `/loans/:id/approve` | supervisor, hr, finance (matching current stage) | Advance stage; finance approval marks ready-to-disburse |
| POST | `/loans/:id/reject` | supervisor, hr, finance (matching stage) | Reject |
| POST | `/loans/:id/disburse` | finance | Mark disbursed, generate repayment schedule |
| PATCH | `/loans/:id/repayments/:period` | finance | Mark a repayment period deducted/missed/adjusted |

## Freelancers

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/freelancers` | hr | Create freelancer record (status starts `pending`) |
| GET | `/freelancers` | hr, finance | List/filter |
| GET | `/freelancers/:id` | self, hr, finance | Detail |
| PATCH | `/freelancers/:id` | hr | Edit details, assign supervisor |
| POST | `/freelancers/:id/approve` | finance | Move to `active` |
| POST | `/freelancers/:id/deactivate` | hr | Move to `inactive` |
| PUT | `/freelancers/:id/banking` | self, hr, finance(read) | Upsert banking details |
| PUT | `/freelancers/:id/contact` | self, hr | Update email/phone |

## Freelancer work & invoicing

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/work-submissions` | freelancer(self) | Submit work for a period (period, description, amount, optional file) |
| GET | `/work-submissions` | self, supervisor(assigned), finance | List/filter |
| POST | `/work-submissions/:id/approve` | supervisor(assigned) | Approve — moves to "ready to submit to Finance" |
| POST | `/work-submissions/:id/reject` | supervisor(assigned) | Reject |
| POST | `/work-submissions/:id/submit-to-finance` | freelancer(self) | Generates invoice number, notifies Finance |
| POST | `/work-submissions/:id/mark-paid` | finance | Marks invoice paid |

## Contracts

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/contract-templates` | hr | Get the standard employment contract template |
| PUT | `/contract-templates` | hr | Update the template |
| POST | `/employees/:id/contract/generate` | hr | Merge template + employee data, create a `documents` row (type=contract) |
| GET | `/employees/:id/contract/latest` | self, hr | Latest generated contract + editable body text |
| PUT | `/employees/:id/contract/:documentId/amend` | hr | Save edited text for that specific contract (marks "amended") |

## Service agreements (vendors)

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/service-agreements` | hr | Create vendor agreement record |
| GET | `/service-agreements` | hr | List/filter |
| GET | `/service-agreements/:id` | hr | Detail |
| PATCH | `/service-agreements/:id` | hr | Edit / change status (draft/active/expired) |
| DELETE | `/service-agreements/:id` | hr | Remove |
| GET | `/service-agreement-templates` | hr | Get standard template |
| PUT | `/service-agreement-templates` | hr | Update template |
| POST | `/service-agreements/:id/generate` | hr | Generate agreement document from template |

## Notifications

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | any authenticated | List own notifications (unread first) |
| POST | `/notifications/read-all` | any authenticated | Mark all as read |
| GET | `/notifications/unread-count` | any authenticated | Badge count |

## Audit log

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/audit-log` | hr, admin | Paginated, filterable (actor, entity type, date range) |

## Reporting

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/reports/headcount` | hr, admin, finance | By company/department |
| GET | `/reports/leave-utilization` | hr, admin | Vacation days used vs. allotted, by period |
| GET | `/reports/loan-exposure` | finance, hr, admin | Outstanding loan balances |
| GET | `/reports/contract-expiry` | hr, admin | Temporary contracts approaching end date |
| GET | `/reports/freelancer-spend` | finance, hr, admin | Paid + pending invoice totals by period |
| GET | `/reports/export.csv` | hr, admin, finance | CSV export (`?dataset=employees\|leave\|loans`) |

## Admin

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/admin/users` | admin | List all user accounts |
| PATCH | `/admin/users/:id/roles` | admin | Grant/revoke roles |
| POST | `/admin/companies` | admin | Add a company/subsidiary |
| POST | `/admin/departments` | admin | Add a department |
