'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const models = require('./models');
const { createApp } = require('./app');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

(async () => {
  try {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
    await models.initAll(); // builds all indexes
    console.log(`MongoDB connected: ${URI}`);
  } catch (e) {
    console.error('\nCould not connect to MongoDB at ' + URI + '\n -> ' + e.message);
    console.error('Make sure the MongoDB service is running (see README: Troubleshooting).\n');
    process.exit(1);
  }
  const server = createApp().listen(PORT, HOST, () => console.log(`Campus Connect running at http://localhost:${PORT}`));
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Change PORT in .env or stop the other program.` : e.message);
    process.exit(1);
  });
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
})();
