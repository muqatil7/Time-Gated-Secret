// ... الكود الموجود سابقًا ...
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// المسار لعرض النموذج
app.get('/html', (req, res) => {
  res.render('html', { title: 'HTML Viewer', htmlCode: null, error: null });
});

// مسار الاستقبال والمعاينة
app.post('/html', upload.single('htmlFile'), (req, res) => {
  let htmlCode = req.body.htmlCode || '';

  // لو المستخدم رفع ملف
  if (req.file) {
    // تأكد أن نوع الملف هو html
    if (req.file.mimetype !== 'text/html') {
      return res.render('html', { title: 'HTML Viewer', htmlCode: null, error: 'الملف يجب أن يكون من نوع HTML فقط.' });
    }
    htmlCode = fs.readFileSync(req.file.path, 'utf8');
    // حذف الملف بعد القراءة
    fs.unlinkSync(req.file.path);
  }

  if (!htmlCode) {
    return res.render('html', { title: 'HTML Viewer', htmlCode: null, error: 'يرجى إدخال كود HTML أو رفع ملف.' });
  }
  // عرض الصفحة بدون قيود
  res.send(htmlCode);
});
// ... بقية الكود ...