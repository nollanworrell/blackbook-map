const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const {
  getDbInfo,
  initDb,
  getAllCrews,
  getCrewById,
  getCrewHistory,
  rollbackCrew,
  archiveCrew,
  restoreCrew,
  upsertCrew,
  deleteCrew,
  getGlobalActivity,
  getCachedGeocode,
  setCachedGeocode,
  getStats,
} = require('./db.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = __dirname;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'blackbook2026';

function verifyAdminToken(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    return decoded.startsWith(ADMIN_PASSWORD + ':');
  } catch (_) {
    return false;
  }
}

/**
 * MIME type resolver for static files
 */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/**
 * Server-side Geocoding with SQLite caching
 */
async function geocodeCityWithCache(query) {
  if (!query) return null;
  const cached = await getCachedGeocode(query);
  if (cached) {
    return cached;
  }

  try {
    const geoUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(geoUrl, {
      headers: { 'User-Agent': 'BlackbookMapBackend/1.0 (contact@bboyblackbook.map)' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);
      await setCachedGeocode(query, lat, lng);
      return { lat, lng };
    }
  } catch (err) {
    console.warn(`Geocoding failed for "${query}":`, err.message);
  }
  return null;
}

/**
 * Parse JSON body from request
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * HTTP Request Handler
 */
const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  const parsedUrl = new URL(req.url, `http://${host}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  // CORS Headers for API & cross-origin clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helpers
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const sendError = (statusCode, message) => {
    sendJson(statusCode, { error: message });
  };

  // ─── API ROUTES ─────────────────────────────────────────

  // Healthcheck & DB Status
  if (pathname === '/api/health' && method === 'GET') {
    const dbInfo = getDbInfo();
    return sendJson(200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbInfo.type,
      storage: dbInfo.storage,
      isTurso: dbInfo.isTurso,
    });
  }

  // Get Stats
  if (pathname === '/api/stats' && method === 'GET') {
    try {
      const stats = await getStats();
      return sendJson(200, stats);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Export Full Blackbook
  if (pathname === '/api/export' && method === 'GET') {
    try {
      const crews = await getAllCrews(true);
      res.setHeader('Content-Disposition', 'attachment; filename="blackbook_crews_export.json"');
      return sendJson(200, {
        exportedAt: new Date().toISOString(),
        totalCrews: crews.length,
        crews,
      });
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Import Full Blackbook
  if (pathname === '/api/import' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const crewsList = Array.isArray(body) ? body : body.crews;
      if (!Array.isArray(crewsList)) {
        return sendError(400, 'Expected an array of crews or { crews: [...] }');
      }
      let importedCount = 0;
      for (const c of crewsList) {
        if (c && c.name && c.city) {
          await upsertCrew(c, 'Import/Sync', 'Community backup sync');
          importedCount++;
        }
      }
      console.log(`📥 Successfully imported/synced ${importedCount} crews into database.`);
      return sendJson(200, { success: true, count: importedCount });
    } catch (err) {
      console.error('Import error:', err);
      return sendError(400, err.message);
    }
  }

  // Global Activity Feed
  if (pathname === '/api/activity' && method === 'GET') {
    try {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '40', 10);
      const activity = await getGlobalActivity(limit);
      return sendJson(200, activity);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Admin Authentication
  if (pathname === '/api/admin/login' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const pass = (body && body.password) ? String(body.password).trim() : '';
      if (pass === ADMIN_PASSWORD) {
        const token = Buffer.from(`${ADMIN_PASSWORD}:${Date.now()}`).toString('base64');
        return sendJson(200, { success: true, token });
      }
      return sendError(401, 'Invalid admin password');
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  if (pathname === '/api/admin/verify' && (method === 'GET' || method === 'POST')) {
    const isValid = verifyAdminToken(req);
    return sendJson(isValid ? 200 : 401, { authenticated: isValid });
  }

  // Get All Crews (with optional active/inactive and era filters)
  if (pathname === '/api/crews' && method === 'GET') {
    try {
      const includeArchived = parsedUrl.searchParams.get('includeArchived') === 'true';
      let crews = await getAllCrews(includeArchived);

      const statusFilter = parsedUrl.searchParams.get('status');
      if (statusFilter === 'active') {
        crews = crews.filter(c => c.isActive);
      } else if (statusFilter === 'inactive') {
        crews = crews.filter(c => !c.isActive);
      }

      const eraFilter = parsedUrl.searchParams.get('era');
      if (eraFilter) {
        crews = crews.filter(c => Array.isArray(c.erasActive) && c.erasActive.includes(eraFilter));
      }

      return sendJson(200, crews);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Quick Add Crew with server-side Geocoding & relationship wiring
  if (pathname === '/api/quick-crew' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { name, city, year, role, targetCrewId, authorName, editSummary } = body;

      if (!name || !city) {
        return sendError(400, 'Crew name and city are required');
      }

      const geo = await geocodeCityWithCache(city);
      const newId = 'crew_' + Date.now();

      const newCrewData = {
        id: newId,
        name: name.trim(),
        city: city.trim(),
        lat: geo ? geo.lat : (25 + (Math.random() * 20 - 10)),
        lng: geo ? geo.lng : (Math.random() * 40 - 20),
        year: year ? parseInt(year) : null,
        founders: [],
        parentIds: role === 'child' && targetCrewId ? [targetCrewId] : [],
        childIds: role === 'parent' && targetCrewId ? [targetCrewId] : [],
        instagram: '',
        email: '',
        phone: '',
        website: '',
      };

      const summary = editSummary || `Quick-added crew & linked as ${role}`;
      const created = await upsertCrew(newCrewData, authorName || 'Anonymous', summary);
      console.log(`✨ [QUICK-ADD] Crew "${created.name}" (${created.city}) added by ${authorName || 'Anonymous'}`);
      return sendJson(201, created);
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  // Add Crew (POST /api/crews)
  if (pathname === '/api/crews' && method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      if (!body.name || !body.city) {
        return sendError(400, 'Name and city are required fields');
      }

      // Geocode on server if lat/lng missing
      if (body.lat == null || body.lng == null) {
        const geo = await geocodeCityWithCache(body.city);
        if (geo) {
          body.lat = geo.lat;
          body.lng = geo.lng;
        }
      }

      const author = body.authorName || 'Anonymous';
      const summary = body.editSummary || (body.id ? 'Updated crew details & lineage' : 'Created new crew entry');
      const saved = await upsertCrew(body, author, summary);
      console.log(`💾 [SAVE] Crew "${saved.name}" (${saved.city}) saved by ${author}`);
      return sendJson(201, saved);
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  // Crew History Route: GET /api/crews/:id/history
  const historyMatch = pathname.match(/^\/api\/crews\/([a-zA-Z0-9_\-]+)\/history$/);
  if (historyMatch && method === 'GET') {
    const crewId = historyMatch[1];
    try {
      const history = await getCrewHistory(crewId);
      return sendJson(200, history);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Crew Rollback Route: POST /api/crews/:id/rollback/:revId
  const rollbackMatch = pathname.match(/^\/api\/crews\/([a-zA-Z0-9_\-]+)\/rollback\/([0-9]+)$/);
  if (rollbackMatch && method === 'POST') {
    const crewId = rollbackMatch[1];
    const revId = parseInt(rollbackMatch[2], 10);
    try {
      const body = await parseJsonBody(req);
      const author = body.authorName || 'Anonymous';
      const rolledBack = await rollbackCrew(crewId, revId, author);
      console.log(`↺ [ROLLBACK] Crew "${rolledBack.name}" reverted to rev #${revId} by ${author}`);
      return sendJson(200, rolledBack);
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  // Crew Restore Route: POST /api/crews/:id/restore
  const restoreMatch = pathname.match(/^\/api\/crews\/([a-zA-Z0-9_\-]+)\/restore$/);
  if (restoreMatch && method === 'POST') {
    const crewId = restoreMatch[1];
    try {
      const body = await parseJsonBody(req);
      const author = body.authorName || 'Anonymous';
      const restored = await restoreCrew(crewId, author);
      console.log(`♻️ [RESTORE] Crew "${restored.name}" restored from archive by ${author}`);
      return sendJson(200, restored);
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  // Single Crew Routes: /api/crews/:id
  const crewMatch = pathname.match(/^\/api\/crews\/([a-zA-Z0-9_\-]+)$/);
  if (crewMatch) {
    const crewId = crewMatch[1];

    if (method === 'GET') {
      const crew = await getCrewById(crewId);
      if (!crew) return sendError(404, 'Crew not found');
      return sendJson(200, crew);
    }

    if (method === 'PUT' || method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        body.id = crewId;
        const author = body.authorName || 'Anonymous';
        const summary = body.editSummary || 'Updated crew details & lineage';
        const updated = await upsertCrew(body, author, summary);
        console.log(`📝 [UPDATE] Crew "${updated.name}" updated by ${author}`);
        return sendJson(200, updated);
      } catch (err) {
        return sendError(400, err.message);
      }
    }

    if (method === 'DELETE') {
      try {
        let body = {};
        try { body = await parseJsonBody(req); } catch (_) {}
        const reason = body.reason || parsedUrl.searchParams.get('reason') || 'Archived by community';
        const author = body.authorName || parsedUrl.searchParams.get('author') || 'Anonymous';
        const result = await archiveCrew(crewId, reason, author);
        console.log(`🗑️ [ARCHIVE] Crew ${crewId} archived by ${author} (Reason: ${reason})`);
        return sendJson(200, { ...result, deletedId: crewId });
      } catch (err) {
        const status = err.message.includes('locked') ? 403 : 500;
        return sendError(status, err.message);
      }
    }
  }

  // ─── STATIC FILE SERVING ────────────────────────────────
  if (method === 'GET') {
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security check: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Default to index.html if file doesn't exist
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500);
        res.end('Error reading static file');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
    return;
  }

  sendError(404, 'Not Found');
});

// Ensure DB is initialized before listening
initDb().then(() => {
  const dbInfo = getDbInfo();
  server.listen(PORT, () => {
    console.log(`
╔═════════════════════════════════════════════════════════════════╗
║         THE BLACKBOOK MAP - BBOY CREW GENEALOGY BACKEND         ║
╠═════════════════════════════════════════════════════════════════╣
║  🌐 Web Application:  http://localhost:${PORT}                    ║
║  📡 REST API:         http://localhost:${PORT}/api/crews          ║
║  💾 Database:         ${dbInfo.type.padEnd(42)}║
║  📍 Storage:          ${(dbInfo.isTurso ? dbInfo.storage : 'Local / Persistent Disk').padEnd(42)}║
╚═════════════════════════════════════════════════════════════════╝
    `);
  });
}).catch(err => {
  console.error('Fatal database initialization error:', err);
  process.exit(1);
});

module.exports = server;
