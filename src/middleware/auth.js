const jwt = require('jsonwebtoken');
const { getDb } = require('../db/database');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'goldtrader_secret_key';

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      phone: user.phone,
      is_admin: user.is_admin,
      is_verified: user.is_verified
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'توکن احراز هویت یافت نشد' });
  }

  const token = authHeader.substring(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ success: false, message: 'توکن نامعتبر یا منقضی شده است' });
  }

  // Get fresh user data
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.id);

  if (!user) {
    return res.status(401).json({ success: false, message: 'کاربر یافت نشد یا غیرفعال است' });
  }

  req.user = user;
  next();
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({ success: false, message: 'دسترسی مجاز نیست - فقط مدیران' });
    }
    next();
  });
}

module.exports = { generateToken, verifyToken, authMiddleware, adminMiddleware };
