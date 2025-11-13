const express = require('express');
const router = express.Router();
const db = require('../src/db');

// GET /html - عرض صفحة إدارة HTML
router.get('/html', async (req, res) => {
  try {
    res.render('html', { title: 'إدارة صفحات HTML' });
  } catch (error) {
    console.error('Error rendering HTML page:', error);
    res.status(500).send('حدث خطأ في تحميل الصفحة');
  }
});

// POST /html/save - حفظ صفحة HTML في Firebase
router.post('/html/save', async (req, res) => {
  try {
    const { page_name, html_code } = req.body;

    if (!page_name || !html_code) {
      return res.status(400).json({ 
        success: false, 
        message: 'يجب إدخال اسم الصفحة وكود HTML' 
      });
    }

    // التحقق من صحة اسم الصفحة
    const pageNamePattern = /^[a-zA-Z0-9_-]{3,32}$/;
    if (!pageNamePattern.test(page_name)) {
      return res.status(400).json({ 
        success: false, 
        message: 'اسم الصفحة يجب أن يكون من 3-32 حرف (أحرف إنجليزية، أرقام، شرطات)' 
      });
    }

    const now = new Date().toISOString();
    
    // فحص إذا كانت الصفحة موجودة
    const existingPage = await db.getHtmlPage(page_name);
    const createdAt = existingPage ? existingPage.createdAt : now;

    await db.createOrUpdateHtmlPage({
      pageName: page_name,
      htmlCode: html_code,
      createdAt: createdAt,
      updatedAt: now
    });

    res.json({ 
      success: true, 
      message: `تم حفظ الصفحة "${page_name}" بنجاح في Firebase`,
      pageName: page_name
    });
  } catch (error) {
    console.error('Error saving HTML page to Firebase:', error);
    res.status(500).json({ 
      success: false, 
      message: 'فشل حفظ الصفحة في Firebase' 
    });
  }
});

// GET /html/pages - جلب قائمة الصفحات من Firebase
router.get('/html/pages', async (req, res) => {
  try {
    const pages = await db.listHtmlPages();
    res.json({ 
      success: true, 
      pages: pages.map(p => ({
        name: p.pageName,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }))
    });
  } catch (error) {
    console.error('Error fetching HTML pages from Firebase:', error);
    res.status(500).json({ 
      success: false, 
      message: 'فشل جلب الصفحات من Firebase',
      pages: []
    });
  }
});

// GET /html/pages/:pageName - عرض صفحة HTML محددة
router.get('/html/pages/:pageName', async (req, res) => {
  try {
    const { pageName } = req.params;
    const page = await db.getHtmlPage(pageName);

    if (!page) {
      return res.status(404).send('الصفحة غير موجودة');
    }

    // عرض HTML مباشرة
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(page.htmlCode);
  } catch (error) {
    console.error('Error displaying HTML page:', error);
    res.status(500).send('حدث خطأ في عرض الصفحة');
  }
});

// GET /html/pages/:pageName/edit - جلب بيانات الصفحة للتعديل
router.get('/html/pages/:pageName/edit', async (req, res) => {
  try {
    const { pageName } = req.params;
    const page = await db.getHtmlPage(pageName);

    if (!page) {
      return res.status(404).json({ 
        success: false, 
        message: 'الصفحة غير موجودة' 
      });
    }

    res.json({ 
      success: true, 
      page: {
        name: page.pageName,
        htmlCode: page.htmlCode,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching page for edit:', error);
    res.status(500).json({ 
      success: false, 
      message: 'فشل جلب بيانات الصفحة' 
    });
  }
});

// POST /html/pages/:pageName/delete - حذف صفحة
router.post('/html/pages/:pageName/delete', async (req, res) => {
  try {
    const { pageName } = req.params;
    
    const page = await db.getHtmlPage(pageName);
    if (!page) {
      return res.status(404).json({ 
        success: false, 
        message: 'الصفحة غير موجودة' 
      });
    }

    await db.deleteHtmlPage(pageName);

    res.json({ 
      success: true, 
      message: `تم حذف الصفحة "${pageName}" بنجاح` 
    });
  } catch (error) {
    console.error('Error deleting HTML page:', error);
    res.status(500).json({ 
      success: false, 
      message: 'فشل حذف الصفحة' 
    });
  }
});

module.exports = router;
