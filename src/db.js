// Polyfill fetch for Node.js environments older than 18 or those that lack fetch
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}

const crypto = require('crypto');
const fs = require('fs');

let firestoreConfig = null;
let accessTokenCache = null;
let dbInitialized = false;

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
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
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

  const fromServiceAccount =
    parseServiceAccountJSON(getEnv('FIREBASE_SERVICE_ACCOUNT_JSON')) ||
    parseServiceAccountJSON(getEnv('FIREBASE_SERVICE_ACCOUNT_FILE'));

  if (fromServiceAccount) {
    projectId = projectId || fromServiceAccount.projectId;
    clientEmail = clientEmail || fromServiceAccount.clientEmail;
    privateKey = privateKey || fromServiceAccount.privateKey;
  }

  if (projectId && clientEmail && privateKey) {
    privateKey = privateKey.replace(/\r\n/g, '\n').replace(/\\n/g, '\n');
    firestoreConfig = { projectId, clientEmail, privateKey };
    dbInitialized = true;
  } else {
    console.warn("Firebase credentials not found. Database features will be disabled.");
    dbInitialized = false;
  }
  return firestoreConfig;
}

async function getAccessToken() {
  if (!dbInitialized || !firestoreConfig) {
    throw new Error('Database not initialized');
  }
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token;
  }

  const { clientEmail, privateKey } = firestoreConfig;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const unsignedToken = `${Buffer.from(JSON.stringify(header)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  const signature = signer.sign(privateKey);
  const assertion = `${unsignedToken}.${Buffer.from(signature).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;

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
  accessTokenCache = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(0, ((Number(json.expires_in) || 0) - 60) * 1000),
  };
  return accessTokenCache.token;
}

async function callFirestore(method, path, body, query) {
  if (!dbInitialized) {
    const error = new Error('Firestore is not initialized.');
    error.status = 500;
    throw error;
  }
  const token = await getAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${firestoreConfig.projectId}/databases/(default)${path}`;
  const response = await fetch(url, {
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

function stringField(value) { return { stringValue: value }; }
function timestampField(value) { return { timestampValue: value }; }

function parseTimestampField(field) {
  if (!field) return null;
  return field.timestampValue || field.stringValue || null;
}

function parseHtmlPageDocument(doc) {
  if (!doc || !doc.fields) return null;
  const { fields } = doc;
  return {
    pageName: fields.pageName?.stringValue || doc.name.split('/').pop(),
    htmlCode: fields.htmlCode?.stringValue || '',
    createdAt: parseTimestampField(fields.createdAt),
    updatedAt: parseTimestampField(fields.updatedAt),
  };
}

async function createOrUpdateHtmlPage({ pageName, htmlCode, createdAt, updatedAt }) {
  const fields = {
    pageName: stringField(pageName),
    htmlCode: stringField(htmlCode),
    createdAt: timestampField(createdAt),
    updatedAt: timestampField(updatedAt),
  };
  await callFirestore('PATCH', `/documents/htmlPages/${encodeURIComponent(pageName)}`, { fields });
}

async function getHtmlPage(pageName) {
  try {
    const doc = await callFirestore('GET', `/documents/htmlPages/${encodeURIComponent(pageName)}`);
    return parseHtmlPageDocument(doc);
  } catch (e) {
    if (e.status === 404 || e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

async function listHtmlPages() {
  if (!dbInitialized) return [];
  try {
    const result = await callFirestore('GET', '/documents/htmlPages', null, {
      orderBy: 'updatedAt desc',
      pageSize: 1000,
    });
    return (result.documents || []).map(parseHtmlPageDocument).filter(Boolean);
  } catch (e) {
    if (e.status === 404 || e.code === 'NOT_FOUND') return [];
    throw e;
  }
}

async function deleteHtmlPage(pageName) {
  await callFirestore('DELETE', `/documents/htmlPages/${encodeURIComponent(pageName)}`);
}

async function init() {
  loadConfig();
  if(dbInitialized) {
    try {
      await getAccessToken();
    } catch (e) {
      console.error("Failed to get access token on init:", e.message);
      dbInitialized = false;
    }
  }
}


module.exports = {
  init,
  dbInitialized: () => dbInitialized,
  createOrUpdateHtmlPage,
  getHtmlPage,
  listHtmlPages,
  deleteHtmlPage,
};
