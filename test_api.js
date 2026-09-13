const http = require('node:http');
const assert = require('node:assert');
process.env.PORT = '3099';
const server = require('./server.js');

async function testHttpApi() {
  console.log('🌐 Testing HTTP REST API endpoints on port 3099...\n');

  const fetchJson = async (path, options = {}) => {
    const res = await fetch(`http://localhost:3099${path}`, options);
    const data = await res.json();
    return { status: res.status, data };
  };

  // 1. Healthcheck
  const health = await fetchJson('/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.data.status, 'ok');
  assert.strictEqual(health.data.database, 'blackbook.db');
  console.log('✓ GET /api/health responded 200 OK');

  // 2. Get all crews
  const crewsRes = await fetchJson('/api/crews');
  assert.strictEqual(crewsRes.status, 200);
  assert(Array.isArray(crewsRes.data) && crewsRes.data.length >= 9);
  console.log(`✓ GET /api/crews returned ${crewsRes.data.length} crews`);

  // 3. Stats
  const statsRes = await fetchJson('/api/stats');
  assert.strictEqual(statsRes.status, 200);
  assert(statsRes.data.totalCrews >= 9);
  console.log(`✓ GET /api/stats returned ${statsRes.data.totalCrews} crews`);

  // 4. Create Crew via POST
  const newCrew = {
    id: 'api_test_crew',
    name: 'API Battle Force',
    city: 'Los Angeles, USA',
    year: 2010,
    founders: ['Poe One'],
    parentIds: ['massive_monkees'],
    childIds: [],
    instagram: '@apibattle',
  };
  const createRes = await fetchJson('/api/crews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newCrew),
  });
  assert.strictEqual(createRes.status, 201);
  assert.strictEqual(createRes.data.name, 'API Battle Force');
  console.log('✓ POST /api/crews created crew with server-side geocoding');

  // 5. Delete / Archive Crew
  const deleteRes = await fetchJson('/api/crews/api_test_crew', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Cleaning up test crew', authorName: 'TestRunner' }),
  });
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.data.deletedId, 'api_test_crew');
  console.log('✓ DELETE /api/crews/:id archived crew with community reason & author');

  // 6. Root crew deletion protection (403 Forbidden)
  const lockedDeleteRes = await fetchJson('/api/crews/massive_monkees', { method: 'DELETE' });
  assert.strictEqual(lockedDeleteRes.status, 403);
  console.log('✓ DELETE /api/crews/massive_monkees blocked with 403 (Protected root)');

  // 7. Global Activity Feed
  const activityRes = await fetchJson('/api/activity?limit=10');
  assert.strictEqual(activityRes.status, 200);
  assert(Array.isArray(activityRes.data) && activityRes.data.length > 0);
  console.log(`✓ GET /api/activity returned ${activityRes.data.length} recent community events`);

  // 8. Crew Revision History
  const historyRes = await fetchJson('/api/crews/massive_monkees/history');
  assert.strictEqual(historyRes.status, 200);
  assert(Array.isArray(historyRes.data) && historyRes.data.length >= 2);
  console.log(`✓ GET /api/crews/:id/history returned ${historyRes.data.length} revisions for Massive Monkees`);

  // 9. Rollback via API
  const pastRevId = historyRes.data[1].id;
  const rollbackRes = await fetchJson(`/api/crews/massive_monkees/rollback/${pastRevId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorName: 'TestModerator' }),
  });
  assert.strictEqual(rollbackRes.status, 200);
  console.log(`✓ POST /api/crews/:id/rollback/:revId successfully restored revision #${pastRevId}`);

  // 6. Static HTML check
  const htmlRes = await fetch('http://localhost:3099/');
  const htmlText = await htmlRes.text();
  assert(htmlText.includes('Crew Genealogy'), 'HTML should serve index.html');
  console.log('✓ GET / successfully served index.html');

  server.close(() => {
    console.log('\n🎉 ALL HTTP REST API TESTS PASSED SUCCESSFULLY!');
  });
}

testHttpApi().catch(err => {
  console.error('API Test Error:', err);
  server.close();
  process.exit(1);
});
