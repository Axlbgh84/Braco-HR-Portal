const app = require('./app');
const env = require('./config/env');

const server = app.listen(env.port, () => {
  console.log(`Braco HR API listening on :${env.port} (${env.nodeEnv})`);
});

// Graceful shutdown — important on Render/Railway, which send SIGTERM on deploys.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => process.exit(0));
});
