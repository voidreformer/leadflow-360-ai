const fs = require('fs');
const path = require('path');

let initSqlJs = null;
try {
  initSqlJs = require('sql.js');
} catch (e) {
  console.log("sql.js loading deferred");
}

const isVercel = process.env.VERCEL === '1' || process.env.NOW_BUILDER === '1';
const dbDir = isVercel ? '/tmp' : __dirname;
const dbPath = path.join(dbDir, 'leadflow.db');

let db = null;
let memoryStore = [];
let nextId = 1;

async function initDB() {
  if (db) return db;
  
  try {
    if (initSqlJs) {
      const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
      const config = fs.existsSync(wasmPath) ? { locateFile: () => wasmPath } : {};
      const SQL = await initSqlJs(config);
      
      if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
      } else {
        db = new SQL.Database();
        createTables(db);
        saveDB();
      }
      return db;
    }
  } catch (err) {
    console.error("WASM SQLite Fallback engaged:", err.message);
  }

  // Pure In-Memory Zero-Fail Provider for Vercel Serverless
  db = {
    exec: (sql) => {
      return [{
        columns: ['id', 'name', 'contact', 'channel', 'raw_text', 'intent_summary', 'budget_val', 'urgency', 'score', 'stage', 'email_draft', 'whatsapp_draft', 'next_followup', 'created_at', 'updated_at'],
        values: memoryStore.map(l => [
          l.id, l.name, l.contact, l.channel, l.raw_text, l.intent_summary,
          l.budget_val, l.urgency, l.score, l.stage, l.email_draft,
          l.whatsapp_draft, l.next_followup, l.created_at, l.updated_at
        ])
      }];
    },
    prepare: () => ({
      run: (params) => {
        const lead = {
          id: nextId++,
          name: params[0],
          contact: params[1],
          channel: params[2],
          raw_text: params[3],
          intent_summary: params[4],
          budget_val: params[5],
          urgency: params[6],
          score: params[7],
          stage: params[8],
          email_draft: params[9],
          whatsapp_draft: params[10],
          next_followup: params[11],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        memoryStore.push(lead);
      },
      free: () => {}
    }),
    run: (sql, params) => {
      if (sql.includes('UPDATE leads')) {
        const [stage, id] = params;
        const target = memoryStore.find(l => l.id == id);
        if (target) target.stage = stage;
      } else if (sql.includes('DELETE FROM leads')) {
        const [id] = params;
        memoryStore = memoryStore.filter(l => l.id != id);
      }
    }
  };

  return db;
}

function createTables(database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact TEXT NOT NULL,
      channel TEXT DEFAULT 'Web Form',
      raw_text TEXT NOT NULL,
      intent_summary TEXT,
      budget_val INTEGER DEFAULT 0,
      urgency TEXT DEFAULT 'Medium',
      score INTEGER DEFAULT 50,
      stage TEXT DEFAULT 'Lead Ingestion',
      email_draft TEXT,
      whatsapp_draft TEXT,
      next_followup TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function saveDB() {
  if (!db || !db.export) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch (err) {
    console.error("Warning: Could not save DB to disk:", err.message);
  }
}

module.exports = { initDB, saveDB };
