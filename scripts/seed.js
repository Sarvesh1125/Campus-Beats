'use strict';
// Non-destructive seed: only inserts what is missing. Never drops or overwrites anything.
require('dotenv').config();
const mongoose = require('mongoose');
const { User, Venue, Event, Notification, initAll } = require('../src/models');
const { hashPassword } = require('../src/auth');

const URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect';
const PASSWORD = 'Campus@123';
const DESC = (t) => `${t}: a hands-on campus session organised by the Campus Connect team with speakers, activities and Q&A for all interested students.`;

function at(daysFromNow, hour, hours = 3) {
  const s = new Date(); s.setDate(s.getDate() + daysFromNow); s.setHours(hour, 0, 0, 0);
  return [s, new Date(s.getTime() + hours * 3600000)];
}

(async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  await initAll();
  const out = { users: 0, venues: 0, events: 0 };

  const people = [
    { name: 'Campus Admin', email: 'admin@campus.local', phone: '9000000001', role: 'admin', verified: true },
    { name: 'Olivia Organizer', email: 'organizer@campus.local', phone: '9000000002', role: 'organizer', verified: true, interests: ['Technology', 'Culture'] },
    { name: 'Sam Student', email: 'student@campus.local', phone: '9000000003', role: 'student', verified: true, interests: ['AI', 'Music'] },
    { name: 'Riya Student', email: 'student2@campus.local', phone: '9000000004', role: 'student', verified: true, interests: ['Sports', 'Design'] },
  ];
  const users = {};
  for (const p of people) {
    let u = await User.findOne({ email: p.email });
    if (!u) { if(p.role === 'organizer') p.organizationNumber = await require('../src/upgrades').nextOrgNumber(); u = await User.create({ ...p, passwordHash: await hashPassword(PASSWORD) }); out.users++; }
    users[p.role + (p.email.includes('student2') ? '2' : '')] = u;
  }

  const venueDefs = [
    { name: 'Innovation Lab', location: 'Block A, Floor 2', capacity: 60, amenities: ['Wi-Fi', 'Projector', 'Whiteboards'] },
    { name: 'Main Auditorium', location: 'Central Campus', capacity: 500, amenities: ['Stage', 'Sound system', 'AC'] },
    { name: 'Sports Ground', location: 'South Campus', capacity: 1000, amenities: ['Floodlights', 'Seating', 'First aid'] },
  ];
  const venues = {};
  for (const v of venueDefs) {
    let doc = await Venue.findOne({ name: v.name });
    if (!doc) { doc = await Venue.create(v); out.venues++; }
    venues[v.name] = doc;
  }

  const [liveStart] = [new Date(Date.now() + 30 * 60000)];
  const defs = [
    { title: 'Build with AI', category: 'Workshop', venue: 'Innovation Lab', capacity: 40, when: at(3, 10), status: 'Approved' },
    { title: 'Rhythm of Campus', category: 'Cultural', venue: 'Main Auditorium', capacity: 300, when: at(5, 17), status: 'Approved' },
    { title: 'Campus Premier League', category: 'Sports', venue: 'Sports Ground', capacity: 500, when: at(7, 9, 6), status: 'Approved', budget: 25000, budgetNotes: 'Equipment ₹10,000; trophies ₹5,000; refreshments ₹7,000; referees ₹3,000' },
    { title: 'Cyber Security Summit', category: 'Seminar', venue: 'Main Auditorium', capacity: 250, when: at(9, 10, 5), status: 'Pending', budget: 15000, budgetNotes: 'Speaker honorarium ₹10,000; hospitality ₹5,000' },
    { title: 'Design Thinking Lab', category: 'Workshop', venue: 'Innovation Lab', capacity: 30, when: at(6, 14), status: 'Pending' },
    { title: 'Live Check-in Practice', category: 'Social', venue: 'Innovation Lab', capacity: 20, when: [liveStart, new Date(liveStart.getTime() + 3 * 3600000)], status: 'Approved', demoTicket: true },
    { title: 'One-seat Waitlist Demo', category: 'Academic', venue: 'Innovation Lab', capacity: 1, when: at(2, 16, 2), status: 'Approved' },
  ];
  for (const d of defs) {
    if (await Event.exists({ organizer: users.organizer._id, titleKey: d.title.toLowerCase() })) continue;
    const [start, end] = d.when;
    const ev = {
      title: d.title, titleKey: d.title.toLowerCase(), dateKey: new Date(start.getTime()+19800000).toISOString().slice(0, 10), description: DESC(d.title),
      category: d.category, start, end, venue: venues[d.venue]._id, organizer: users.organizer._id, originalCreator: users.organizer._id, ...(d.status === 'Approved' ? { firstApprovedAt: new Date(), announcementPending: false } : {}), capacity: d.capacity,
      budget: d.budget || 0, budgetNotes: d.budgetNotes || '', status: d.status, registrations: [],
    };
    if (d.demoTicket) ev.registrations.push({ student: users.student._id, status: 'registered', ticketCode: 'TKT-DEMO0001' });
    try { await Event.create(ev); out.events++; } catch (e) { if (e.code !== 11000) throw e; }
  }
  if (out.users) await Notification.create({ user: users.student._id, message: 'Welcome to Campus Connect! Browse events and register for your first one.' });

  console.log(`Seed finished. Added: ${out.users} users, ${out.venues} venues, ${out.events} events (existing data untouched).`);
  console.log('Demo logins (password for all: ' + PASSWORD + '): admin@campus.local, organizer@campus.local, student@campus.local, student2@campus.local');
  console.log('Check-in demo ticket: TKT-DEMO0001 (event "Live Check-in Practice", opens now).');
  await mongoose.disconnect();
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
