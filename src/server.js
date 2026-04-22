const express = require('express');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request logging
app.use((req, res, next) => {
  const time = new Date().toLocaleString('fa-IR');
  console.log(`[${time}] ${req.method} ${req.path}`);
  next();
});

// Serve static files from public directory
app.use('/static', express.static(path.join(__dirname, '../public/static')));
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/prices', require('./routes/prices'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/admin', require('./routes/admin'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Serve frontend for all non-API routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ success: false, message: 'خطای داخلی سرور' });
});

// Initialize DB and start server
const { getDb } = require('./db/database');
try {
  const db = getDb();
  // Check if DB is initialized
  const tableCount = db.prepare("SELECT COUNT(*) as count FROM sqlite_master WHERE type='table'").get();
  if (tableCount.count < 5) {
    console.log('⚠️  Database not initialized. Run: node src/db/init.js');
  } else {
    console.log('✅ Database connection successful');
  }
} catch (err) {
  console.error('❌ Database error:', err.message);
  console.log('Run: node src/db/init.js to initialize the database');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 =====================================');
  console.log(`🌟 GoldTrader Platform running on port ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log('🔑 Admin: 09000000000 / Admin@1234');
  console.log('👤 User: 09123456789 / User@1234');
  console.log('=====================================');
  console.log('');
});

module.exports = app;
