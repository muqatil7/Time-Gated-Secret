const fs = require('fs');
const pagesDir = path.join(__dirname, 'pages');

// قائمة الصفحات - واجهة HTML
app.get('/pages', (req, res) => {
  fs.readdir(pagesDir, (err, files) => {
    if (err || !files) return res.render('pages', { pages: [] });
    const htmlPages = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html','')).sort();
    res.render('pages', { pages: htmlPages });
  });
});
