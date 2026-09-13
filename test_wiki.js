const assert = require('node:assert');
const {
  getAllCrews,
  getCrewById,
  getCrewHistory,
  rollbackCrew,
  archiveCrew,
  restoreCrew,
  upsertCrew,
  deleteCrew,
  getGlobalActivity,
} = require('./db.js');

async function runWikiTests() {
  console.log('🧪 Starting Wikipedia-Style Revision & Self-Governance Tests...\n');

  // 1. Check existing crews and revisions
  const crews = await getAllCrews();
  assert(crews.length >= 9, 'Should have active crews');
  console.log(`✓ Active crews: ${crews.length}`);

  // 2. Test editing Massive Monkees with an author moniker & edit summary
  const mmOriginal = await getCrewById('massive_monkees');
  const testFounder = 'Bboy Test_' + Date.now();
  const updatedMm = await upsertCrew({
    ...mmOriginal,
    founders: [...mmOriginal.founders, testFounder],
    notes: 'Documented session',
  }, 'Bboy Seattle', 'Added test founder to founders list');

  assert(updatedMm.founders.includes(testFounder));
  console.log('✓ Edited Massive Monkees with author tag & edit summary.');

  // 3. Verify history is recorded
  const mmHistory = await getCrewHistory('massive_monkees');
  assert(mmHistory.length >= 2, 'Massive Monkees should have revision history');
  const latestRev = mmHistory[0];
  const previousRev = mmHistory[1];
  assert.strictEqual(latestRev.authorName, 'Bboy Seattle');
  assert.strictEqual(latestRev.editSummary, 'Added test founder to founders list');
  console.log(`✓ Revision logged: ID=${latestRev.id} by ${latestRev.authorName} ("${latestRev.editSummary}")`);

  // 4. Test 1-Click Rollback
  console.log(`↺ Performing 1-Click Rollback to revision #${previousRev.id}...`);
  const rolledBack = await rollbackCrew('massive_monkees', previousRev.id, 'Moderator');
  assert(!rolledBack.founders.includes(testFounder), 'Rollback should undo the added founder');
  console.log('✓ Rollback successfully restored previous founder state.');

  // 5. Test Soft-Delete / Archiving
  const dummy = await upsertCrew({
    id: 'grief_target',
    name: 'Grief Target Crew',
    city: 'Chicago, USA',
    year: 2020,
  }, 'Spammer', 'Spam entry');

  const archiveResult = await archiveCrew('grief_target', 'Spam/duplicate entry', 'VigilantBboy');
  assert.strictEqual(archiveResult.isArchived, true);
  const activeCrewsAfterArchive = await getAllCrews(false);
  assert(!activeCrewsAfterArchive.some(c => c.id === 'grief_target'), 'Archived crew should not appear on active map');
  console.log('✓ Soft-delete archiving verified (hidden from map, preserved in database).');

  // 6. Test Un-Archiving / Restoration
  const restored = await restoreCrew('grief_target', 'Restorer');
  assert.strictEqual(restored.isArchived, false);
  const activeAfterRestore = await getAllCrews(false);
  assert(activeAfterRestore.some(c => c.id === 'grief_target'), 'Restored crew should reappear on active map');
  console.log('✓ Un-archiving / restoration verified.');

  // Clean up grief_target via hard delete
  await deleteCrew('grief_target', true);

  // 7. Test Protected Root (Massive Monkees cannot be deleted)
  try {
    await archiveCrew('massive_monkees', 'Accidental delete', 'Griefer');
    assert.fail('Should not be able to archive locked crew');
  } catch (err) {
    assert(err.message.includes('locked'), 'Expected locked error');
    console.log('✓ Protected foundation roots (Massive Monkees) cannot be archived.');
  }

  // 8. Test Global Activity Feed
  const activity = await getGlobalActivity(10);
  assert(activity.length >= 3, 'Activity feed should contain recent actions');
  console.log(`✓ Global activity feed contains ${activity.length} recent events worldwide.`);
  console.log(`  Latest: [${activity[0].action.toUpperCase()}] "${activity[0].crewName}" by ${activity[0].authorName}: "${activity[0].editSummary}"`);

  // Clean up any test founders or test revisions
  const { client } = require('./db.js');
  await client.execute({ sql: 'DELETE FROM founders WHERE crew_id = ? AND name LIKE ?', args: ['massive_monkees', 'Bboy Test%'] });
  await client.execute({ sql: 'DELETE FROM crew_revisions WHERE author_name IN (?, ?, ?)', args: ['Bboy Seattle', 'TestModerator', 'Moderator'] });

  console.log('\n🎉 ALL WIKIPEDIA-STYLE ARCHIVAL & ROLLBACK TESTS PASSED!');
}

runWikiTests().catch(err => {
  console.error('Wiki Test failure:', err);
  process.exit(1);
});
