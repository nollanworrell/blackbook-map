const assert = require('node:assert');
const {
  getAllCrews,
  getCrewById,
  upsertCrew,
  deleteCrew,
  getCachedGeocode,
  setCachedGeocode,
  getStats,
} = require('./db.js');

console.log('🧪 Starting Backend & Database Tests...\n');

// 1. Check seeded crews
const initialCrews = getAllCrews();
console.log(`✓ Database contains ${initialCrews.length} seeded crews.`);
assert(initialCrews.length >= 10, 'Expected at least 10 seeded crews');

// 2. Check Massive Monkees exists and has RSC as Heritage
const mm = initialCrews.find(c => c.name === 'Massive Monkees');
assert(mm, 'Massive Monkees should be in the database');
console.log(`✓ Massive Monkees found: city=${mm.city}, heritage=${mm.parentIds.join(', ')}`);
assert(mm.parentIds.includes('rsc'), 'Massive Monkees should have RSC as Heritage');

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

const saved = upsertCrew(testCrew);
assert.strictEqual(saved.name, 'Blackbook Test Crew');
assert.strictEqual(saved.founders.length, 2);
assert(saved.parentIds.includes('massive_monkees'), 'Should have massive_monkees as heritage');
console.log('✓ Crew insertion and founder association passed.');

// 4. Test Reciprocal Lineage Query
const mmUpdated = getCrewById('massive_monkees');
assert(mmUpdated.childIds.includes('test_crew_99'), 'Massive Monkees offspring should now include test_crew_99');
console.log('✓ Bidirectional lineage synchronization passed.');

// 5. Test Geocode Cache
setCachedGeocode('Seattle, WA', 47.6062, -122.3321);
const cachedGeo = getCachedGeocode('Seattle, WA');
assert(cachedGeo && cachedGeo.lat === 47.6062, 'Geocode cache should retrieve stored coordinates');
console.log('✓ SQLite Geocode caching passed.');

// 6. Test Stats
const stats = getStats();
console.log(`✓ Database Stats: ${stats.totalCrews} crews, ${stats.totalRelationships} relationships, ${stats.totalCities} cities.`);
assert(stats.totalCrews >= 11, 'Stats total crews check');

// 7. Test Deletion
deleteCrew('test_crew_99');
const deletedCheck = getCrewById('test_crew_99');
assert.strictEqual(deletedCheck, null, 'Deleted crew should not exist');
const mmAfterDelete = getCrewById('massive_monkees');
assert(!mmAfterDelete.childIds.includes('test_crew_99'), 'Offspring should be cleaned up on delete');
console.log('✓ Cascade deletion and relationship cleanup passed.');

console.log('\n🎉 ALL BACKEND & DATABASE TESTS PASSED SUCCESSFULLY!');
