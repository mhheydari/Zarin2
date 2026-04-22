const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/wallet - Get user wallet (all assets + cash)
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user.id;

    const cashWallet = db.prepare('SELECT balance FROM cash_wallets WHERE user_id = ?').get(userId);
    
    const assetWallets = db.prepare(`
      SELECT w.*, a.name as asset_name, a.symbol, a.unit,
        (SELECT price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as current_price,
        (SELECT buy_price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as buy_price,
        (SELECT sell_price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as sell_price
      FROM wallets w
      JOIN assets a ON w.asset_id = a.id
      WHERE w.user_id = ? AND a.is_active = 1
    `).all(userId);

    const totalAssetValue = assetWallets.reduce((sum, w) => {
      return sum + (w.balance * (w.sell_price || w.current_price || 0));
    }, 0);

    res.json({
      success: true,
      data: {
        cash_balance: cashWallet?.balance || 0,
        assets: assetWallets,
        total_asset_value: totalAssetValue,
        total_portfolio_value: (cashWallet?.balance || 0) + totalAssetValue
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت کیف پول' });
  }
});

// POST /api/wallet/deposit - Admin: Add cash to user wallet
router.post('/deposit', adminMiddleware, (req, res) => {
  try {
    const { user_id, amount } = req.body;
    
    if (!user_id || !amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'اطلاعات ناقص' });
    }

    const db = getDb();
    
    // Check user exists
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'کاربر یافت نشد' });
    }

    db.prepare(`
      INSERT INTO cash_wallets (user_id, balance) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
    `).run(user_id, amount, amount);

    // Notify user
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'شارژ کیف پول', ?, 'success')
    `).run(user_id, `مبلغ ${parseFloat(amount).toLocaleString()} ریال به کیف پول شما افزوده شد.`);

    res.json({ success: true, message: 'کیف پول شارژ شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در شارژ کیف پول' });
  }
});

// GET /api/wallet/notifications - Get user notifications
router.get('/notifications', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, unread_only = false } = req.query;

    let query = 'SELECT * FROM notifications WHERE user_id = ?';
    if (unread_only === 'true') query += ' AND is_read = 0';
    query += ' ORDER BY created_at DESC LIMIT ?';

    const notifications = db.prepare(query).all(req.user.id, parseInt(limit));
    const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id);

    res.json({ success: true, data: notifications, unread_count: unreadCount.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت اطلاعیه‌ها' });
  }
});

// PUT /api/wallet/notifications/read - Mark notifications as read
router.put('/notifications/read', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ success: true, message: 'اطلاعیه‌ها خوانده شدند' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطا' });
  }
});

// GET /api/wallet/referrals - Get user referrals
router.get('/referrals', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const referrals = db.prepare(`
      SELECT u.phone, u.full_name, u.created_at, r.created_at as referred_at
      FROM referrals r
      JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);

    res.json({ success: true, data: referrals, total: referrals.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت معرفی‌ها' });
  }
});

module.exports = router;
