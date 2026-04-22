const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/prices - Get current prices for all assets
router.get('/', (req, res) => {
  try {
    const db = getDb();
    
    const priceMode = db.prepare("SELECT value FROM settings WHERE key = 'price_mode'").get();
    const buyMarkup = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'buy_markup'").get()?.value || '2');
    const sellMarkdown = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'sell_markdown'").get()?.value || '2');

    const prices = db.prepare(`
      SELECT p.*, a.name as asset_name, a.symbol, a.unit
      FROM prices p
      JOIN assets a ON p.asset_id = a.id
      WHERE a.is_active = 1
      AND p.id = (
        SELECT id FROM prices WHERE asset_id = p.asset_id ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY a.id
    `).all();

    const result = prices.map(p => ({
      asset_id: p.asset_id,
      asset_name: p.asset_name,
      symbol: p.symbol,
      unit: p.unit,
      base_price: p.price,
      buy_price: p.buy_price || (p.price * (1 + buyMarkup / 100)),
      sell_price: p.sell_price || (p.price * (1 - sellMarkdown / 100)),
      price_mode: priceMode?.value || 'manual',
      updated_at: p.created_at
    }));

    res.json({
      success: true,
      data: result,
      price_mode: priceMode?.value || 'manual'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت قیمت‌ها' });
  }
});

// GET /api/prices/:assetId - Get price for specific asset
router.get('/:assetId', (req, res) => {
  try {
    const db = getDb();
    const { assetId } = req.params;
    
    const buyMarkup = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'buy_markup'").get()?.value || '2');
    const sellMarkdown = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'sell_markdown'").get()?.value || '2');

    const price = db.prepare(`
      SELECT p.*, a.name as asset_name, a.symbol, a.unit
      FROM prices p
      JOIN assets a ON p.asset_id = a.id
      WHERE p.asset_id = ?
      ORDER BY p.created_at DESC LIMIT 1
    `).get(assetId);

    if (!price) {
      return res.status(404).json({ success: false, message: 'قیمت یافت نشد' });
    }

    res.json({
      success: true,
      data: {
        asset_id: price.asset_id,
        asset_name: price.asset_name,
        symbol: price.symbol,
        unit: price.unit,
        base_price: price.price,
        buy_price: price.buy_price || (price.price * (1 + buyMarkup / 100)),
        sell_price: price.sell_price || (price.price * (1 - sellMarkdown / 100)),
        updated_at: price.created_at
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در دریافت قیمت' });
  }
});

// POST /api/prices - Admin: Set manual price
router.post('/', adminMiddleware, (req, res) => {
  try {
    const { asset_id, price, buy_price, sell_price } = req.body;

    if (!asset_id || !price) {
      return res.status(400).json({ success: false, message: 'شناسه دارایی و قیمت الزامی است' });
    }

    const db = getDb();
    const buyMarkup = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'buy_markup'").get()?.value || '2');
    const sellMarkdown = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'sell_markdown'").get()?.value || '2');

    const finalBuyPrice = buy_price || (price * (1 + buyMarkup / 100));
    const finalSellPrice = sell_price || (price * (1 - sellMarkdown / 100));

    db.prepare(`
      INSERT INTO prices (asset_id, price, price_type, buy_price, sell_price, created_by)
      VALUES (?, ?, 'manual', ?, ?, ?)
    `).run(asset_id, price, finalBuyPrice, finalSellPrice, req.user.id);

    res.json({ success: true, message: 'قیمت بروزرسانی شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در بروزرسانی قیمت' });
  }
});

// PUT /api/prices/settings - Admin: Update price settings
router.put('/settings/markup', adminMiddleware, (req, res) => {
  try {
    const { price_mode, buy_markup, sell_markdown } = req.body;
    const db = getDb();

    if (price_mode !== undefined) {
      db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'price_mode'").run(price_mode);
    }
    if (buy_markup !== undefined) {
      db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'buy_markup'").run(buy_markup.toString());
    }
    if (sell_markdown !== undefined) {
      db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'sell_markdown'").run(sell_markdown.toString());
    }

    res.json({ success: true, message: 'تنظیمات قیمت‌گذاری بروزرسانی شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در بروزرسانی تنظیمات' });
  }
});

// GET /api/prices/settings/all - Get all settings
router.get('/settings/all', (req, res) => {
  try {
    const db = getDb();
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });
    res.json({ success: true, data: settingsMap });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطا' });
  }
});

module.exports = router;
