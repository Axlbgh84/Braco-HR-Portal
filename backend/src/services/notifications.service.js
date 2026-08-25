const db = require('../config/db');

async function notify(userId, type, message) {
  if (!userId) return;
  await db.query(
    `insert into notifications (user_id, type, message) values ($1,$2,$3)`,
    [userId, type, message]
  );
}

/** Notify every active user holding a given role (used for "HR review needed" style broadcasts). */
async function notifyRole(roleKey, type, message) {
  const { rows } = await db.query(
    `select u.id from users u
     join user_roles ur on ur.user_id = u.id
     join roles r on r.id = ur.role_id
     where r.key = $1 and u.is_active`,
    [roleKey]
  );
  await Promise.all(rows.map((u) => notify(u.id, type, message)));
}

module.exports = { notify, notifyRole };
