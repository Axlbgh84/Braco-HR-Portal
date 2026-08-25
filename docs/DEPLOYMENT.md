# Deployment Runbook

## 1. Supabase (database + storage)

1. Create a project at supabase.com. Note the **project URL**, **service_role key** (Settings →
   API — keep this secret, it's server-only), and the **database connection string**
   (Settings → Database → Connection string → "URI", use the **Session pooler** variant for a
   long-lived Express process, not the Transaction pooler).
2. Open the SQL Editor and run `database/schema.sql` in full.
3. Create a Storage bucket named `braco-documents` (Storage → New bucket). Keep it **private**
   (not public) — the API serves files via short-lived signed URLs, never public links.
4. Enable email OTP for freelancer login: Authentication → Providers → Email → enable "Magic Link".
   Customize the email template under Authentication → Email Templates if desired.

## 2. Microsoft Entra ID (staff SSO)

1. In the [Azure Portal](https://portal.azure.com), go to **Entra ID → App registrations → New
   registration**.
2. Name it "Braco Group HR Portal". Under **Supported account types**, choose "Accounts in this
   organizational directory only" (single tenant).
3. Add a **Redirect URI**: platform "Single-page application", URI
   `https://braco-portal.netlify.app` (your Netlify frontend URL) plus
   `http://localhost:5173` for local development.
4. Note the **Application (client) ID** and **Directory (tenant) ID** from the Overview page —
   these become `ENTRA_CLIENT_ID` and `ENTRA_TENANT_ID`.
5. Under **API permissions**, add `User.Read` (Microsoft Graph, delegated) — enough to read the
   signed-in user's name/email. Grant admin consent.
6. Under **Authentication**, enable "ID tokens" under the implicit/hybrid flow section (needed
   for MSAL.js to receive an ID token directly).
7. No client secret is needed for the SPA flow (public client, PKCE) — the frontend uses MSAL.js
   with Authorization Code + PKCE, not a client secret.

## 3. Backend — Render or Railway

Both work the same way for a plain Node service; steps below are for Render (Railway is
near-identical: New Project → Deploy from GitHub → set the same env vars → same build/start
commands).

1. Push the `backend/` folder to a Git repository.
2. Render → New → Web Service → connect the repo, root directory `backend/`.
3. **Build command**: `npm install`
4. **Start command**: `npm start`
5. **Environment**: Node 20.
6. Add environment variables (Render → Environment) matching `.env.example`:
   `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`,
   `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_ISSUER`, `SESSION_JWT_SECRET`,
   `BANKING_ENCRYPTION_KEY`, `FRONTEND_ORIGIN` (your Netlify URL), `NODE_ENV=production`.
   Generate `SESSION_JWT_SECRET` and `BANKING_ENCRYPTION_KEY` with e.g.
   `openssl rand -base64 48` — long, random, never reused between environments.
7. Deploy. Confirm `GET https://<your-service>.onrender.com/health` returns `{"status":"ok"}`.
8. **Health check path**: set to `/health` in Render's settings so it doesn't mark the service
   unhealthy during cold starts.

## 4. Frontend — Netlify

1. The existing single-file HTML/CSS/JS app, once its data layer is migrated to call the API
   (see `docs/MIGRATION.md`), can be built as a static site — no build step is strictly required
   if it stays a single HTML file, but splitting the inline `<script>` into real files and adding
   MSAL.js via npm + a bundler (esbuild/Vite) is recommended at this point for maintainability.
2. Netlify → Add new site → Deploy manually (drag-and-drop the `dist/` or the single HTML file) or
   connect the Git repo for continuous deploys.
3. If using a bundler: **Build command** `npm run build`, **Publish directory** `dist`.
4. Environment variable: `VITE_API_BASE_URL` (or equivalent) = your Render backend URL, e.g.
   `https://braco-hr-api.onrender.com/v1`. Also set `VITE_ENTRA_CLIENT_ID` and
   `VITE_ENTRA_TENANT_ID` for MSAL.js configuration.
5. Add a `_redirects` file (or `netlify.toml` redirects section) if the app gains client-side
   routing later: `/*  /index.html  200`.
6. Once deployed, go back to the Entra ID app registration and confirm the Netlify URL is listed
   as a redirect URI (step 2.3 above).

## 5. Post-deploy checklist

- [ ] `GET /health` on the backend returns 200
- [ ] Staff can sign in via Entra ID and land with zero roles (expected — see next step)
- [ ] An admin grants the first HR/admin role directly via SQL (one-time bootstrap, since
      `PATCH /admin/users/:id/roles` itself requires the `admin.users` permission — chicken/egg
      for the very first admin):
      ```sql
      insert into user_roles (user_id, role_id)
      select u.id, r.id from users u, roles r where u.email = 'first-admin@bracogroup.com' and r.key = 'admin';
      ```
- [ ] From there, all further role grants go through the Admin UI/API
- [ ] Freelancer magic-link login tested end-to-end with a real freelancer record + real email
- [ ] CORS: confirm the frontend origin is exactly right in `FRONTEND_ORIGIN` (no trailing slash)
- [ ] Confirm banking details round-trip correctly (write then read masked) — validates
      `BANKING_ENCRYPTION_KEY` is set consistently
