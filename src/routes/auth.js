const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { generateToken, authMiddleware } = require('../middleware/auth');

// Generate referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/send-otp
router.post('/send-otp', (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone || !/^09\d{9}$/.test(phone)) {
      return res.status(400).json({ success: false, message: 'شماره موبایل نامعتبر است' });
    }

    const db = getDb();
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

    // Invalidate old OTPs
    db.prepare('UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0').run(phone);
    
    // Insert new OTP
    db.prepare(`
      INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)
    `).run(phone, otp, expiresAt.toISOString());

    // In production, send SMS here
    console.log(`📱 OTP for ${phone}: ${otp}`);

    res.json({ 
      success: true, 
      message: 'کد تأیید ارسال شد',
      // Only in development
      ...(process.env.NODE_ENV === 'development' ? { otp } : {})
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در ارسال کد' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', (req, res) => {
  try {
    const { phone, otp, referral_code } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'شماره موبایل و کد تأیید الزامی است' });
    }

    const db = getDb();

    // Check OTP
    const otpRecord = db.prepare(`
      SELECT * FROM otp_codes 
      WHERE phone = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `).get(phone, otp);

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'کد تأیید اشتباه یا منقضی شده است' });
    }

    // Mark OTP as used
    db.prepare('UPDATE otp_codes SET used = 1 WHERE id = ?').run(otpRecord.id);

    // Find or create user
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);

    if (!user) {
      const userId = require('uuid').v4();
      let userReferralCode;
      let isUnique = false;
      
      while (!isUnique) {
        userReferralCode = generateReferralCode();
        const existing = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(userReferralCode);
        if (!existing) isUnique = true;
      }

      // Check referral
      let referredBy = null;
      if (referral_code) {
        const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referral_code);
        if (referrer) referredBy = referral_code;
      }

      db.prepare(`
        INSERT INTO users (id, phone, referral_code, referred_by, is_verified)
        VALUES (?, ?, ?, ?, 1)
      `).run(userId, phone, userReferralCode, referredBy);

      // Create cash wallet
      db.prepare('INSERT OR IGNORE INTO cash_wallets (user_id, balance) VALUES (?, 0)').run(userId);

      // Create asset wallets
      const assets = db.prepare('SELECT id FROM assets WHERE is_active = 1').all();
      assets.forEach(asset => {
        db.prepare('INSERT OR IGNORE INTO wallets (user_id, asset_id, balance) VALUES (?, ?, 0)').run(userId, asset.id);
      });

      // Track referral
      if (referredBy) {
        const referrer = db.prepare('SELECT id FROM users WHERE referral_code = ?').get(referredBy);
        if (referrer) {
          db.prepare('INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)').run(referrer.id, userId);
        }
      }

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(user.id);
      user.is_verified = 1;
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'ورود موفق',
      token,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
        is_admin: user.is_admin === 1,
        referral_code: user.referral_code
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در تأیید کد' });
  }
});

// POST /api/auth/login - Login with phone/password
router.post('/login', (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, message: 'شماره موبایل و رمز عبور الزامی است' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE phone = ? AND is_active = 1').get(phone);

    if (!user) {
      return res.status(401).json({ success: false, message: 'کاربر یافت نشد' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ success: false, message: 'رمز عبور تنظیم نشده است. از OTP استفاده کنید' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'رمز عبور اشتباه است' });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: 'ورود موفق',
      token,
      user: {
        id: user.id,
        phone: user.phone,
        full_name: user.full_name,
        is_admin: user.is_admin === 1,
        referral_code: user.referral_code
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در ورود' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = req.user;
  res.json({
    success: true,
    user: {
      id: user.id,
      phone: user.phone,
      full_name: user.full_name,
      national_id: user.national_id,
      email: user.email,
      is_admin: user.is_admin === 1,
      is_verified: user.is_verified === 1,
      referral_code: user.referral_code,
      referred_by: user.referred_by,
      created_at: user.created_at
    }
  });
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { full_name, national_id, email } = req.body;
    const db = getDb();

    db.prepare(`
      UPDATE users SET full_name = ?, national_id = ?, email = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(full_name, national_id, email, req.user.id);

    res.json({ success: true, message: 'پروفایل بروزرسانی شد' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطا در بروزرسانی پروفایل' });
  }
});

module.exports = router;
