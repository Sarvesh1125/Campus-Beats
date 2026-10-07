'use strict';
require('dotenv').config();
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const { spawnSync } = require('node:child_process');
const M = require('../src/models');
const { createApp } = require('../src/app');
let browser,server;
(async()=>{
 await mongoose.connect(process.env.TEST_MONGODB_URI||'mongodb://127.0.0.1:27017/campus_connect_test');assert.equal(mongoose.connection.name,'campus_connect_test');await mongoose.connection.dropDatabase();await M.initAll();
 const seed=spawnSync(process.execPath,['scripts/seed.js'],{env:{...process.env,MONGODB_URI:process.env.TEST_MONGODB_URI||'mongodb://127.0.0.1:27017/campus_connect_test'},encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
 server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Forgot password?'}).click();await page.getByLabel('Account email').fill('missing@test.local');await page.getByRole('button',{name:'Request reset link'}).click();await page.getByText('If the account exists, password instructions').waitFor();await page.getByRole('button',{name:'Back to login'}).click();
 async function login(role){await page.getByLabel('Email',{exact:true}).fill(role+'@campus.local');await page.getByLabel('Password',{exact:true}).fill('Campus@123');await page.locator('form button[type=submit]').click();await page.locator('#shell').waitFor({state:'visible'});await page.locator('#view .spinner').waitFor({state:'hidden'});}
 async function nav(view){await page.locator(`#nav button[data-view=${view}]`).click();await page.locator('#view .spinner').waitFor({state:'hidden'});assert.equal(await page.locator('#view > .err').count(),0,view+' error');}
 await login('admin');
 for(const view of ['dashboard','calendar','approvals','events','users','organizers','venues','availability','checkin','reports','notifications','suggestions','audit','health','profile']){await nav(view);console.log('  ✔ Admin screen: '+view);}
 await nav('checkin'); const qr=require('qrcode'); const png=await qr.toBuffer('TKT-DEMO0001'); await page.getByLabel('Upload QR image').setInputFiles({name:'ticket.png',mimeType:'image/png',buffer:png}); await page.getByText('Sam Student checked in').waitFor(); assert.equal((await M.Event.findOne({title:'Live Check-in Practice'})).registrations[0].status,'checked-in'); console.log('  ✔ Actual QR image decoding and check-in');
 await nav('users');await page.getByRole('button',{name:'＋ Create user'}).click();await page.getByRole('dialog').waitFor();await page.getByLabel('Close dialog').click();
 await nav('dashboard');await page.screenshot({path:'tests/admin-desktop.png',fullPage:true});
 await page.locator('#logoutBtn').click();await login('organizer');for(const view of ['calendar','manage','checkin','availability','reports','profile'])await nav(view);
 await nav('manage');await page.getByRole('button',{name:'＋ Create event'}).click();await page.getByLabel('Title',{exact:true}).fill('Browser created event');await page.getByLabel('Description',{exact:true}).fill('A browser created event with a long enough description for the actual server validation.');
 const d=new Date(Date.now()+20*86400000).toISOString().slice(0,10);await page.getByLabel('Start (IST)').fill(d+'T10:00');await page.getByLabel('End (IST)').fill(d+'T12:00');await page.getByLabel('Capacity',{exact:true}).fill('20');await page.getByRole('button',{name:'Submit event',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await M.Event.exists({title:'Browser created event'}));
 await page.locator('#logoutBtn').click();await login('student');for(const view of ['discover','mine','calendar','notifications','profile'])await nav(view);
 await page.setViewportSize({width:390,height:844});await page.locator('#menuBtn').click();await nav('calendar');await page.getByLabel('View',{exact:true}).selectOption('agenda');await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=0);await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#toasts').replaceChildren();});await page.screenshot({path:'tests/student-mobile.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page must not overflow horizontally');
 assert.deepEqual(errors,[]);console.log('Browser checks passed: login/reset, all Admin screens, Organizer screens + real event creation, Student screens, mobile layout.');
 await browser.close();server.close();await mongoose.disconnect();
})().catch(async e=>{console.error(e);if(browser)await browser.close();server?.close();await mongoose.disconnect();process.exitCode=1;});
