const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// POST /api/orders - Create new order
router.post('/', authMiddleware, (req, res) => {
  try {
    const { asset_id, order_type, quantity, amount_toman } = req.body;

    if (!asset_id || !order_type || (!quantity && !amount_toman)) {
      return res.status(400).json({ 
        success: false, 
        message: 'اطلاعات ناقص: دارایی، نوع سفارش و مقدار الزامی است' 
      });
    }

    if (!['buy', 'sell'].includes(order_type)) {
      return res.status(400).json({ success: false, message: 'نوع سفارش باید خرید یا فروش باشد' });
    }

    const db = getDb();
    
    // Check asset exists
    const asset = db.prepare('SELECT * FROM assets WHERE id = ? AND is_active = 1').get(asset_id);
    if (!asset) {
      return res.status(404).json({ success: false, message: 'دارایی یافت نشد' });
    }

    // Get current price
    const priceData = db.prepare(`
      SELECT * FROM prices WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(asset_id);

    if (!priceData) {
      return res.status(400).json({ success: false, message: 'قیمت دارایی تنظیم نشده است' });
    }

    const buyMarkup = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'buy_markup'").get()?.value || '2');
    const sellMarkdown = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'sell_markdown'").get()?.value || '2');
    const priceMode = db.prepare("SELECT value FROM settings WHERE key = 'price_mode'").get()?.value || 'manual';

    // Calculate price based on order type
    let pricePerUnit;
    if (order_type === 'buy') {
      pricePerUnit = priceData.buy_price || (priceData.price * (1 + buyMarkup / 100));
    } else {
      pricePerUnit = priceData.sell_price || (priceData.price * (1 - sellMarkdown / 100));
    }

    // Calculate quantity and total
    let finalQuantity;
    let totalAmount;

    if (quantity) {
      finalQuantity = parseFloat(quantity);
      totalAmount = finalQuantity * pricePerUnit;
    } else if (amount_toman) {
      totalAmount = parseFloat(amount_toman);
      finalQuantity = totalAmount / pricePerUnit;
    }

    if (finalQuantity <= 0 || totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'مقدار یا مبلغ باید بزرگتر از صفر باشد' });
    }

    // Check wallet balance for sell orders
    if (order_type === 'sell') {
      const wallet = db.prepare('SELECT balance FROM wallets WHERE user_id = ? AND asset_id = ?').get(req.user.id, asset_id);
      if (!wallet || wallet.balance < finalQuantity) {
        return res.status(400).json({ 
          success: false, 
          message: `موجودی کافی نیست. موجودی فعلی: ${wallet?.balance?.toFixed(4) || 0} ${asset.unit}` 
        });
      }
    }

    // Check cash wallet for buy orders
    if (order_type === 'buy') {
      const cashWallet = db.prepare('SELECT balance FROM cash_wallets WHERE user_id = ?').get(req.user.id);
      if (!cashWallet || cashWallet.balance < totalAmount) {
        return res.status(400).json({ 
          success: false, 
          message: `موجودی ریالی کافی نیست. موجودی فعلی: ${cashWallet?.balance?.toLocaleString('fa-IR') || 0} ریال` 
        });
      }
    }

    const orderId = require('uuid').v4();
    const orderStatus = priceMode === 'manual' ? 'completed' : 'pending';

    // Create order
    db.prepare(`
      INSERT INTO orders (id, user_id, asset_id, order_type, quantity, price_per_unit, total_amount, status, price_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, req.user.id, asset_id, order_type, finalQuantity, pricePerUnit, totalAmount, orderStatus, priceMode);

    // If manual mode, process immediately
    if (priceMode === 'manual') {
      processOrder(db, orderId, req.user.id, asset_id, order_type, finalQuantity, totalAmount, null);
    }

    // Create notification
    const statusText = orderStatus === 'completed' ? 'تکمیل شد' : 'در انتظار تأیید است';
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, ?)
    `).run(
      req.user.id,
      `سفارش ${order_type === 'buy' ? 'خرید' : 'فروش'} ${statusText}`,
      `سفارش ${order_type === 'buy' ? 'خرید' : 'فروش'} ${finalQuantity.toFixed(4)} ${asset.unit} ${asset.name} به مبلغ ${totalAmount.toLocaleString()} ریال ${statusText}.`,
      orderStatus === 'completed' ? 'success' : 'info'
    );

    res.json({
      success: true,
      message: priceMode === 'manual' ? 'سفارش با موفقیت ثبت و تأیید شد' : 'سفارش با موفقیت ثبت شد و در انتظار تأیید است',
      order_id: orderId,
      status: orderStatus,
      data: {
        quantity: finalQuantity,
        price_per_unit: pricePerUnit,
        total_amount: totalAmount
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در ثبت سفارش' });
  }
});

// Process order (update wallets)
function processOrder(db, orderId, userId, assetId, orderType, quantity, totalAmount, adminId) {
  const processTransaction = db.transaction(() => {
    if (orderType === 'buy') {
      // Deduct cash, add asset
      db.prepare('UPDATE cash_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(totalAmount, userId);
      db.prepare('UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_id = ?').run(quantity, userId, assetId);
    } else {
      // Deduct asset, add cash
      db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND asset_id = ?').run(quantity, userId, assetId);
      db.prepare('UPDATE cash_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(totalAmount, userId);
    }

    // Update order status
    db.prepare(`
      UPDATE orders SET status = 'completed', approved_at = CURRENT_TIMESTAMP, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(adminId, orderId);
  });

  processTransaction();
}

