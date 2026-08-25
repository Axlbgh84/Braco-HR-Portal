const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const env = require('./env');

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${env.entraTenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000, // 12h
  rateLimit: true
});

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * Verifies a raw Entra ID token (used once, at login). Checks signature against
 * Entra's published JWKS, plus issuer/audience/expiry.
 * @param {string} token
 * @returns {Promise<{oid: string, tid: string, email: string, name: string}>}
 */
function verifyEntraToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getSigningKey,
      {
        audience: env.entraClientId,
        issuer: env.entraIssuer,
        algorithms: ['RS256']
      },
      (err, decoded) => {
        if (err) return reject(err);
        resolve({
          oid: decoded.oid,
          tid: decoded.tid,
          email: decoded.preferred_username || decoded.email,
          name: decoded.name
        });
      }
    );
  });
}

module.exports = { verifyEntraToken };
