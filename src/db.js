const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '..', 'data');
const dbFile = path.join(dataDir, 'secrets.sqlite');

let db;

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

async function init() {
  ensureDataDir();
  db = new sqlite3.Database(dbFile);
  await run(
    `CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      secretText TEXT NOT NULL,
      timezone TEXT NOT NULL,
      schedule TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      lockedAt TEXT
    )`
  );
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function createSecret({ id, secretText, timezone, schedule, createdAt, lockedAt }) {
  const scheduleJson = JSON.stringify(schedule);
  await run(
    `INSERT INTO secrets (id, secretText, timezone, schedule, createdAt, lockedAt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, secretText, timezone, scheduleJson, createdAt, lockedAt]
  );
}

async function getSecret(id) {
  const row = await get(`SELECT * FROM secrets WHERE id = ?`, [id]);
  if (!row) return null;
  return {
    id: row.id,
    secretText: row.secretText,
    timezone: row.timezone,
    schedule: JSON.parse(row.schedule),
    createdAt: row.createdAt,
    lockedAt: row.lockedAt,
  };
}

async function listSecrets() {
  const rows = await all(`SELECT * FROM secrets ORDER BY datetime(createdAt) DESC`, []);
  return rows.map((row) => ({
    id: row.id,
    secretText: row.secretText,
    timezone: row.timezone,
    schedule: JSON.parse(row.schedule),
    createdAt: row.createdAt,
    lockedAt: row.lockedAt,
  }));
}

async function lockSecret(id, lockedAt) {
  await run(`UPDATE secrets SET lockedAt = ? WHERE id = ?`, [lockedAt, id]);
}

async function updateSecretSchedule(id, timezone, schedule) {
  const scheduleJson = JSON.stringify(schedule);
  await run(`UPDATE secrets SET timezone = ?, schedule = ? WHERE id = ?`, [timezone, scheduleJson, id]);
}

module.exports = {
  init,
  createSecret,
  getSecret,
  lockSecret,
  updateSecretSchedule,
  listSecrets,
};


