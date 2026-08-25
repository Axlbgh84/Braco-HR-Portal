const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const authService = require('../services/auth.service');

const router = express.Router();

// Auth endpoints are the most attractive target for abuse — rate limit tightly.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post('/entra/callback', authLimiter, async (req, res, next) => {
  try {
    const { idToken } = z.object({ idToken: z.string().min(10) }).parse(req.body);
    const { token } = await authService.loginWithEntra(idToken);
    res
      .cookie('session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 1000 })
      .json({ data: { token } }); // also returned in body for SPA clients using Authorization header instead of cookies
  } catch (err) { next(err); }
});

router.post('/freelancer/request-link', authLimiter, async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await authService.requestFreelancerLink(email);
    res.status(204).send(); // same response whether or not the email matches a freelancer
  } catch (err) { next(err); }
});

router.post('/freelancer/verify', authLimiter, async (req, res, next) => {
  try {
    const { accessToken } = z.object({ accessToken: z.string().min(10) }).parse(req.body);
    const { token } = await authService.verifyFreelancerLink(accessToken);
    res
      .cookie('session', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 60 * 60 * 1000 })
      .json({ data: { token } });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  res.clearCookie('session').status(204).send();
});

router.get('/me', requireAuth, async (req, res, next) => {
  try { res.json({ data: await authService.getMe(req.user.id) }); } catch (err) { next(err); }
});

module.exports = router;
