const fs = require('fs');
const pagesDir = path.join(__dirname, 'pages');

// قائمة الصفحات
app.get('/pages', (req, res) => {
  fs.readdir(pagesDir, (err, files) => {
    if (err || !files) return res.json({pages: []});
    // فقط الصفحات المنتهية ب .html
    const htmlPages = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html','')).sort();
    res.json({pages: htmlPages});
  });
});
