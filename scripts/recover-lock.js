'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
(async()=>{
 if(!process.argv.includes('--confirm-server-stopped'))throw new Error('Stop ALL application servers first, then run: npm run recover-lock -- --confirm-server-stopped');
 await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect');
 await mongoose.connection.collection('write_locks').deleteOne({_id:'mutations'});
 console.log('Write lock cleared. Restart one server only after confirming all prior servers are stopped.');
 await mongoose.disconnect();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
