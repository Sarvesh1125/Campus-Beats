'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const models = require('./models');
const { createApp } = require('./app');
const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
let connecting = false, stopping = false;
async function connect() {
  if (connecting || stopping || mongoose.connection.readyState !== 0) return;
  connecting = true;
  try { await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 }); await models.initAll(); console.log('Local MongoDB connected'); }
  catch { console.error('Database unavailable or indexes need migration. Start MongoDB and follow README; API will return a clear unavailable message.'); await mongoose.disconnect().catch(()=>{}); }
  finally { connecting = false; }
}
const server = createApp().listen(PORT, HOST, () => console.log(`Campus Connect running at http://localhost:${PORT}`));
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Change PORT and APP_BASE_URL in .env.` : e.message); process.exit(1); });
connect(); const timer = setInterval(connect,10000);
const stop = () => { stopping=true;clearInterval(timer);server.close(()=>mongoose.disconnect().then(()=>process.exit(0))); };
process.on('SIGINT',stop);process.on('SIGTERM',stop);