// GET /api/orders - Get user orders
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { status, limit = 20, offset = 0 } = req.query;

    let query = `
      SELECT o.*, a.name as asset_name, a.symbol, a.unit
      FROM orders o
      JOIN assets a ON o.asset_id = a.id
      WHERE o.user_id = ?
    `;
    const params = [req.user.id];

    if (status) {
      query += ' AND o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const orders = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM orders WHERE user_id = ?${status ? ' AND status = ?' : ''}`).get(...[req.user.id, ...(status ? [status] : [])]);

    res.json({ success: true, data: orders, total: total.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت سفارشات' });
  }
});

// GET /api/orders/admin/all - Admin: Get all orders
router.get('/admin/all', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const { status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT o.*, a.name as asset_name, a.symbol, a.unit, u.phone as user_phone, u.full_name as user_name
      FROM orders o
      JOIN assets a ON o.asset_id = a.id
      JOIN users u ON o.user_id = u.id
    `;
    const params = [];

    if (status) {
      query += ' WHERE o.status = ?';
      params.push(status);
    }

    query += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const orders = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM orders${status ? ' WHERE status = ?' : ''}`).get(...(status ? [status] : []));

    res.json({ success: true, data: orders, total: total.count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت سفارشات' });
  }
});

// PUT /api/orders/:id/approve - Admin: Approve order
router.put('/:id/approve', adminMiddleware, (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'سفارش یافت نشد' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'سفارش قابل تأیید نیست' });
    }

    processOrder(db, order.id, order.user_id, order.asset_id, order.order_type, order.quantity, order.total_amount, req.user.id);

    // Notify user
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(order.asset_id);
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'success')
    `).run(
      order.user_id,
      `سفارش ${order.order_type === 'buy' ? 'خرید' : 'فروش'} تأیید شد`,
      `سفارش ${order.order_type === 'buy' ? 'خرید' : 'فروش'} ${order.quantity} ${asset?.unit} ${asset?.name} تأیید و تکمیل شد.`
    );

    res.json({ success: true, message: 'سفارش تأیید شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در تأیید سفارش' });
  }
});

// PUT /api/orders/:id/reject - Admin: Reject order
router.put('/:id/reject', adminMiddleware, (req, res) => {
  try {
    const { admin_notes } = req.body;
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'سفارش یافت نشد' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'سفارش قابل رد کردن نیست' });
    }

    db.prepare(`
      UPDATE orders SET status = 'rejected', admin_notes = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(admin_notes || '', req.user.id, req.params.id);

    // Notify user
    const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(order.asset_id);
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (?, ?, ?, 'error')
    `).run(
      order.user_id,
      `سفارش ${order.order_type === 'buy' ? 'خرید' : 'فروش'} رد شد`,
      `سفارش ${order.order_type === 'buy' ? 'خرید' : 'فروش'} ${order.quantity} ${asset?.unit} ${asset?.name} توسط مدیریت رد شد. ${admin_notes ? 'دلیل: ' + admin_notes : ''}`
    );

    res.json({ success: true, message: 'سفارش رد شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در رد سفارش' });
  }
});

module.exports = router;
