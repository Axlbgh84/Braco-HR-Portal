const env = require('../config/env');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = status === 500 && env.nodeEnv === 'production'
    ? 'Something went wrong on our end.'
    : err.message;

  if (status === 500) {
    console.error(err); // full stack server-side; never leak stack traces to the client
  }

  res.status(status).json({ error: { code, message } });
}

module.exports = { ApiError, notFoundHandler, errorHandler };
