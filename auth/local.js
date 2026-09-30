'use strict';

// Username-only login for the Okta-fronted internal app (Google dropped — the
// -internal.com domain breaks the Google OAuth callback, and Okta already
// authenticates the Salesforce employee at the edge). The SE types their
// @salesforce.com email prefix (e.g. "mtoledo"); returning users must type it
// exactly to reconnect to their existing account + demos.
//
// Uses passport's session machinery (req.logIn) so requireAuth and every authed
// route keep working exactly as they did under Google.

const db = require('../db');

// Normalize whatever the SE typed into a stable username: lowercase, drop a
// pasted "@salesforce.com" (or any domain), keep only safe chars, cap length.
function normalizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  let u = raw.trim().toLowerCase();
  const at = u.indexOf('@');
  if (at !== -1) u = u.slice(0, at); // tolerate a pasted full email
  u = u.replace(/[^a-z0-9._-]/g, '');
  return u.slice(0, 30);
}

function registerRoutes(app) {
  // Only allow redirecting back to a same-origin path (guards ?returnTo /
  // ?config handoff against open-redirect). Returns a safe path or null.
  const safeReturnTo = (raw) => {
    if (typeof raw !== 'string' || !raw) return null;
    if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return null;
    return raw;
  };

  app.post('/auth/login', async (req, res, next) => {
    try {
      const username = normalizeUsername(req.body && req.body.username);
      if (!username) {
        return res.status(400).json({ error: 'invalid_username', detail: 'Enter your Salesforce email prefix (e.g. mtoledo).' });
      }
      const email = `${username}@salesforce.com`;
      const user = await db.upsertUserByUsername({ username, email, name: username });
      req.logIn(user, (err) => {
        if (err) return next(err);
        res.json({ ok: true, returnTo: safeReturnTo(req.body && req.body.returnTo) || '/' });
      });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { registerRoutes, normalizeUsername };
