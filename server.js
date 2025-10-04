require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { DateTime } = require('luxon');
const db = require('./src/db');
const {
  parseScheduleFromBody,
  isSecretVisibleNow,
  validateTimezone,
  buildDefaultExampleSchedule,
  scheduleToDisplayRows,
  hasEverEnteredHiddenSinceCreation,
} = require('./src/schedule');

const app = express();
const PORT = process.env.PORT || 3000;

// Security hardening
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://cdn.tailwindcss.com'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// Disable caching to avoid leaking visible responses
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /');
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Custom ID validation
const RESERVED_IDS = new Set(['new', 'list', 'healthz', 'robots.txt']);
function isValidCustomId(id) {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(trimmed)) return false; // 3-63 chars
  if (RESERVED_IDS.has(trimmed)) return false;
  return true;
}

// Initialize database and start server only after successful init
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Secret app listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database', err);
    process.exit(1);
  });

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/', (req, res) => {
  res.redirect('/new');
});

app.get('/list', async (_req, res) => {
  const secrets = await db.listSecrets();
  const items = secrets.map((s) => {
    const visible = isSecretVisibleNow(s.schedule, s.timezone);
    return {
      id: s.id,
      timezone: s.timezone,
      createdAt: s.createdAt,
      isVisible: visible,
      lockedAt: s.lockedAt,
      preview: visible ? s.secretText : null,
    };
  });
  const message = _req.query && _req.query.msg ? String(_req.query.msg) : '';
  res.render('list', { title: 'All Secrets', items, message });
});

app.get('/new', (req, res) => {
  const clientTz = 'UTC';
  const defaultSchedule = buildDefaultExampleSchedule();
  res.render('new', {
    title: 'Create Secret',
    defaultTimezone: clientTz,
    defaultSchedule,
    errors: [],
    values: { id: '', secretText: '' },
  });
});

app.post('/secret', async (req, res) => {
  const { id: rawId = '', secretText = '', timezone = '' } = req.body;
  const errors = [];

  const id = String(rawId || '').trim().toLowerCase();
  if (!isValidCustomId(id)) {
    errors.push('Custom ID must be 3–63 chars (lowercase letters, numbers, hyphens) and not reserved.');
  }

  if (!secretText || typeof secretText !== 'string' || secretText.trim().length === 0) {
    errors.push('Secret text is required.');
  }

  if (!validateTimezone(timezone)) {
    errors.push('Invalid time zone. Use a valid IANA timezone (e.g., Europe/London).');
  }

  let schedule;
  try {
    schedule = parseScheduleFromBody(req.body);
  } catch (e) {
    errors.push(e.message || 'Invalid schedule.');
  }

  // Check uniqueness if format is valid
  if (errors.length === 0) {
    const existing = await db.getSecret(id);
    if (existing) {
      errors.push('This ID is already taken. Please choose another.');
    }
  }

  if (errors.length > 0) {
    return res.status(400).render('new', {
      title: 'Create Secret',
      defaultTimezone: timezone || 'UTC',
      defaultSchedule: schedule || buildDefaultExampleSchedule(),
      errors,
      values: { id, secretText },
    });
  }

  const createdAt = DateTime.utc().toISO();
  const initialVisibility = isSecretVisibleNow(schedule, timezone);
  const lockedAt = initialVisibility ? null : DateTime.utc().toISO();

  try {
    await db.createSecret({ id, secretText, timezone, schedule, createdAt, lockedAt });
  } catch (e) {
    // Handle rare race: unique violation
    if (e && e.code === '23505') {
      return res.status(400).render('new', {
        title: 'Create Secret',
        defaultTimezone: timezone || 'UTC',
        defaultSchedule: schedule || buildDefaultExampleSchedule(),
        errors: ['This ID is already taken. Please choose another.'],
        values: { id, secretText },
      });
    }
    console.error('Failed to create secret', e);
    return res.status(500).send('Internal Server Error');
  }

  return res.redirect(`/s/${id}`);
});

