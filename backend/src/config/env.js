require('dotenv').config();

const required = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'SESSION_JWT_SECRET',
  'BANKING_ENCRYPTION_KEY'
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length && process.env.NODE_ENV !== 'test') {
  // Fail fast and loudly rather than limping along with undefined secrets.
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'braco-documents',
  entraTenantId: process.env.ENTRA_TENANT_ID,
  entraClientId: process.env.ENTRA_CLIENT_ID,
  entraIssuer: process.env.ENTRA_ISSUER || `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/v2.0`,
  sessionJwtSecret: process.env.SESSION_JWT_SECRET,
  sessionJwtTtl: process.env.SESSION_JWT_TTL || '1h',
  refreshTokenTtl: process.env.REFRESH_TOKEN_TTL || '30d',
  bankingEncryptionKey: process.env.BANKING_ENCRYPTION_KEY
};
