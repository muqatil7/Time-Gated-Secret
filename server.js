const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());

// Static files and EJS setup
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Load custom HTML route
const htmlRoutes = require('./routes/html');
app.use(htmlRoutes);

// Original /pages route (still supports legacy local files if needed)
const pagesDir = path.join(__dirname, 'pages');
app.get('/pages', (req, res) => {
  fs.readdir(pagesDir, (err, files) => {
    if (err || !files) return res.render('pages', { pages: [] });
    const htmlPages = files.filter(f => f.endsWith('.html')).map(f => f.replace('.html', '')).sort();
    res.render('pages', { pages: htmlPages });
  });
});

// 404 catch-all (must come last)
app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not Found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
