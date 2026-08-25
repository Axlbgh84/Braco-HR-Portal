const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const db = require('../config/db');
const env = require('../config/env');
const { verifyEntraToken } = require('../config/entra');
const { ApiError } = require('../middleware/errorHandler');

const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

function issueSession(userId) {
  return jwt.sign({ sub: userId }, env.sessionJwtSecret, { expiresIn: env.sessionJwtTtl });
}

/** Staff login via Entra ID. JIT-provisions a `users` row with NO roles by default. */
async function loginWithEntra(entraIdToken) {
  const claims = await verifyEntraToken(entraIdToken);

  let { rows } = await db.query('select * from users where entra_object_id = $1', [claims.oid]);
  let user = rows[0];

  if (!user) {
    const inserted = await db.query(
      `insert into users (auth_provider, entra_object_id, entra_tenant_id, email, display_name)
       values ('entra_id', $1, $2, $3, $4) returning *`,
      [claims.oid, claims.tid, claims.email, claims.name]
    );
    user = inserted.rows[0];
    // Deliberately no role granted here — an admin/HR must explicitly grant one.
    // The frontend should show a "your account is set up, ask HR for access" state
    // for a brand-new user with zero roles rather than treating them as an employee.
  } else {
    await db.query('update users set last_login_at = now(), display_name = $2 where id = $1', [user.id, claims.name]);
  }

  if (!user.is_active) throw new ApiError(403, 'ACCOUNT_INACTIVE', 'This account has been deactivated.');
  return { token: issueSession(user.id), userId: user.id };
}

/** Sends a magic-link email to a known freelancer via Supabase Auth. */
async function requestFreelancerLink(email) {
  const { rows } = await db.query('select id from freelancers where email = $1', [email]);
  if (!rows[0]) {
    // Do not reveal whether the email exists — respond success either way.
    return;
  }
  await supabaseAdmin.auth.signInWithOtp({ email });
}

/** Verifies the Supabase session established after the freelancer clicks their magic link. */
async function verifyFreelancerLink(supabaseAccessToken) {
  const { data, error } = await supabaseAdmin.auth.getUser(supabaseAccessToken);
  if (error || !data?.user) throw new ApiError(401, 'INVALID_LINK', 'That link is invalid or has expired.');

  const email = data.user.email;
  let { rows } = await db.query('select * from users where email = $1 and auth_provider = $2', [email, 'email_magic_link']);
  let user = rows[0];

  if (!user) {
    const { rows: freelancerRows } = await db.query('select id from freelancers where email = $1', [email]);
    if (!freelancerRows[0]) throw new ApiError(403, 'NOT_A_FREELANCER', 'No freelancer record matches this email.');

    const inserted = await db.query(
      `insert into users (auth_provider, email, display_name) values ('email_magic_link', $1, $1) returning *`,
      [email]
    );
    user = inserted.rows[0];
    await db.query('update freelancers set user_id = $1 where email = $2', [user.id, email]);
  } else {
    await db.query('update users set last_login_at = now() where id = $1', [user.id]);
  }

  return { token: issueSession(user.id), userId: user.id };
}

async function getMe(userId) {
  const { rows } = await db.query(
    `select u.id, u.email, u.display_name,
            coalesce(array_agg(distinct r.key) filter (where r.key is not null), '{}') as roles,
            (select id from employees where user_id = u.id) as employee_id,
            (select id from freelancers where user_id = u.id) as freelancer_id
     from users u
     left join user_roles ur on ur.user_id = u.id
     left join roles r on r.id = ur.role_id
     where u.id = $1
     group by u.id`,
    [userId]
  );
  return rows[0];
}

module.exports = { loginWithEntra, requestFreelancerLink, verifyFreelancerLink, getMe };
