const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'pages');

// يجب تعريف مسار /pages قبل 404 لأي طلبات أخرى
app.get('/pages', (req, res) => {
  fs.readdir(pagesDir, (err, files) => {
    if (err || !files) return res.render('pages', { pages: [] });
    const htmlPages = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html','')).sort();
    res.render('pages', { pages: htmlPages });
  });
});

// يجب إبقاء جميع مسارات العرض فوق هذا السطر وعدم إضافة أي handler لل404 قبله!
app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not Found' });
});
