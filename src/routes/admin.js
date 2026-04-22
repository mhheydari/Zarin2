const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/admin/dashboard - Dashboard stats
router.get('/dashboard', adminMiddleware, (req, res) => {
  try {
    const db = getDb();

    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_admin = 0').get();
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get();
    const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get();
    const totalWithdrawals = db.prepare('SELECT COUNT(*) as count FROM withdrawals').get();
    const pendingWithdrawals = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status = 'pending'").get();
    const totalVolume = db.prepare("SELECT SUM(total_amount) as total FROM orders WHERE status = 'completed'").get();
    const todayOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE date(created_at) = date('now')
    `).get();
    const weekOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE created_at >= datetime('now', '-7 days')
    `).get();
    const monthOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE created_at >= datetime('now', '-30 days')
    `).get();

    const recentOrders = db.prepare(`
      SELECT o.*, a.name as asset_name, a.symbol, a.unit, u.phone as user_phone, u.full_name as user_name
      FROM orders o
      JOIN assets a ON o.asset_id = a.id
      JOIN users u ON o.user_id = u.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all();

    const recentWithdrawals = db.prepare(`
      SELECT w.*, u.phone as user_phone, u.full_name as user_name
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC LIMIT 5
    `).all();

    res.json({
      success: true,
      data: {
        stats: {
          total_users: totalUsers.count,
          total_orders: totalOrders.count,
          pending_orders: pendingOrders.count,
          total_withdrawals: totalWithdrawals.count,
          pending_withdrawals: pendingWithdrawals.count,
          total_volume: totalVolume.total || 0,
          today_orders: todayOrders.count,
          week_orders: weekOrders.count,
          month_orders: monthOrders.count
        },
        recent_orders: recentOrders,
        recent_withdrawals: recentWithdrawals
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت داشبورد' });
  }
});

// GET /api/admin/users - Get all users
router.get('/users', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { search, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT u.*, 
        (SELECT balance FROM cash_wallets WHERE user_id = u.id) as cash_balance,
        (SELECT COUNT(*) FROM orders WHERE user_id = u.id) as order_count,
        (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id) as referral_count
      FROM users u
      WHERE u.is_admin = 0
    `;
    const params = [];

    if (search) {
      query += ' AND (u.phone LIKE ? OR u.full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const users = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM users WHERE is_admin = 0${search ? ' AND (phone LIKE ? OR full_name LIKE ?)' : ''}`).get(...(search ? [`%${search}%`, `%${search}%`] : []));

    res.json({ success: true, data: users, total: total.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت کاربران' });
  }
});

// GET /api/admin/users/:id - Get user details
router.get('/users/:id', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT u.*, 
        (SELECT balance FROM cash_wallets WHERE user_id = u.id) as cash_balance
      FROM users u WHERE u.id = ?
    `).get(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'کاربر یافت نشد' });
    }

    const assetWallets = db.prepare(`
      SELECT w.*, a.name as asset_name, a.symbol, a.unit
      FROM wallets w JOIN assets a ON w.asset_id = a.id
      WHERE w.user_id = ?
    `).all(req.params.id);

    const orders = db.prepare(`
      SELECT o.*, a.name as asset_name, a.symbol
      FROM orders o JOIN assets a ON o.asset_id = a.id
      WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 10
    `).all(req.params.id);

    const referrals = db.prepare(`
      SELECT u.phone, u.full_name, r.created_at
      FROM referrals r JOIN users u ON r.referred_id = u.id
      WHERE r.referrer_id = ?
    `).all(req.params.id);

    delete user.password_hash;

    res.json({
      success: true,
      data: { user, asset_wallets: assetWallets, orders, referrals }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا' });
  }
});

// PUT /api/admin/users/:id - Update user
router.put('/users/:id', adminMiddleware, (req, res) => {
  try {
    const { full_name, is_active, national_id, email } = req.body;
    const db = getDb();

    db.prepare(`
      UPDATE users SET full_name = COALESCE(?, full_name), is_active = COALESCE(?, is_active),
        national_id = COALESCE(?, national_id), email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(full_name, is_active, national_id, email, req.params.id);

    res.json({ success: true, message: 'کاربر بروزرسانی شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در بروزرسانی کاربر' });
  }
});

// GET /api/admin/reports - Get reports
router.get('/reports', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { period = 'daily' } = req.query;

    let dateExpr = '';
    if (period === 'daily') dateExpr = "AND date(created_at) = date('now')";
    else if (period === 'weekly') dateExpr = "AND created_at >= datetime('now', '-7 days')";
    else if (period === 'monthly') dateExpr = "AND created_at >= datetime('now', '-30 days')";

    const orderStats = db.prepare(`
      SELECT 
        order_type,
        COUNT(*) as count,
        SUM(total_amount) as total_amount,
        SUM(quantity) as total_quantity
      FROM orders WHERE 1=1 ${dateExpr} AND status = 'completed'
      GROUP BY order_type
    `).all();

    // Use subquery to avoid ambiguous column names in JOIN
    const assetStats = db.prepare(`
      SELECT 
        a.name as asset_name,
        a.symbol,
        o.order_type,
        COUNT(*) as count,
        SUM(o.total_amount) as total_amount
      FROM orders o JOIN assets a ON o.asset_id = a.id
      WHERE o.status = 'completed' ${dateExpr.replace('created_at', 'o.created_at')}
      GROUP BY a.id, o.order_type
    `).all();

    const withdrawalStats = db.prepare(`
      SELECT status, COUNT(*) as count, SUM(amount) as total_amount
      FROM withdrawals WHERE 1=1 ${dateExpr}
      GROUP BY status
    `).all();

    const newUsers = db.prepare(`
      SELECT COUNT(*) as count FROM users WHERE is_admin = 0 ${dateExpr}
    `).get();

    res.json({
      success: true,
      data: {
        period,
        order_stats: orderStats,
        asset_stats: assetStats,
        withdrawal_stats: withdrawalStats,
        new_users: newUsers.count
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در گزارش‌گیری' });
  }
});

// GET /api/admin/assets - Manage assets
router.get('/assets', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const assets = db.prepare(`
      SELECT a.*, 
        (SELECT price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as current_price,
        (SELECT buy_price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as buy_price,
        (SELECT sell_price FROM prices WHERE asset_id = a.id ORDER BY created_at DESC LIMIT 1) as sell_price
      FROM assets a
    `).all();
    res.json({ success: true, data: assets });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطا' });
  }
});

// GET /api/admin/settings - Get all settings
router.get('/settings', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM settings').all();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطا' });
  }
});

// PUT /api/admin/settings - Update settings
router.put('/settings', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, message: 'تنظیمات نامعتبر' });
    }

    const updateSetting = db.prepare(`
      UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?
    `);

    Object.entries(settings).forEach(([key, value]) => {
      updateSetting.run(value.toString(), key);
    });

    res.json({ success: true, message: 'تنظیمات بروزرسانی شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در بروزرسانی تنظیمات' });
  }
});

module.exports = router;
