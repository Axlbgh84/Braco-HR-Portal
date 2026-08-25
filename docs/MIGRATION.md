# Migrating the Existing Frontend to This Backend

**Scope of this migration: the data layer only.** Every render function (`dashboardHtml()`,
`employeesHtml()`, `profileHtml()`, all the CSS, all the visual design) stays exactly as it is.
What changes is *where data comes from and where authority lives*.

## The core shift

Right now, the frontend:
- Reads/writes state via `window.storage.get/set/delete/list()` (or the `localStorage` fallback).
- Decides who can approve what, client-side, in functions like `approveVacation()`.
- Checks a plaintext PIN against a hardcoded value.
- Stores photos/documents as base64 strings.

None of that is trustworthy once real people and real money are involved — a client can always
be tampered with. After migration:
- The frontend calls `fetch()` against the API for everything.
- **All approval logic, balance checks, and role checks move server-side** (already written into
  `leave.service.js` / `employees.service.js` as the reference pattern). The frontend's job
  becomes: render what the API returns, submit what the user enters, show errors the API sends
  back.
- Login becomes an Entra ID redirect (staff) or magic-link flow (freelancers) — no PIN anywhere.
- File inputs upload via `multipart/form-data` to `/documents`, get back a signed URL to display.

## Function-by-function mapping

| Old (client-side) | New (API call) |
|---|---|
| `window.storage.get('braco:employees', true)` | `GET /v1/employees` |
| `saveEmployees()` | *(gone — each mutation is its own endpoint, e.g. `PATCH /v1/employees/:id`)* |
| `handleLogin()` (PIN check) | MSAL.js redirect → `POST /v1/auth/entra/callback` |
| `approveVacation(id)` | `POST /v1/leave/:id/approve` |
| `rejectVacation(id)` | `POST /v1/leave/:id/reject` |
| `submitVacationRequest()` | `POST /v1/leave` |
| `approveLoan(id)` / `rejectLoan(id)` / `disburseLoan(id)` | `POST /v1/loans/:id/approve` \| `/reject` \| `/disburse` |
| `vacationRemaining(emp)` | `GET /v1/employees/:id/leave-balance` (now server-computed, not client math) |
| `saveEmployeeFile()` (base64 headshot/passport) | `POST /v1/documents` (multipart) → returns `{ id, downloadUrl }` |
| `updateBanking()` | `PUT /v1/employees/:id/banking` (server encrypts; response never includes the raw number) |
| `profileChecklist(e)` | `GET /v1/employees/:id/onboarding-checklist` |
| `addFreelancer()` / `approveFreelancer()` | `POST /v1/freelancers` / `POST /v1/freelancers/:id/approve` |
| `submitWorkForMonth()` / `submitWorkToFinance()` | `POST /v1/work-submissions` / `POST /v1/work-submissions/:id/submit-to-finance` |
| `generateEmployeeContract()` | `POST /v1/contracts/employees/:id/generate` |
| `pushNotification()` / bell badge | `GET /v1/notifications`, `GET /v1/notifications/unread-count` |
| `logAudit()` | *(gone from the frontend entirely — every service function in the backend calls `recordAudit()` itself)* |

## Login screen changes

Replace the PIN form with:

```js
import { PublicClientApplication } from '@azure/msal-browser';

const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_ENTRA_TENANT_ID}`,
    redirectUri: window.location.origin
  }
};
const msalInstance = new PublicClientApplication(msalConfig);

async function handleLogin() {
  const result = await msalInstance.loginPopup({ scopes: ['User.Read'] });
  const res = await fetch(`${API_BASE}/auth/entra/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: result.idToken })
  });
  const { data } = await res.json();
  sessionToken = data.token; // used as Bearer token on every subsequent fetch()
  await loadCurrentUser();
}
```

Freelancers get a simpler two-step form (email → check inbox → click link → land back
authenticated) instead of the staff/freelancer combined PIN dropdown.

## A note on `currentTab`, `renderShell()`, etc.

The existing rendering approach (rebuild HTML strings, set `innerHTML`, re-wire event listeners)
does not need to change to something like React just because the backend changed. It's perfectly
reasonable to keep exactly that pattern and just swap synchronous array lookups
(`employees.find(...)`) for `await fetch(...)` calls at the point data is needed, with a loading
state while the request is in flight. A rewrite to a frontend framework is a separate, optional
decision — not a requirement of this migration.

## Suggested migration order

1. Stand up the backend, run the schema, seed one admin user manually (see
   `docs/DEPLOYMENT.md` post-deploy checklist).
2. Swap the login screen for Entra ID / magic-link (§ above). Confirm `GET /v1/auth/me` returns
   the right identity.
3. Swap read paths module by module (directory, then leave, then loans, ...), leaving writes on
   the old client-side logic temporarily — the UI will look identical but be reading real data.
4. Swap write paths module by module, deleting the corresponding client-side business-logic
   function as you go (this is where `approveVacation()`-style functions disappear entirely).
5. Once every module is migrated, delete `window.storage` / the `localStorage` fallback shim
   entirely — nothing should call it anymore.
