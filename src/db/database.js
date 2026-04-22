const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const dbPath = process.env.DATABASE_PATH || './data/goldtrader.db';
const resolvedPath = path.resolve(dbPath);
const dbDir = path.dirname(resolvedPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

function getDb() {
  if (!db) {
    db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

module.exports = { getDb };
