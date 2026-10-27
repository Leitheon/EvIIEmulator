'use strict';
// Web server for the launch page, config2.xml, your copy of the client, and game art.
// Art the client asks for (images/..., other .swf modules) is fetched once from the asset CDN
// in config.json and kept in the cache folder, the same way your browser cache would hold it.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const TYPES = { '.html': 'text/html; charset=utf-8', '.xml': 'text/xml; charset=utf-8', '.swf': 'application/x-shockwave-flash', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.json': 'application/json', '.wasm': 'application/wasm' };
const typeOf = p => TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream';
const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function config2(cfg){
  const base = `http://${cfg.host}:${cfg.httpPort}/`;
  const v = {
    debugMode: 'true', server: cfg.host, port: cfg.gamePort, security: `xmlsocket://${cfg.host}:${cfg.policyPort}`,
    serverID: cfg.serverId || 'local', serverAlias: cfg.serverName || 'Local', homePage: base, Language: 'English', MultiLanguage: 'false',
    FrameCount: 300, RunSeconds: 5, ButtonFlag: 'true', Facebook: 0, AbTestFlag: 'true', AttackFlag: 'false', BuildingQueueFlag: cfg.buildingQueue === false ? 'false' : 'true',
    ScaleHouse: 0, ScaleTownHall: 0, Coord: '', SID: '', movingText: '', movingTxt: '', Offer: '', ServerState: '', proclamation: '', NewsRSS: '',
    acount: '', password: '', addFund: base + 'coins?from=game', GiftKey: '', forum: base, allianceForum: base, help: base, AccountProtect: base, PreminumRewardPage: base,
    IEvonyPage: base, SendGift: base, AddNeighbor: base, VisitEmpire: base, NeighborList: base, RecentActivities: base, FbAction: base, FbEventAction: base,
    FbLinkAccount: base, FbUprisingUrl: base, CheckServerState: base, MiniFavorable: base, coeRegUrl: base,
  };
  return '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n' + Object.entries(v).map(([k, x]) => `  <${k}>${xmlEsc(x)}</${k}>`).join('\n') + '\n</config>\n';
}
const CROSSDOMAIN = '<?xml version="1.0"?>\n<cross-domain-policy>\n  <allow-access-from domain="*"/>\n</cross-domain-policy>\n';

// Hero portraits are images/icon/hero/N.png on the art server. Which numbers exist isn't known up front, so
// numbers that turn out to be missing are remembered (cache/hero-faces.json) and the hero generator skips them;
// meanwhile a missing portrait is answered with one that does exist.
function createFacePool(cacheDir){
  const file = path.join(cacheDir, 'hero-faces.json');
  let missing = new Set();
  try { missing = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).missing || []); } catch (e){}
  const dir = path.join(cacheDir, 'images', 'icon', 'hero');
  const known = () => { try { return fs.readdirSync(dir).map(f => /^(\d+)\.png$/.exec(f)).filter(Boolean).map(m => Number(m[1])); } catch (e){ return []; } };
  return {
    missing: n => missing.has(n),
    markMissing(n){ if (missing.has(n)) return; missing.add(n); try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ missing: [...missing].sort((a, b) => a - b) })); } catch (e){} },
    anyKnown(){ const k = known(); return k.length ? k[Math.floor(Math.random() * k.length)] : null; },
    fallbackFile(n){ const k = known().filter(x => x !== n); return k.length ? path.join(dir, `${k[n % k.length]}.png`) : null; },
  };
}

function fetchUpstream(url, depth = 0){
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (local Evony server asset cache)' }, timeout: 20000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && depth < 3){
        res.resume(); return resolve(fetchUpstream(new URL(res.headers.location, url).toString(), depth + 1));
      }
      if (res.statusCode !== 200){ res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// The live servers' config.xml, as RoboEvony reads it: serverID (must match what was typed), server (the game
// socket, host:port), SID and serverAlias.
function botConfig(cfg, hostHeader){
  const asked = String(hostHeader || `${cfg.host}:${cfg.httpPort}`);
  const host = asked.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') || cfg.host;
  const x = v => String(v).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  return `<?xml version="1.0" encoding="utf-8"?>\n<config>\n  <serverID>${x(asked)}</serverID>\n  <serverAlias>${x(cfg.serverName || 'Local')}</serverAlias>\n` +
    `  <server>${x(host)}:${cfg.gamePort}</server>\n  <port>${cfg.gamePort}</port>\n  <SID></SID>\n</config>\n`;
}

// Art the client asked for that neither cache/ nor the art server has. Logged once per file, so you can see
// what's missing, and used to keep items without an icon off the Wheel of Fortune. A 404 from the art server
// is remembered in cache/missing-art.json; other failures (no connection) only until the server restarts.
function createArtLog(cacheDir, log){
  const file = path.join(cacheDir, 'missing-art.json');
  let gone = new Set();
  try { gone = new Set(JSON.parse(fs.readFileSync(file, 'utf8')).missing || []); } catch (e){}
  const failed = new Set();
  const key = rel => String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  return {
    has: rel => !!rel && (gone.has(key(rel)) || failed.has(key(rel))),
    mark(rel, why){
      const k = key(rel);
      if (gone.has(k) || failed.has(k)) return;
      if (/HTTP 404|not cached/.test(why)){
        gone.add(k);
        try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify({ missing: [...gone].sort() }, null, 1)); } catch (e){}
      } else failed.add(k);
      log.info(`Missing art: ${k} (${why})`);
    },
  };
}

