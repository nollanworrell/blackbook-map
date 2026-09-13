const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

// Database file stored in project root (or cloud persistent mount via DB_PATH)
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'blackbook.db');
const db = new DatabaseSync(DB_FILE);

// Enable WAL mode for high-performance concurrent reads & writes
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize Relational Schema
db.exec(`
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS founders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crew_id TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (crew_id) REFERENCES crews(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_founders_crew ON founders(crew_id);

  CREATE TABLE IF NOT EXISTS crew_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id TEXT NOT NULL,
    child_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(parent_id, child_id),
    FOREIGN KEY (parent_id) REFERENCES crews(id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES crews(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_rel_parent ON crew_relationships(parent_id);
  CREATE INDEX IF NOT EXISTS idx_rel_child ON crew_relationships(child_id);

  CREATE TABLE IF NOT EXISTS geocode_cache (
    query TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    cached_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS crew_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crew_id TEXT NOT NULL,
    action TEXT NOT NULL,
    author_name TEXT DEFAULT 'Anonymous',
    edit_summary TEXT,
    snapshot TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rev_crew ON crew_revisions(crew_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rev_created ON crew_revisions(created_at DESC);
`);

// Safe incremental migrations for existing databases
try { db.exec('ALTER TABLE crews ADD COLUMN is_archived INTEGER DEFAULT 0;'); } catch (_) {}
try { db.exec('ALTER TABLE crews ADD COLUMN archive_reason TEXT;'); } catch (_) {}
try { db.exec('ALTER TABLE crews ADD COLUMN is_locked INTEGER DEFAULT 0;'); } catch (_) {}
try { db.exec('ALTER TABLE crews ADD COLUMN phone TEXT;'); } catch (_) {}
try { db.exec('ALTER TABLE crews ADD COLUMN website TEXT;'); } catch (_) {}

/**
 * Save an immutable snapshot to revision history
 */
function saveRevision(crewId, action, authorName, editSummary, snapshotObj) {
  const author = (authorName && String(authorName).trim()) || 'Anonymous';
  const summary = (editSummary && String(editSummary).trim()) || (
    action === 'create' ? 'Initial Blackbook entry' :
    action === 'archive' ? 'Archived crew' :
    action === 'restore' ? 'Restored crew from archive' :
    action === 'rollback' ? 'Reverted to earlier revision' :
    'Updated details & lineage'
  );
  const snapshotStr = typeof snapshotObj === 'string' ? snapshotObj : JSON.stringify(snapshotObj);

  const stmt = db.prepare(`
    INSERT INTO crew_revisions (crew_id, action, author_name, edit_summary, snapshot)
    VALUES (?, ?, ?, ?, ?);
  `);
  return stmt.run(crewId, action, author, summary, snapshotStr);
}

/**
 * Retrieve all crews with their resolved founders and relationships (heritage & offspring)
 */
