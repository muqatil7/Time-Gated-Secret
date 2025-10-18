const crypto = require('crypto');
const fs = require('fs');

let firestoreConfig = null;
let accessTokenCache = null;

function getEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseServiceAccountJSON(source) {
  if (!source) return null;

  let jsonString = source;

  if (fs.existsSync(source)) {
    jsonString = fs.readFileSync(source, 'utf8');
  }

  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null;
    }
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  } catch (_err) {
    return null;
  }
}

function loadConfig() {
  if (firestoreConfig) return firestoreConfig;

  let projectId = getEnv('FIREBASE_PROJECT_ID');
  let clientEmail = getEnv('FIREBASE_CLIENT_EMAIL');
  let privateKey = getEnv('FIREBASE_PRIVATE_KEY');

  if (!projectId || !clientEmail || !privateKey) {
    const fromServiceAccount =
      parseServiceAccountJSON(getEnv('FIREBASE_SERVICE_ACCOUNT_JSON')) ||
      parseServiceAccountJSON(getEnv('FIREBASE_SERVICE_ACCOUNT_FILE'));

    if (fromServiceAccount) {
      projectId = projectId || fromServiceAccount.projectId;
      clientEmail = clientEmail || fromServiceAccount.clientEmail;
      privateKey = privateKey || fromServiceAccount.privateKey;
    }
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase service-account credentials. Provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_FILE). Note: the web SDK config with apiKey/authDomain is not sufficient for server access.'
    );
  }

  privateKey = privateKey.replace(/\r\n/g, '\n');
  privateKey = privateKey.replace(/\\n/g, '\n');

  firestoreConfig = { projectId, clientEmail, privateKey };
  return firestoreConfig;
}

function base64UrlEncode(data) {
  return Buffer.from(data)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function fetchAccessToken() {
  const { clientEmail, privateKey } = loadConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign(privateKey);
  const assertion = `${unsignedToken}.${base64UrlEncode(signature)}`;

  const params = new URLSearchParams();
  params.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  params.append('assertion', assertion);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`Failed to obtain Firebase access token: ${text}`), {
      status: response.status,
    });
  }

  const json = await response.json();
  const expiresIn = Number(json.expires_in || 0);
  accessTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(0, (expiresIn - 60) * 1000),
  };
  return accessTokenCache.token;
}

async function getAccessToken() {
  if (accessTokenCache && accessTokenCache.token && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }
  return fetchAccessToken();
}

function buildFirestoreUrl(path, query = {}) {
  const { projectId } = loadConfig();
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
  const search = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((v) => search.append(key, v));
    } else if (value != null) {
      search.append(key, String(value));
    }
  });
  const queryString = search.toString();
  return `${base}${path}${queryString ? `?${queryString}` : ''}`;
}

async function callFirestore(method, path, body, query) {
  const token = await getAccessToken();
  const response = await fetch(buildFirestoreUrl(path, query), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let errorPayload;
    try {
      errorPayload = await response.json();
    } catch (_e) {
      errorPayload = { error: { message: response.statusText } };
    }
    const error = new Error(errorPayload.error?.message || 'Firestore request failed');
    error.code = errorPayload.error?.status || response.status;
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function stringField(value) {
  return { stringValue: value }; 
}

function timestampField(value) {
  return { timestampValue: value };
}

function nullField() {
  return { nullValue: null };
}

function buildSecretFields({ id, secretText, timezone, schedule, createdAt, lockedAt }) {
  const fields = {
    id: stringField(id),
    secretText: stringField(secretText),
    timezone: stringField(timezone),
    schedule: stringField(JSON.stringify(schedule)),
    createdAt: timestampField(createdAt),
  };
  fields.lockedAt = lockedAt ? timestampField(lockedAt) : nullField();
  return fields;
}

function parseTimestampField(field) {
  if (!field) return null;
  if (typeof field.timestampValue === 'string') return field.timestampValue;
  if (typeof field.stringValue === 'string') return field.stringValue;
  return null;
}

function parseSecretDocument(doc) {
  if (!doc || !doc.fields) return null;
  const { fields } = doc;
  const scheduleRaw = fields.schedule?.stringValue;
  let schedule = null;
  if (typeof scheduleRaw === 'string') {
    try {
      schedule = JSON.parse(scheduleRaw);
    } catch (_e) {
      schedule = null;
    }
  }

  return {
    id: fields.id?.stringValue || doc.name.split('/').pop(),
    secretText: fields.secretText?.stringValue || '',
    timezone: fields.timezone?.stringValue || 'UTC',
    schedule: schedule || { version: 1, windowsPerDay: {} },
    createdAt: parseTimestampField(fields.createdAt),
    lockedAt: parseTimestampField(fields.lockedAt),
  };
}

async function init() {
  loadConfig();
  await getAccessToken();
}

async function createSecret({ id, secretText, timezone, schedule, createdAt, lockedAt }) {
  const fields = buildSecretFields({ id, secretText, timezone, schedule, createdAt, lockedAt });
  await callFirestore(
    'PATCH',
    `/documents/secrets/${encodeURIComponent(id)}`,
    { fields },
    { 'currentDocument.exists': 'false' }
  );
}

async function getSecret(id) {
  try {
    const doc = await callFirestore('GET', `/documents/secrets/${encodeURIComponent(id)}`, null, {});
    return parseSecretDocument(doc);
  } catch (e) {
    if (e.status === 404 || e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function listSecrets() {
  const result = await callFirestore('GET', '/documents/secrets', null, {
    orderBy: 'createdAt desc',
    pageSize: 1000,
  });
  const documents = result.documents || [];
  return documents.map(parseSecretDocument).filter(Boolean);
}

async function lockSecret(id, lockedAt) {
  await callFirestore(
    'PATCH',
    `/documents/secrets/${encodeURIComponent(id)}`,
    {
      fields: {
        lockedAt: timestampField(lockedAt),
      },
    },
    { 'updateMask.fieldPaths': 'lockedAt' }
  );
}

async function updateSecretSchedule(id, timezone, schedule) {
  await callFirestore(
    'PATCH',
    `/documents/secrets/${encodeURIComponent(id)}`,
    {
      fields: {
        timezone: stringField(timezone),
        schedule: stringField(JSON.stringify(schedule)),
      },
    },
    {
      'updateMask.fieldPaths': ['timezone', 'schedule'],
    }
  );
}

async function deleteSecret(id) {
  await callFirestore('DELETE', `/documents/secrets/${encodeURIComponent(id)}`, null, {});
}

module.exports = {
  init,
  createSecret,
  getSecret,
  lockSecret,
  updateSecretSchedule,
  listSecrets,
  deleteSecret,
};
