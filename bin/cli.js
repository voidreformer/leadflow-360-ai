#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log("==================================================");
console.log("⚡ Launching LeadFlow 360 AI Server by VoidReformer...");
console.log("==================================================");

const serverPath = path.join(__dirname, '..', 'server.js');
const child = spawn('node', [serverPath], { stdio: 'inherit' });

child.on('close', (code) => {
  process.exit(code);
});
