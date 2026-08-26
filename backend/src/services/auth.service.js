const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const db = require('../config/db');
const env = require('../config/env');
const { verifyEntraToken } = require('../config/entra');
const { ApiError } = require('../middleware/errorHandler');

const supabaseAdmin = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey
);

function issueSession(userId) {
  return jwt.sign(
    { sub: userId },
    env.sessionJwtSecret,
    { expiresIn: env.sessionJwtTtl }
  );
}


/* ============================================================================
   MICROSOFT ENTRA LOGIN
   Kept available for possible future use.
============================================================================ */

/**
 * Staff login via Entra ID.
 * Creates a users row if one does not already exist.
 */
async function loginWithEntra(entraIdToken) {
  const claims = await verifyEntraToken(entraIdToken);

  let { rows } = await db.query(
    'select * from users where entra_object_id = $1',
    [claims.oid]
  );

  let user = rows[0];

  if (!user) {
    const inserted = await db.query(
      `insert into users (
        auth_provider,
        entra_object_id,
        entra_tenant_id,
        email,
        display_name
      )
      values (
        'entra_id',
        $1,
        $2,
        $3,
        $4
      )
      returning *`,
      [
        claims.oid,
        claims.tid,
        claims.email,
        claims.name
      ]
    );

    user = inserted.rows[0];

  } else {
    await db.query(
      `update users
       set last_login_at = now(),
           display_name = $2
       where id = $1`,
      [
        user.id,
        claims.name
      ]
    );
  }

  if (!user.is_active) {
    throw new ApiError(
      403,
      'ACCOUNT_INACTIVE',
      'This account has been deactivated.'
    );
  }

  return {
    token: issueSession(user.id),
    userId: user.id
  };
}


/* ============================================================================
   EMAIL MAGIC-LINK LOGIN
   Used by:
   1. Employees
   2. Freelancers
   3. Service Agreement Workers
============================================================================ */

/**
 * Sends a Supabase magic-link email if the email belongs to an approved
 * Employee, Freelancer, or Service Agreement Worker.
 *
 * The response deliberately does not reveal whether an email exists.
 */
async function requestEmailLink(email) {
  const normalizedEmail = email.trim().toLowerCase();

  // Employees store their email on the linked users record.
  const employeeResult = await db.query(
    `select e.id
     from employees e
     join users u
       on u.id = e.user_id
     where lower(u.email) = $1
       and e.active = true`,
    [normalizedEmail]
  );

  // Freelancers currently store their email directly.
  const freelancerResult = await db.query(
    `select id
     from freelancers
     where lower(email) = $1`,
    [normalizedEmail]
  );

  // Service Agreement Workers store their email directly.
  const serviceWorkerResult = await db.query(
    `select id
     from service_agreement_workers
     where lower(email) = $1
       and active = true`,
    [normalizedEmail]
  );

  // Do not reveal whether an account exists.
  if (
    !employeeResult.rows[0] &&
    !freelancerResult.rows[0] &&
    !serviceWorkerResult.rows[0]
  ) {
    return;
  }

  const { error } = await supabaseAdmin.auth.signInWithOtp({
    email: normalizedEmail
  });

  if (error) {
    throw new ApiError(
      500,
      'EMAIL_LINK_FAILED',
      'Unable to send the sign-in link.'
    );
  }
}


/**
 * Completes a Supabase magic-link login.
 *
 * After Supabase verifies the email address, this function:
 * - confirms the person exists in the portal,
 * - creates or finds their users record,
 * - links the worker record to the user where necessary,
 * - issues the Braco Portal session token.
 */
