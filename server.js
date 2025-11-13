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
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
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

// الصفحة الرئيسية - عرض قائمة الصفحات
app.get('/', async (req, res) => {
  try {
    const pagesSnapshot = await db.collection('html_pages').orderBy('createdAt', 'desc').get();
    const pages = [];
    pagesSnapshot.forEach(doc => {
      pages.push({ id: doc.id, ...doc.data() });
    });
    res.render('index', { pages });
  } catch (error) {
    console.error('خطأ في جلب الصفحات:', error);
    res.status(500).send('حدث خطأ في جلب الصفحات');
  }
});

// صفحة إنشاء صفحة جديدة
app.get('/create', (req, res) => {
  res.render('create');
});

// حفظ صفحة جديدة
app.post('/api/pages', async (req, res) => {
  try {
    const { name, htmlContent } = req.body;
    
    if (!name || !htmlContent) {
      return res.status(400).json({ error: 'الاسم والمحتوى مطلوبان' });
    }

    const pageData = {
      name,
      htmlContent,
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

    const pageData = { id: doc.id, ...doc.data() };
    res.render('edit', { page: pageData });
  } catch (error) {
    console.error('خطأ في جلب الصفحة:', error);
    res.status(500).send('حدث خطأ في جلب الصفحة');
  }
});

// تحديث صفحة محددة
app.put('/api/pages/:id', async (req, res) => {
  try {
    const { name, htmlContent } = req.body;
    
    if (!name || !htmlContent) {
      return res.status(400).json({ error: 'الاسم والمحتوى مطلوبان' });
    }

    const updateData = {
      name,
      htmlContent,
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

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});