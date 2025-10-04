const { Pool } = require('pg');

// Build a robust Pool configuration that works locally and on Render
function createPool() {
  const hasUrl = !!process.env.DATABASE_URL;
  const shouldUseSSL = (() => {
    const sslEnv = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || '').toLowerCase();
    if (sslEnv === 'require' || sslEnv === 'true') return true;
    if (process.env.NODE_ENV === 'production' && /render\.com/.test(process.env.DATABASE_URL || '')) return true;
    return false;
  })();

  const ssl = shouldUseSSL ? { rejectUnauthorized: false } : undefined;

  if (hasUrl) {
    return new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  }

  return new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'postgres',
    ssl,
  });
}

const pool = createPool();

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error', err);
});

// Graceful shutdown to avoid hanging clients on process exit
function setupGracefulShutdown() {
  const shutdown = async (signal) => {
    try {
      await pool.end();
    } catch (e) {
      // noop
    } finally {
      process.exit(signal === 'SIGTERM' ? 0 : 0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

setupGracefulShutdown();

async function init() {
  // Create table with conventional snake_case column names
  await pool.query(`
    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      secret_text TEXT NOT NULL,
      timezone TEXT NOT NULL,
      schedule JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      locked_at TIMESTAMPTZ
    )
  `);
}

function parseScheduleValue(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch (_e) { return null; }
  }
  return raw;
}

async function createSecret({ id, secretText, timezone, schedule, createdAt, lockedAt }) {
  await pool.query(
    `INSERT INTO secrets (id, secret_text, timezone, schedule, created_at, locked_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)`,
    [id, secretText, timezone, JSON.stringify(schedule), createdAt, lockedAt]
  );
}

async function getSecret(id) {
  const { rows } = await pool.query(
    `SELECT id,
            secret_text AS "secretText",
            timezone,
            schedule,
            created_at AS "createdAt",
            locked_at AS "lockedAt"
       FROM secrets
      WHERE id = $1
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    secretText: row.secretText,
    timezone: row.timezone,
    schedule: parseScheduleValue(row.schedule),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    lockedAt: row.lockedAt instanceof Date ? row.lockedAt.toISOString() : row.lockedAt,
  };
}

async function listSecrets() {
  const { rows } = await pool.query(
    `SELECT id,
            secret_text AS "secretText",
            timezone,
            schedule,
            created_at AS "createdAt",
            locked_at AS "lockedAt"
       FROM secrets
   ORDER BY created_at DESC`
  );
  return rows.map((row) => ({
    id: row.id,
    secretText: row.secretText,
    timezone: row.timezone,
    schedule: parseScheduleValue(row.schedule),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    lockedAt: row.lockedAt instanceof Date ? row.lockedAt.toISOString() : row.lockedAt,
  }));
}

async function lockSecret(id, lockedAt) {
  await pool.query(
    `UPDATE secrets SET locked_at = $1::timestamptz WHERE id = $2`,
    [lockedAt, id]
  );
}

async function updateSecretSchedule(id, timezone, schedule) {
  await pool.query(
    `UPDATE secrets SET timezone = $1, schedule = $2::jsonb WHERE id = $3`,
    [timezone, JSON.stringify(schedule), id]
  );
}

module.exports = {
  init,
  createSecret,
  getSecret,
  lockSecret,
  updateSecretSchedule,
  listSecrets,
};