function getAllCrews(includeArchived = false) {
  const query = includeArchived
    ? `SELECT * FROM crews ORDER BY name COLLATE NOCASE ASC;`
    : `SELECT * FROM crews WHERE is_archived = 0 ORDER BY name COLLATE NOCASE ASC;`;
  const crews = db.prepare(query).all();
  if (crews.length === 0) return [];

  // Batch query all founders
  const foundersList = db.prepare(`SELECT crew_id, name FROM founders ORDER BY id ASC;`).all();
  const foundersMap = {};
  for (const f of foundersList) {
    if (!foundersMap[f.crew_id]) foundersMap[f.crew_id] = [];
    foundersMap[f.crew_id].push(f.name);
  }

  // Batch query all relationships (only between active crews unless includeArchived is true)
  const relQuery = includeArchived
    ? `SELECT parent_id, child_id FROM crew_relationships;`
    : `SELECT r.parent_id, r.child_id
       FROM crew_relationships r
       JOIN crews p ON r.parent_id = p.id AND p.is_archived = 0
       JOIN crews c ON r.child_id = c.id AND c.is_archived = 0;`;
  const relationships = db.prepare(relQuery).all();
  const parentMap = {}; // crew_id -> array of parent_ids (Heritage)
  const childMap = {};  // crew_id -> array of child_ids (Offspring)

  for (const r of relationships) {
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
    parentIds: parentMap[c.id] || [], // Heritage
    childIds: childMap[c.id] || [],   // Offspring
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
function getCrewById(id, includeArchived = true) {
  const crew = db.prepare(`SELECT * FROM crews WHERE id = ?;`).get(id);
  if (!crew) return null;
  if (!includeArchived && crew.is_archived) return null;

  const founders = db.prepare(`SELECT name FROM founders WHERE crew_id = ? ORDER BY id ASC;`).all(id).map(f => f.name);
  const parents = db.prepare(`SELECT parent_id FROM crew_relationships WHERE child_id = ?;`).all(id).map(r => r.parent_id);
  const children = db.prepare(`SELECT child_id FROM crew_relationships WHERE parent_id = ?;`).all(id).map(r => r.child_id);

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
function getCrewHistory(crewId) {
  const rows = db.prepare(`
    SELECT id, crew_id, action, author_name, edit_summary, snapshot, created_at
    FROM crew_revisions
    WHERE crew_id = ?
    ORDER BY id DESC;
  `).all(crewId);

  return rows.map(r => {
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
function upsertCrew(crewData, authorName = 'Anonymous', editSummary = '', actionOverride = null) {
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

  db.exec('BEGIN IMMEDIATE;');
  try {
    const existing = db.prepare(`SELECT id, is_locked FROM crews WHERE id = ?;`).get(targetId);

    if (existing) {
      db.prepare(`
        UPDATE crews
        SET name = ?, city = ?, lat = ?, lng = ?, year = ?, instagram = ?, email = ?, phone = ?, website = ?, open_for_sessions = 1, notes = ?, is_archived = 0, archive_reason = NULL, updated_at = datetime('now')
        WHERE id = ?;
      `).run(
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
        targetId
      );
    } else {
      db.prepare(`
        INSERT INTO crews (id, name, city, lat, lng, year, instagram, email, phone, website, open_for_sessions, notes, is_locked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
      `).run(
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
        isLocked ? 1 : 0
      );
    }

    // 1. Sync founders
    db.prepare(`DELETE FROM founders WHERE crew_id = ?;`).run(targetId);
    if (Array.isArray(founders) && founders.length > 0) {
      const insertFounder = db.prepare(`INSERT INTO founders (crew_id, name) VALUES (?, ?);`);
      for (const f of founders) {
        if (f && String(f).trim()) {
          insertFounder.run(targetId, String(f).trim());
        }
      }
    }

    // 2. Sync Heritage (Parent relationships where this crew is child)
    db.prepare(`DELETE FROM crew_relationships WHERE child_id = ?;`).run(targetId);
    if (Array.isArray(parentIds) && parentIds.length > 0) {
      const checkCrew = db.prepare(`SELECT id FROM crews WHERE id = ?;`);
      const insertRel = db.prepare(`INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`);
      for (const pid of parentIds) {
        if (pid && pid !== targetId && checkCrew.get(pid)) {
          insertRel.run(pid, targetId);
        }
      }
    }

    // 3. Sync Offspring (Child relationships where this crew is parent)
    db.prepare(`DELETE FROM crew_relationships WHERE parent_id = ?;`).run(targetId);
    if (Array.isArray(childIds) && childIds.length > 0) {
      const checkCrew = db.prepare(`SELECT id FROM crews WHERE id = ?;`);
      const insertRel = db.prepare(`INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`);
      for (const cid of childIds) {
        if (cid && cid !== targetId && checkCrew.get(cid)) {
          insertRel.run(targetId, cid);
        }
      }
    }

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const updatedCrew = getCrewById(targetId);

  // Record Revision Snapshot
  const action = actionOverride || (crewData.id ? 'edit' : 'create');
  saveRevision(targetId, action, authorName, editSummary, updatedCrew);

  return updatedCrew;
}

/**
 * 1-Click Rollback: Restore a crew to an exact past revision snapshot
 */
function rollbackCrew(crewId, revisionId, authorName = 'Anonymous') {
  const rev = db.prepare(`SELECT * FROM crew_revisions WHERE id = ? AND crew_id = ?;`).get(revisionId, crewId);
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
  return upsertCrew(snapshot, authorName, summary, 'rollback');
}

/**
 * Soft-delete / Archive a crew (Wikipedia-style removal with rollback ability)
 */
function archiveCrew(crewId, reason = 'Archived by community', authorName = 'Anonymous') {
  const crew = getCrewById(crewId);
  if (!crew) throw new Error('Crew not found');
  if (crew.isLocked) {
    throw new Error('This foundational heritage root is locked from removal.');
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      UPDATE crews
      SET is_archived = 1, archive_reason = ?, updated_at = datetime('now')
      WHERE id = ?;
    `).run(reason || 'Archived', crewId);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  saveRevision(crewId, 'archive', authorName, reason, crew);
  return { success: true, id: crewId, isArchived: true };
}

/**
 * Restore an archived crew back onto the live map
 */
function restoreCrew(crewId, authorName = 'Anonymous') {
  const crew = getCrewById(crewId, true);
  if (!crew) throw new Error('Crew not found');

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`
      UPDATE crews
      SET is_archived = 0, archive_reason = NULL, updated_at = datetime('now')
      WHERE id = ?;
    `).run(crewId);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const restored = getCrewById(crewId);
  saveRevision(crewId, 'restore', authorName, 'Restored from archive', restored);
  return restored;
}

/**
 * Hard delete (admin purge)
 */
function deleteCrew(id, hardDelete = false, authorName = 'Anonymous', reason = '') {
  if (!hardDelete) {
    return archiveCrew(id, reason, authorName);
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(`DELETE FROM crew_relationships WHERE parent_id = ? OR child_id = ?;`).run(id, id);
    db.prepare(`DELETE FROM founders WHERE crew_id = ?;`).run(id);
    db.prepare(`DELETE FROM crew_revisions WHERE crew_id = ?;`).run(id);
    const res = db.prepare(`DELETE FROM crews WHERE id = ?;`).run(id);
    db.exec('COMMIT;');
    return res;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Global Activity Feed: latest edits made across the entire worldwide Blackbook
 */
function getGlobalActivity(limit = 40) {
  const rows = db.prepare(`
    SELECT r.id, r.crew_id, r.action, r.author_name, r.edit_summary, r.created_at,
           c.name AS crew_name, c.city AS crew_city, c.is_archived
    FROM crew_revisions r
    LEFT JOIN crews c ON r.crew_id = c.id
    ORDER BY r.id DESC
    LIMIT ?;
  `).all(limit);

  return rows.map(r => ({
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
 * Geocode caching in SQLite
 */
function getCachedGeocode(query) {
  if (!query) return null;
  const key = query.trim().toLowerCase();
  const row = db.prepare(`SELECT lat, lng FROM geocode_cache WHERE query = ?;`).get(key);
  return row ? { lat: row.lat, lng: row.lng } : null;
}

function setCachedGeocode(query, lat, lng) {
  if (!query || lat == null || lng == null) return;
  const key = query.trim().toLowerCase();
  db.prepare(`INSERT OR REPLACE INTO geocode_cache (query, lat, lng) VALUES (?, ?, ?);`).run(key, Number(lat), Number(lng));
}

/**
 * Network stats for analytics and dashboard
 */
function getStats() {
  const totalCrews = db.prepare(`SELECT COUNT(*) AS count FROM crews WHERE is_archived = 0;`).get().count;
  const totalArchived = db.prepare(`SELECT COUNT(*) AS count FROM crews WHERE is_archived = 1;`).get().count;
  const totalRels = db.prepare(`SELECT COUNT(*) AS count FROM crew_relationships;`).get().count;
  const totalCities = db.prepare(`SELECT COUNT(DISTINCT city) AS count FROM crews WHERE is_archived = 0;`).get().count;
  const totalRevisions = db.prepare(`SELECT COUNT(*) AS count FROM crew_revisions;`).get().count;

  const oldest = db.prepare(`SELECT name, year, city FROM crews WHERE is_archived = 0 AND year IS NOT NULL ORDER BY year ASC LIMIT 3;`).all();
  const mostOffspring = db.prepare(`
    SELECT c.id, c.name, COUNT(r.child_id) as offspring_count
    FROM crews c
    JOIN crew_relationships r ON c.id = r.parent_id
    WHERE c.is_archived = 0
    GROUP BY c.id
    ORDER BY offspring_count DESC
    LIMIT 5;
  `).all();

  return {
    totalCrews,
    totalArchived,
    totalRelationships: totalRels,
    totalCities,
    totalRevisions,
    oldestCrews: oldest,
    topLineageRoots: mostOffspring,
  };
}

// Default starter roster (user-curated crews)
const DEFAULT_CREWS = [
  {
    id: 'massive_monkees',
    name: 'Massive Monkees',
    city: 'Seattle, WA, USA',
    lat: 47.6062,
    lng: -122.3321,
    year: 1999,
    founders: ['J-Sun', 'Smilez', 'Jerome', 'Tim', 'Brysen', 'Thesis'],
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
 * Seed initial sample crews if database is brand new
 */
function seedDefaults(sampleCrews) {
  const count = db.prepare(`SELECT COUNT(*) AS count FROM crews;`).get().count;
  if (count > 0) {
    // Ensure massive_monkees has is_locked set to 1
    db.prepare(`UPDATE crews SET is_locked = 1 WHERE id = 'massive_monkees';`).run();
    return false;
  }

  console.log('⚡ Empty database detected. Seeding default Blackbook crews...');
  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const c of sampleCrews) {
      db.prepare(`
        INSERT INTO crews (id, name, city, lat, lng, year, instagram, email, open_for_sessions, is_locked)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `).run(
        c.id,
        c.name,
        c.city,
        c.lat,
        c.lng,
        c.year,
        c.instagram || '',
        c.email || '',
        c.openForSessions ? 1 : 0,
        c.isLocked ? 1 : 0
      );

      if (Array.isArray(c.founders)) {
        const insertF = db.prepare(`INSERT INTO founders (crew_id, name) VALUES (?, ?);`);
        for (const f of c.founders) {
          insertF.run(c.id, f);
        }
      }
    }

    // Establish relationships
    const insertR = db.prepare(`INSERT OR IGNORE INTO crew_relationships (parent_id, child_id) VALUES (?, ?);`);
    for (const c of sampleCrews) {
      if (Array.isArray(c.parentIds)) {
        for (const pid of c.parentIds) {
          insertR.run(pid, c.id);
        }
      }
      if (Array.isArray(c.childIds)) {
        for (const cid of c.childIds) {
          insertR.run(c.id, cid);
        }
      }
    }

    db.exec('COMMIT;');

    // Record initial revision history for default crews
    for (const c of sampleCrews) {
      const saved = getCrewById(c.id);
      saveRevision(c.id, 'create', 'Blackbook Genesis', 'Foundational roster import', saved);
    }

    console.log(`✅ Successfully seeded ${sampleCrews.length} default crews into blackbook.db!`);
    return true;
  } catch (err) {
    db.exec('ROLLBACK;');
    console.error('Failed to seed default crews:', err);
    throw err;
  }
}

// Automatically seed defaults if database is brand new
seedDefaults(DEFAULT_CREWS);

module.exports = {
  db,
  DEFAULT_CREWS,
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
