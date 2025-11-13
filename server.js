const express = require('express');
const path = require('path');
const helmet = require('helmet');
const dotenv = require('dotenv');
const db = require('./src/db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Initialize DB and then set up routes
db.init();

const htmlRoutes = require('./routes/html');
app.use(htmlRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('not_found', { title: 'Not Found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
