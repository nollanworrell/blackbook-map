const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
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
  getCachedGeocode,
  setCachedGeocode,
  getStats,
  seedDefaults,
} = require('./db.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = __dirname;

// Seed defaults handled by db.js

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
  const cached = getCachedGeocode(query);
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
      setCachedGeocode(query, lat, lng);
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
      if (body.length > 5 * 1024 * 1024) {
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
    return sendJson(200, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'blackbook.db',
      mode: 'WAL',
    });
  }

  // Get Stats
  if (pathname === '/api/stats' && method === 'GET') {
    try {
      const stats = getStats();
      return sendJson(200, stats);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Export Full Blackbook
  if (pathname === '/api/export' && method === 'GET') {
    try {
      const crews = getAllCrews();
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
        upsertCrew(c);
        importedCount++;
      }
      return sendJson(200, { success: true, count: importedCount });
    } catch (err) {
      return sendError(400, err.message);
    }
  }

  // Global Activity Feed
  if (pathname === '/api/activity' && method === 'GET') {
    try {
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '40', 10);
      const activity = getGlobalActivity(limit);
      return sendJson(200, activity);
    } catch (err) {
      return sendError(500, err.message);
    }
  }

  // Get All Crews
  if (pathname === '/api/crews' && method === 'GET') {
    try {
      const includeArchived = parsedUrl.searchParams.get('includeArchived') === 'true';
      const crews = getAllCrews(includeArchived);
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
      const created = upsertCrew(newCrewData, authorName || 'Anonymous', summary);
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
      const saved = upsertCrew(body, author, summary);
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
      const history = getCrewHistory(crewId);
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
      const rolledBack = rollbackCrew(crewId, revId, author);
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
      const restored = restoreCrew(crewId, author);
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
      const crew = getCrewById(crewId);
      if (!crew) return sendError(404, 'Crew not found');
      return sendJson(200, crew);
    }

    if (method === 'PUT' || method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        body.id = crewId;
        const author = body.authorName || 'Anonymous';
        const summary = body.editSummary || 'Updated crew details & lineage';
        const updated = upsertCrew(body, author, summary);
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
        const result = archiveCrew(crewId, reason, author);
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

server.listen(PORT, () => {
  console.log(`
╔═════════════════════════════════════════════════════════════════╗
║         THE BLACKBOOK MAP - BBOY CREW GENEALOGY BACKEND         ║
╠═════════════════════════════════════════════════════════════════╣
║  🌐 Web Application:  http://localhost:${PORT}                    ║
║  📡 REST API:         http://localhost:${PORT}/api/crews          ║
║  💾 Database:         blackbook.db (SQLite WAL Mode)            ║
║  📍 Geocode Cache:    Enabled & Persistent in SQLite            ║
╚═════════════════════════════════════════════════════════════════╝
  `);
});

module.exports = server;
