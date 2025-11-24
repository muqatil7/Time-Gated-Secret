require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Helpers to normalize Firebase credentials from different env formats
function normalizePrivateKey(input) {
  if (!input) return undefined;
  let key = String(input).trim();
  // Remove accidental wrapping quotes
  key = key.replace(/^['"`]|['"`]$/g, '');
  // Try base64 decode if it doesn't look like PEM yet
  try {
    if (!key.includes('BEGIN PRIVATE KEY')) {
      const decoded = Buffer.from(key, 'base64').toString('utf8');
      if (decoded.includes('BEGIN PRIVATE KEY')) {
        key = decoded;
      }
    }
  } catch (_) {}
  // Convert escaped newlines to real newlines
  key = key.replace(/\\n/g, '\n');
  // Ensure BEGIN/END lines are on their own lines
  key = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/m, '-----BEGIN PRIVATE KEY-----\n')
    .replace(/\s*-----END PRIVATE KEY-----/m, '\n-----END PRIVATE KEY-----');
  return key;
}

function parseServiceAccountJSON(input) {
  if (!input) return undefined;
  let raw = String(input).trim();
  // Remove wrapping quotes/backticks if any
  raw = raw.replace(/^['"`]|['"`]$/g, '');
  // Try base64 first
  try {
    const maybeDecoded = Buffer.from(raw, 'base64').toString('utf8');
    if (maybeDecoded.includes('"private_key"') || maybeDecoded.includes('"project_id"')) {
      raw = maybeDecoded;
    }
  } catch (_) {}
  const obj = JSON.parse(raw);
  if (obj.private_key) {
    obj.private_key = normalizePrivateKey(obj.private_key);
  }
  return obj;
}

// Firebase configuration (robust across env providers: JSON, base64, or split vars)
let firebaseCredential;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
  const payload = parseServiceAccountJSON(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
  );
  firebaseCredential = cert(payload);
  console.log('[init] Firebase using SERVICE_ACCOUNT_JSON');
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
  const payload = require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_FILE));
  if (payload.private_key) payload.private_key = normalizePrivateKey(payload.private_key);
  firebaseCredential = cert(payload);
  console.log('[init] Firebase using SERVICE_ACCOUNT_FILE');
} else {
  firebaseCredential = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY_BASE64)
  });
  console.log('[init] Firebase using discrete env vars (PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY)');
}

initializeApp({ credential: firebaseCredential });
const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// الصفحة الرئيسية - عرض قائمة المجلدات والصفحات
app.get('/', async (req, res) => {
  try {
    const folderId = req.query.folder || null;

    // جلب جميع المجلدات ثم تصفيتها حسب parentId لتجنب where(null)
    const foldersSnapshot = await db.collection('folders').orderBy('name').get();
    const folders = [];
    foldersSnapshot.forEach(doc => {
      const data = doc.data();
      if ((folderId && data.parentId === folderId) || (!folderId && (!('parentId' in data) || !data.parentId))) {
        folders.push({ id: doc.id, ...data });
      }
    });

    // جلب جميع الصفحات ثم تصفيتها حسب folderId لتجنب where(null)
    const pagesSnapshot = await db.collection('html_pages').orderBy('createdAt', 'desc').get();
    const pages = [];
    pagesSnapshot.forEach(doc => {
      const data = doc.data();
      if ((folderId && data.folderId === folderId) || (!folderId && (!('folderId' in data) || !data.folderId))) {
        pages.push({ id: doc.id, ...data });
      }
    });

    // جلب معلومات المجلد الحالي إذا كنا داخل مجلد
    let currentFolder = null;
    if (folderId) {
      const folderDoc = await db.collection('folders').doc(folderId).get();
      if (folderDoc.exists) {
        currentFolder = { id: folderDoc.id, ...folderDoc.data() };
      }
    }

    res.render('index', { pages, folders, currentFolder, folderId });
  } catch (error) {
    console.error('خطأ في جلب البيانات:', error);
    res.status(500).send('حدث خطأ في جلب البيانات');
  }
});

// صفحة إنشاء صفحة جديدة
app.get('/create', async (req, res) => {
  try {
    const folderId = req.query.folder || null;
    const foldersSnapshot = await db.collection('folders').orderBy('name').get();
    const folders = [];
    foldersSnapshot.forEach(doc => {
      folders.push({ id: doc.id, ...doc.data() });
    });
    res.render('create', { folders, selectedFolderId: folderId });
  } catch (error) {
    console.error('خطأ:', error);
    res.status(500).send('حدث خطأ');
  }
});

