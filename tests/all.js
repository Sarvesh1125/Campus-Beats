'use strict';
const {spawnSync}=require('node:child_process');
for(const script of ['tests/integration.js','tests/upgrades.js']){const r=spawnSync(process.execPath,[script],{stdio:'inherit',env:process.env});if(r.status!==0)process.exit(r.status||1);}
