const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../config/db');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select * from notifications where user_id = $1 order by created_at desc limit 50`,
      [req.user.id]
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select count(*)::int as count from notifications where user_id = $1 and read = false`,
      [req.user.id]
    );
    res.json({ data: { count: rows[0].count } });
  } catch (err) { next(err); }
});

router.post('/read-all', async (req, res, next) => {
  try {
    await db.query(`update notifications set read = true where user_id = $1 and read = false`, [req.user.id]);
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