// حفظ صفحة جديدة
app.post('/api/pages', async (req, res) => {
  try {
    const { name, htmlContent, folderId } = req.body;
    if (!name || !htmlContent) {
      return res.status(400).json({ error: 'الاسم والمحتوى مطلوبان' });
    }
    const pageData = {
      name,
      htmlContent,
      folderId: folderId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const docRef = await db.collection('html_pages').add(pageData);
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('خطأ في حفظ الصفحة:', error);
    res.status(500).json({ error: 'فشل حفظ الصفحة' });
  }
});

// عرض صفحة HTML محددة
app.get('/page/:id', async (req, res) => {
  try {
    const doc = await db.collection('html_pages').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('الصفحة غير موجودة');
    }
    const pageData = doc.data();
    res.send(pageData.htmlContent);
  } catch (error) {
    console.error('خطأ في عرض الصفحة:', error);
    res.status(500).send('حدث خطأ في عرض الصفحة');
  }
});

// صفحة تعديل صفحة محددة
app.get('/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('html_pages').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('الصفحة غير موجودة');
    }
    const foldersSnapshot = await db.collection('folders').orderBy('name').get();
    const folders = [];
    foldersSnapshot.forEach(doc => {
      folders.push({ id: doc.id, ...doc.data() });
    });
    const pageData = { id: doc.id, ...doc.data() };
    res.render('edit', { page: pageData, folders });
  } catch (error) {
    console.error('خطأ في جلب الصفحة:', error);
    res.status(500).send('حدث خطأ في جلب الصفحة');
  }
});

// تحديث صفحة محددة
app.put('/api/pages/:id', async (req, res) => {
  try {
    const { name, htmlContent, folderId } = req.body;
    if (!name || !htmlContent) {
      return res.status(400).json({ error: 'الاسم والمحتوى مطلوبان' });
    }
    const updateData = {
      name,
      htmlContent,
      folderId: folderId || null,
      updatedAt: new Date().toISOString()
    };
    await db.collection('html_pages').doc(req.params.id).update(updateData);
    res.json({ success: true });
  } catch (error) {
    console.error('خطأ في تحديث الصفحة:', error);
    res.status(500).json({ error: 'فشل تحديث الصفحة' });
  }
});

// حذف صفحة محددة
app.delete('/api/pages/:id', async (req, res) => {
  try {
    await db.collection('html_pages').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('خطأ في حذف الصفحة:', error);
    res.status(500).json({ error: 'فشل حذف الصفحة' });
  }
});

// إنشاء مجلد جديد
app.post('/api/folders', async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'اسم المجلد مطلوب' });
    }
    const folderData = { name, parentId: parentId || null, createdAt: new Date().toISOString() };
    const docRef = await db.collection('folders').add(folderData);
    res.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error('خطأ في إنشاء المجلد:', error);
    res.status(500).json({ error: 'فشل إنشاء المجلد' });
  }
});

// حذف مجلد
app.delete('/api/folders/:id', async (req, res) => {
  try {
    const folderId = req.params.id;
    const pagesInFolder = await db.collection('html_pages').where('folderId', '==', folderId).limit(1).get();
    const subFolders = await db.collection('folders').where('parentId', '==', folderId).limit(1).get();
    if (!pagesInFolder.empty || !subFolders.empty) {
      return res.status(400).json({ error: 'لا يمكن حذف مجلد يحتوي على صفحات أو مجلدات فرعية' });
    }
    await db.collection('folders').doc(folderId).delete();
    res.json({ success: true });
  } catch (error) {
    console.error('خطأ في حذف المجلد:', error);
    res.status(500).json({ error: 'فشل حذف المجلد' });
  }
});

// إعادة تسمية مجلد
app.put('/api/folders/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'اسم المجلد مطلوب' });
    }
    await db.collection('folders').doc(req.params.id).update({ name });
    res.json({ success: true });
  } catch (error) {
    console.error('خطأ في تحديث المجلد:', error);
    res.status(500).json({ error: 'فشل تحديث المجلد' });
  }
});

// عرض جميع البيانات من قاعدة البيانات
app.get('/data', async (req, res) => {
  try {
    const allData = {};
    
    // جلب جميع المجموعات (collections) في قاعدة البيانات
    const collections = await db.listCollections();
    
    for (const collection of collections) {
      const collectionName = collection.id;
      const snapshot = await collection.get();
      
      allData[collectionName] = [];
      snapshot.forEach(doc => {
        allData[collectionName].push({
          id: doc.id,
          ...doc.data()
        });
      });
    }
    
    // إرسال البيانات بصيغة JSON منسقة
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(allData, null, 2));
  } catch (error) {
    console.error('خطأ في جلب البيانات:', error);
    res.status(500).json({ 
      error: 'فشل جلب البيانات', 
      details: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
