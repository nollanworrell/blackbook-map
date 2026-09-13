const assert = require('node:assert');
const {
  getAllCrews,
  getCrewById,
  upsertCrew,
  deleteCrew,
  getCachedGeocode,
  setCachedGeocode,
  getStats,
  getDbInfo,
} = require('./db.js');

async function runTests() {
  console.log('🧪 Starting Backend & Database Tests...\n');
  console.log('DB Engine:', getDbInfo().type);

  // 1. Check seeded crews
  const initialCrews = await getAllCrews();
  console.log(`✓ Database contains ${initialCrews.length} seeded crews.`);
  assert(initialCrews.length >= 9, 'Expected at least 9 seeded crews');

  // 2. Check Massive Monkees exists and has Bboy Gravity
  const mm = initialCrews.find(c => c.name === 'Massive Monkees');
  assert(mm, 'Massive Monkees should be in the database');
  console.log(`✓ Massive Monkees found: city=${mm.city}, heritage=${mm.parentIds.join(', ')}`);
  assert(mm.founders.includes('Bboy Gravity'), 'Massive Monkees should include Bboy Gravity');

  // 3. Test Upserting a new test crew
  const testCrew = {
    id: 'test_crew_99',
    name: 'Blackbook Test Crew',
    city: 'Seattle, WA, USA',
    lat: 47.6062,
    lng: -122.3321,
    year: 2024,
    founders: ['Bboy Alpha', 'Bboy Omega'],
    parentIds: ['massive_monkees'],
    childIds: [],
    instagram: '@testcrew',
    email: 'test@blackbook.map',
    openForSessions: true,
  };

  const saved = await upsertCrew(testCrew, 'Tester', 'Adding test crew');
  assert.strictEqual(saved.name, 'Blackbook Test Crew');
  assert.strictEqual(saved.founders.length, 2);
  assert(saved.parentIds.includes('massive_monkees'), 'Should have massive_monkees as heritage');
  console.log('✓ Crew insertion and founder association passed.');

  // 4. Test Reciprocal Lineage Query
  const mmUpdated = await getCrewById('massive_monkees');
  assert(mmUpdated.childIds.includes('test_crew_99'), 'Massive Monkees offspring should now include test_crew_99');
  console.log('✓ Bidirectional lineage synchronization passed.');

  // 5. Test Geocode Cache
  await setCachedGeocode('Seattle, WA', 47.6062, -122.3321);
  const cachedGeo = await getCachedGeocode('Seattle, WA');
  assert(cachedGeo && cachedGeo.lat === 47.6062, 'Geocode cache should retrieve stored coordinates');
  console.log('✓ Geocode caching passed.');

  // 6. Test Stats
  const stats = await getStats();
  console.log(`✓ Database Stats: ${stats.totalCrews} crews, ${stats.totalRelationships} relationships, ${stats.totalCities} cities.`);
  assert(stats.totalCrews >= 10, 'Stats total crews check');

  // 7. Test Deletion (Hard Delete for test cleanup)
  await deleteCrew('test_crew_99', true);
  const deletedCheck = await getCrewById('test_crew_99');
  assert.strictEqual(deletedCheck, null, 'Deleted crew should not exist');
  const mmAfterDelete = await getCrewById('massive_monkees');
  assert(!mmAfterDelete.childIds.includes('test_crew_99'), 'Offspring should be cleaned up on delete');
  console.log('✓ Cascade deletion and relationship cleanup passed.');

  console.log('\n🎉 ALL BACKEND & DATABASE TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
