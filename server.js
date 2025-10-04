const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { DateTime } = require('luxon');
const crypto = require('crypto');
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

function generateId(size = 21) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-';
  const bytes = crypto.randomBytes(size);
  let id = '';
  for (let i = 0; i < size; i += 1) {
    id += alphabet[bytes[i] & 63];
  }
  return id;
}

// Initialize database
db.init().catch((err) => {
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
  res.render('list', { title: 'All Secrets', items });
});

app.get('/new', (req, res) => {
  const clientTz = 'UTC';
  const defaultSchedule = buildDefaultExampleSchedule();
  res.render('new', {
    title: 'Create Secret',
    defaultTimezone: clientTz,
    defaultSchedule,
    errors: [],
    values: { secretText: '' },
  });
});

app.post('/secret', async (req, res) => {
  const { secretText = '', timezone = '' } = req.body;
  const errors = [];

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

  if (errors.length > 0) {
    return res.status(400).render('new', {
      title: 'Create Secret',
      defaultTimezone: timezone || 'UTC',
      defaultSchedule: schedule || buildDefaultExampleSchedule(),
      errors,
      values: { secretText },
    });
  }

  const id = generateId(21);
  const createdAt = DateTime.utc().toISO();
  const initialVisibility = isSecretVisibleNow(schedule, timezone);
  const lockedAt = initialVisibility ? null : DateTime.utc().toISO();

  try {
    await db.createSecret({ id, secretText, timezone, schedule, createdAt, lockedAt });
  } catch (e) {
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

app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not Found' });
});

app.listen(PORT, () => {
  console.log(`Secret app listening on http://localhost:${PORT}`);
});


