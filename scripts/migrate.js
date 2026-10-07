'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const M = require('../src/models');
const U = require('../src/upgrades');
async function migrate() {
  // Inspect before index creation; legacy empty numbers on students are not identifiers.
  const duplicates = await M.User.aggregate([{ $match: { organizationNumber: { $type: 'string', $ne: '' } } }, { $group: { _id: '$organizationNumber', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]);
  if (duplicates.length) throw new Error('Duplicate Organizer numbers require manual review: '+JSON.stringify(duplicates));
  await M.User.updateMany({ organizationNumber: '' }, { $unset: { organizationNumber: '' } });
  await M.User.updateMany({ authVersion: { $exists: false } }, { $set: { authVersion: 0 } });
  for (const u of await M.User.find({ role: 'organizer', organizationNumber: null })) { u.organizationNumber = await U.nextOrgNumber(); await u.save(); }
  await M.Event.updateMany({ originalCreator: { $exists: false } }, [{ $set: { originalCreator: '$organizer' } }]);
  // Existing approved / historical events must not be announced again by this migration.
  await M.Event.updateMany({ status: { $in: ['Approved','Completed','Archived'] }, firstApprovedAt: { $exists: false } }, [{ $set: { firstApprovedAt: '$createdAt', announcementPending: false } }]);
  for (const u of await M.User.find()) await U.markAttention(u);
  for (const model of Object.values(M)) if (model?.createIndexes) await model.createIndexes();
  console.log('Migration completed. Existing data preserved.');
}
if (require.main === module) (async()=>{await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campus_connect',{autoIndex:false,serverSelectionTimeoutMS:5000});try{await U.locked(migrate);}finally{await mongoose.disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports = { migrate };
