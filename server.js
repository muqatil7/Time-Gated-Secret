require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// تكوين Firebase
let firebaseConfig;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  firebaseConfig = {
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  };
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
  firebaseConfig = {
    credential: cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_FILE)))
  };
} else {
  firebaseConfig = {
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, '\n')
    })
  };
}

initializeApp(firebaseConfig);
const db = getFirestore();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false // نسمح بتنفيذ HTML بدون قيود
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// الصفحة الرئيسية - عرض قائمة المجلدات والصفحات
app.get('/', async (req, res) => {
  try {
    const folderId = req.query.folder || null;

    // جلب جميع المجلدات وترتيبها client-side للمجلدات الرئيسية
    const foldersSnapshot = await db.collection('folders').orderBy('name').get();
    const folders = [];
    foldersSnapshot.forEach(doc => {
      const data = doc.data();
      // لو لم يكن فيه parentId أو قيمته فارغة اعتبره مجلد رئيسي
      if ((folderId && data.parentId === folderId) || (!folderId && (!('parentId' in data) || !data.parentId))) {
        folders.push({ id: doc.id, ...data });
      }
    });

    // جلب جميع الصفحات وترتيبها client-side للصفحات الرئيسية
    const pagesSnapshot = await db.collection('html_pages').orderBy('createdAt', 'desc').get();
    const pages = [];
    pagesSnapshot.forEach(doc => {
      const data = doc.data();
      // لو لم يكن فيه folderId أو قيمته فارغة اعتبره صفحة رئيسية
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

// بقية المسارات بدون تعديل لأنها لا تعتمد على الاستعلام بالمقارنة مع null مباشرة
// ... 

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

// ... المستندات الأخرى كما هي بدون تغيير هام

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});
