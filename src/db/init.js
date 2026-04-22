const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dbPath = process.env.DATABASE_PATH || './data/goldtrader.db';
const dbDir = path.dirname(path.resolve(dbPath));

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(dbPath));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    phone TEXT UNIQUE NOT NULL,
    full_name TEXT,
    national_id TEXT,
    email TEXT,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    is_verified INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0,
    password_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referred_by) REFERENCES users(referral_code)
  );

  -- OTP codes table
  CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Assets table (types of assets available for trading)
  CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    symbol TEXT UNIQUE NOT NULL,
    unit TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Prices table (manual and API prices)
  CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_id INTEGER NOT NULL,
    price REAL NOT NULL,
    price_type TEXT DEFAULT 'manual',
    buy_price REAL,
    sell_price REAL,
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (asset_id) REFERENCES assets(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  -- User wallets/balances
  CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    asset_id INTEGER NOT NULL,
    balance REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, asset_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES assets(id)
  );

  -- Toman wallet (cash balance)
  CREATE TABLE IF NOT EXISTS cash_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE NOT NULL,
    balance REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Orders table
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    asset_id INTEGER NOT NULL,
    order_type TEXT NOT NULL CHECK(order_type IN ('buy', 'sell')),
    quantity REAL NOT NULL,
    price_per_unit REAL NOT NULL,
    total_amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
    price_mode TEXT DEFAULT 'manual' CHECK(price_mode IN ('manual', 'api')),
    notes TEXT,
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME,
    approved_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (asset_id) REFERENCES assets(id)
  );

  -- Withdrawals table
  CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    amount REAL NOT NULL,
    sheba_number TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    bank_name TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'paid')),
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    processed_by TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Settings table
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Referrals tracking
  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT NOT NULL,
    referred_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(id),
    FOREIGN KEY (referred_id) REFERENCES users(id)
  );

  -- Notifications
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- Create indexes
  CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
  CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
  CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
`);

// Insert default assets
const insertAsset = db.prepare(`
  INSERT OR IGNORE INTO assets (name, symbol, unit, description) VALUES (?, ?, ?, ?)
`);

insertAsset.run('طلای ۱۸ عیار', 'GOLD18', 'گرم', 'طلای ۱۸ عیار - هر گرم');
insertAsset.run('طلای ۲۴ عیار', 'GOLD24', 'گرم', 'طلای ۲۴ عیار - هر گرم');
insertAsset.run('سکه بهار آزادی', 'COIN_BAHAR', 'عدد', 'سکه بهار آزادی تمام');
insertAsset.run('نیم سکه', 'COIN_HALF', 'عدد', 'نیم سکه بهار آزادی');
insertAsset.run('ربع سکه', 'COIN_QUARTER', 'عدد', 'ربع سکه بهار آزادی');

// Insert default settings
const insertSetting = db.prepare(`
  INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)
`);

insertSetting.run('price_mode', 'manual', 'حالت قیمت‌گذاری: manual یا api');
insertSetting.run('buy_markup', '2', 'درصد افزایش قیمت برای فروش به مشتری');
insertSetting.run('sell_markdown', '2', 'درصد کاهش قیمت برای خرید از مشتری');
insertSetting.run('min_withdrawal', '500000', 'حداقل مبلغ برداشت (ریال)');
insertSetting.run('site_name', 'گلدتریدر', 'نام سایت');
insertSetting.run('site_description', 'پلتفرم معاملات طلا و سکه', 'توضیحات سایت');

// Insert default prices
const assets = db.prepare('SELECT id, symbol FROM assets').all();
const insertPrice = db.prepare(`
  INSERT OR IGNORE INTO prices (asset_id, price, price_type, buy_price, sell_price)
  VALUES (?, ?, 'manual', ?, ?)
`);

const defaultPrices = {
  'GOLD18': 4500000,
  'GOLD24': 6000000,
  'COIN_BAHAR': 85000000,
  'COIN_HALF': 42000000,
  'COIN_QUARTER': 21000000
};

assets.forEach(asset => {
  const price = defaultPrices[asset.symbol] || 1000000;
  insertPrice.run(asset.id, price, price * 1.02, price * 0.98);
});

// Create admin user
const adminPhone = '09000000000';
const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
const adminHash = bcrypt.hashSync(adminPassword, 10);
const adminCode = 'ADMIN001';

const insertAdmin = db.prepare(`
  INSERT OR IGNORE INTO users (id, phone, full_name, referral_code, is_verified, is_admin, password_hash)
  VALUES (?, ?, ?, ?, 1, 1, ?)
`);

insertAdmin.run('admin-user-001', adminPhone, 'مدیر سیستم', adminCode, adminHash);

// Create cash wallet for admin
const insertCashWallet = db.prepare(`
  INSERT OR IGNORE INTO cash_wallets (user_id, balance) VALUES (?, ?)
`);
insertCashWallet.run('admin-user-001', 0);

// Create test user
const testPhone = '09123456789';
const testPassword = 'User@1234';
const testHash = bcrypt.hashSync(testPassword, 10);
const testUserId = 'test-user-001';
const testCode = 'USER' + Math.random().toString(36).substring(2, 8).toUpperCase();

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (id, phone, full_name, referral_code, is_verified, is_admin, password_hash)
  VALUES (?, ?, ?, ?, 1, 0, ?)
`);

insertUser.run(testUserId, testPhone, 'کاربر تست', testCode, testHash);
insertCashWallet.run(testUserId, 10000000); // 10 million test balance

// Add sample asset balance for test user
const insertWallet = db.prepare(`
  INSERT OR IGNORE INTO wallets (user_id, asset_id, balance) VALUES (?, ?, ?)
`);

assets.forEach(asset => {
  insertWallet.run(testUserId, asset.id, asset.symbol.startsWith('GOLD') ? 5.5 : 2);
});

// Also ensure admin has wallet entries
assets.forEach(asset => {
  insertWallet.run('admin-user-001', asset.id, 0);
});

console.log('✅ Database initialized successfully!');
console.log('');
console.log('📌 Admin credentials:');
console.log('   Phone: 09000000000');
console.log('   Password: Admin@1234');
console.log('');
console.log('📌 Test user credentials:');
console.log('   Phone: 09123456789');
console.log('   Password: User@1234');
console.log('');

db.close();