// pages: { '/path': (URLSearchParams) => html } for pages the game itself serves (the coins page).
function startHttp(cfg, root, log, pages = {}, faces = null, art = null){
  const pub = path.join(root, 'public'), cache = path.resolve(root, cfg.cacheDir || 'cache');
  const clientFile = path.resolve(root, cfg.clientFile);
  const inflight = new Map();
  const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' }); res.end(body); };
  const sendFile = (res, file) => fs.readFile(file, (e, b) => e ? send(res, 404, 'Not found', 'text/plain') : (res.writeHead(200, { 'Content-Type': typeOf(file), 'Content-Length': b.length }), res.end(b)));

  const srv = http.createServer(async (req, res) => {
    let p, query;
    try { const u = new URL(req.url, 'http://x'); p = decodeURIComponent(u.pathname); query = u.searchParams; } catch (e){ return send(res, 400, 'Bad path', 'text/plain'); }
    // Flex's HTTPService turns a GET with an XML content type into a POST, so RoboEvony POSTs for config.xml.
    if (p === '/config.xml' && req.method === 'POST'){ req.resume(); return send(res, 200, botConfig(cfg, req.headers.host), TYPES['.xml']); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    if (p === '/' || p === '/index.html') return sendFile(res, path.join(pub, 'index.html'));
    if (pages[p]){ try { return send(res, 200, pages[p](query), TYPES['.html']); } catch (e){ log.error(`${p}: ${e.message}`); return send(res, 500, 'Server error', 'text/plain'); } }
    if (p === '/config2.xml') return send(res, 200, config2(cfg), TYPES['.xml']);
    // RoboEvony (patched to take an address as its server): it reads config.xml from the address you type and
    // expects serverID to repeat it, then connects to <server>, here host:port.
    if (p === '/config.xml') return send(res, 200, botConfig(cfg, req.headers.host), TYPES['.xml']);
    if (p === '/crossdomain.xml') return send(res, 200, CROSSDOMAIN, TYPES['.xml']);
    if (p.toLowerCase() === '/' + path.basename(clientFile).toLowerCase()) return sendFile(res, clientFile);
    const rel = path.normalize(p).replace(/^([/\\])+/, '');
    if (rel.startsWith('..') || path.isAbsolute(rel)) return send(res, 400, 'Bad path', 'text/plain');
    const local = path.join(pub, rel);
    if (local.startsWith(pub + path.sep) && fs.existsSync(local) && fs.statSync(local).isFile()) return sendFile(res, local);
    const cached = path.join(cache, rel);
    if (!cached.startsWith(cache + path.sep)) return send(res, 400, 'Bad path', 'text/plain');
    if (fs.existsSync(cached)) return sendFile(res, cached);
    if (!cfg.assetCdn){ art?.mark(rel, 'not cached, and no assetCdn is set'); return send(res, 404, 'Not found', 'text/plain'); }
    try {
      if (!inflight.has(rel)){
        inflight.set(rel, fetchUpstream(cfg.assetCdn.replace(/\/$/, '') + '/' + rel.split(path.sep).map(encodeURIComponent).join('/'))
          .then(b => { fs.mkdirSync(path.dirname(cached), { recursive: true }); fs.writeFileSync(cached, b); return b; })
          .finally(() => setTimeout(() => inflight.delete(rel), 1000)));
      }
      const b = await inflight.get(rel);
      res.writeHead(200, { 'Content-Type': typeOf(rel), 'Content-Length': b.length }); res.end(b);
    } catch (e){
      log.debug(`asset ${rel}: ${e.message}`);
      if (!/^images[\\/]icon[\\/]hero[\\/]/.test(rel)) art?.mark(rel, `art server: ${e.message}`);
      const hero = /^images[\\/]icon[\\/]hero[\\/](\d+)\.png$/.exec(rel);
      if (hero && faces && /HTTP 404/.test(e.message)){
        faces.markMissing(Number(hero[1]));
        const alt = faces.fallbackFile(Number(hero[1]));
        if (alt) return sendFile(res, alt);
      }
      send(res, 404, 'Not found', 'text/plain');
    }
  });
  srv.on('error', e => { log.error(`Web server could not listen on port ${cfg.httpPort}: ${e.code || e.message}`); process.exitCode = 1; });
  // Ruffle (no Flash needed): /ruffle.html runs the client in any modern browser, its game socket over /ws.
  require('./ws').attachSocketBridge(srv, '127.0.0.1', cfg.gamePort, log);
  srv.listen(cfg.httpPort, () => log.info(`Web server: open http://${cfg.host}:${cfg.httpPort}/ in Basilisk, or http://${cfg.host}:${cfg.httpPort}/ruffle.html in any browser (Ruffle, no Flash)`));
  return srv;
}

module.exports = { startHttp, config2, botConfig, createFacePool, createArtLog };
