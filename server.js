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

// الصفحة الرئيسية - عرض قائمة المجلدات والصفحات
app.get('/', async (req, res) => {
  try {
    const folderId = req.query.folder || null;
    
    // جلب المجلدات
    const foldersQuery = folderId 
      ? db.collection('folders').where('parentId', '==', folderId).orderBy('name')
      : db.collection('folders').where('parentId', '==', null).orderBy('name');
    
    const foldersSnapshot = await foldersQuery.get();
    const folders = [];
    foldersSnapshot.forEach(doc => {
      folders.push({ id: doc.id, ...doc.data() });
    });

    // جلب الصفحات في المجلد الحالي
    const pagesQuery = folderId
      ? db.collection('html_pages').where('folderId', '==', folderId).orderBy('createdAt', 'desc')
      : db.collection('html_pages').where('folderId', '==', null).orderBy('createdAt', 'desc');
    
    const pagesSnapshot = await pagesQuery.get();
    const pages = [];
    pagesSnapshot.forEach(doc => {
      pages.push({ id: doc.id, ...doc.data() });
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
    
    // جلب جميع المجلدات لقائمة الاختيار
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

    // جلب جميع المجلدات لقائمة الاختيار
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

    const folderData = {
      name,
      parentId: parentId || null,
      createdAt: new Date().toISOString()
    };

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
    
    // التحقق من عدم وجود صفحات أو مجلدات فرعية
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

app.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});