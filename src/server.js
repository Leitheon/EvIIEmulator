'use strict';
// Local server for the Evony Flash client (EvonyClient1921.swf, version 091103_11).
const fs = require('fs');
const path = require('path');
const gamedata = require('./gamedata');
const { loadRules } = require('./rules');
const { Store } = require('./store');
const { Game } = require('./game/game');
const { startPolicyServer, startGameServer } = require('./net');
const { startHttp, createFacePool, createArtLog } = require('./http');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG = {
  host: '127.0.0.1', httpPort: 8080, gamePort: 9443, policyPort: 843,
  assetCdn: 'http://e2.eimg.us', speed: 1, clientFile: 'client/EvonyClient1921.swf',
  dataDir: 'data', cacheDir: 'cache', logLevel: 'info', serverName: 'Local',
};

function makeLog(level, file){
  const order = { debug: 0, info: 1, warn: 2, error: 3 }, min = order[level] ?? 1;
  const out = (lvl, msg) => {
    if (order[lvl] < min) return;
    const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${lvl.toUpperCase().padEnd(5)} ${msg}`;
    (lvl === 'error' ? console.error : console.log)(line);
    try { fs.appendFileSync(file, line + '\n'); } catch (e){}
  };
  return { debug: m => out('debug', m), info: m => out('info', m), warn: m => out('warn', m), error: m => out('error', m) };
}

function main(overrides = {}){
  const cfgFile = path.join(ROOT, 'config.json');
  const cfg = { ...DEFAULT_CONFIG, ...(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {}), ...overrides };
  const dataDir = path.resolve(ROOT, cfg.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const log = makeLog(cfg.logLevel, path.join(dataDir, 'server.log'));

  let data;
  try { data = gamedata.load(path.resolve(ROOT, cfg.clientFile)); }
  catch (e){ log.error(e.message); process.exit(1); }
  log.info(`Loaded ${Object.keys(data.buildings).length} buildings, ${Object.keys(data.techs).length} research topics, ${Object.keys(data.troops).length} troop types from the client`);

  const protocol = JSON.parse(fs.readFileSync(path.join(ROOT, 'protocol.json'), 'utf8'));
  const store = new Store(dataDir, log);
  const rules = loadRules(dataDir, log);
  const faces = createFacePool(path.resolve(ROOT, cfg.cacheDir || 'cache'));
  const art = createArtLog(path.resolve(ROOT, cfg.cacheDir || 'cache'), log);
  const game = new Game({ store, data, rules, speed: cfg.speed, protocol, log, logDir: dataDir, faces, art });
  log.info(`Placed ${game.historicCount.toLocaleString('en-US')} Historic Cities on the map`);

  const policySrv = startPolicyServer(cfg.policyPort, log);
  const gameSrv = startGameServer(cfg.gamePort,
    (conn, cmd, payload) => { log.debug(`<- ${cmd} ${JSON.stringify(payload)?.slice(0, 200)}`); game.handle(conn, cmd, payload); },
    conn => game.disconnect(conn), log);
  const httpSrv = startHttp({ ...cfg, buildingQueue: rules.buildQueue?.enabled !== false }, ROOT, log, { '/coins': q => game.coinsPage(q) }, faces, art);
  const ticker = setInterval(() => { try { game.tick(); } catch (e){ log.error('tick: ' + (e.stack || e.message)); } }, 1000);
  if (cfg.speed !== 1) log.info(`Game speed is ${cfg.speed}x`);

  const close = () => { clearInterval(ticker); clearInterval(store.timer); for (const s of [policySrv, gameSrv, httpSrv]) try { s.close(); } catch (e){} try { store.flush(); } catch (e){} };
  if (!overrides.embedded){
    const stop = () => { close(); process.exit(0); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    process.on('uncaughtException', e => { log.error('Unexpected error: ' + (e.stack || e.message)); try { store.flush(); } catch (x){} });
  }
  return { game, store, cfg, close };
}

if (require.main === module) main();
module.exports = { main };
