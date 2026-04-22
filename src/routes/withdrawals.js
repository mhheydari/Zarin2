const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// POST /api/withdrawals - Create withdrawal request
router.post('/', authMiddleware, (req, res) => {
  try {
    const { amount, sheba_number, account_holder, bank_name } = req.body;

    if (!amount || !sheba_number || !account_holder) {
      return res.status(400).json({ 
        success: false, 
        message: 'مبلغ، شماره شبا و نام صاحب حساب الزامی است' 
      });
    }

    if (amount <= 0) {
      return res.status(400).json({ success: false, message: 'مبلغ باید بزرگتر از صفر باشد' });
    }

    // Validate SHEBA
    const shebaClean = sheba_number.replace(/\s/g, '');
    if (!shebaClean.startsWith('IR') || shebaClean.length !== 26) {
      return res.status(400).json({ success: false, message: 'شماره شبا نامعتبر است. باید با IR شروع شده و ۲۶ کاراکتر باشد' });
    }

    const db = getDb();
    
    // Check minimum withdrawal
    const minWithdrawal = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'min_withdrawal'").get()?.value || '500000');
    if (amount < minWithdrawal) {
      return res.status(400).json({ 
        success: false, 
        message: `حداقل مبلغ برداشت ${minWithdrawal.toLocaleString()} ریال است` 
      });
    }

    // Check cash balance
    const cashWallet = db.prepare('SELECT balance FROM cash_wallets WHERE user_id = ?').get(req.user.id);
    if (!cashWallet || cashWallet.balance < amount) {
      return res.status(400).json({ 
        success: false, 
        message: `موجودی کافی نیست. موجودی فعلی: ${cashWallet?.balance?.toLocaleString() || 0} ریال` 
      });
    }

    // Check pending withdrawals
    const pendingWithdrawals = db.prepare(`
      SELECT COUNT(*) as count FROM withdrawals WHERE user_id = ? AND status = 'pending'
    `).get(req.user.id);
    
    if (pendingWithdrawals.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'شما یک درخواست برداشت در حال بررسی دارید' 
      });
    }

    const withdrawalId = require('uuid').v4();

    // Reserve amount (deduct from balance)
    db.prepare('UPDATE cash_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(amount, req.user.id);

    // Create withdrawal
    db.prepare(`
      INSERT INTO withdrawals (id, user_id, amount, sheba_number, account_holder, bank_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(withdrawalId, req.user.id, amount, shebaClean, account_holder, bank_name || '');

    // Notify user
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'درخواست برداشت ثبت شد', ?, 'info')
    `).run(req.user.id, `درخواست برداشت ${parseFloat(amount).toLocaleString()} ریال ثبت شد و در انتظار بررسی است.`);

    res.json({
      success: true,
      message: 'درخواست برداشت با موفقیت ثبت شد',
      withdrawal_id: withdrawalId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در ثبت درخواست برداشت' });
  }
});

// GET /api/withdrawals - Get user withdrawals
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { limit = 20, offset = 0 } = req.query;

    const withdrawals = db.prepare(`
      SELECT * FROM withdrawals WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(req.user.id, parseInt(limit), parseInt(offset));

    const total = db.prepare('SELECT COUNT(*) as count FROM withdrawals WHERE user_id = ?').get(req.user.id);

    res.json({ success: true, data: withdrawals, total: total.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت درخواست‌های برداشت' });
  }
});

// GET /api/withdrawals/admin/all - Admin: Get all withdrawals
router.get('/admin/all', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT w.*, u.phone as user_phone, u.full_name as user_name
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE w.status = ?';
      params.push(status);
    }

    query += ' ORDER BY w.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const withdrawals = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM withdrawals${status ? ' WHERE status = ?' : ''}`).get(...(status ? [status] : []));

    res.json({ success: true, data: withdrawals, total: total.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت درخواست‌های برداشت' });
  }
});

// PUT /api/withdrawals/:id/approve - Admin: Approve withdrawal
router.put('/:id/approve', adminMiddleware, (req, res) => {
  try {
    const { admin_notes } = req.body;
    const db = getDb();
    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'درخواست یافت نشد' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'این درخواست قابل تأیید نیست' });
    }

    db.prepare(`
      UPDATE withdrawals 
      SET status = 'approved', admin_notes = ?, processed_at = CURRENT_TIMESTAMP, processed_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(admin_notes || '', req.user.id, req.params.id);

    // Notify user
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'برداشت وجه تأیید شد', ?, 'success')
    `).run(
      withdrawal.user_id,
      `درخواست برداشت ${parseFloat(withdrawal.amount).toLocaleString()} ریال به شماره شبا ${withdrawal.sheba_number} تأیید شد.`
    );

    res.json({ success: true, message: 'درخواست برداشت تأیید شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در تأیید درخواست' });
  }
});

// PUT /api/withdrawals/:id/reject - Admin: Reject withdrawal
router.put('/:id/reject', adminMiddleware, (req, res) => {
  try {
    const { admin_notes } = req.body;
    const db = getDb();
    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'درخواست یافت نشد' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'این درخواست قابل رد کردن نیست' });
    }

    // Refund amount
    db.prepare('UPDATE cash_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(withdrawal.amount, withdrawal.user_id);

    db.prepare(`
      UPDATE withdrawals 
      SET status = 'rejected', admin_notes = ?, processed_at = CURRENT_TIMESTAMP, processed_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(admin_notes || '', req.user.id, req.params.id);

    // Notify user
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, 'درخواست برداشت رد شد', ?, 'error')
    `).run(
      withdrawal.user_id,
      `درخواست برداشت ${parseFloat(withdrawal.amount).toLocaleString()} ریال رد شد و مبلغ به کیف پول شما برگشت. ${admin_notes ? 'دلیل: ' + admin_notes : ''}`
    );

    res.json({ success: true, message: 'درخواست برداشت رد شد و مبلغ به کیف پول کاربر برگشت' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در رد درخواست' });
  }
});

module.exports = router;
