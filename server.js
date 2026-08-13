const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB, saveDB } = require('./db');
const { analyzeLeadText, processSalesTranscript } = require('./app');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());

// Serve static assets with explicit root dir
app.use(express.static(path.join(__dirname)));

app.get('/api/leads', async (req, res) => {
  try {
    const db = await initDB();
    const result = db.exec("SELECT * FROM leads ORDER BY score DESC, id DESC;");
    
    let leads = [];
    if (result.length > 0) {
      const columns = result[0].columns;
      leads = result[0].values.map(row => {
        let obj = {};
        columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        if (obj.next_followup) {
          obj.is_overdue = new Date(obj.next_followup) < new Date() && obj.stage !== 'Contract Signed' && obj.stage !== 'Archived / Lost';
        }
        return obj;
      });
    }

    const stats = {
      totalLeads: leads.length,
      hotLeads: leads.filter(l => l.score >= 80).length,
      totalPipelineValue: leads.reduce((sum, l) => sum + (l.budget_val || 0), 0),
      overdueAlerts: leads.filter(l => l.is_overdue).length
    };

    res.json({ success: true, stats, leads });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/ingest', async (req, res) => {
  try {
    const { raw_text, name, contact } = req.body;
    if (!raw_text) {
      return res.status(400).json({ success: false, error: "raw_text is required" });
    }

    const analyzed = await analyzeLeadText(raw_text, name, contact);
    const db = await initDB();

    const stmt = db.prepare(`
      INSERT INTO leads (name, contact, channel, raw_text, intent_summary, budget_val, urgency, score, stage, email_draft, whatsapp_draft, next_followup)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    stmt.run([
      analyzed.name, analyzed.contact, analyzed.channel, analyzed.raw_text,
      analyzed.intent_summary, analyzed.budget_val, analyzed.urgency,
      analyzed.score, analyzed.stage, analyzed.email_draft,
      analyzed.whatsapp_draft, analyzed.next_followup
    ]);
    stmt.free();
    saveDB();

    res.json({ success: true, message: "Lead ingested & qualified", lead: analyzed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/leads/:id/stage', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage } = req.body;
    const validStages = [
      "Lead Ingestion",
      "SQL (Sales Qualified)",
      "Proposal & Negotiation",
      "Contract Signed",
      "Archived / Lost"
    ];
    
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, error: "Invalid pipeline stage" });
    }

    const db = await initDB();
    db.run("UPDATE leads SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [stage, id]);
    db.run("INSERT INTO activities (lead_id, action, details) VALUES (?, ?, ?);", [
      id, "Stage Updated", `Pipeline stage changed to ${stage}`
    ]);
    saveDB();

    res.json({ success: true, message: `Pipeline stage updated to ${stage}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:id/transcript', async (req, res) => {
  try {
    const { id } = req.params;
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ success: false, error: "transcript text is required" });
    }

    const result = await processSalesTranscript(id, transcript);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await initDB();
    db.run("DELETE FROM leads WHERE id = ?;", [id]);
    saveDB();
    res.json({ success: true, message: "Lead record deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Wildcard Route — serve index.html for all SPA non-API requests
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(444).json({ error: "API endpoint not found" });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 LeadFlow 360 AI Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
