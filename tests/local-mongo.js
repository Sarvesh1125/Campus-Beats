'use strict';
// Downloads an actual mongod binary on first run. Subsequent runs use its cache.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
(async()=>{
 const mongo=await MongoMemoryServer.create({instance:{dbName:'campus_connect_test',args:['--nounixsocket']}});
 console.log('Temporary real MongoDB started');
 const child=spawn(process.execPath,[process.argv[2]||'tests/integration.js'],{stdio:'inherit',env:{...process.env,TEST_MONGODB_URI:mongo.getUri('campus_connect_test'),PASSWORD_DELIVERY:'console',NODE_ENV:'test'}});
 child.on('exit',async code=>{await mongo.stop();process.exit(code||0);});
})().catch(e=>{console.error(e);process.exit(1);});
