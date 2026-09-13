const path = require('node:path');
const fs = require('node:fs');
const { createClient } = require('@libsql/client');

// Database configuration:
// 1. Turso Cloud SQLite: When TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set (Render production)
// 2. Persistent Disk / Local SQLite: When DB_PATH is set (e.g., /data/blackbook.db) or local file fallback
const isTurso = Boolean(process.env.TURSO_DATABASE_URL);
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'blackbook.db');

let clientConfig;
if (isTurso) {
  clientConfig = {
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  };
  console.log('⚡ Connected to Turso Cloud SQLite database:', clientConfig.url);
} else {
  const dbDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  clientConfig = {
    url: 'file:' + path.resolve(DB_FILE),
  };
  console.log('💾 Connected to Local SQLite database:', path.resolve(DB_FILE));
}

const client = createClient(clientConfig);

function getDbInfo() {
  return {
    isTurso,
    type: isTurso ? 'Turso Cloud SQLite' : 'Local SQLite',
    storage: isTurso ? 'Turso Remote' : path.resolve(DB_FILE),
  };
}

// Default starter roster (user-curated crews with Bboy Gravity included)
const DEFAULT_CREWS = [
  {
    id: 'massive_monkees',
    name: 'Massive Monkees',
    city: 'Seattle, WA, USA',
    lat: 47.6062,
    lng: -122.3321,
    year: 1999,
    founders: ['J-Sun', 'Smilez', 'Jerome', 'Tim', 'Brysen', 'Thesis', 'Bboy Gravity'],
    parentIds: [
      'crew_1789255058187',
      'crew_1789255084884',
      'crew_1789255464998',
      'crew_1789255481268',
      'crew_1789255900456',
      'crew_1789255952058'
    ],
    childIds: [],
    instagram: '@massivemonkees',
    email: 'info@massivemonkees.com',
    phone: '',
    website: 'https://massivemonkees.com',
    isLocked: true,
  },
  {
    id: 'crew_1789255058187',
    name: 'Universal Style Monkees',
    city: 'Seattle, USA',
    lat: 47.6038321,
    lng: -122.330062,
    year: null,
    founders: [],
    parentIds: [],
    childIds: ['massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255084884',
    name: 'MASSIVE',
    city: 'Seattle',
    lat: 47.6038321,
    lng: -122.330062,
    year: 1999,
    founders: [],
    parentIds: [],
    childIds: ['massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255464998',
    name: 'Premier Crew',
    city: 'Everett, WA',
    lat: 47.9793437,
    lng: -122.2127011,
    year: null,
    founders: [],
    parentIds: [],
    childIds: ['crew_1789255550302', 'massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255481268',
    name: 'Mad Flava',
    city: 'Bellevue, USA',
    lat: 47.6144219,
    lng: -122.192337,
    year: null,
    founders: [],
    parentIds: [],
    childIds: ['crew_1789255672502', 'massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255550302',
    name: 'Floor Hogs',
    city: 'Shoreline, WA',
    lat: 47.7564667,
    lng: -122.3437497,
    year: null,
    founders: [],
    parentIds: ['crew_1789255464998'],
    childIds: [],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255672502',
    name: 'Battle Reflex',
    city: 'Bellevue, WA',
    lat: 47.6144219,
    lng: -122.192337,
    year: null,
    founders: [],
    parentIds: ['crew_1789255481268'],
    childIds: [],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255900456',
    name: 'BOSS',
    city: 'Seattle, WA',
    lat: 47.6062,
    lng: -122.3321,
    year: null,
    founders: [],
    parentIds: [],
    childIds: ['massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
  {
    id: 'crew_1789255952058',
    name: 'DVS',
    city: 'Seattle, WA',
    lat: 47.6062,
    lng: -122.3321,
    year: null,
    founders: [],
    parentIds: [],
    childIds: ['massive_monkees'],
    instagram: '',
    email: '',
    phone: '',
    website: '',
  },
];

/**
 * Initialize Schema and default seeds
 */
let isInitialized = false;
let initPromise = null;

async function initDb() {
  if (isInitialized) return;

  // Schema creation
  await client.execute(`
    CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      lat REAL,
      lng REAL,
      year INTEGER,
      instagram TEXT,
      email TEXT,
      open_for_sessions INTEGER DEFAULT 1,
      notes TEXT,
      is_archived INTEGER DEFAULT 0,
      archive_reason TEXT,
      is_locked INTEGER DEFAULT 0,
      phone TEXT,
      website TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS founders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id TEXT NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_founders_crew ON founders(crew_id);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS crew_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(parent_id, child_id),
      FOREIGN KEY (parent_id) REFERENCES crews(id) ON DELETE CASCADE,
      FOREIGN KEY (child_id) REFERENCES crews(id) ON DELETE CASCADE
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rel_parent ON crew_relationships(parent_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rel_child ON crew_relationships(child_id);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      cached_at TEXT DEFAULT (datetime('now'))
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS crew_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id TEXT NOT NULL,
      action TEXT NOT NULL,
      author_name TEXT DEFAULT 'Anonymous',
      edit_summary TEXT,
      snapshot TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rev_crew ON crew_revisions(crew_id, created_at DESC);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_rev_created ON crew_revisions(created_at DESC);`);

  // Safe migrations for legacy databases
  try { await client.execute('ALTER TABLE crews ADD COLUMN is_archived INTEGER DEFAULT 0;'); } catch (_) {}
  try { await client.execute('ALTER TABLE crews ADD COLUMN archive_reason TEXT;'); } catch (_) {}
  try { await client.execute('ALTER TABLE crews ADD COLUMN is_locked INTEGER DEFAULT 0;'); } catch (_) {}
  try { await client.execute('ALTER TABLE crews ADD COLUMN phone TEXT;'); } catch (_) {}
  try { await client.execute('ALTER TABLE crews ADD COLUMN website TEXT;'); } catch (_) {}

  // Seed default crews if database is brand new
  await seedDefaults(DEFAULT_CREWS);

  isInitialized = true;
}

initPromise = initDb().catch(err => {
  console.error('Database initialization error:', err);
});

async function ensureReady() {
  if (!isInitialized && initPromise) {
    await initPromise;
  }
}

/**
 * Save an immutable snapshot to revision history
 */
async function saveRevision(crewId, action, authorName, editSummary, snapshotObj) {
  await ensureReady();
  const author = (authorName && String(authorName).trim()) || 'Anonymous';
  const summary = (editSummary && String(editSummary).trim()) || (
    action === 'create' ? 'Initial Blackbook entry' :
    action === 'archive' ? 'Archived crew' :
    action === 'restore' ? 'Restored crew from archive' :
    action === 'rollback' ? 'Reverted to earlier revision' :
    'Updated details & lineage'
  );
  const snapshotStr = typeof snapshotObj === 'string' ? snapshotObj : JSON.stringify(snapshotObj);

  return await client.execute({
    sql: `INSERT INTO crew_revisions (crew_id, action, author_name, edit_summary, snapshot)
          VALUES (?, ?, ?, ?, ?);`,
    args: [crewId, action, author, summary, snapshotStr],
  });
}

/**
 * Retrieve all crews with their resolved founders and relationships (heritage & offspring)
 */
async function getAllCrews(includeArchived = false) {
  await ensureReady();
  const query = includeArchived
    ? `SELECT * FROM crews ORDER BY name COLLATE NOCASE ASC;`
    : `SELECT * FROM crews WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC;`;
  const crewsRes = await client.execute(query);
  const crews = crewsRes.rows;
  if (crews.length === 0) return [];

  // Batch query all founders
  const foundersRes = await client.execute(`SELECT crew_id, name FROM founders ORDER BY id ASC;`);
  const foundersMap = {};
  for (const f of foundersRes.rows) {
    if (!foundersMap[f.crew_id]) foundersMap[f.crew_id] = [];
    foundersMap[f.crew_id].push(f.name);
  }

  // Batch query all relationships
  const relQuery = includeArchived
    ? `SELECT parent_id, child_id FROM crew_relationships;`
    : `SELECT r.parent_id, r.child_id
       FROM crew_relationships r
       JOIN crews p ON r.parent_id = p.id AND p.is_archived = 0
       JOIN crews c ON r.child_id = c.id AND c.is_archived = 0;`;
  const relRes = await client.execute(relQuery);
  const parentMap = {}; // crew_id -> array of parent_ids (Heritage)
  const childMap = {};  // crew_id -> array of child_ids (Offspring)

  for (const r of relRes.rows) {
    if (!parentMap[r.child_id]) parentMap[r.child_id] = [];
    parentMap[r.child_id].push(r.parent_id);

    if (!childMap[r.parent_id]) childMap[r.parent_id] = [];
    childMap[r.parent_id].push(r.child_id);
  }

  return crews.map(c => ({
    id: c.id,
    name: c.name,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    year: c.year,
    founders: foundersMap[c.id] || [],
    parentIds: parentMap[c.id] || [],
    childIds: childMap[c.id] || [],
    instagram: c.instagram || '',
    email: c.email || '',
    phone: c.phone || '',
    website: c.website || '',
    notes: c.notes || '',
    isArchived: Boolean(c.is_archived),
    archiveReason: c.archive_reason || '',
    isLocked: Boolean(c.is_locked),
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

/**
 * Get a single crew by ID with full lineage
 */
async function getCrewById(id, includeArchived = true) {
  await ensureReady();
  const crewRes = await client.execute({
    sql: `SELECT * FROM crews WHERE id = ?;`,
    args: [id],
  });
  const crew = crewRes.rows[0];
  if (!crew) return null;
  if (!includeArchived && crew.is_archived) return null;

  const foundersRes = await client.execute({
    sql: `SELECT name FROM founders WHERE crew_id = ? ORDER BY id ASC;`,
    args: [id],
  });
  const founders = foundersRes.rows.map(f => f.name);

  const parentsRes = await client.execute({
    sql: `SELECT parent_id FROM crew_relationships WHERE child_id = ?;`,
    args: [id],
  });
  const parents = parentsRes.rows.map(r => r.parent_id);

  const childrenRes = await client.execute({
    sql: `SELECT child_id FROM crew_relationships WHERE parent_id = ?;`,
    args: [id],
  });
  const children = childrenRes.rows.map(r => r.child_id);

  return {
    id: crew.id,
    name: crew.name,
    city: crew.city,
    lat: crew.lat,
    lng: crew.lng,
    year: crew.year,
    founders,
    parentIds: parents,
    childIds: children,
    instagram: crew.instagram || '',
    email: crew.email || '',
    phone: crew.phone || '',
    website: crew.website || '',
    notes: crew.notes || '',
    isArchived: Boolean(crew.is_archived),
    archiveReason: crew.archive_reason || '',
    isLocked: Boolean(crew.is_locked),
    createdAt: crew.created_at,
    updatedAt: crew.updated_at,
  };
}

/**
 * Retrieve revision history for a crew
 */
async function getCrewHistory(crewId) {
  await ensureReady();
  const res = await client.execute({
    sql: `SELECT id, crew_id, action, author_name, edit_summary, snapshot, created_at
          FROM crew_revisions
          WHERE crew_id = ?
          ORDER BY id DESC;`,
    args: [crewId],
  });

  return res.rows.map(r => {
    let preview = null;
    try {
      const snap = JSON.parse(r.snapshot);
      preview = {
        name: snap.name,
        city: snap.city,
        year: snap.year,
        foundersCount: Array.isArray(snap.founders) ? snap.founders.length : 0,
        heritageCount: Array.isArray(snap.parentIds) ? snap.parentIds.length : 0,
        offspringCount: Array.isArray(snap.childIds) ? snap.childIds.length : 0,
      };
    } catch (_) {}

    return {
      id: r.id,
      crewId: r.crew_id,
      action: r.action,
      authorName: r.author_name,
      editSummary: r.edit_summary,
      createdAt: r.created_at,
      preview,
    };
  });
}

/**
 * Upsert crew (insert or update) inside an ACID transaction + log revision
 */
async function upsertCrew(crewData, authorName = 'Anonymous', editSummary = '', actionOverride = null) {
  await ensureReady();
  const {
    id,
    name,
    city,
    lat,
    lng,
    year,
    founders = [],
    parentIds = [],
    childIds = [],
    instagram = '',
    email = '',
    phone = '',
    website = '',
    notes = '',
    isLocked = false,
  } = crewData;

  const targetId = id || ('crew_' + Date.now());

  const tx = await client.transaction('write');
  try {
    const existingRes = await tx.execute({
      sql: `SELECT id, is_locked FROM crews WHERE id = ?;`,
      args: [targetId],
    });
    const existing = existingRes.rows[0];

    if (existing) {
      await tx.execute({
        sql: `UPDATE crews
              SET name = ?, city = ?, lat = ?, lng = ?, year = ?, instagram = ?, email = ?, phone = ?, website = ?, open_for_sessions = 1, notes = ?, is_archived = 0, archive_reason = NULL, updated_at = datetime('now')
              WHERE id = ?;`,
        args: [
          name,
          city,
          lat != null ? Number(lat) : null,
          lng != null ? Number(lng) : null,
          year != null ? parseInt(year) : null,
          instagram || '',
          email || '',
          phone || '',
          website || '',
          notes || '',
          targetId,
        ],
      });
    } else {
      await tx.execute({
        sql: `INSERT INTO crews (id, name, city, lat, lng, year, instagram, email, phone, website, open_for_sessions, notes, is_locked)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);`,
        args: [
          targetId,
          name,
          city,
          lat != null ? Number(lat) : null,
          lng != null ? Number(lng) : null,
          year != null ? parseInt(year) : null,
          instagram || '',
          email || '',
          phone || '',
          website || '',
          notes || '',
          isLocked ? 1 : 0,
        ],
      });
    }

    // 1. Sync founders
    await tx.execute({
      sql: `DELETE FROM founders WHERE crew_id = ?;`,
      args: [targetId],
    });
    if (Array.isArray(founders) && founders.length > 0) {
      for (const f of founders) {
        if (f && String(f).trim()) {
          await tx.execute({
            sql: `INSERT INTO founders (crew_id, name) VALUES (?, ?);`,
            args: [targetId, String(f).trim()],
          });
        }
      }
    }

    // 2. Sync Heritage (Parent relationships where this crew is child)
    await tx.execute({
      sql: `DELETE FROM crew_relationships WHERE child_id = ?;`,
      args: [targetId],
    });
    if (Array.isArray(parentIds) && parentIds.length > 0) {
      for (const pid of parentIds) {
        if (pid && pid !== targetId) {
          const checkCrew = await tx.execute({
            sql: `SELECT id FROM crews WHERE id = ?;`,
            args: [pid],
          });
          if (checkCrew.rows.length > 0) {
            await tx.execute({
              sql: `INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`,
              args: [pid, targetId],
            });
          }
        }
      }
    }

    // 3. Sync Offspring (Child relationships where this crew is parent)
    await tx.execute({
      sql: `DELETE FROM crew_relationships WHERE parent_id = ?;`,
      args: [targetId],
    });
    if (Array.isArray(childIds) && childIds.length > 0) {
      for (const cid of childIds) {
        if (cid && cid !== targetId) {
          const checkCrew = await tx.execute({
            sql: `SELECT id FROM crews WHERE id = ?;`,
            args: [cid],
          });
          if (checkCrew.rows.length > 0) {
            await tx.execute({
              sql: `INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`,
              args: [targetId, cid],
            });
          }
        }
      }
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  const updatedCrew = await getCrewById(targetId);

  // Record Revision Snapshot
  const action = actionOverride || (crewData.id ? 'edit' : 'create');
  await saveRevision(targetId, action, authorName, editSummary, updatedCrew);

  return updatedCrew;
}

/**
 * 1-Click Rollback: Restore a crew to an exact past revision snapshot
 */
async function rollbackCrew(crewId, revisionId, authorName = 'Anonymous') {
  await ensureReady();
  const res = await client.execute({
    sql: `SELECT * FROM crew_revisions WHERE id = ? AND crew_id = ?;`,
    args: [revisionId, crewId],
  });
  const rev = res.rows[0];
  if (!rev) {
    throw new Error(`Revision #${revisionId} not found for crew ${crewId}`);
  }

  let snapshot;
  try {
    snapshot = JSON.parse(rev.snapshot);
  } catch (err) {
    throw new Error(`Corrupted revision snapshot: ${err.message}`);
  }

  const summary = `Reverted to revision #${revisionId} (${rev.action} by ${rev.author_name})`;
  return await upsertCrew(snapshot, authorName, summary, 'rollback');
}

/**
 * Soft-delete / Archive a crew
 */
async function archiveCrew(crewId, reason = 'Archived by community', authorName = 'Anonymous') {
  await ensureReady();
  const crew = await getCrewById(crewId);
  if (!crew) throw new Error('Crew not found');
  if (crew.isLocked) {
    throw new Error('This foundational heritage root is locked from removal.');
  }

  await client.execute({
    sql: `UPDATE crews
          SET is_archived = 1, archive_reason = ?, updated_at = datetime('now')
          WHERE id = ?;`,
    args: [reason || 'Archived', crewId],
  });

  await saveRevision(crewId, 'archive', authorName, reason, crew);
  return { success: true, id: crewId, isArchived: true };
}

/**
 * Restore an archived crew back onto the live map
 */
async function restoreCrew(crewId, authorName = 'Anonymous') {
  await ensureReady();
  const crew = await getCrewById(crewId, true);
  if (!crew) throw new Error('Crew not found');

  await client.execute({
    sql: `UPDATE crews
          SET is_archived = 0, archive_reason = NULL, updated_at = datetime('now')
          WHERE id = ?;`,
    args: [crewId],
  });

  const restored = await getCrewById(crewId);
  await saveRevision(crewId, 'restore', authorName, 'Restored from archive', restored);
  return restored;
}

/**
 * Hard delete (admin purge)
 */
async function deleteCrew(id, hardDelete = false, authorName = 'Anonymous', reason = '') {
  await ensureReady();
  if (!hardDelete) {
    return await archiveCrew(id, reason, authorName);
  }

  const tx = await client.transaction('write');
  try {
    await tx.execute({
      sql: `DELETE FROM crew_relationships WHERE parent_id = ? OR child_id = ?;`,
      args: [id, id],
    });
    await tx.execute({
      sql: `DELETE FROM founders WHERE crew_id = ?;`,
      args: [id],
    });
    await tx.execute({
      sql: `DELETE FROM crew_revisions WHERE crew_id = ?;`,
      args: [id],
    });
    const res = await tx.execute({
      sql: `DELETE FROM crews WHERE id = ?;`,
      args: [id],
    });
    await tx.commit();
    return res;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Global Activity Feed
 */
async function getGlobalActivity(limit = 40) {
  await ensureReady();
  const res = await client.execute({
    sql: `SELECT r.id, r.crew_id, r.action, r.author_name, r.edit_summary, r.created_at,
                 c.name AS crew_name, c.city AS crew_city, c.is_archived
          FROM crew_revisions r
          LEFT JOIN crews c ON r.crew_id = c.id
          ORDER BY r.id DESC
          LIMIT ?;`,
    args: [limit],
  });

  return res.rows.map(r => ({
    revisionId: r.id,
    crewId: r.crew_id,
    crewName: r.crew_name || r.crew_id,
    crewCity: r.crew_city || '',
    action: r.action,
    authorName: r.author_name || 'Anonymous',
    editSummary: r.edit_summary || '',
    isArchived: Boolean(r.is_archived),
    timestamp: r.created_at,
  }));
}

/**
 * Geocode caching
 */
async function getCachedGeocode(query) {
  if (!query) return null;
  await ensureReady();
  const key = query.trim().toLowerCase();
  const res = await client.execute({
    sql: `SELECT lat, lng FROM geocode_cache WHERE query = ?;`,
    args: [key],
  });
  const row = res.rows[0];
  return row ? { lat: row.lat, lng: row.lng } : null;
}

async function setCachedGeocode(query, lat, lng) {
  if (!query || lat == null || lng == null) return;
  await ensureReady();
  const key = query.trim().toLowerCase();
  await client.execute({
    sql: `INSERT OR REPLACE INTO geocode_cache (query, lat, lng) VALUES (?, ?, ?);`,
    args: [key, Number(lat), Number(lng)],
  });
}

/**
 * Network stats
 */
async function getStats() {
  await ensureReady();
  const totalCrewsRes = await client.execute(`SELECT COUNT(*) AS count FROM crews WHERE is_archived = 0;`);
  const totalArchivedRes = await client.execute(`SELECT COUNT(*) AS count FROM crews WHERE is_archived = 1;`);
  const totalRelsRes = await client.execute(`SELECT COUNT(*) AS count FROM crew_relationships;`);
  const totalCitiesRes = await client.execute(`SELECT COUNT(DISTINCT city) AS count FROM crews WHERE is_archived = 0;`);
  const totalRevisionsRes = await client.execute(`SELECT COUNT(*) AS count FROM crew_revisions;`);

  const oldestRes = await client.execute(`SELECT name, year, city FROM crews WHERE is_archived = 0 AND year IS NOT NULL ORDER BY year ASC LIMIT 3;`);
  const mostOffspringRes = await client.execute(`
    SELECT c.id, c.name, COUNT(r.child_id) as offspring_count
    FROM crews c
    JOIN crew_relationships r ON c.id = r.parent_id
    WHERE c.is_archived = 0
    GROUP BY c.id
    ORDER BY offspring_count DESC
    LIMIT 5;
  `);

  return {
    totalCrews: totalCrewsRes.rows[0].count,
    totalArchived: totalArchivedRes.rows[0].count,
    totalRelationships: totalRelsRes.rows[0].count,
    totalCities: totalCitiesRes.rows[0].count,
    totalRevisions: totalRevisionsRes.rows[0].count,
    oldestCrews: oldestRes.rows,
    topLineageRoots: mostOffspringRes.rows,
  };
}

/**
 * Seed initial sample crews if database is brand new
 */
async function seedDefaults(sampleCrews) {
  const countRes = await client.execute(`SELECT COUNT(*) AS count FROM crews;`);
  const count = countRes.rows[0].count;
  if (count > 0) {
    // Ensure massive_monkees has is_locked set to 1
    await client.execute(`UPDATE crews SET is_locked = 1 WHERE id = 'massive_monkees';`);
    return false;
  }

  console.log('⚡ Empty database detected. Seeding default Blackbook crews...');
  const tx = await client.transaction('write');
  try {
    for (const c of sampleCrews) {
      await tx.execute({
        sql: `INSERT INTO crews (id, name, city, lat, lng, year, instagram, email, open_for_sessions, is_locked)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        args: [
          c.id,
          c.name,
          c.city,
          c.lat,
          c.lng,
          c.year,
          c.instagram || '',
          c.email || '',
          c.openForSessions ? 1 : 0,
          c.isLocked ? 1 : 0,
        ],
      });

      if (Array.isArray(c.founders)) {
        for (const f of c.founders) {
          await tx.execute({
            sql: `INSERT INTO founders (crew_id, name) VALUES (?, ?);`,
            args: [c.id, f],
          });
        }
      }
    }

    // Establish relationships
    for (const c of sampleCrews) {
      if (Array.isArray(c.parentIds)) {
        for (const pid of c.parentIds) {
          await tx.execute({
            sql: `INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`,
            args: [pid, c.id],
          });
        }
      }
      if (Array.isArray(c.childIds)) {
        for (const cid of c.childIds) {
          await tx.execute({
            sql: `INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`,
            args: [c.id, cid],
          });
        }
      }
    }

    await tx.commit();

    // Record initial revision history for default crews
    for (const c of sampleCrews) {
      const saved = await getCrewById(c.id);
      await saveRevision(c.id, 'create', 'Blackbook Genesis', 'Foundational roster import', saved);
    }

    console.log(`✅ Successfully seeded ${sampleCrews.length} default crews into database!`);
    return true;
  } catch (err) {
    await tx.rollback();
    console.error('Failed to seed default crews:', err);
    throw err;
  }
}

module.exports = {
  client,
  DEFAULT_CREWS,
  getDbInfo,
  initDb,
  getAllCrews,
  getCrewById,
  getCrewHistory,
  saveRevision,
  rollbackCrew,
  archiveCrew,
  restoreCrew,
  upsertCrew,
  deleteCrew,
  getGlobalActivity,
  getCachedGeocode,
  setCachedGeocode,
  getStats,
  seedDefaults,
};
