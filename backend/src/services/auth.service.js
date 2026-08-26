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


/* ============================================================================
   SESSION
============================================================================ */

function issueSession(userId) {
  return jwt.sign(
    { sub: userId },
    env.sessionJwtSecret,
    { expiresIn: env.sessionJwtTtl }
  );
}


/* ============================================================================
   MICROSOFT ENTRA LOGIN
============================================================================ */

async function loginWithEntra(entraIdToken) {
  const claims = await verifyEntraToken(entraIdToken);

  let { rows } = await db.query(
    `select *
     from users
     where entra_object_id = $1`,
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
   EMAIL MAGIC-LINK — REQUEST
============================================================================ */

async function requestEmailLink(email) {
  const normalizedEmail = email.trim().toLowerCase();


  // Existing portal users:
  // Admin, HR, Finance, Supervisor, Employee, Freelancer, etc.
  const portalUserResult = await db.query(
    `select u.id
     from users u
     where lower(u.email) = $1
       and u.is_active = true
       and (
         exists (
           select 1
           from user_roles ur
           where ur.user_id = u.id
         )
         or exists (
           select 1
           from employees e
           where e.user_id = u.id
             and e.active = true
         )
         or exists (
           select 1
           from freelancers f
           where f.user_id = u.id
         )
       )`,
    [normalizedEmail]
  );


  // Service Agreement Workers may exist before a users row is created.
  const serviceWorkerResult = await db.query(
    `select id
     from service_agreement_workers
     where lower(email) = $1
       and active = true`,
    [normalizedEmail]
  );


  // Do not reveal whether the email exists.
  if (
    !portalUserResult.rows[0] &&
    !serviceWorkerResult.rows[0]
  ) {
    return;
  }


  // IMPORTANT:
  // Explicitly send the user back to the frontend callback route.
  const { error } = await supabaseAdmin.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${env.frontendOrigin}/auth/callback`
    }
  });


  if (error) {
    console.error(
      'Supabase magic-link request failed:',
      error.message
    );

    throw new ApiError(
      500,
      'EMAIL_LINK_FAILED',
      'Unable to send the sign-in link.'
    );
  }
}


/* ============================================================================
   EMAIL MAGIC-LINK — VERIFY
============================================================================ */

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
     Existing portal user
  -------------------------------------------------------------------------- */

  const userResult = await db.query(
    `select *
     from users
     where lower(email) = $1`,
    [email]
  );

  let user = userResult.rows[0];


  /* --------------------------------------------------------------------------
     Service Agreement Worker
  -------------------------------------------------------------------------- */

  const serviceWorkerResult = await db.query(
    `select id,
            user_id
     from service_agreement_workers
     where lower(email) = $1
       and active = true`,
    [email]
  );

  const serviceWorker = serviceWorkerResult.rows[0];


  /* --------------------------------------------------------------------------
     Create users row only for an approved Service Agreement Worker
  -------------------------------------------------------------------------- */

  if (!user) {

    if (!serviceWorker) {
      throw new ApiError(
        403,
        'ACCOUNT_NOT_APPROVED',
        'This email address is not registered for portal access.'
      );
    }


    const inserted = await db.query(
      `insert into users (
         auth_provider,
         email,
         display_name
       )
       values (
         'email_magic_link',
         $1,
         $2
       )
       returning *`,
      [
        email,
        email
      ]
    );

    user = inserted.rows[0];
  }


  /* --------------------------------------------------------------------------
     Active-account check
  -------------------------------------------------------------------------- */

  if (!user.is_active) {
    throw new ApiError(
      403,
      'ACCOUNT_INACTIVE',
      'This account has been deactivated.'
    );
  }


  /* --------------------------------------------------------------------------
     Employee profile
  -------------------------------------------------------------------------- */

  const employeeResult = await db.query(
    `select e.id
     from employees e
     where e.user_id = $1
       and e.active = true`,
    [user.id]
  );

  const employee = employeeResult.rows[0];


  /* --------------------------------------------------------------------------
     Freelancer profile
  -------------------------------------------------------------------------- */

  const freelancerResult = await db.query(
    `select f.id
     from freelancers f
     where f.user_id = $1`,
    [user.id]
  );

  const freelancer = freelancerResult.rows[0];


  /* --------------------------------------------------------------------------
     Portal roles
  -------------------------------------------------------------------------- */

  const roleResult = await db.query(
    `select r.key
     from user_roles ur
     join roles r
       on r.id = ur.role_id
     where ur.user_id = $1`,
    [user.id]
  );

  const roles = roleResult.rows.map(row => row.key);


  /* --------------------------------------------------------------------------
     Link Service Agreement Worker to user
  -------------------------------------------------------------------------- */

  if (serviceWorker) {

    if (
      serviceWorker.user_id &&
      serviceWorker.user_id !== user.id
    ) {
      throw new ApiError(
        409,
        'ACCOUNT_LINK_CONFLICT',
        'This service agreement worker is already linked to another account.'
      );
    }


    if (!serviceWorker.user_id) {
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


    await db.query(
      `insert into user_roles (
         user_id,
         role_id
       )
       select
         $1,
         r.id
       from roles r
       where r.key = 'service_worker'
       on conflict (user_id, role_id)
       do nothing`,
      [user.id]
    );


    if (!roles.includes('service_worker')) {
      roles.push('service_worker');
    }
  }


  /* --------------------------------------------------------------------------
     Authorization check
  -------------------------------------------------------------------------- */

  const approved =
    roles.length > 0 ||
    Boolean(employee) ||
    Boolean(freelancer) ||
    Boolean(serviceWorker);


  if (!approved) {
    throw new ApiError(
      403,
      'ACCOUNT_NOT_APPROVED',
      'This email address is not registered for portal access.'
    );
  }


  /* --------------------------------------------------------------------------
     Update login timestamp
  -------------------------------------------------------------------------- */

  await db.query(
    `update users
     set last_login_at = now()
     where id = $1`,
    [user.id]
  );


  /* --------------------------------------------------------------------------
     Issue Braco portal session
  -------------------------------------------------------------------------- */

  return {
    token: issueSession(user.id),
    userId: user.id
  };
}


/* ============================================================================
   CURRENT USER
============================================================================ */

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
         select e.id
         from employees e
         where e.user_id = u.id
       ) as employee_id,

       (
         select f.id
         from freelancers f
         where f.user_id = u.id
       ) as freelancer_id,

       (
         select saw.id
         from service_agreement_workers saw
         where saw.user_id = u.id
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


  if (!rows[0]) {
    throw new ApiError(
      404,
      'USER_NOT_FOUND',
      'User account was not found.'
    );
  }


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