app.get('/s/:id', async (req, res) => {
  const { id } = req.params;
  const secret = await db.getSecret(id);
  if (!secret) {
    return res.status(404).render('not_found', { title: 'Not Found' });
  }

  const isVisible = isSecretVisibleNow(secret.schedule, secret.timezone);

  // One-way lock: if the secret has ever entered a hidden period since creation, lock forever
  if (!secret.lockedAt) {
    const everHidden = hasEverEnteredHiddenSinceCreation(secret.createdAt, secret.schedule, secret.timezone) || !isVisible;
    if (everHidden) {
      const lockedAt = DateTime.utc().toISO();
      await db.lockSecret(id, lockedAt);
      secret.lockedAt = lockedAt;
    }
  }

  const canModifySchedule = isVisible && !secret.lockedAt;

  res.render('show', {
    title: 'Secret',
    secret,
    isVisible,
    canModifySchedule,
    scheduleRows: scheduleToDisplayRows(secret.schedule),
  });
});

app.post('/s/:id/update-schedule', async (req, res) => {
  const { id } = req.params;
  const secret = await db.getSecret(id);
  if (!secret) {
    return res.status(404).render('not_found', { title: 'Not Found' });
  }

  const isVisible = isSecretVisibleNow(secret.schedule, secret.timezone);
  const everHidden = secret.lockedAt || hasEverEnteredHiddenSinceCreation(secret.createdAt, secret.schedule, secret.timezone);
  if (!isVisible || everHidden) {
    return res.status(403).send('Schedule cannot be changed outside visible periods or after lock.');
  }

  const errors = [];
  const { timezone = '' } = req.body;
  if (!validateTimezone(timezone)) {
    errors.push('Invalid time zone.');
  }

  let schedule;
  try {
    schedule = parseScheduleFromBody(req.body);
  } catch (e) {
    errors.push(e.message || 'Invalid schedule.');
  }

  if (errors.length > 0) {
    return res.status(400).render('show', {
      title: 'Secret',
      secret: { ...secret, timezone, schedule },
      isVisible,
      canModifySchedule: true,
      scheduleRows: scheduleToDisplayRows(schedule || secret.schedule),
      errors,
    });
  }

  try {
    await db.updateSecretSchedule(id, timezone, schedule);
  } catch (e) {
    console.error('Failed to update schedule', e);
    return res.status(500).send('Internal Server Error');
  }

  return res.redirect(`/s/${id}`);
});

app.post('/s/:id/delete', async (req, res) => {
  const { id } = req.params;
  const { confirm = '' } = req.body || {};
  const secret = await db.getSecret(id);
  if (!secret) {
    return res.status(404).render('not_found', { title: 'Not Found' });
  }
  const isVisible = isSecretVisibleNow(secret.schedule, secret.timezone);
  if (!isVisible) {
    return res.status(403).render('show', {
      title: 'Secret',
      secret,
      isVisible,
      canModifySchedule: false,
      scheduleRows: scheduleToDisplayRows(secret.schedule),
      errors: ['Cannot delete while the secret is hidden. Try again during a visible window.'],
    });
  }
  if (String(confirm).trim().toLowerCase() !== id.toLowerCase()) {
    return res.status(400).render('show', {
      title: 'Secret',
      secret,
      isVisible,
      canModifySchedule: false,
      scheduleRows: scheduleToDisplayRows(secret.schedule),
      errors: ['Deletion confirmation failed. Type the exact ID to confirm.'],
    });
  }
  try {
    await db.deleteSecret(id);
  } catch (e) {
    console.error('Failed to delete secret', e);
    return res.status(500).send('Internal Server Error');
  }
  return res.redirect('/list?msg=Secret%20deleted');
});

app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not Found' });
});

// server starts in db.init().then(...)


