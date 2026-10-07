'use strict';
require('dotenv').config();
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const M = require('../src/models');
const A = require('../src/auth');
const U = require('../src/upgrades');
const { createApp } = require('../src/app');
const { migrate } = require('../scripts/migrate');
const PW='Campus@123';let base,server;let passed=0,failed=0;
const test=async(name,fn)=>{try{await fn();passed++;console.log('  ✔ '+name);}catch(e){failed++;console.error('  ✘ '+name+'\n'+e.stack);}};
function client(){let cookie='';return async(method,path,body)=>{const r=await fetch(base+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});for(const c of r.headers.getSetCookie())cookie=c.split(';')[0];return {status:r.status,data:await r.json()};};}
const expect=async(p,status)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
(async()=>{
 await mongoose.connect(process.env.TEST_MONGODB_URI||'mongodb://127.0.0.1:27017/campus_connect_test',{serverSelectionTimeoutMS:5000});
 assert.equal(mongoose.connection.name,'campus_connect_test');await mongoose.connection.dropDatabase();await M.initAll();
 server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 const user=async(name,role)=>M.User.create({name,email:name.toLowerCase()+'@test.local',phone:'9876543210',role,verified:true,passwordHash:await A.hashPassword(PW),...(role==='organizer'?{organizationNumber:await U.nextOrgNumber()}:{})});
 const ad=await user('Admin','admin'),og=await user('Organizer','organizer'),og2=await user('Other','organizer'),st=await user('Student','student'),st2=await user('Second','student');
 const admin=client(),org=client(),other=client(),student=client(),student2=client();
 for(const [c,u] of [[admin,ad],[org,og],[other,og2],[student,st],[student2,st2]])await expect(c('POST','/auth/login',{email:u.email,password:PW}),200);
 const venue=await M.Venue.create({name:'Test Hall',location:'Block A',capacity:100});
 const start=new Date(Date.now()+86400000),end=new Date(start.getTime()+7200000);
 const data={title:'Upgrade Event',description:'A detailed description of a workshop for students to explore technology and creativity together.',category:'Workshop',start:start.toISOString(),end:end.toISOString(),capacity:4,budget:50,budgetNotes:'Private budget notes',venue:venue.id};
 let ev,token,ticket;
 await test('Concurrent Organizer signups get unique server-generated numbers',async()=>{
  const rows=await Promise.all([0,1,2,3].map(i=>expect(client()('POST','/auth/register',{name:'New Organizer',email:`org${i}@test.local`,phone:'9876543210',role:'organizer',password:PW,organizationNumber:'ATTACKER-CHOSEN'}),201)));
  assert.equal(new Set(rows.map(r=>r.user.organizationNumber)).size,4);rows.forEach(r=>{assert.match(r.user.organizationNumber,/^ORG-\d{4}-\d{6}$/);assert.equal(r.user.verified,false);});
 });
 await test('Concurrent venue reservations accept one; back-to-back booking allowed',async()=>{
  const r=await Promise.all([org('POST','/events',data),other('POST','/events',{...data,title:'Clashing event'})]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);ev=r.find(x=>x.status===201).data.event;
  // Normalize managing organizer for subsequent cases.
  await M.Event.updateOne({_id:ev._id},{$set:{organizer:og._id,originalCreator:og._id}});
  await expect(org('POST','/events',{...data,title:'Adjacent event',start:end.toISOString(),end:new Date(end.getTime()+3600000).toISOString()}),201);
  const availability=await expect(admin('GET',`/venues/${venue.id}/availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`),200);assert.equal(availability.available,false);assert.equal(availability.conflicts.length,1);
 });
 await test('Approval announcements are deduplicated, include venue, and are retryable',async()=>{
  await expect(admin('PATCH',`/events/${ev._id}/status`,{status:'Approved'}),200);await expect(admin('PATCH',`/events/${ev._id}/status`,{status:'Approved'}),409);
  await Promise.all([U.flushAnnouncements(),U.flushAnnouncements()]);assert.equal(await M.Notification.countDocuments({user:st._id,dedupeKey:`approved:${ev._id}`}),1);
  assert.match((await M.Notification.findOne({user:st._id,dedupeKey:`approved:${ev._id}`})).message,/Test Hall/);
  await expect(org('PATCH',`/events/${ev._id}`,{description:data.description+' Updated.'}),200);await expect(admin('PATCH',`/events/${ev._id}/status`,{status:'Approved'}),200);
  assert.equal(await M.Notification.countDocuments({user:st._id,dedupeKey:`approved:${ev._id}`}),1);
  // Simulated crash after durable approval save, before notification fanout.
  const retry=await M.Event.create({...data,title:'Retry Announcement',titleKey:'retry announcement',dateKey:'retry',organizer:og._id,status:'Approved',firstApprovedAt:new Date(),announcementPending:true});
  await expect(student('GET','/notifications'),200);assert.equal(await M.Notification.countDocuments({user:st._id,dedupeKey:`approved:${retry.id}`}),1);
 });
 await test('Calendars enforce Student registration and Organizer privacy',async()=>{
  const query=`?start=${encodeURIComponent(new Date(start.getTime()-86400000).toISOString())}&end=${encodeURIComponent(new Date(end.getTime()+86400000).toISOString())}`;
  assert.equal((await expect(student('GET','/calendar'+query),200)).events.length,0);
  ticket=(await expect(student('POST',`/events/${ev._id}/register`),201)).registration.ticketCode;
  const s=await expect(student('GET','/calendar'+query),200);assert.equal(s.events.length,1);assert.equal(s.events[0].budgetNotes,undefined);
  const o=await expect(other('GET','/calendar'+query),200);const visible=o.events.find(x=>x._id===ev._id);assert.ok(visible);assert.equal(visible.budgetNotes,undefined);assert.equal(visible.counts,undefined);assert.equal(visible.organizer.email,undefined);assert.equal(visible.canManage,false);
  assert.ok((await expect(admin('GET','/calendar'+query),200)).events.length>=2);
 });
 await test('Revocation during live event blocks Organizer operations, preserves basic access',async()=>{
  await M.Event.updateOne({_id:ev._id},{$set:{start:new Date(Date.now()-1000),end:new Date(Date.now()+3600000)}});
  await expect(admin('PATCH',`/users/${og.id}`,{verified:false,reason:'Temporary review'}),200);
  await expect(org('POST',`/events/${ev._id}/checkin`,{ticketCode:ticket}),403);await expect(org('GET','/notifications'),200);await expect(org('GET','/auth/me'),200);
  const e=await M.Event.findById(ev._id);assert.equal(e.status,'Approved');assert.equal(e.registrations.length,1);assert.equal(e.needsAttention,true);
 });
 await test('Account deactivation invalidates session during live event; Admin reassigns',async()=>{
  await expect(admin('PATCH',`/users/${og.id}`,{active:false,reason:'Account suspended'}),200);await expect(org('GET','/auth/me'),401);
  await expect(admin('PATCH',`/events/${ev._id}/reassign`,{organizer:og2.id,reason:'Continue event with another Organizer'}),200);
  const e=await M.Event.findById(ev._id);assert.equal(String(e.originalCreator),og.id);assert.equal(String(e.organizer),og2.id);assert.equal(e.needsAttention,false);assert.equal(e.registrations[0].ticketCode,ticket);
 });
 await test('Concurrent check-in succeeds once and records operator',async()=>{
  await expect(admin('POST',`/events/${ev._id}/checkin`,{ticketCode:'INVALID'}),404);
  const r=await Promise.all([admin('POST',`/events/${ev._id}/checkin`,{ticketCode:ticket}),other('POST',`/events/${ev._id}/checkin`,{ticketCode:ticket})]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);
  const e=await M.Event.findById(ev._id);assert.equal(e.registrations[0].status,'checked-in');assert.ok(e.registrations[0].checkedInBy);
 });
 await test('Forgot password is generic, hashed, and single-use; resets invalidate sessions',async()=>{
  const original=console.log;let captured='';console.log=(...x)=>{if(String(x[0]).startsWith('[LOCAL PASSWORD SETUP]'))captured=x.join(' ');else original(...x);};let existing,unknown;
  try{existing=await expect(client()('POST','/auth/forgot-password',{email:st.email}),200);unknown=await expect(client()('POST','/auth/forgot-password',{email:'missing@test.local'}),200);}finally{console.log=original;}
  assert.deepEqual(existing,unknown);token=captured.match(/#reset=([a-f0-9]+)/)[1];const u=await M.User.findById(st.id);assert.notEqual(u.resetHash,token);assert.equal(u.resetHash,crypto.createHash('sha256').update(token).digest('hex'));
  await expect(client()('POST','/auth/reset-password',{token,password:'NewPassword@123'}),200);await expect(student('GET','/auth/me'),401);await expect(client()('POST','/auth/reset-password',{token,password:PW}),400);
  await expect(student('POST','/auth/login',{email:st.email,password:'NewPassword@123'}),200);const me=await expect(student('GET','/auth/me'),200);assert.equal(me.user.resetHash,undefined);
 });
 await test('Expired reset token rejected; deactivated account stays deactivated',async()=>{
  const raw='a'.repeat(64);await M.User.updateOne({_id:og._id},{$set:{resetHash:crypto.createHash('sha256').update(raw).digest('hex'),resetExpiresAt:new Date(Date.now()-1000)}});
  await expect(client()('POST','/auth/reset-password',{token:raw,password:PW}),400);
  await M.User.updateOne({_id:og._id},{$set:{resetExpiresAt:new Date(Date.now()+60000)}});await expect(client()('POST','/auth/reset-password',{token:raw,password:PW}),200);assert.equal((await M.User.findById(og.id)).active,false);
 });
 let secondAdmin;
 await test('Admin creation requires reauthentication; public role escalation rejected',async()=>{
  await expect(student('POST','/users',{name:'No',role:'admin'}),403);
  const b={name:'New Admin',email:'newadmin@test.local',phone:'9876543210',role:'admin'};
  await expect(admin('POST','/users',b),403);
  const log=console.log;console.log=()=>{};try{secondAdmin=(await expect(admin('POST','/users',{...b,currentPassword:PW}),201)).user;}finally{console.log=log;}
  assert.equal(secondAdmin.role,'admin');assert.equal(secondAdmin.passwordHash,undefined);assert.equal(secondAdmin.resetHash,undefined);
  await expect(student('PATCH','/profile',{role:'admin'}),400);
 });
 await test('Concurrent Admin removals preserve an active Admin',async()=>{
  await M.User.updateOne({_id:secondAdmin._id},{$set:{passwordHash:await A.hashPassword(PW)}});const second=client();await expect(second('POST','/auth/login',{email:secondAdmin.email,password:PW}),200);
  const r=await Promise.all([admin('PATCH',`/users/${secondAdmin._id}`,{active:false,reason:'Test removal'}),second('PATCH',`/users/${ad.id}`,{active:false,reason:'Concurrent removal'})]);assert.equal(r.filter(x=>x.status===200).length,1);assert.equal(await M.User.countDocuments({role:'admin',active:true}),1);
  // restore fixed admin fixture through database, then reauthenticate
  await M.User.updateOne({_id:ad._id},{$set:{active:true}});await expect(admin('POST','/auth/login',{email:ad.email,password:PW}),200);
  await expect(admin('PATCH',`/users/${ad.id}`,{active:false,reason:'Self removal'}),409);
 });
 await test('Notification mark-all, soft deletion, audit and pagination work',async()=>{
  await expect(student('PATCH','/notifications/read-all'),200);assert.equal((await expect(student('GET','/notifications'),200)).unread,0);
  const n=await M.Notification.findOne({user:st.id,dedupeKey:{$exists:true}});await expect(student('DELETE',`/notifications/${n.id}`),200);assert.equal((await M.Notification.findById(n.id)).deleted,true);
  const r=await expect(admin('GET','/audit?limit=2'),200);assert.equal(r.logs.length,2);assert.ok(r.total>2);assert.ok(!JSON.stringify(r).includes('resetHash'));
  assert.equal((await expect(admin('GET','/users?limit=2&page=2'),200)).users.length,2);
 });
 await test('Migration is repeatable and preserves original creator and ticket history',async()=>{
  const before=await M.Event.countDocuments();await U.locked(migrate);await U.locked(migrate);assert.equal(await M.Event.countDocuments(),before);const e=await M.Event.findById(ev._id);assert.equal(String(e.originalCreator),og.id);assert.equal(e.registrations[0].ticketCode,ticket);
 });
 console.log(`\n${passed}/${passed+failed} upgrade tests passed`);
 server.close();await mongoose.disconnect();process.exitCode=failed?1:0;
})().catch(async e=>{console.error(e);server?.close();await mongoose.disconnect();process.exitCode=1;});
