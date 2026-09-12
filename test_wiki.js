const assert = require('node:assert');
const {
  getAllCrews,
  getCrewById,
  getCrewHistory,
  rollbackCrew,
  archiveCrew,
  restoreCrew,
  upsertCrew,
  getGlobalActivity,
} = require('./db.js');

console.log('🧪 Starting Wikipedia-Style Revision & Self-Governance Tests...\n');

// 1. Check existing crews and revisions
const crews = getAllCrews();
assert(crews.length >= 10, 'Should have active crews');
console.log(`✓ Active crews: ${crews.length}`);

// 2. Test editing Massive Monkees with an author moniker & edit summary
const mmOriginal = getCrewById('massive_monkees');
const testFounder = 'Bboy Test_' + Date.now();
const updatedMm = upsertCrew({
  ...mmOriginal,
  founders: [...mmOriginal.founders, testFounder],
  notes: 'Documented session',
}, 'Bboy Seattle', 'Added test founder to founders list');

assert(updatedMm.founders.includes(testFounder));
console.log('✓ Edited Massive Monkees with author tag & edit summary.');

// 3. Verify history is recorded
const mmHistory = getCrewHistory('massive_monkees');
assert(mmHistory.length >= 2, 'Massive Monkees should have revision history');
const latestRev = mmHistory[0];
const previousRev = mmHistory[1];
assert.strictEqual(latestRev.authorName, 'Bboy Seattle');
assert.strictEqual(latestRev.editSummary, 'Added test founder to founders list');
console.log(`✓ Revision logged: ID=${latestRev.id} by ${latestRev.authorName} ("${latestRev.editSummary}")`);

// 4. Test 1-Click Rollback
console.log(`↺ Performing 1-Click Rollback to revision #${previousRev.id}...`);
const rolledBack = rollbackCrew('massive_monkees', previousRev.id, 'Moderator');
assert(!rolledBack.founders.includes(testFounder), 'Rollback should undo the added founder');
console.log('✓ Rollback successfully restored previous founder state.');

// 5. Test Soft-Delete / Archiving
const dummy = upsertCrew({
  id: 'grief_target',
  name: 'Grief Target Crew',
  city: 'Chicago, USA',
  year: 2020,
}, 'Spammer', 'Spam entry');

const archiveResult = archiveCrew('grief_target', 'Spam/duplicate entry', 'VigilantBboy');
assert.strictEqual(archiveResult.isArchived, true);
const activeCrewsAfterArchive = getAllCrews(false);
assert(!activeCrewsAfterArchive.some(c => c.id === 'grief_target'), 'Archived crew should not appear on active map');
console.log('✓ Soft-delete archiving verified (hidden from map, preserved in database).');

// 6. Test Un-Archiving / Restoration
const restored = restoreCrew('grief_target', 'Restorer');
assert.strictEqual(restored.isArchived, false);
const activeAfterRestore = getAllCrews(false);
assert(activeAfterRestore.some(c => c.id === 'grief_target'), 'Restored crew should reappear on active map');
console.log('✓ Un-archiving / restoration verified.');

// 7. Test Protected Root (RSC cannot be deleted)
try {
  archiveCrew('rsc', 'Accidental delete', 'Griefer');
  assert.fail('Should not be able to archive locked crew');
} catch (err) {
  assert(err.message.includes('locked'), 'Expected locked error');
  console.log('✓ Protected foundation roots (RSC) cannot be archived.');
}

// 8. Test Global Activity Feed
const activity = getGlobalActivity(10);
assert(activity.length >= 3, 'Activity feed should contain recent actions');
console.log(`✓ Global activity feed contains ${activity.length} recent events worldwide.`);
console.log(`  Latest: [${activity[0].action.toUpperCase()}] "${activity[0].crewName}" by ${activity[0].authorName}: "${activity[0].editSummary}"`);

console.log('\n🎉 ALL WIKIPEDIA-STYLE ARCHIVAL & ROLLBACK TESTS PASSED!');