async function verifyEmailLink(supabaseAccessToken) {
  const { data, error } = await supabaseAdmin.auth.getUser(
    supabaseAccessToken
  );

  if (
    error ||
    !data?.user ||
    !data.user.email
  ) {
    throw new ApiError(
      401,
      'INVALID_LINK',
      'That sign-in link is invalid or has expired.'
    );
  }

  const email = data.user.email
    .trim()
    .toLowerCase();


  /* --------------------------------------------------------------------------
     Find existing portal user
  -------------------------------------------------------------------------- */

  let { rows } = await db.query(
    `select *
     from users
     where lower(email) = $1`,
    [email]
  );

  let user = rows[0];


  /* --------------------------------------------------------------------------
     Find matching Employee
     Employee email lives on users, not employees.
  -------------------------------------------------------------------------- */

  const employeeResult = await db.query(
    `select e.id
     from employees e
     join users u
       on u.id = e.user_id
     where lower(u.email) = $1
       and e.active = true`,
    [email]
  );


  /* --------------------------------------------------------------------------
     Find matching Freelancer
  -------------------------------------------------------------------------- */

  const freelancerResult = await db.query(
    `select id
     from freelancers
     where lower(email) = $1`,
    [email]
  );


  /* --------------------------------------------------------------------------
     Find matching Service Agreement Worker
  -------------------------------------------------------------------------- */

  const serviceWorkerResult = await db.query(
    `select id
     from service_agreement_workers
     where lower(email) = $1
       and active = true`,
    [email]
  );


  const employee = employeeResult.rows[0];
  const freelancer = freelancerResult.rows[0];
  const serviceWorker = serviceWorkerResult.rows[0];


  /* --------------------------------------------------------------------------
     Reject emails that are not registered in the portal
  -------------------------------------------------------------------------- */

  if (
    !employee &&
    !freelancer &&
    !serviceWorker
  ) {
    throw new ApiError(
      403,
      'ACCOUNT_NOT_APPROVED',
      'This email address is not registered for portal access.'
    );
  }


  /* --------------------------------------------------------------------------
     Create portal user if needed

     This is particularly useful for Freelancers and Service Agreement Workers,
     because their worker record can exist before their users record.
  -------------------------------------------------------------------------- */

  if (!user) {
    const inserted = await db.query(
      `insert into users (
        auth_provider,
        email,
        display_name
      )
      values (
        'email_magic_link',
        $1,
        $1
      )
      returning *`,
      [email]
    );

    user = inserted.rows[0];

  } else {
    await db.query(
      `update users
       set last_login_at = now()
       where id = $1`,
      [user.id]
    );
  }


  /* --------------------------------------------------------------------------
     Ensure account has not been deactivated
  -------------------------------------------------------------------------- */

  if (!user.is_active) {
    throw new ApiError(
      403,
      'ACCOUNT_INACTIVE',
      'This account has been deactivated.'
    );
  }


  /* --------------------------------------------------------------------------
     Link Employee to user
  -------------------------------------------------------------------------- */

  if (employee) {
    await db.query(
      `update employees
       set user_id = $1
       where id = $2
         and user_id is null`,
      [
        user.id,
        employee.id
      ]
    );
  }


  /* --------------------------------------------------------------------------
     Link Freelancer to user
  -------------------------------------------------------------------------- */

  if (freelancer) {
    await db.query(
      `update freelancers
       set user_id = $1
       where id = $2
         and user_id is null`,
      [
        user.id,
        freelancer.id
      ]
    );
  }


  /* --------------------------------------------------------------------------
     Link Service Agreement Worker to user
  -------------------------------------------------------------------------- */

  if (serviceWorker) {
    await db.query(
      `update service_agreement_workers
       set user_id = $1
       where id = $2
         and user_id is null`,
      [
        user.id,
        serviceWorker.id
      ]
    );
  }


  return {
    token: issueSession(user.id),
    userId: user.id
  };
}


/* ============================================================================
   CURRENT USER / PROFILE
============================================================================ */

/**
 * Returns the logged-in user's identity, roles, and linked worker profile.
 */
async function getMe(userId) {
  const { rows } = await db.query(
    `select
       u.id,
       u.email,
       u.display_name,

       coalesce(
         array_agg(distinct r.key)
         filter (where r.key is not null),
         '{}'
       ) as roles,

       (
         select id
         from employees
         where user_id = u.id
       ) as employee_id,

       (
         select id
         from freelancers
         where user_id = u.id
       ) as freelancer_id,

       (
         select id
         from service_agreement_workers
         where user_id = u.id
       ) as service_worker_id

     from users u

     left join user_roles ur
       on ur.user_id = u.id

     left join roles r
       on r.id = ur.role_id

     where u.id = $1

     group by u.id`,
    [userId]
  );

  return rows[0];
}


/* ============================================================================
   EXPORTS
============================================================================ */

module.exports = {
  loginWithEntra,
  requestEmailLink,
  verifyEmailLink,
  getMe
};