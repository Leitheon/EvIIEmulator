'use strict';
// End-to-end test: plays the Flash client's side of the protocol against a real server instance.
// Run with `npm test`. Needs client/EvonyClient1921.swf like the server itself.
const net = require('net');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const amf3 = require('../src/amf3');
const { main } = require('../src/server');

const PORTS = { httpPort: 18080, gamePort: 19443, policyPort: 18843 };
const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'protocol.json'), 'utf8'));
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures++; };

// Checks a value against the client's declared field types, the way the bean constructors read it.
function validate(bean, obj, where, problems){
  const def = protocol.beans[bean];
  if (!def){ problems.push(`${where}: no definition for ${bean}`); return; }
  for (const [k, v] of Object.entries(obj)){
    const f = def.fields[k];
    if (!f) continue; // the client ignores fields it doesn't read
    const check = (val, at) => {
      if (val === null || val === undefined) return;
      const t = f.type;
      if (t === 'int' || t === 'Number' || t === 'uint'){ if (typeof val !== 'number') problems.push(`${at}: expected ${t}, got ${typeof val}`); }
      else if (t === 'String'){ if (typeof val !== 'string') problems.push(`${at}: expected String, got ${typeof val}`); }
      else if (t === 'Boolean'){ if (typeof val !== 'boolean') problems.push(`${at}: expected Boolean, got ${typeof val}`); }
      else if (protocol.beans[t]){ if (typeof val !== 'object' || Array.isArray(val)) problems.push(`${at}: expected ${t} object`); else validate(t, val, at, problems); }
    };
    if (f.array){ if (!Array.isArray(v)) problems.push(`${where}.${k}: expected array`); else v.forEach((x, i) => check(x, `${where}.${k}[${i}]`)); }
    else check(v, `${where}.${k}`);
  }
}

class FakeClient {
  constructor(port){
    this.sock = net.connect(port, '127.0.0.1'); this.buf = Buffer.alloc(0); this.inbox = []; this.waiters = [];
    this.sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
  }
  ready(){ return new Promise(r => this.sock.once('connect', r)); }
  drain(){
    while (this.buf.length >= 4){
      const head = this.buf.readUInt32BE(0), len = head & 0x7fffffff;
      if (this.buf.length < 4 + len) return;
      let p = this.buf.subarray(4, 4 + len); this.buf = this.buf.subarray(4 + len);
      if (head & 0x80000000) p = zlib.inflateSync(p);
      const msg = amf3.decode(p); this.inbox.push(msg); (this.order = this.order || []).push(msg);
      this.waiters = this.waiters.filter(w => { const i = this.inbox.findIndex(w.match); if (i < 0) return true; w.resolve(this.inbox.splice(i, 1)[0]); return false; });
    }
  }
  send(cmd, data){ const b = amf3.encode({ cmd, data }); const h = Buffer.alloc(4); h.writeUInt32BE(b.length); this.sock.write(Buffer.concat([h, b])); }
  wait(cmd, ms = 4000, pred = () => true){
    const match = m => m.cmd === cmd && pred(m.data);
    const i = this.inbox.findIndex(match); if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => { const w = { match, resolve }; this.waiters.push(w); setTimeout(() => reject(new Error('timed out waiting for ' + cmd)), ms); });
  }
  async call(cmd, data, replyCmd = cmd){
    this.send(cmd, data); const r = (await this.wait(replyCmd)).data;
    const bean = protocol.replies[replyCmd], problems = [];
    if (bean) validate(bean, r, replyCmd, problems);
    if (problems.length){ failures++; console.log(`FAIL ${replyCmd} reply types: ${problems.slice(0, 6).join('; ')}`); }
    return r;
  }
  close(){ this.sock.destroy(); }
}

const policyRequest = port => new Promise((resolve, reject) => {
  const s = net.connect(port, '127.0.0.1', () => s.write('<policy-file-request/>\0'));
  let got = ''; s.on('data', d => got += d); s.on('close', () => resolve(got)); s.on('error', reject);
});
const get = p => new Promise((resolve, reject) => http.get(`http://127.0.0.1:${PORTS.httpPort}${p}`, res => { const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), type: res.headers['content-type'] })); }).on('error', reject));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

(async () => {
  // AMF3 round trip, including references, negatives, doubles and nesting.
  const sample = { cmd: 'x', data: { a: 1, b: -5, c: 268435456, d: 3.5, s: 'hello', s2: 'hello', arr: [1, 'two', { three: 3 }], t: true, n: null, deep: { list: [] } } };
  ok(JSON.stringify(amf3.decode(amf3.encode(sample))) === JSON.stringify(sample), 'AMF3 encode/decode round trip');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evony-test-'));
  // The tests were written for a richer first city than the live game's (which has only a Town Hall): a Cottage, four
  // fields and plenty of resources. The live start is checked on its own further down.
  fs.writeFileSync(path.join(dataDir, 'rules.json'), JSON.stringify({ start: { resources: { food: 200000, wood: 200000, stone: 200000, iron: 200000, gold: 50000 },
    population: 100, taxRate: 20, productionRate: 100, buildings: { '0': [1, 1], '1001': [7, 1], '1002': [4, 1], '1003': [5, 1], '1004': [6, 1] } } }));
  const srv = main({ ...PORTS, dataDir, cacheDir: path.join(dataDir, 'cache'), speed: 600, logLevel: 'warn', embedded: true, assetCdn: '' });
  await sleep(400);
  try {
    ok((await policyRequest(PORTS.policyPort)).includes('<allow-access-from domain="*" to-ports="*"/>'), 'policy port answers <policy-file-request/>');
    ok((await policyRequest(PORTS.gamePort)).includes('cross-domain-policy'), 'game port also answers the policy request');

    const cfg = await get('/config2.xml');
    ok(cfg.status === 200 && cfg.body.toString().includes(`<port>${PORTS.gamePort}</port>`) && cfg.body.toString().includes('<debugMode>true</debugMode>'), 'config2.xml points the client at this server in debug mode');
    const swf = await get('/EvonyClient1921.swf');
    ok(swf.status === 200 && swf.body.subarray(0, 3).toString() === 'CWS', 'the client file is served');
    ok((await get('/')).body.toString().includes('EvonyClient1921.swf'), 'launch page embeds the client');

    const c = new FakeClient(PORTS.gamePort); await c.ready();
    c.send('gameClient.version', '091103_11');
    c.send('login', { user: 'Tester', pwd: sha1('secret') });
    const login = (await c.wait('server.LoginResponse')).data;
    ok(login.ok === 1, 'login succeeds and creates the lord');
    const problems = []; validate('LoginResponse', login, 'login', problems);
    ok(problems.length === 0, 'login reply matches the client\'s field types' + (problems.length ? ': ' + problems.slice(0, 8).join('; ') : ''));
    const p = login.player, castle = p.castles[0];
    ok(p.playerInfo.userName === 'Tester' && p.castles.length === 1, 'player has one city');
    ok(/^\d{4}\.\d{2}\.\d{2} \d{2}\.\d{2}\.\d{2}$/.test(p.currentDateTime), 'server time uses the client\'s YYYY.MM.DD HH.MM.SS format');
    ok(castle.buildings.some(b => b.positionId === -1 && b.typeId === 31 && b.level === 1), 'city starts with a level 1 Town Hall');
    ok(castle.name === 'City Name', `a new lord's city is called "City Name", as on the live game (${castle.name})`);
    // New lords build two buildings at once for their first 72 hours: the client's notice ("All new players can build
    // two buildings at one time in 72 hours.") and the buff icon it shows by itself from the account's creation time.
    {
      const n = new FakeClient(PORTS.gamePort); await n.ready();
      n.send('gameClient.version', '091103_11'); n.send('login', { user: 'Newcomer', pwd: sha1('fresh') });
      const np = (await n.wait('server.LoginResponse')).data.player, nq = srv.store.db.players[np.playerInfo.id], nc = np.castles[0].id;
      const b1 = await n.call('castle.newBuilding', { castleId: nc, positionId: 3, buildingType: 1 });
      const b2 = await n.call('castle.newBuilding', { castleId: nc, positionId: 4, buildingType: 1 });
      const b3 = await n.call('castle.newBuilding', { castleId: nc, positionId: 5, buildingType: 1 });
      const later = srv.game.items.buildSlots(nq, nq.createdAt + 72 * 3600000);
      ok(np.playerInfo.createrTime === nq.createdAt && b1.ok === 1 && b2.ok === 1 && b3.ok === -48 && later === 1,
        'a new lord builds two buildings at once for his first 72 hours (the client shows that buff from the account\'s creation time), then one');
      n.close();
      srv.store.db.players[p.playerInfo.id].createdAt -= 73 * 3600000;   // (the tests below expect a single builder)
    }

    const inside = await c.call('castle.getAvailableBuildingListInside', { castleId: castle.id });
    ok(inside.ok === 1 && inside.builingList.length > 5, `inside build menu lists ${inside.builingList.length} buildings`);
    const pr = []; validate('AvailableBuilingListResponse', inside, 'inside', pr); ok(pr.length === 0, 'build menu matches client types' + (pr.length ? ': ' + pr.slice(0, 5).join('; ') : ''));
    const cottage = inside.builingList.find(x => x.typeId === 1);
    ok(cottage && cottage.conditionBean.wood > 0 && cottage.conditionBean.time > 0, 'Cottage cost and time come from the client data');

    const bad = await c.call('castle.newBuilding', { castleId: castle.id, positionId: 3, buildingType: 2 });
    ok(bad.ok === -8 && /Rally Spot/.test(bad.errorMsg), 'Barracks without a Rally Spot is refused with the reason');

    c.send('castle.newBuilding', { castleId: castle.id, positionId: 3, buildingType: 1 });
    const started = await c.wait('server.BuildComplate', 3000, d => d.buildingBean.positionId === 3 && d.buildingBean.status === 1);
    ok((await c.wait('castle.newBuilding')).data.ok === 1, 'Cottage build accepted');
    ok(started.data.buildingBean.endTime > started.data.buildingBean.startTime, 'build start is pushed with its timer');
    const res = (await c.wait('server.ResourceUpdate')).data;
    ok(res.resource.wood.amount < castle.resource.wood.amount, 'resources drop by the build cost');
    const busy = await c.call('castle.upgradeBuilding', { castleId: castle.id, positionId: -1 }); await c.wait('server.ResourceUpdate').catch(() => {});
    ok(busy.ok === -48 && /already working/.test(busy.errorMsg), 'a second build at the same time is refused (with -48, on which the client offers to queue it)');
    const done = await c.wait('server.BuildComplate', 5000, d => d.buildingBean.positionId === 3 && d.buildingBean.status === 0);
    ok(done.data.buildingBean.level === 1, 'Cottage finishes on its timer and the client is told');

    const up = await c.call('castle.upgradeBuilding', { castleId: castle.id, positionId: -1 });
    ok(up.ok === 1, 'Town Hall upgrade accepted');
    const th = await c.wait('server.BuildComplate', 6000, d => d.buildingBean.positionId === -1 && d.buildingBean.status === 0);
    ok(th.data.buildingBean.level === 2, 'Town Hall reaches level 2');

    const tax = await c.call('interior.modifyTaxRate', { castleId: castle.id, tax: 35 });
    ok(tax.ok === 1, 'tax rate change accepted');

    // ---------- milestone 2 ----------
    ok(p.playerInfo.medal === 1000, 'new lords start with 1,000 coins');
    ok(p.saleTypeBeans.length === 6 && p.saleTypeBeans.find(t => t.typeName === '加速').items.split('#').includes('consume.2.a'), 'shop categories are filled from the client\'s item table');

    const map = await c.call('common.mapInfoSimple', { castleId: castle.id, x1: 380, y1: 474, x2: 420, y2: 504 });
    const fx = castle.fieldId % 800, fy = Math.floor(castle.fieldId / 800);
    const w = 41, h = 31;
    ok(map.ok === 1 && map.mapStr.length === 2 * w * h, `map string covers the requested ${w}x${h} tiles`);
    if (fx >= 380 && fx <= 420 && fy >= 474 && fy <= 504){
      const at = ((fy - 474) * w + (fx - 380)) * 2;
      ok(map.mapStr[at] === 'b' && map.castles.some(b => b.id === castle.fieldId && b.relation === 1 && b.castleId === castle.id), 'your city appears on the map as your own');
    } else {
      const around = await c.call('common.mapInfoSimple', { castleId: castle.id, x1: fx - 5, y1: fy - 5, x2: fx + 5, y2: fy + 5 });
      ok(around.mapStr.slice(2 * (5 * 11 + 5), 2 * (5 * 11 + 5) + 1) === 'b' && around.castles.some(b => b.castleId === castle.id && b.relation === 1), 'your city appears on the map as your own');
    }
    ok(/^[0-9a-c][0-9a-f]+$/.test(map.mapStr), 'every map tile code is two hex digits');
    const wrap = await c.call('common.mapInfoSimple', { castleId: castle.id, x1: -5, y1: -5, x2: 5, y2: 5 });
    ok(wrap.ok === 1 && wrap.mapStr.length === 2 * 121, 'map wraps around the world edge');
    const zones = await c.call('common.zoneInfo', {});
    ok(zones.zones.length === 16 && zones.zones[0].name === 'FRIESLAND', 'zone list has the 16 Evony regions');
    ok(castle.powerlevel === 4, 'your city is an ordinary city to the client (powerlevel 4), not a Historic City');
    {
      const W = require('../src/game/world');
      let npcId = null;
      for (let r = 1; r < 60 && npcId == null; r++) for (let dx = -r; dx <= r && npcId == null; dx++){ const id = W.idOf(fx + dx, fy + r), t = W.tileAt(srv.store, id); if (t.type === W.T.NPC && !t.historic) npcId = id; }
      const info = await c.call('field.getOtherFieldInfo', { castleId: castle.id, fieldId: npcId });
      ok(info.bean.canOccupy === true && !info.bean.userName, 'an NPC city\'s tile window offers Attack, with no lord to mail');
    }

    const buy = await c.call('shop.buy', { itemId: 'consume.2.a', amount: 2 });
    ok(buy.ok === 1, 'buying 2 Beginner Guidelines succeeds');
    const itemUp = (await c.wait('server.ItemUpdate')).data, infoUp = (await c.wait('server.PlayerInfoUpdate')).data;
    ok(itemUp.items[0].id === 'consume.2.a' && itemUp.items[0].count === 2 && infoUp.playerInfo.medal === 990, 'the item arrives and 10 coins are spent');
    const tooMuch = await c.call('shop.buy', { itemId: 'player.speedup.1', amount: 100 });
    ok(tooMuch.ok < 0 && /coins/.test(tooMuch.errorMsg), 'buying more than you can afford is refused');

    const coinsPage = await get(`/coins?from=game&user=Tester&add=1000`);
    ok(coinsPage.status === 200 && coinsPage.body.toString().includes('Added 1,000 coins'), 'the Get More Coins page adds coins');
    ok((await c.wait('server.PlayerInfoUpdate')).data.playerInfo.medal === 1990, 'added coins reach the game right away');
    const fillPage = await get(`/coins?from=game&user=Tester&fill=100000000`);
    const filled = (await c.wait('server.ResourceUpdate', 3000, d => d.resource.wood.amount >= 100000000)).data;
    ok(fillPage.body.toString().includes('100,000,000') && filled.resource.food.amount >= 100000000 && filled.resource.gold >= 100000000, 'the owner panel fills resources to 100 million and the game sees it');
    const givePage = await get(`/coins?from=game&user=Tester&give=${encodeURIComponent('Saxon Beer Chest A')}&n=2`);
    const gotItem = (await c.wait('server.ItemUpdate', 3000, d => d.items.some(i => i.id === 'player.box.present.money.96'))).data;
    ok(givePage.body.toString().includes('Added 2 x Saxon Beer Chest A') && gotItem.items[0].count === 2, 'the owner panel gives any item, event chests included');
    const troops0 = { ...srv.store.db.castles[castle.id].troops }, arch0 = troops0.archer || 0;
    const troopPage = await get(`/coins?from=game&user=Tester&city=${castle.id}&troop=archer&tn=500`), allPage = await get(`/coins?from=game&user=Tester&city=${castle.id}&troop=all&tn=3`);
    const gotTroops = (await c.wait('server.TroopUpdate', 3000, d => d.troop.archer === arch0 + 503)).data;
    ok(/Added 500 Archers? to/.test(troopPage.body.toString()) && /Add troops/.test(troopPage.body.toString()) && /every kind of troop/.test(allPage.body.toString()) && gotTroops.troop.peasants >= 3 && gotTroops.troop.catapult >= 3,
      'the debug menu adds troops of one kind, or of every kind, to a city and the game sees them');
    srv.store.db.castles[castle.id].troops = troops0; c.inbox = c.inbox.filter(m => m.cmd !== 'server.TroopUpdate');
    {
      // m3.76: the debug menu sets research, gear levels and gear stars.
      const G = srv.game, eq = G.equipment, me = srv.store.db.players[p.playerInfo.id], had = new Set(c.inbox);
      const saved = { techs: { ...(me.techs || {}) }, gear: me.gear ? JSON.parse(JSON.stringify(me.gear)) : undefined, research: me.research, gearResearch: me.gearResearch };
      const maxed = (await get(`/coins?from=game&user=Tester&tech=all&tl=10&gear=all&gl=10&star=all&sl=15`)).body.toString();
      ok(Object.keys(G.data.techs).every(id => me.techs[id] === 10) && eq.types().length === 14 && eq.types().every(t => eq.level(me, t) === 10 && eq.star(me, t) === 15)
        && eq.setStars(me) === 15 && /Star set: <b>15<\/b>/.test(maxed) && /Max everything/.test(maxed),
        'the debug menu maxes everything in one click: all 19 research topics and all 14 gear technologies at 10, with 15 stars (star set 15)');
      const some = (await get(`/coins?from=game&user=Tester&tech=14&tl=3&gear=1&gl=2&star=1&sl=15`)).body.toString();
      const zero = (await get(`/coins?from=game&user=Tester&gear=2&gl=0&star=2&sl=5`)).body.toString();
      ok(me.techs[14] === 3 && me.techs[13] === 10 && eq.level(me, 1) === 2 && eq.star(me, 1) === 8 && /at most 8/.test(some) && eq.level(me, 3) === 10
        && eq.level(me, 2) === 0 && eq.star(me, 2) === 0 && /Not researched yet/.test(zero) && eq.setStars(me) === 0,
        'one topic or one gear technology can be set alone; stars stop at the level + 6 the game allows, and an unresearched technology takes none');
      me.techs = saved.techs; if (saved.gear) me.gear = saved.gear; else delete me.gear; me.research = saved.research ?? null; me.gearResearch = saved.gearResearch ?? null;
      c.inbox = c.inbox.filter(m => had.has(m) || !['server.ResourceUpdate', 'server.HeroUpdate'].includes(m.cmd));
    }

    // Rally Spot then Barracks, then train Warriors.
    for (const [pos, type] of [[4, 29], [5, 2]]){
      ok((await c.call('castle.newBuilding', { castleId: castle.id, positionId: pos, buildingType: type })).ok === 1, `build ${type === 29 ? 'Rally Spot' : 'Barracks'}`);
      await c.wait('server.BuildComplate', 5000, d => d.buildingBean.positionId === pos && d.buildingBean.status === 0);
    }
    const list = await c.call('troop.getTroopProduceList', { castleId: castle.id, positionId: 5 });
    const warrior = list.troopList.find(t => t.typeId === 3), scout = list.troopList.find(t => t.typeId === 4);
    ok(list.troopList.length === 12 && warrior.permition && !scout.permition, 'barracks lists all 12 troops; Warriors unlocked, Scouts locked');
    ok(warrior.conditionBean.food === 80 && warrior.conditionBean.wood === 100 && warrior.conditionBean.iron === 50, 'Warrior cost comes from the client data');
    const train = await c.call('troop.produceTroop', { castleId: castle.id, positionId: 5, troopType: 3, num: 10, isShare: false, toIdle: false });
    ok(train.ok === 1, 'training 10 Warriors accepted');
    const queue = await c.call('troop.getProduceQueue', { castleId: castle.id });
    const bq = queue.allProduceQueue.find(q => q.positionId === 5);
    ok(bq && bq.allProduceQueue.length === 1 && bq.allProduceQueue[0].num === 10 && bq.allProduceQueue[0].endTime > 0, 'the batch shows in the barracks queue with a timer');
    const trained = (await c.wait('server.TroopUpdate', 5000)).data;
    ok(trained.troop.militia === 10, 'Warriors finish training and the city is told');
    const locked = await c.call('troop.produceTroop', { castleId: castle.id, positionId: 5, troopType: 4, num: 1, isShare: false, toIdle: false });
    ok(locked.ok < 0 && /Requires/.test(locked.errorMsg), 'locked troops are refused with the requirement');

    // Academy research (Town Hall is level 2 by now).
    ok((await c.call('castle.newBuilding', { castleId: castle.id, positionId: 6, buildingType: 25 })).ok === 1, 'build Academy');
    await c.wait('server.BuildComplate', 5000, d => d.buildingBean.positionId === 6 && d.buildingBean.status === 0);
    const techs = await c.call('tech.getResearchList', { castleId: castle.id });
    ok(techs.academyCount === 1 && techs.acailableResearchBeans.length === 19, 'Academy lists all 19 research topics');
    const agri = techs.acailableResearchBeans.find(t => t.typeId === 1);
    ok(agri.permition && agri.conditionBean.gold === 1000 && agri.conditionBean.food === 500, 'Agriculture cost comes from the client data');
    const res1 = await c.call('tech.research', { castleId: castle.id, techId: 1 });
    ok(res1.ok === 1 && res1.tech.upgradeing, 'Agriculture research starts');
    const done1 = (await c.wait('server.ResearchCompleteUpdate', 5000)).data;
    ok(done1.typeId === 1 && done1.level === 1, 'research finishes and the client is told');
    {
      // Requirements from the wiki's research pages.
      const list = (await c.call('tech.getResearchList', { castleId: castle.id })).acailableResearchBeans, by = id => list.find(t => t.typeId === id);
      const agri2 = by(1).conditionBean.buildings.find(b => b.typeId === 7), mining = by(4).conditionBean.techs.find(t => t.id === 3), msci = by(8).conditionBean.buildings.find(b => b.typeId === 22);
      ok(agri2 && agri2.level === 2 && !agri2.successFlag && !by(1).permition && mining && mining.level === 1 && msci && msci.level === 1,
        'research needs the wiki\'s prerequisites: Agriculture 2 a level 2 Farm, Mining Masonry 1, Military Science a Forge');
      const G = srv.game, pl = srv.store.db.players[srv.store.db.castles[castle.id].playerId], cc = srv.store.db.castles[castle.id];
      const saved = { ...pl.techs }, base = id => G.data.troops[id].time / G.logic.speed;
      pl.techs[8] = 2; const ms2 = G.troops.unitSeconds(cc, pl, 3) / base(3);
      pl.techs[8] = 10; const ms10 = G.troops.unitSeconds(cc, pl, 3) / base(3);
      pl.techs[5] = 5; const ram = G.troops.unitSeconds(cc, pl, 12) / base(12), sword = G.troops.unitSeconds(cc, pl, 6) / base(6);
      pl.techs[17] = 10; const fort = G.forts.unitSeconds(pl, 14) / (G.data.forts[14].time / G.logic.speed);
      pl.techs = saved;
      ok(Math.abs(ms2 - 0.81) < 1e-9 && Math.abs(ms10 - Math.pow(0.9, 10)) < 1e-9 && Math.abs(ram - Math.pow(0.9, 10) / 1.5) < 1e-9 && Math.abs(sword - Math.pow(0.9, 10)) < 1e-9 && Math.abs(fort - Math.pow(0.9, 10)) < 1e-9,
        'Military Science takes 10% off per level (81% at 2, 35% at 10); Metal Casting speeds siege units; Construction speeds wall defenses the same way (35% at 10)');
      // The mayor's attack (the guide's Swordsmen page: 3:45, 1:19 with research 10, 1:09 with 100 attack, 0:20 with 1,000).
      const hook = G.logic.hooks.mayor, at = n => { G.logic.hooks.mayor = (c, kind) => kind === 'attack' ? n : 0; pl.techs[8] = 10; const t = G.troops.unitSeconds(cc, pl, 6) * G.logic.speed; pl.techs = { ...saved }; return t; };
      const s0 = at(0), s100 = at(100), s1000 = at(1000);
      G.logic.hooks.mayor = hook; pl.techs = saved;
      ok(Math.round(s0) === 78 && Math.round(s100) === 68 && Math.round(s1000) === 19, `a mayor's attack speeds training, 13% per 100 points (swordsmen ${s0.toFixed(0)} s, ${s100.toFixed(0)} s, ${s1000.toFixed(0)} s)`);
    }

    // Building requirements from the wiki's building pages: Town Hall 3 needs Walls 1, the Walls need a level 2
    // Quarry and a Workshop, the Workshop a level 2 Forge, the Forge a level 3 Ironmine.
    {
      const th3no = await c.call('castle.upgradeBuilding', { castleId: castle.id, positionId: -1 });
      const wallsNo = await c.call('castle.newBuilding', { castleId: castle.id, positionId: -2, buildingType: 32 });
      const forgeNo = await c.call('castle.newBuilding', { castleId: castle.id, positionId: 21, buildingType: 22 });
      ok(th3no.ok < 0 && /Walls level 1/.test(th3no.errorMsg) && wallsNo.ok < 0 && /Quarry level 2/.test(wallsNo.errorMsg) && forgeNo.ok < 0 && /Ironmine level 3/.test(forgeNo.errorMsg),
        'the wiki\'s building requirements: ' + [th3no.errorMsg, wallsNo.errorMsg, forgeNo.errorMsg].join(' / '));
      // Skip the build times: set up the chain directly for the tests that follow.
      const cc = srv.store.db.castles[castle.id], put = (pos, typeId, level) => { cc.buildings[pos] = { typeId, level, status: 0, startTime: 0, endTime: 0 }; };
      cc.buildings['1003'].level = 2; cc.buildings['1004'].level = 3; put(21, 22, 2); put(20, 26, 1); put(-2, 32, 1);
    }
    // Speed-up item on a long upgrade: Town Hall 2 -> 3 is 3600s / 600 = 6s; 15 minutes off finishes it.
    const th3up = await c.call('castle.upgradeBuilding', { castleId: castle.id, positionId: -1 }); ok(th3up.ok === 1, 'Town Hall 3 upgrade starts' + (th3up.ok === 1 ? '' : ': ' + th3up.errorMsg));
    const sp = await c.call('castle.speedUpBuildCommand', { castleId: castle.id, positionId: -1, itemId: 'consume.2.a' });
    ok(sp.ok === 1, 'Beginner Guidelines accepted as a speed-up');
    const th3 = await c.wait('server.BuildComplate', 3000, d => d.buildingBean.positionId === -1 && d.buildingBean.status === 0);
    ok(th3.data.buildingBean.level === 3, 'the speed-up finishes the Town Hall');

    // Production boost item.
    await c.call('shop.buy', { itemId: 'player.resinc.1', amount: 1 });
    const use = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.resinc.1', num: 1 });
    const buff = (await c.wait('server.PlayerBuffUpdate')).data;
    ok(use.ok === 1 && buff.buffBean.typeId === 'IncFoodProduceBuff', 'Plowshares starts a food production buff');
    const prod = await c.call('interior.getResourceProduceData', { castleId: castle.id });
    const food = prod.resourceProduceDataBean.find(b => b.typeid === 1);
    ok(food.productionCapacity > 0 && food.cimeliaPercentage === Math.round(food.productionCapacity * 0.25) && food.technologicalPercentage === Math.round(food.productionCapacity * 0.10) && food.naturalPercentage === 100 * srv.game.logic.speed,
      `production screen shows the fields' output, Providence and the item and Agriculture bonuses as amounts (${JSON.stringify({ cap: food.productionCapacity, item: food.cimeliaPercentage, tech: food.technologicalPercentage, nat: food.naturalPercentage })})`);
    const rank = await c.call('rank.getPlayerRank', { pageSize: 10, pageNo: 1, sortType: 0, key: null });
    ok(rank.beans.length === Object.keys(srv.store.db.players).length && rank.beans.some(b => b.userName === 'Tester'), 'player ranking lists the lords');

    // ---------- milestone 3: Historic Cities ----------
    const world = require('../src/game/world');
    const grid = require('./historic-grid.json');
    const plain = s => String(s).replace(/^﻿/, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    const near = (a, b) => { a = plain(a); b = plain(b); if (a === b) return true; const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
      for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] <= 2; };
    const wrong = [];
    for (const lv of ['18', '16', '14']) for (const [x, y, name] of grid[lv]){
      const h = world.historicAt(world.idOf(x, y));
      if (!h || String(h.level) !== lv || !near(h.name, name)) wrong.push(`${x},${y} ${name} -> ${h ? h.name + ' L' + h.level : 'nothing'}`);
    }
    ok(wrong.length === 0, `all ${grid['18'].length + grid['16'].length + grid['14'].length} Historic Cities in Fox's grid are in place` + (wrong.length ? ': ' + wrong.slice(0, 5).join('; ') : ''));
    const hm = await c.call('common.mapInfoSimple', { castleId: castle.id, x1: 28, y1: 160, x2: 38, y2: 170 });
    const sara = hm.castles.find(b => b.id === world.idOf(33, 165));
    ok(hm.mapStr.slice(2 * (5 * 11 + 5), 2 * (5 * 11 + 5) + 2) === 'ca' && sara && sara.name === 'Sarajevo' && sara.powerLevel === 2 && sara.npc && sara.playerLogoUrl === null && sara.zoneName === 'FRIESLAND',
      'Sarajevo is drawn as a level 14 Historic City in Friesland');
    const atl = await c.call('field.getOtherFieldInfo', { castleId: castle.id, fieldId: 0 });
    ok(atl.bean.powerLevel === 0 && /Atlantis/.test(atl.bean.name), 'Atlantis at 0,0 is the level 18 Historic City');
    const dc = await c.call('field.getOtherFieldInfo', { castleId: castle.id, fieldId: world.idOf(100, 100) });
    ok(dc.bean.powerLevel === 1 && dc.bean.name === 'Washington, D.C.', 'Washington, D.C. at 100,100 is a level 16 capital');

    const l12 = world.tileAt(srv.store, world.idOf(9, 9));
    ok(l12.historic && l12.historic.level === 12 && !world.historicAt(world.idOf(0, 9)), 'level 12 Historic Cities are every 18 tiles from 9,9');
    // Fox's checks on the live server (Oct 2026).
    const live12 = [[9, 9, 'San Jose'], [675, 279, 'Townsville'], [243, 585, 'Jihlava'], [261, 585, 'Chomutov'], [279, 585, 'Prerov'], [783, 783, 'Hong Kong']];
    const bad12 = live12.filter(([x, y, n]) => { const h = world.historicAt(world.idOf(x, y)); return !h || h.level !== 12 || !near(h.name, n); });
    ok(bad12.length === 0, 'level 12 names match the live server' + (bad12.length ? ': ' + bad12.map(b => b.join(',')).join('; ') : ''));
    ok(!world.historicAt(world.idOf(621, 297)) && !world.historicAt(world.idOf(99, 99)), 'no level 12 right next to Harare or Washington, D.C.');
    const g12 = srv.game.npc.full(l12);
    const either = (g12.troops.swordsmen || 0) + (g12.troops.pikemen || 0), cav = (g12.troops.heavyCavalry || 0) + (g12.troops.lightCavalry || 0);
    ok(g12.troops.militia === 1120000 && either === 162666 && g12.troops.archer === 42807 && cav === 108444 && g12.forts.trap === 22000 && g12.ruler.level === 100,
      'a level 12 Historic City has its real garrison and a level 100 ruler');
    const g14 = srv.game.npc.full(world.tileAt(srv.store, world.idOf(33, 165))), g16 = srv.game.npc.full(world.tileAt(srv.store, world.idOf(100, 100))), g18 = srv.game.npc.full(world.tileAt(srv.store, 0));
    {
      // Live (Fox's scout reports): a level 12 with 108,444 Ballistae and a level 14 with 271,111 (as many as their cavalry);
      // NPC 6 has 2,250 abatis; levels 12 and 14 hold an NPC 10's stores.
      const N = srv.game.npc, siege = (t, at) => { const x = N.full(t, at).troops; return ['ballista', 'catapult', 'batteringRam'].map(k => x[k] ? `${k} ${x[k]}` : '').join(''); };
      const t12 = world.tileAt(srv.store, world.idOf(9, 9)), t14 = world.tileAt(srv.store, world.idOf(33, 165)), seen = new Set();
      for (let d = 0; d < 30; d++){ const at = Date.now() + d * 86400000; seen.add(siege(t12, at)); seen.add(siege(t14, at)); }
      const npc10s = N.full({ type: 12, level: 10 }).res, s14 = N.full(t14).res;
      ok(seen.has('ballista 108444') && seen.has('ballista 271111') && (seen.has('catapult 14640') || seen.has('batteringRam 14640')) && !seen.has('ballista 14640')
        && N.full({ type: 12, level: 6 }).forts.abatis === 2250 && s14.food === npc10s.food && s14.gold === npc10s.gold,
        'Historic City Ballistae come as many as their cavalry (108,444 at level 12, 271,111 at 14); NPC 6 has 2,250 abatis; a level 14 holds an NPC 10\'s stores');
    }
    ok(g14.troops.militia === 2800000 && g14.troops.archer === 171228 && g16.troops.militia === 7000000 && g16.troops.archer === 428070
      && g18.troops.militia === 14000000 && g18.troops.archer === 856140 && g18.forts.arrowTower === 6666, 'level 14, 16 and 18 Historic Cities have their real garrisons');
    {
      // Levels 16 and 18 (the guide): always Cataphracts and Catapults; only swordsmen and pikemen change day to day.
      const t16 = world.tileAt(srv.store, world.idOf(100, 100)), t18 = world.tileAt(srv.store, 0), seen = new Set();
      let fixed = true;
      for (let d = 0; d < 20; d++){
        const at = Date.now() + d * 86400000, a = srv.game.npc.full(t16, at).troops, b = srv.game.npc.full(t18, at).troops;
        for (const [x, cav, cat] of [[a, 677777, 91500], [b, 1355555, 183000]])
          if (x.heavyCavalry !== cav || x.catapult !== cat || x.lightCavalry || x.ballista || x.batteringRam) fixed = false;
        seen.add(a.swordsmen ? 'swordsmen' : 'pikemen');
      }
      ok(fixed && seen.size === 2, 'level 16 and 18 Historic Cities always have Cataphracts and Catapults; their swordsmen and pikemen still alternate');
    }
    const npc10 = srv.game.npc.full({ type: 12, level: 10 }), npc5 = srv.game.npc.full({ type: 12, level: 5 });
    ok(npc10.troops.militia === 400000 && npc10.forts.arrowTower === 3666 && npc10.res.food === 19000000 && npc5.troops.pikemen === 1000 && npc5.res.gold === 450000,
      'NPC cities use Evony\'s real garrisons and stores');

    // ---------- heroes ----------
    {
      const innNo = await c.call('castle.newBuilding', { castleId: castle.id, positionId: 7, buildingType: 21 });
      ok(innNo.ok < 0 && /Cottage level 2/.test(innNo.errorMsg), 'an Inn needs a level 2 Cottage (the wiki)');
      srv.store.db.castles[castle.id].buildings['0'].level = 2;
    }
    for (const [pos, type] of [[7, 21], [8, 27]]){
      const r = await c.call('castle.newBuilding', { castleId: castle.id, positionId: pos, buildingType: type });
      ok(r.ok === 1, `build ${type === 21 ? 'Inn' : 'Feasting Hall'}` + (r.ok === 1 ? '' : ': ' + r.errorMsg));
      await c.wait('server.BuildComplate', 5000, d => d.buildingBean.positionId === pos && d.buildingBean.status === 0);
    }
    const inn = await c.call('hero.getHerosListFromTavern', { castleId: castle.id });
    ok(inn.heros.length === 1 && inn.posCount === 1 && /^images\/icon\/player\/face[AB]\d+\.jpg$/.test(inn.heros[0].logoUrl) && !/ /.test(inn.heros[0].name),
      'a level 1 Inn offers 1 ordinary hero (one name, generic portrait); the Feasting Hall has 1 place');
    const oldSave = { heroes: [{ id: 1, name: 'Brienne Thorne', face: 412, sex: true }, { id: 2, name: 'Sir Fox', face: 17 }], inn: { offers: [{ name: 'Otto Pell', face: 5 }] } };
    srv.game.heroes.migrate(oldSave);
    ok(oldSave.heroes[0].name === 'Brienne' && /faceB\d+\.jpg$/.test(oldSave.heroes[0].face) && oldSave.heroes[1].name === 'Sir Fox' && /faceA\d+\.jpg$/.test(oldSave.heroes[1].face) && !oldSave.inn,
      'heroes from older saves get a generic portrait and lose the invented surname');
    const hb = srv.game.heroes.bean({ ...srv.game.heroes.makeHero(5, null, new Set()), level: 37, id: 9, status: 0 });
    const noTech = { techEffect: () => 0 }, lvl10 = { level: 10, base: { atk: 50, int: 40 }, added: { atk: 0, int: 0 } };
    const lvl100 = { level: 100, base: { atk: 50, int: 40 }, added: { atk: 0, int: 0 } };
    const lead = (h, n, side) => srv.game.combat.mods(noTech, {}, h, { archer: n }, { side }).attack;
    ok(hb.leadership === 37 && srv.game.combat.leads(lvl10) === 1100 && srv.game.combat.leads(lvl100) === 110000 && lead(lvl10, 1100) === 50 && lead(lvl100, 110000) === 50,
      'leadership = level; a hero leads (leadership x 10 + level) x leadership troops: 1,100 at level 10, 110,000 at level 100 (the guide)');
    ok(lead(lvl10, 2200) === 25 && lead(lvl10, 2200, 'defence') === 31.25 && Math.abs(srv.game.combat.mods(noTech, {}, lvl10, { archer: 2200 }, { side: 'defence' }).defence - 40 * srv.game.rules.heroDefencePerIntelligence * 0.625) < 1e-9,
      'troops beyond that get none of his bonus in attack and a quarter of it in defence (2,200 under a level 10 hero: 50% / 62.5% of it)');
    {
      // Fox, live: behind level 10 Walls with Archery 10, archers reach 2,340 and archer's towers 2,535 (4.5% a Walls level).
      const C = srv.game.combat, arch10 = { techEffect: (p, id) => id === 14 ? 50 : 0 };
      const st = C.stacks({ troops: { archer: 10 }, forts: { arrowTower: 10 }, mods: C.mods(arch10, {}, null, { archer: 10 }, { side: 'defence', walls: 10 }) }, 'D', 0);
      const open = C.stacks({ troops: { archer: 10 }, mods: C.mods(arch10, {}, null, { archer: 10 }) }, 'A', 0);
      const npc10 = srv.game.npc.mods({ type: 12, level: 10 }, srv.game.data.techs, null);
      ok(Math.round(st.find(x => x.field === 'archer').range) === 2340 && Math.round(st.find(x => x.tower).range) === 2535 && Math.round(open[0].range) === 1800 && npc10.range === 95,
        'Walls give defenders 4.5% range a level: archers 2,340 and towers 2,535 behind level 10 Walls with Archery 10 (1,800 in the open); NPC 10 gets the same');
    }
    {
      // m3.74: ranged units shoot enemy ranged units in range first (the Age I combat guide), which makes the
      // guide's ballista farming of NPC 1-5 lossless.
      const C = srv.game.combat, N = srv.game.npc, techs = srv.game.data.techs;
      const melee = { ranged: false, x: 500, count: 100, atk: 10, speed: 400 }, arch = { ranged: true, x: 1500, count: 5, atk: 10, speed: 250 };
      ok(C.pick({ ranged: true, x: 0, range: 2100 }, [melee, arch]) === arch && C.pick({ ranged: true, x: 0, range: 1000 }, [melee, arch]) === melee
        && C.pick({ ranged: false, x: 1400, range: 200 }, [melee, arch]) === arch,
        'a ballista with an archer stack in range shoots it before closer melee; with none in range it shoots the closest');
      const t10 = { techEffect: (p, id) => techs[id]?.levels[9]?.effect || 0 }, farmer = { level: 50, base: { atk: 250, int: 250 }, added: { atk: 0, int: 0 } };
      const farm = [[1, 20], [2, 50], [3, 170], [4, 270], [5, 550]].map(([L, n]) => {
        const tile = { type: 12, level: L }, g = N.full(tile);
        const r = C.fight({ troops: { ballista: n }, mods: C.mods(t10, {}, farmer, { ballista: n }) }, { troops: g.troops, forts: g.forts, mods: N.mods(tile, techs, null) });
        return r.attackerWon && r.att[0].lose === 0;
      });
      ok(farm.every(Boolean), `20/50/170/270/550 ballistae with research 10 beat NPC 1-5 without loss (the guide's farming table): ${farm}`);
      // Fox's wave on a level 12 Historic City's remnants (Oct 26 2026): 1,000 of each troop and 90,000 catapults
      // against 108,444 ballistae, 6,666 towers and a few troops. dxcalc: the wave dies, every troop but the
      // ballistae dies, the traps and abatis are spent, no tower falls (dxcalc also kills 52 ballistae; we kill none).
      const hcTile = { type: 12, level: 10, historic: { level: 12 } };
      const wave = { peasants: 1000, militia: 1000, scouter: 1000, pikemen: 1000, swordsmen: 1000, archer: 1000, lightCavalry: 1000, heavyCavalry: 1000, ballista: 1000, batteringRam: 1000, catapult: 90000 };
      const piper = { level: 25, leadership: 25, base: { atk: 268, int: 160 }, added: { atk: 0, int: 0 } };
      const hc = C.fight({ troops: wave, mods: C.mods(t10, {}, piper, wave, { life: 50 }) },
        { troops: { militia: 1402, swordsmen: 203, archer: 53, lightCavalry: 135, ballista: 108444 }, forts: { arrowTower: 6666, trap: 2, abatis: 1 },
          mods: N.mods(hcTile, techs, { attack: 635, intelligence: 335 }) });
      const lost = f => hc.def.find(u => u.field === f)?.lose;
      ok(!hc.attackerWon && hc.att.every(u => u.lose === u.count) && ['militia', 'swordsmen', 'archer', 'lightCavalry'].every(f => lost(f) === hc.def.find(u => u.field === f).count)
        && lost('arrowTower') === 0 && lost('trap') === 2 && lost('abatis') === 1 && lost('ballista') < 1000,
        `Fox's HC 12 wave: the wave dies, the HC loses every troop but its ballistae, its traps and abatis, and no tower, as in dxcalc (${hc.round} rounds)`);
    }
    const offer = inn.heros[0];
    const liveCastle = srv.store.db.castles[castle.id];
    const goldBefore = liveCastle.res.gold;
    const hire = await c.call('hero.hireHero', { castleId: castle.id, heroName: offer.name });
    ok(hire.ok === 1, 'hiring the hero succeeds');
    const added = (await c.wait('server.HeroUpdate')).data;
    const goldAfter = liveCastle.res.gold;
    ok(added.updateType === 0 && added.hero.name === offer.name, 'the hero joins the Feasting Hall');
    ok(Math.abs(goldBefore - goldAfter - offer.level * 1000) < 50, `hiring cost level x 1,000 gold (${offer.level * 1000})`);
    const full = await c.call('hero.refreshHerosListFromTavern', { castleId: castle.id });
    const hire2 = await c.call('hero.hireHero', { castleId: castle.id, heroName: full.heros[0].name });
    ok(hire2.ok < 0 && /Feasting Hall is full/.test(hire2.errorMsg), 'a full Feasting Hall blocks hiring');
    const hero = added.hero;
    ok((await c.call('hero.promoteToChief', { castleId: castle.id, heroId: hero.id })).ok === 1 && (await c.wait('server.HeroUpdate')).data.hero.status === 1, 'the hero can be made mayor');
    ok((await c.call('hero.dischargeChief', { castleId: castle.id })).ok === 1 && (await c.wait('server.HeroUpdate')).data.hero.status === 0, 'and relieved again');

    // ---------- an attack on a valley ----------
    const t100 = await c.call('troop.produceTroop', { castleId: castle.id, positionId: 5, troopType: 3, num: 60, isShare: false, toIdle: false });
    ok(t100.ok === 1, 'train 60 more Warriors' + (t100.ok === 1 ? '' : ': ' + t100.errorMsg));
    await c.wait('server.TroopUpdate', 8000, d => d.troop.militia >= 70);
    let target = null;
    for (let r = 1; r < 12 && !target; r++) for (let dx = -r; dx <= r && !target; dx++) for (const dy of [-r, r]){
      const id = world.idOf(fx + dx, fy + dy), t = world.tileAt(srv.store, id);
      if (t.type >= 1 && t.type <= 6 && t.level === 1){ target = id; break; }
    }
    ok(!!target, 'found a level 1 valley nearby');
    const noHero = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 5, heroId: -1, targetPoint: target, troops: { militia: 50 }, resource: {}, restTime: 0 } });
    ok(noHero.ok < 0 && /hero/.test(noHero.errorMsg), 'an attack without a hero is refused');
    const scoutMil = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 3, heroId: -1, targetPoint: target, troops: { militia: 10 }, resource: {}, restTime: 0 } });
    ok(scoutMil.ok < 0 && /Scouts/.test(scoutMil.errorMsg), 'scouting with Warriors is refused');
    const send = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 5, heroId: hero.id, targetPoint: target, troops: { militia: 70 }, resource: {}, restTime: 0 } });
    ok(send.ok === 1, 'an attack with a hero and 70 Warriors marches' + (send.ok === 1 ? '' : ': ' + send.errorMsg));
    const out = (await c.wait('server.SelfArmysUpdate', 3000, d => d.armys.length === 1)).data.armys[0];
    ok(out.direction === 1 && out.missionType === 5 && out.troop.militia === '70' && out.reachTime > out.startTime && out.hero === hero.name, 'the army shows on the march with its hero');
    {
      // The march window's estimate (NewArmyWin): seconds = distance x 60,000 / speed. The test server runs 600x.
      const a = Object.values(srv.store.db.armies)[0], tx = target % 800, ty = Math.floor(target / 800);
      const dist = Math.hypot(Math.min(Math.abs(tx - fx), 800 - Math.abs(tx - fx)), Math.min(Math.abs(ty - fy), 800 - Math.abs(ty - fy)));
      const speed = srv.game.data.troops[3].speed * (1 + srv.game.logic.techEffect(srv.store.db.players[srv.store.db.castles[castle.id].playerId], 12) / 100);
      const want = Math.max(1000, dist * 60000 / speed * 1000 / 600);
      ok(Math.abs((a.reachTime - a.startTime) - want) < 5, `travel time matches the march window (${(dist * 60000 / speed).toFixed(0)} s at 1x speed)`);
    }
    const rep = (await c.wait('server.NewReport', 8000)).data;
    ok(rep.army_count >= 1, 'a battle report arrives');
    const field = (await c.wait('server.CastleFieldUpdate', 3000).catch(() => null))?.data;
    ok(field && field.updateType === 0 && field.bean.id === target, 'the valley is taken');
    const back = (await c.wait('server.SelfArmysUpdate', 8000, d => d.armys.length === 0)).data;
    ok(back.armys.length === 0, 'the army comes home');
    const reps = await c.call('report.receiveReportList', { pageNo: 1, pageSize: 10, reportType: 1 });
    const br = reps.reports[0];
    ok(br && /<battleReport isAttack="true" isAttackSuccess="true"/.test(br.content) && /<troopUnit typeId="3" count="70"/.test(br.content) && /<backTroop/.test(br.content), 'the report has the battle details the client reads');
    const read = await c.call('report.markAsRead', { reportId: br.id });
    ok(read.ok === 1 && read.report.isRead === 1, 'reports can be read');
    const fields = await c.call('field.getCastleFieldInfo', { castleId: castle.id });
    ok(fields.fields.length === 1 && fields.fields[0].id === target, 'the valley is listed under your city');
    const prod2 = await c.call('interior.getResourceProduceData', { castleId: castle.id });
    ok(prod2.resourceProduceDataBean.some(b => b.fieldPercentage > 0), 'the valley raises production');
    const hstate = srv.game.heroes.find(srv.store.db.castles[castle.id], hero.id);
    ok(hstate.exp > 0 && hstate.status === 0, `the hero gained ${hstate.exp} experience and is free again`);
    // A flat can be conquered too (City Expansion: Conquering). Live, flats hold troops like valleys (a level 2 flat:
    // 51 warriors, 17 pikemen); taken, it fills a valley slot.
    {
      let flat = null;
      for (let r = 1; r < 30 && !flat; r++) for (let dx = -r; dx <= r && !flat; dx++) for (const dy of [-r, r]){
        const id = world.idOf(fx + dx, fy + dy), t = world.tileAt(srv.store, id);
        if (t.type === world.T.FLAT && t.level <= 2 && !srv.store.db.tiles[id]){ flat = id; break; }
      }
      const home = srv.store.db.castles[castle.id]; home.troops.militia = (home.troops.militia || 0) + 400;
      const go = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 5, heroId: hero.id, targetPoint: flat, troops: { militia: 400 }, resource: {}, restTime: 0 } });
      const got = go.ok === 1 && await c.wait('server.CastleFieldUpdate', 8000, d => d.bean.id === flat).catch(() => null);
      await c.wait('server.SelfArmysUpdate', 8000, d => d.armys.length === 0).catch(() => null);
      const owner = srv.store.db.players[srv.store.db.castles[castle.id].playerId];
      ok(!!got && srv.game.quests.state(owner).flags.flat && srv.store.db.castles[castle.id].valleys.includes(flat), 'a flat can be conquered, as City Expansion asks' + (go.ok === 1 ? '' : ': ' + go.errorMsg));
      for (let i = 0; i < 50 && srv.game.heroes.find(srv.store.db.castles[castle.id], hero.id).status !== 0; i++) await new Promise(res => setTimeout(res, 100));
    }
    // Valley levels go up one a day at the daily reset and wrap from 10 to 1; a held valley keeps its level.
    {
      const DAY = 86400000, t0 = Date.UTC(2026, 9, 21, 12), VALLEYS = new Set([1, 2, 3, 4, 5, 6]);
      let free = null, ten = null;
      for (let r = 1; r < 30 && !(free && ten); r++) for (let dx = -r; dx <= r; dx++) for (const dy of [-r, r]){
        const id = world.idOf(fx + dx, fy + dy), t = world.tileAt(srv.store, id, t0);
        if (srv.store.db.tiles[id] || !VALLEYS.has(t.type)) continue;
        if (!free && t.level < 10) free = id;
        if (!ten && t.level === 10) ten = id;
      }
      const lv = (id, t) => world.tileAt(srv.store, id, t).level;
      const reset = (world.cycleDay(t0) + 1) * DAY + (srv.game.rules.dailyResetHourUTC || 0) * 3600000;   // the next daily reset
      ok(free != null && lv(free, t0 + DAY) === lv(free, t0) + 1 && lv(free, t0 + 5 * DAY) === (lv(free, t0) + 4) % 10 + 1 && lv(free, reset - 1) === lv(free, t0) && lv(free, reset) === lv(free, t0) + 1,
        'an unheld valley goes up a level at each daily reset');
      ok(ten != null && lv(ten, t0 + DAY) === 1, 'a level 10 valley goes back to level 1 the next day');
      const t = world.tileAt(srv.store, free, t0);
      srv.store.db.tiles[free] = { type: t.type, level: t.level, ownerCastle: castle.id };
      ok(lv(free, t0 + 3 * DAY) === t.level && world.terrain(srv.store.db.seed, free).type === t.type, 'a held valley keeps the level it was taken at');
      delete srv.store.db.tiles[free];
      ok(lv(free, t0 + 3 * DAY) === (t.level + 2) % 10 + 1, 'and joins the cycle again once given up');
    }

    // ---------- historic heroes ----------
    const hhLogic = srv.game.hh, me = srv.store.db.players[castle.playerId] || Object.values(srv.store.db.players)[0];
    ok(hhLogic.roster.size === 639 && Object.values(srv.store.db.hh).filter(s => s.status === 'free' && s.fieldId != null).length === 639, 'all 639 historic heroes wait in NPC cities');
    const say = await c.call('npchero.getNpcHerosList', { castleId: castle.id });
    ok(say.ok === 1 && say.simpleNpcHeros.length === 10 && /^images\/icon\/hero\/\d+\.png$/.test(say.simpleNpcHeros[0].logourl) && /^Rumour has it/.test(say.simpleNpcHeros[0].introduce2),
      'the Inn has hearsay about 10 historic heroes');
    // Put Caesar in a level 1 NPC city next door for the test.
    let npcTile = null;
    for (let r = 1; r < 40 && !npcTile; r++) for (let dx = -r; dx <= r && !npcTile; dx++) for (const dy of [-r, r]){
      const id = world.idOf(fx + dx, fy + dy), t = world.tileAt(srv.store, id);
      if (t.type === world.T.NPC && t.level === 1 && !t.historic && !hhLogic.byField.has(id)){ npcTile = id; break; }
    }
    if (!npcTile){ npcTile = world.idOf(fx + 3, fy); srv.store.db.tiles[npcTile] = { type: world.T.NPC, level: 1 }; }
    hhLogic.byField.delete(srv.store.db.hh[146].fieldId); srv.store.db.hh[146] = { status: 'free', fieldId: npcTile, loyalty: 100, hitAt: 0 }; hhLogic.byField.set(npcTile, 146);
    srv.store.db.castles[castle.id].res.gold = 200;
    const poor = await c.call('npchero.getNpcHerosListByFilter', { castleId: castle.id, filter: 'caesar' });
    srv.store.db.castles[castle.id].res.gold = 1000000;
    const found = await c.call('npchero.getNpcHerosListByFilter', { castleId: castle.id, filter: 'caesar' });
    ok(poor.ok < 0 && /1,000 gold/.test(poor.errorMsg) && found.ok === 1 && found.simpleNpcHeros.some(h => h.npcid === 146 && h.name === 'Caesar'), 'Hero Search finds Caesar for 1,000 gold');
    const coins0 = me.coins;
    const det = await c.call('npchero.getNpcHeroInfroByID', { castleId: castle.id, npcid: 146 });
    const { x: nx, y: ny } = world.xy(npcTile);
    ok(det.ok === 1 && det.simpleNpcHeros[0].introduce2.startsWith('According to') && det.simpleNpcHeros[0].introduce2.includes(`(${nx},${ny})`) && me.coins === coins0 - 10 && me.items['hero.taskitem.146'] === 1,
      'Enquire Details costs 10 cents and gives the location and the portrait');
    const acc = await c.call('quest.accept', { ncpid: 146, castleid: castle.id });
    ok(acc.ok === 1 && acc.quests[0].name === 'Caesar' && /accepted/.test(acc.errorMsg), 'the hero\'s quest can be accepted at the Inn');
    const qt = await c.call('quest.getQuestType', { castleId: castle.id, type: 4 });
    const ql = await c.call('quest.getQuestList', { castleId: castle.id, typeId: qt.types[0]?.typeId });
    ok(qt.types.length === 1 && qt.types[0].mainId === 4 && qt.types[0].name === 'Heros' && ql.quests[0].name === 'Caesar' && ql.quests[0].description === 'Catch Hero quest  Caesar quest' && ql.quests[0].targets.length === 2 && ql.quests[0].targets[0].finished && !ql.quests[0].isFinish
      && ql.quests[0].award === 'Aries Amulet 1, Beginner Guidelines 1, Population 30, Food 200, Lumber 1000, Stone 200, Iron 100.', 'it shows under Quests, Hero Quests, Heros, worded as live' + (ql.quests[0] ? ': ' + ql.quests[0].award : ''));
    const city = srv.store.db.castles[castle.id];
    const G = srv.game, db = srv.store.db, A = G.armies, titleWas = me.title || 0, citiesWas = [...me.castles];
    me.title = Math.max(titleWas, me.castles.length + 3);   // room for three conquests
    const heroObj = G.heroes.find(city, hero.id);
    const hit = async (target, heroId = hero.id, from = city) => {
      from.troops.lightCavalry = 10000;
      const r = await c.call('army.newArmy', { castleId: from.id, newArmyBean: { missionType: 5, heroId, targetPoint: target, troops: { lightCavalry: 10000 }, resource: {}, restTime: 0 } });
      if (r.ok !== 1) return r.errorMsg;
      for (let i = 0; i < 200 && Object.values(db.armies).some(a => a.playerId === me.id); i++) await new Promise(res => setTimeout(res, 100));
      return Object.values(db.armies).some(a => a.playerId === me.id) ? 'the army did not come home' : null;
    };
    const lastReport = async () => (await c.call('report.receiveReportList', { pageNo: 1, pageSize: 5, reportType: 1 })).reports[0];
    const loyaltyOf = id => Math.floor(G.npc.state(db, world.tileAt(srv.store, id), Date.now()).loyalty);
    const cityAt = id => me.castles.map(x => db.castles[x]).find(x => x && x.fieldId === id);
    // Fox's live reports (Oct 23 2026): each won attack lowers an NPC city's loyalty; at 0 the city is conquered.
    const e1 = await hit(npcTile), r1 = await lastReport(), loy1 = Number((/The Loyalty of this city is (\d+)/.exec(r1?.content || '') || [])[1]);
    ok(!e1 && /heroName="Caesar"/.test(r1?.content || '') && /heroUrl="images\/icon\/hero\/146.png"/.test(r1.content)
      && new RegExp(`support="-\\d" complaint="\\d" isSeize="false" seizeProblem="The Loyalty of this city is ${loy1}."`).test(r1.content) && /injuredPer="10"/.test(r1.content) && loy1 < 80 && loy1 >= 70 && new RegExp(`loyalty ${loy1}$`).test(r1.title),
      `a won attack lowers the city's loyalty (80 to ${loy1}) and the report says so as live; Caesar leads the defence` + (e1 ? ': ' + e1 : r1 ? ': ' + r1.title : ''));
    {
      const at = (l, x) => A.loyaltyDrop(l, 1, () => x);
      let n = 0, l = 90; const rng = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
      while (l > 0 && n < 200){ l -= A.loyaltyDrop(l, 1 + n % 15, rng); n++; }
      ok([at(90, 0.1), at(90, 0.5), at(90, 0.9), at(80, 0.05), at(50, 0.3), at(10, 0.9)].join() === '2,3,4,1,2,3' && A.loyaltyDrop(50, 1, () => 0.5) === A.loyaltyDrop(50, 15, () => 0.5) && n >= 26 && n <= 44,
        `a win takes 1, 2 or 3 loyalty (10/40/50%), 2-4 above 80, whatever the battle's length (Fox): ${n} wins took a level 8 from 90`);
    }
    {
      const t = { id: 4242, type: world.T.NPC, level: 5 }, sp = G.npc.speed || 1;
      db.npc[t.id] = { troops: {}, forts: {}, res: {}, loyalty: 50, hitAt: Date.now() - 360000 / sp };
      const back = G.npc.state(db, t, Date.now()).loyalty; delete db.npc[t.id];
      ok(Math.floor(back) === 52, `loyalty climbs back a point every 3 minutes (50 to ${back.toFixed(1)} in 6)`);
    }
    // At 0, with Caesar's quest and portrait: the city is ours and Caesar is captured.
    // (The test server's clock runs fast, so start well below 0: loyalty comes back while the army marches.)
    db.npc[npcTile] = { ...G.npc.state(db, world.tileAt(srv.store, npcTile), Date.now()), loyalty: -1000, hitAt: Date.now() };
    const e2 = await hit(npcTile), r2 = await lastReport(), nc = cityAt(npcTile);
    const ch = [city, nc].filter(Boolean).flatMap(x => G.heroes.list(x)).find(h => h.historic === 146), heldIn = [city, nc].find(x => x && G.heroes.list(x).includes(ch));
    ok(!e2 && nc && me.castles.length === citiesWas.length + 1 && /isSeize="true"/.test(r2?.content || '') && !/seizeProblem/.test(r2.content) && !/backTroop/.test(r2.content) && /conquered/.test(r2.title)
      && world.tileAt(srv.store, npcTile).type === world.T.CASTLE && G.heroes.list(nc).some(h => h.id === hero.id) && (nc.troops.lightCavalry || 0) > 0 && !G.heroes.list(city).some(h => h.id === hero.id)
      && nc.buildings['-1'].level === 1 && Object.values(nc.buildings).filter(b => b.typeId === 1).length === 20 && Object.values(nc.buildings).filter(b => b.typeId === 7).length === 10
      && Object.values(nc.buildings).filter(b => b.typeId === 27).length === 1 && [12, 20, 31].every(x => nc.buildings[x]?.typeId === 1) && nc.buildings[0]?.typeId === 25 && nc.buildings[3]?.typeId === 27 && nc.buildings[11]?.typeId === 2 && nc.name === 'New city' && nc.taxRate === 10 && nc.commence?.food === 80 && nc.commence?.iron === 80 && Math.abs(nc.pop - G.logic.popMax(nc) * 0.9) < 1e-6
      && nc.buildings[5]?.typeId === 30 && nc.buildings[1011]?.typeId === 4 && nc.buildings[1012]?.typeId === 5 && nc.buildings[1013]?.typeId === 6 && nc.buildings[1010]?.typeId === 7 && !nc.buildings[1014],
      'at loyalty 0 the city is ours, called "New city", with the live layout (Cottages on plots 12-31, Academy on 0, Feasting Hall on 3, Barracks on 11, Farms from 1001, then Sawmill, Quarry and Ironmine on the last of 13 plots), and the army and its hero stay there' + (e2 ? ': ' + e2 : r2 ? ': ' + r2.title : ''));
    const cb = ch && G.heroes.bean(ch);
    ok(ch && ch.status === 4 && db.hh[146].status === 'seized' && cb.itemId === 'hero.taskitem.146' && cb.itemAmount === 1 && (me.reports || []).some(x => x.title === 'Caesar captured')
      && cb.isHero === 1 && cb.level === 30 && cb.remainPoint === 0 && cb.managementAdded + cb.powerAdded + cb.stratagemAdded === 60 && cb.logoUrl === 'images/icon/hero/146.png' && cb.leadership === [...G.hh.roster.values()].find(h => h.id === 146).ldr + 29
      && cb.power === 75 + cb.powerAdded && cb.management === 94 + cb.managementAdded && cb.stratagem === 62 + cb.stratagemAdded && cb.infro.length > 20,
      'with the quest and the portrait Caesar is captured: level 30 with his portrait, biography, base stats (94 politics: the live ranking), his leadership plus 29 for his levels (Fox) and 60 points spread at random (2 a level, live), to be persuaded with his portrait');
    {
      const R = [...srv.game.hh.roster.values()], by = n => R.find(h => h.name === n);
      ok(by('Genghis Khan')?.atk === 97 && by('Genghis Khan')?.int === 91 && by('Isaac Newton')?.atk === 50 && by('Isaac Newton')?.int === 98 && R.filter(h => h.estimated).length < 10,
        `historic heroes have attack and intelligence the right way round (Genghis Khan 97 attack, Isaac Newton 98 intelligence), with only ${R.filter(h => h.estimated).length} estimated`);
      const old = { historic: by('Isaac Newton').id, base: { pol: 80, atk: 98, int: 50 }, leadership: 90 };
      ok(srv.game.hh.sync(old) && old.base.atk === 50 && old.base.int === 98 && !srv.game.hh.sync(old), 'a historic hero hired under the old sheet takes the corrected stats once');
    }
    {
      const ql2 = await c.call('quest.getQuestList', { castleId: castle.id, typeId: 2000000 });
      const am0 = me.items['player.box.gambling.3'] || 0, bg0 = me.items['consume.2.a'] || 0, pop0 = city.pop;
      const claim = await c.call('quest.award', { castleId: castle.id, questId: 2000146 });
      ok(ql2.quests[0]?.isFinish && claim.ok === 1 && me.items['player.box.gambling.3'] === am0 + 1 && me.items['consume.2.a'] === bg0 + 1 && city.pop >= pop0 + 29 && !G.hh.quests(me)[146],
        'capturing Caesar finishes his quest, which pays the live award (an Aries Amulet, Beginner Guidelines, 30 population and some resources)');
      ok(cb.loyalty === 0, 'a captive\'s loyalty is 0, as live');
    }
    heldIn.res.gold = 1000000; me.items['hero.taskitem.146'] = 0;
    const noPortrait = await c.call('hero.tryGetSeizedHero', { castleId: heldIn.id, heroId: ch.id });
    me.items['hero.taskitem.146'] = 1;
    const persuaded = await c.call('hero.tryGetSeizedHero', { castleId: heldIn.id, heroId: ch.id });
    ok(noPortrait.ok < 0 && /portrait/.test(noPortrait.errorMsg) && persuaded.ok === 1 && ch.status === 0 && ch.loyalty === 70 && db.hh[146].status === 'hired' && !me.items['hero.taskitem.146'] && heldIn.res.gold <= 1000000 - 30000 + 100,
      'persuading Caesar takes 30,000 gold and his portrait');
    {
      const f = srv.game.quests.state(me).flags;
      ok(f.heroSearch && f.enquire && f.hearsay && f.captureHero && f.captureFamous, 'Hero Search, Enquire Details, accepting the task and winning Caesar over tick the Hero Recruitment quests');
    }
    me.items['hero.reset.1'] = 3;
    const wash = await c.call('hero.resetPoint', { castleId: heldIn.id, heroId: ch.id });
    ok(wash.ok === 1 && ch.points === 60 && ch.added.pol + ch.added.atk + ch.added.int === 0 && me.items['hero.reset.1'] === 0, 'three Holy Water free Caesar\'s 60 points to place');
    const ren = await c.call('hero.changeName', { castleId: heldIn.id, heroId: ch.id, newName: 'Bob' });
    ok(ren.ok < 0, 'a historic hero keeps his name');
    ok((await c.call('hero.fireHero', { castleId: heldIn.id, heroId: ch.id })).ok === 1 && srv.store.db.hh[146].status === 'free' && srv.store.db.hh[146].fieldId !== npcTile,
      'a dismissed historic hero goes back to an NPC city somewhere else');
    // Fox (Oct 23 2026): a barbarian city's hero is randomized daily; conquering the city captures it, and you can
    // then persuade (bribe) the hero to join, or release it.
    {
      const tile = { id: world.idOf(9, 9), type: world.T.NPC, level: 1 }, now = Date.now();
      const days = Array.from({ length: 20 }, (_, i) => G.npc.hero({ ...tile, id: tile.id + i * 7 }, now));
      const next = Array.from({ length: 20 }, (_, i) => G.npc.hero({ ...tile, id: tile.id + i * 7 }, now + 86400000));
      const valley = { id: npcTile + 1, type: world.T.LAKE, level: 3 };
      ok(days.filter((h, i) => h.name !== next[i].name || h.level !== next[i].level).length >= 15 && G.npc.hero(tile, now).name === G.npc.hero(tile, now + 1000).name
        && G.npc.hero(valley, now).name === G.npc.hero(valley, now + 86400000).name, 'an NPC city\'s hero is picked again every day (a valley\'s stays)');
      // Two more level 1 NPC cities near home, with no historic hero.
      const { x: fx, y: fy } = world.xy(city.fieldId), spots = [];
      for (let r = 1; r < 250 && spots.length < 3; r++) for (let dx = -r; dx <= r && spots.length < 3; dx++) for (const dy of [-r, r]){
        const id = world.idOf(((fx + dx) % 800 + 800) % 800, ((fy + dy) % 800 + 800) % 800), t = world.tileAt(srv.store, id);
        if (t.type === world.T.NPC && t.level === 1 && !t.historic && !G.hh.byField.has(id) && !spots.includes(id)) spots.push(id);
      }
      const leader = async () => { const h = { ...G.heroes.makeHero(1, null, new Set(G.heroes.list(city).map(x => x.name))), id: srv.store.id(), status: 0 }; G.heroes.list(city).push(h); return h; };
      const { FEASTING_HALL } = require('../src/game/heroes'), hall = Object.values(city.buildings).find(b => b.typeId === FEASTING_HALL), hallWas = hall.level;
      hall.level = Math.max(hall.level, G.heroes.list(city).length + 4);
      // No free city slot: loyalty stays at 0 and the city isn't taken.
      me.title = me.castles.length - 1;
      db.npc[spots[2]] = { ...G.npc.state(db, world.tileAt(srv.store, spots[2]), Date.now()), loyalty: -1000, hitAt: Date.now() };
      const l0 = await leader(), e5 = await hit(spots[2], l0.id), r5 = await lastReport();
      ok(!e5 && !cityAt(spots[2]) && /loyalty 0$/.test(r5?.title || '') && /isSeize="false" seizeProblem="As an? \w+ you can rule \d+ cit/.test(r5?.content || ''), 'without a free city slot the loyalty stays at 0 and the city isn\'t taken' + (e5 ? ': ' + e5 : r5 ? ': ' + r5.title : ''));
      me.title = me.castles.length + 3;
      const npcH = G.npc.hero(world.tileAt(srv.store, spots[0]), Date.now());
      db.npc[spots[0]] = { ...G.npc.state(db, world.tileAt(srv.store, spots[0]), Date.now()), loyalty: -1000, hitAt: Date.now() };
      const l1 = await leader(), e3 = await hit(spots[0], l1.id), r3 = await lastReport(), c3 = cityAt(spots[0]);
      const cap = [city, c3].filter(Boolean).flatMap(x => G.heroes.list(x)).find(h => h.status === 4), capIn = [city, c3].find(x => x && G.heroes.list(x).includes(cap));
      // (A hero of the same name already in the city makes the captive "Piers 2".)
      ok(!e3 && c3 && cap && (cap.name === npcH.name || cap.name.startsWith(npcH.name + ' ')) && cap.level === npcH.level && new RegExp(`conquered .*; captured ${npcH.name}`).test(r3?.title || '') && (me.reports || []).some(x => x.title === `${cap.name} captured`),
        `conquering an NPC city captures its hero (${npcH.name}, level ${npcH.level}) into a Feasting Hall` + (e3 ? ': ' + e3 : r3 ? ': ' + r3.title : ''));
      const noMayor = await c.call('hero.promoteToChief', { castleId: capIn.id, heroId: cap.id });
      const noArmy = await c.call('army.newArmy', { castleId: capIn.id, newArmyBean: { missionType: 5, heroId: cap.id, targetPoint: spots[1], troops: { lightCavalry: 10 }, resource: {}, restTime: 0 } });
      capIn.res.gold = cap.level * 1000 - 1;
      const poor = await c.call('hero.tryGetSeizedHero', { castleId: capIn.id, heroId: cap.id });
      capIn.res.gold = cap.level * 1000 + 5;
      const won = await c.call('hero.tryGetSeizedHero', { castleId: capIn.id, heroId: cap.id });
      ok(noMayor.ok < 0 && noArmy.ok < 0 && /captive/.test(noMayor.errorMsg) && poor.ok < 0 && won.ok === 1 && cap.status === 0 && capIn.res.gold < 100,
        'a captive can\'t be mayor or lead an army; persuading costs level x 1,000 gold and the hero joins');
      db.npc[spots[1]] = { ...G.npc.state(db, world.tileAt(srv.store, spots[1]), Date.now()), loyalty: -1000, hitAt: Date.now() };
      const l2 = await leader(), e4 = await hit(spots[1], l2.id), c4 = cityAt(spots[1]);
      const cap2 = [city, c4].filter(Boolean).flatMap(x => G.heroes.list(x)).find(h => h.status === 4), cap2In = [city, c4].find(x => x && G.heroes.list(x).includes(cap2));
      const rel = cap2 && await c.call('hero.releaseHero', { castleId: cap2In.id, heroId: cap2.id });
      ok(!e4 && c4 && cap2 && rel.ok === 1 && !G.heroes.list(cap2In).includes(cap2), 'releasing a captive lets it go');
      for (const h of G.heroes.list(city).filter(h => [l0, l1, l2, cap].includes(h))) await c.call('hero.fireHero', { castleId: castle.id, heroId: h.id });
      {
        const lay8 = Object.fromEntries(Object.entries(G.npc.cityLayout({ id: 1, type: world.T.NPC, level: 8 })).map(([k, [t, l]]) => [k, { typeId: t, level: l }]));
        const max8 = G.logic.popMax({ buildings: lay8 });
        ok(max8 === 72050 && Math.round(max8 * 0.9) === 64845, `a conquered level 8 holds 72,050 people (50 plus 20 level 8 Cottages) and comes with 64,845 at 10% tax, as live (got ${max8})`);
      }
      // Fox (Oct 23 2026): a conquered Historic City has Town Hall and Walls 10 and nothing else inside, one of each
      // resource building at its own level, 5,000 of each resource and 50 people.
      {
        let hcT = null; for (let id = 0; id < 640000 && !hcT; id++){ const t = world.tileAt(srv.store, id); if (t.historic?.level === 14) hcT = t; }
        me.title = me.castles.length + 3;
        const why = A.cantConquer(me, hcT), army = { troops: { archer: 777 }, loot: { gold: 100 } };
        const won = A.conquer(army, me, city, null, hcT, G.npc.state(db, hcT, Date.now()), {}, null, Date.now()), h = won.castle;
        const bean = G.mapBean({ player: me }, world.tileAt(srv.store, hcT.id)), inside = Object.keys(h.buildings).filter(k => +k >= 0 && +k < 1000);
        h.buildings[5] = { ...h.buildings['-1'], typeId: 29, level: 10 };   // the Rally Spot its lord builds
        const NC = G.rules.npcConquest; NC.historicRallySpot = true;
        const withRally = G.npc.cityLayout(hcT)[11]; NC.historicRallySpot = false;
        ok(!why && h.name === hcT.historic.name && h.powerLevel === 2 && bean.powerLevel === 2 && bean.name === hcT.historic.name
          && h.buildings['-1'].level === 10 && h.buildings['-2'].level === 10 && inside.length === 0
          && [[1001, 7], [1002, 4], [1003, 5], [1004, 6]].every(([k, t]) => h.buildings[k]?.typeId === t && h.buildings[k].level === 14) && !h.buildings[1005]
          && h.res.food === 5000 && h.res.gold === 5100 && h.pop === 50 && h.troops.archer === 777 && A.troopLimit(h, me) === 150000
          && withRally?.[0] === 29 && withRally[1] === 14,
          `a conquered level 14 Historic City keeps its name (${h.name}) and Town power level, has Town Hall and Walls 10 and nothing else inside, one of each resource building at 14, 5,000 of each resource and 50 people (Fox's live capture); a level 10 Rally Spot there sends 1.5 times as many troops; historicRallySpot gives one at 14 on plot 11`);
        const farm14 = G.logic.checkOut(h, me, h.buildings[1001]), rally10 = G.logic.checkOut(h, me, h.buildings[5]);
        h.buildings[1001].level = 13; const farm13 = G.logic.checkOut(h, me, h.buildings[1001]); h.buildings[1001].level = 14;
        ok(farm14.ok === -57 && rally10.ok === -57 && farm13.ok === 1 && farm13.conditionBean.food === G.logic.condition(h, me, 7, 14).food,
          'in a level 14 Historic City a Farm goes from 13 to 14 but no further, and the Rally Spot stops at 10 (live)');
      }
      hall.level = hallWas;
      delete db.npc[spots[2]];
    }
    // Put things back for the tests below: one city again, the old title.
    for (const id of me.castles.filter(id => !citiesWas.includes(id))){ const x = db.castles[id]; delete db.tiles[x.fieldId]; delete db.castles[id]; }
    me.castles = [...citiesWas]; me.title = titleWas;
    if (heroObj && !G.heroes.find(city, heroObj.id)){ heroObj.status = 0; G.heroes.list(city).push(heroObj); }
    await new Promise(res => setTimeout(res, 200)); c.inbox = c.inbox.filter(m => m.cmd !== 'server.CastleUpdate');   // the conquered cities' updates
    city.troops.lightCavalry = 0;
    const rehire = await c.call('hero.getHerosListFromTavern', { castleId: castle.id });
    if (rehire.heros.length) await c.call('hero.hireHero', { castleId: castle.id, heroName: rehire.heros[0].name });

    // ---------- wall defenses ----------
    // (The Walls were set up at level 1 with the Town Hall 3 requirements above.)
    ok(srv.store.db.castles[castle.id].buildings['-2']?.typeId === 32, 'the city has its Walls');
    const fl = await c.call('fortifications.getFortificationsProduceList', { castleId: castle.id });
    ok(fl.fortList.length === 5 && fl.fortList.find(f => f.typeId === 14).permition && !fl.fortList.find(f => f.typeId === 16).permition, 'traps are open at Walls 1, archer\'s towers are not');
    const fq0 = await c.call('fortifications.getProduceQueue', { castleId: castle.id });
    ok(fq0.allProduceQueue.length === 1 && fq0.allProduceQueue[0].allProduceQueue.length === 0, 'the empty Walls queue still has its one entry');
    ok((await c.call('fortifications.produceWallProtect', { castleId: castle.id, wallProtectType: 14, num: 50 })).ok === 1, 'build 50 traps');
    const busyWalls = await c.call('fortifications.produceWallProtect', { castleId: castle.id, wallProtectType: 14, num: 5 });
    ok(busyWalls.ok === -51, 'level 1 Walls queue one batch at a time');
    const fu = (await c.wait('server.FortificationsUpdate', 8000)).data;
    ok(fu.fortification.trap === 50, 'the traps are finished');
    const tooMany = await c.call('fortifications.produceWallProtect', { castleId: castle.id, wallProtectType: 14, num: 5000 });
    ok(tooMany.ok < 0 && /room on the Walls/.test(tooMany.errorMsg), 'the Walls\' space limit is enforced');

    // ---------- items ----------
    {
      const G = srv.game, give = (id, n = 1) => { me.items[id] = (me.items[id] || 0) + n; };
      const fx0 = city.fieldId % 800, fy0 = Math.floor(city.fieldId / 800);
      // Advanced City Teleporter: to an empty flat a few tiles away.
      let dest = null;
      for (let r = 3; r < 30 && !dest; r++) for (let dx = -r; dx <= r && !dest; dx++){
        const id = world.idOf(fx0 + dx, fy0 + r), t = world.tileAt(srv.store, id);
        if (t.type === world.T.FLAT && !srv.store.db.tiles[id] && !t.historic) dest = id;
      }
      const noItem = await c.call('city.advMoveCastle', { castleId: castle.id, targetId: dest });
      ok(noItem.ok < 0 && /Adv City Teleporter/.test(noItem.errorMsg), 'teleporting without an Adv City Teleporter is refused');
      give('player.more.castle.1.a', 2);
      let npcSpot = null;
      for (let r = 1; r < 40 && !npcSpot; r++) for (let dx = -r; dx <= r && !npcSpot; dx++){ const id = world.idOf(fx0 + dx, fy0 - r), t = world.tileAt(srv.store, id); if (t.type === world.T.NPC && !t.historic) npcSpot = id; }
      const onNpc = await c.call('city.advMoveCastle', { castleId: castle.id, targetId: npcSpot });
      ok(onNpc.ok < 0 && /flat/.test(onNpc.errorMsg) && me.items['player.more.castle.1.a'] === 2, 'an Adv City Teleporter only lands on an empty flat, and is kept on a refusal');
      const oldField = city.fieldId;
      c.send('city.advMoveCastle', { castleId: castle.id, targetId: dest });
      const cu = (await c.wait('server.CastleUpdate', 4000, d => d.updateType === 2)).data;
      const mv = (await c.wait('city.advMoveCastle')).data;
      ok(mv.ok === 1 && cu.updateType === 2 && cu.castleBean.fieldId === dest && city.fieldId === dest && !srv.store.db.tiles[oldField] && srv.store.db.tiles[dest]?.castleId === city.id
        && me.items['player.more.castle.1.a'] === 1, 'the Adv City Teleporter moves the city and the client is told its new place');
      give('consume.move.1');
      const rnd = await c.call('city.moveCastle', { castleId: castle.id, zoneId: 5 });
      ok(rnd.ok === 1 && world.zoneOf(city.fieldId) === 5 && !me.items['consume.move.1'], 'the City Teleporter lands somewhere in the chosen region');
      const back = await c.call('city.advMoveCastle', { castleId: castle.id, targetId: dest });
      ok(back.ok === 1 && city.fieldId === dest, 'and the city can be moved back');
      // War Teleporter: onto a barbarian city (Fox), which is gone; the spot left behind is a flat again.
      give('player.more.castle.1.c', 2);
      const ontoFlat = await c.call('city.WarMoveCastle', { castleId: castle.id, targetId: oldField });
      const war = await c.call('city.WarMoveCastle', { castleId: castle.id, targetId: npcSpot });
      const landed = city.fieldId === npcSpot && srv.store.db.tiles[npcSpot]?.castleId === city.id;
      give('player.more.castle.1.a');
      const back2 = await c.call('city.advMoveCastle', { castleId: castle.id, targetId: dest });
      const leftTile = world.tileAt(srv.store, npcSpot);
      ok(ontoFlat.ok < 0 && /barbarian city/.test(ontoFlat.errorMsg) && war.ok === 1 && landed && back2.ok === 1 && leftTile.type === world.T.FLAT,
        'a War Teleporter lands on a barbarian city, which is gone (Fox), and refuses anything else');

      // Wheel of Fortune.
      give('player.box.gambling.3', 1);
      const spin = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.gambling.3', num: 1 });
      const won = spin.itemBeans?.[0], board = spin.gamblingItemsBeans || [];
      const paidOut = /^player\.box\.gambling\.(food|wood|stone|iron|gold|medal\.10)$/.test(won?.id) ? !me.items[won.id] : me.items[won.id] >= won.count;
      ok(spin.ok === 1 && board.length === 24 && board.filter(b => b.kind === 1).length === 1 && board.some(b => b.id === won.id && b.count === won.count) && paidOut,
        `an Aries Amulet spins the Wheel of Fortune: 24 prizes, as on the live board, and one paid out (${won && G.data.items[won.id]?.name} x${won?.count})`);
      {
        // Like the live boards: 1,000,000 of a resource, cents and gear materials by 5 turn up.
        const seen = new Set(); let full = true;
        for (let i = 0; i < 60; i++){ const b = G.itemUse.spin().board; full = full && b.length === 24 && b.every(x => G.data.items[x.id]); b.forEach(x => seen.add(`${x.id}*${x.count}`)); }
        ok(full && seen.has('player.box.gambling.food*1000000') && [...seen].some(k => /^player\.box\.gambling\.medal\.10\*(10|30|100)$/.test(k)) && seen.has('equipment.tech.upgrade.4*5'),
          'wheel boards always fill all 24 tiles and include resources by 1,000,000, cents and materials by 5');
        // Winning resources pays the city; winning cents pays coins. Neither lands in the inventory.
        const real = G.itemUse.spin, food0 = city.res.food, coins0 = me.coins;
        G.itemUse.spin = () => { const w = { id: 'player.box.gambling.food', count: 1000000, kind: 3 }; return { board: [w], won: w }; };
        give('player.box.gambling.3', 1);
        const fw = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.gambling.3', num: 1 });
        G.itemUse.spin = () => { const w = { id: 'player.box.gambling.medal.10', count: 30, kind: 4 }; return { board: [w], won: w }; };
        give('player.box.gambling.3', 1);
        const cw = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.gambling.3', num: 1 });
        G.itemUse.spin = real;
        ok(fw.ok === 1 && cw.ok === 1 && city.res.food - food0 > 990000 && me.coins - coins0 === 30 && !me.items['player.box.gambling.food'] && !me.items['player.box.gambling.medal.10'],
          'a wheel win of 1,000,000 food goes to the city and 30 cents to your coins');
        // An item whose icon the art server doesn't have is kept off the wheel (it would show as a blank tile).
        G.art.mark('images/items/laba.png', 'HTTP 404');
        let speaker = false; for (let i = 0; i < 60; i++) if (G.itemUse.spin().board.some(x => x.id === 'consume.1.a')) speaker = true;
        ok(!speaker && G.art.has('images/items/laba.png'), 'items without an icon are left off the wheel');
      }
      const today = await c.call('gamblingranking.getGamblingRankingToday', { pageNo: 1, pageSize: 10 });
      ok(today.gamblingRankingBeans[0]?.playerName === 'Tester' && today.gamblingRankingBeans[0].count === 3, 'the Wheel of Fortune billboard counts the spins');

      // Chests with listed contents.
      give('hero.compensation.package.lv1');
      const horn0 = me.items['player.attackinc.1'] || 0, tel0 = me.items['player.more.castle.1.a'] || 0;
      const pack = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'hero.compensation.package.lv1', num: 1 });
      ok(pack.ok === 1 && pack.itemBeans.length >= 5 && me.items['player.attackinc.1'] === horn0 + 1 && me.items['player.more.castle.1.a'] === tel0 + 1 && me.items['enhanced.star.1'] >= 35,
        'Hero Compensation Package Lv1 gives what its description lists');
      give('player.reward.bonus.food');
      const food0 = city.res.food;
      const fp = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.reward.bonus.food', num: 1 });
      ok(fp.ok === 1 && Math.round(city.res.food - food0) >= 249000, 'a Food Package adds 250,000 food');
      give('player.grank.ballista.a');
      const bal0 = city.troops.ballista || 0;
      const tp = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.grank.ballista.a', num: 1 });
      ok(tp.ok === 1 && city.troops.ballista - bal0 >= 50 && city.troops.ballista - bal0 <= 100, `Ballistas Squad adds 50 to 100 ballistas (${city.troops.ballista - bal0})`);
      give('player.box.1'); me.items['consume.key.1'] = 0; me.items['player.box.1'] = 1;
      const lockNo = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.1', num: 1 });
      give('consume.key.1');
      const lockYes = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.1', num: 1 });
      ok(lockNo.ok < 0 && /Bronze Key/.test(lockNo.errorMsg) && lockYes.ok === 1 && me.items['consume.key.1'] <= 1 && !me.items['player.box.1'] && lockYes.itemBeans.some(b => b.count > 0), 'a Bronze Lockbox needs a Bronze Key, which it uses up');
      const reader = G.itemUse.chests;
      const lords = reader.sets('player.box.present.4')[0] || [];
      ok(lords.some(e => e.kind === 'troop' && e.key === 'peasants' && e.min === 250) && lords.some(e => e.id === 'consume.changeflag.1') && lords.some(e => e.id === 'consume.1.a' && e.min === 40),
        'chest descriptions are read, typos and all (Package for Lords: 250 workers, a "Natinal Flag", 40 speakers)');
      const xmas = reader.sets('player.box.present.money.111');
      ok(xmas.length === 3 && xmas[1].some(e => e.id === 'player.more.castle.1.a'), 'a chest offering a choice of sets gives one of them (Thanksgiving War Chest)');
      // The description the client shows (itemDesc) is what's inside (Fox: Stygandr's Tools).
      const ST = 'player.box.present.money.374', BAN = 'player.item.stygandrsbannerofthehorde', WT = 'player.more.castle.1.c';
      me.items[ST] = 1; const ban0 = me.items[BAN] || 0, wt0 = me.items[WT] || 0, stFood0 = city.res.food, stone0 = city.res.stone;
      const tools = await c.call('shop.useGoods', { castleId: castle.id, itemId: ST, num: 1 });
      ok(tools.ok === 1 && me.items[BAN] - ban0 === 10 && me.items[WT] - wt0 === 3 && city.res.food - stFood0 >= 49990000 && city.res.stone - stone0 >= 49990000 && !me.items[ST],
        'Stygandr\'s Tools gives what its description lists: 10 Stygandr\'s Banners of the Horde, 3 War Teleporters, On War, Stone of Finding, Angel/Devil Token, Excalibur, Corselet and 50 million of each resource');
      const sun = reader.sets('player.box.present.money.276')[0] || [], roman = reader.sets('player.box.romanbuildingkit')[0] || [], tt = reader.sets('player.box.present.money.100');
      ok(sun.some(e => e.id === 'consume.key.2') && sun.some(e => e.kind === 'cents' && e.min === 50) && roman.some(e => e.kind === 'res' && e.key === 'food' && e.min === 1e9) && tt.length === 2,
        'other chests read from what the client shows: Sun\'s End (a Silver Key and 50 cents), the Roman Building Kit (1 billion food), Trick or Treat Tokens (one or the other)');

      // The client redraws the item list when the reply arrives, so the new count must already be there.
      // (A Wheel of Fortune spin earlier may already have given one: count from what's there.)
      give('player.resinc.2', 2); const left = me.items['player.resinc.2'] - 1; c.order = [];
      await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.resinc.2', num: 1 });
      const iu = c.order.findIndex(m => m.cmd === 'server.ItemUpdate' && m.data.items.some(i => i.id === 'player.resinc.2' && i.count === left));
      const rp = c.order.findIndex(m => m.cmd === 'shop.useGoods');
      const once = iu >= 0 && iu < rp && c.order.filter(m => m.cmd === 'server.ItemUpdate' && m.data.items.some(i => i.id === 'player.resinc.2')).length === 1;
      ok(once, 'the new item count reaches the client before the reply that redraws the item list, and only once'
        + (once ? '' : ': ' + c.order.map(m => m.cmd + (m.cmd === 'server.ItemUpdate' ? JSON.stringify(m.data.items.map(i => [i.id, i.count])) : '')).join(' ')));

      // Buffs.
      give('player.attackinc.1'); give('player.reduce.troops.upkeep.1');
      const up0 = G.logic.rates(city, me).foodUpkeep;
      await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.attackinc.1', num: 1 });
      await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.reduce.troops.upkeep.1', num: 1 });
      const m = G.combat.mods(G.logic, me, null, {});
      ok(m.attack >= 20 && G.items.active(me, 'PlayerIncArmyAttachBuff'), 'a War Horn adds 20% to troop attack');
      ok(up0 > 0 && Math.abs(G.logic.rates(city, me).foodUpkeep - up0 / 2) < 1, "Vesta's Blessing halves troop upkeep");

      // Hero items.
      const fh = Object.values(city.buildings).find(b => b.typeId === 27); fh.level = 10;
      const h0 = G.heroes.list(city)[0];
      h0.loyalty = 50; give('hero.loyalty.3'); give('player.experience.1.b'); give('hero.power.1');
      const exp0 = h0.exp;
      const med = await c.call('hero.useItem', { castleId: castle.id, heroId: h0.id, itemId: 'hero.loyalty.3' });
      const book = await c.call('hero.useItem', { castleId: castle.id, heroId: h0.id, itemId: 'player.experience.1.b' });
      c.send('hero.useItem', { castleId: castle.id, heroId: h0.id, itemId: 'hero.power.1' });
      const hu = (await c.wait('server.HeroUpdate', 4000, d => d.hero.id === h0.id && d.hero.powerBuffAdded === 25)).data;
      ok(med.ok === 1 && h0.loyalty === 65, 'a Lion Medal raises loyalty by 15');
      ok(book.ok === 1 && h0.exp - exp0 >= 10000, 'Epitome of Military Science gives at least 10,000 experience');
      ok(hu.hero.buffs.some(b => b.typeId === 'hero.power.1') && Math.abs(G.heroes.effective(h0, 'atk') - G.heroes.total(h0, 'atk') * 1.25) < 0.01, 'Excalibur adds 25% to the hero\'s attack and the hero window shows it');
      give('player.box.hero.a');
      const n0 = G.heroes.list(city).length;
      const helm = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.box.hero.a', num: 1 });
      const nh = G.heroes.list(city)[n0];
      ok(helm.ok === 1 && nh && nh.level >= 10 && nh.level <= 15, `Leather Helm of Robinhood brings a level 10-15 hero to the Feasting Hall (${nh?.name}, level ${nh?.level})`);

      // Hero gear: research Weaponry 1 in the Workshop, then wear it.
      city.buildings[20] = { typeId: 26, level: 1, status: 0, startTime: 0, endTime: 0 };
      city.buildings[21] = { typeId: 22, level: 1, status: 0, startTime: 0, endTime: 0 };
      me.items['equipment.tech.upgrade.1'] = 0; me.items['equipment.tech.upgrade.2'] = 0;
      const gl = await c.call('equipmenttech.getResearchList', { castleId: castle.id });
      ok(gl.acailableResearchBeans.length === 14 && !gl.acailableResearchBeans[0].permition, 'the Workshop lists the 14 gear technologies; Weaponry needs materials first');
      give('equipment.tech.upgrade.1'); give('equipment.tech.upgrade.2');
      const ore0 = me.items['equipment.tech.upgrade.1'];
      const gr = await c.call('equipmenttech.research', { castleId: castle.id, techId: 1 });
      const gdone = (await c.wait('server.EquipmentResearchCompleteUpdate', 8000)).data;
      ok(gr.ok === 1 && gdone.typeId === 1 && gdone.level === 1 && me.items['equipment.tech.upgrade.1'] === ore0 - 1 && G.equipment.level(me, 1) === 1, 'Weaponry 1 is researched with its Wood and Iron Ore');
      const h0level = h0.level; h0.level = 9;
      const low = await c.call('equipment.WearEquipmenttech', { heroid: h0.id, Equipmenttechid: '0', AddAttributeType: 2, pos: 3 });
      ok(low.ok < 0 && /from level 10/.test(low.errorMsg) && !h0.gear?.[3], 'a hero below level 10 can\'t wear gear (one gear level per 10 hero levels)');
      h0.level = 10;
      c.send('equipment.WearEquipmenttech', { heroid: h0.id, Equipmenttechid: '0', AddAttributeType: 2, pos: 3 });
      const worn = (await c.wait('server.HeroUpdate', 4000, d => d.hero.id === h0.id && d.hero.equipmentbean.some(e => e.heroPos === 3 && e.addAttributeType === 2))).data;
      const wr = (await c.wait('equipment.WearEquipmenttech')).data;
      const slot = worn.hero.equipmentbean.find(e => e.heroPos === 3);
      ok(wr.ok === 1 && worn.hero.equipmentbean.length === 16 && slot.lv === 1 && slot.addAttribute === 1 && worn.hero.attack === 1, 'a hero wears the weapon for +1 attack and the hero window gets all 16 slots');
      give('enhanced.star.2', 4);
      const gems0 = me.items['enhanced.star.2'];
      const star = await c.call('equipment.EnhancedStarByGemStone', { gemstoneid: 'enhanced.star.2', count: 4, pos: 1 });
      ok(star.ok === 1 && star.enhancedstarlv === 1 && G.equipment.star(me, 1) === 1 && me.items['enhanced.star.2'] === gems0 - 4, 'four Flawless gems give Weaponry its first star (55% + 60%)');
      {
        // Gear limited by the hero's level, as Fox checked live: a level 5 hero wears nothing, level 10 wears level 1
        // gear with 7 stars (+4.03 a piece), level 20 level 2 with 8, level 30 level 3 with 9, level 100 level 10
        // with 15; 15 pieces on attack add 60.45, 90, 124.2 and 569.7; speed is 10 x the mount's level.
        const E = G.equipment, savedGear = me.gear, savedWorn = h0.gear;
        me.gear = {}; for (const t of E.types()) me.gear[t] = { lv: 10, star: 15 };
        h0.gear = {}; for (let pos = 1; pos <= 16; pos++) h0.gear[pos] = pos === 8 ? 1 : 2;
        const at = L => { h0.level = L; const b = E.bonus(me, h0), sh = E.beans(me, h0).find(e => e.heroPos === 4); return { atk: +b.atk.toFixed(2), speed: b.speed, lv: sh.lv, stars: sh.euipmenttechStarLv }; };
        const g5 = at(5), g10 = at(10), g20 = at(20), g30 = at(30), g35 = at(35), g100 = at(100);
        ok(g5.atk === 0 && g5.lv === 0 && g10.atk === 60.45 && g10.lv === 1 && g10.stars === 7 && g10.speed === 10 && g20.atk === 90 && g20.stars === 8 && g30.atk === 124.2 && g30.stars === 9
          && g35.lv === 3 && g35.atk === 124.2 && g100.atk === 569.7 && g100.stars === 15 && g100.speed === 100,
          `gear follows the hero's level as on the live game: level 10 wears level 1 with 7 stars (+${g10.atk} attack), 20 level 2 with 8 (+${g20.atk}), 30 level 3 with 9 (+${g30.atk}), 100 level 10 with 15 (+${g100.atk}); speed 10 x the mount's level`);
        // The star set life bonus belongs to the lord: his lowest star on the 14 gear technologies.
        h0.level = 30; h0.gear = {};
        for (const t of E.types()) me.gear[t].star = 9; const set9 = E.setLife(me, h0);
        me.gear[7].star = 5; const set5 = E.setLife(me, h0);
        for (const t of E.types()) me.gear[t].star = 12; const set12 = E.setLife(me, h0);
        for (const t of E.types()) me.gear[t].star = 15; const set15 = E.setLife(me, h0);
        me.gear[14] = { lv: 0, star: 0 }; const setPart = E.setLife(me, h0); me.gear[14] = { lv: 10, star: 9 };
        for (const t of E.types()) me.gear[t].star = 9;
        G.rules.starSetLife.perHero = true; const perHeroBare = E.setLife(me, h0); G.rules.starSetLife.perHero = false;
        const npcTile = { id: 1, type: 12, level: 9 }, valley = { id: 2, type: 1, level: 9 }, lord = { id: 3, type: 11 };
        const lifeAt = t => G.armies.attackMods(me, h0, { militia: 1000 }, t).life - G.logic.techEffect(me, 16);
        ok(set5 === 50 && set9 === 100 && set12 === 150 && set15 === 250 && setPart === 0 && perHeroBare === 0,
          'star set life bonus, the lord\'s lowest star: +50% life at 5, +100% at 9, +150% at 12, +250% at 15, even for a hero with no gear on; nothing until all 14 are researched');
        ok(lifeAt(npcTile) === 100 && lifeAt(valley) === 0 && lifeAt(lord) === 0, 'the star set bonus counts against NPC cities, not valleys or lords');
        me.gear = savedGear; h0.gear = savedWorn;
      }
      h0.level = h0level;

      // City token: a Civilian rules one city; each title adds one.
      give('player.gen.castle.1');
      const civ = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'player.gen.castle.1', num: 1 });
      ok(civ.ok < 0 && /Civilian/.test(civ.errorMsg) && me.items['player.gen.castle.1'] === 1, 'a Civilian can\'t found a second city');
      me.title = 1;
      const cities0 = me.castles.length;
      c.send('shop.useGoods', { castleId: castle.id, itemId: 'player.gen.castle.1', num: 1 });
      const add = (await c.wait('server.CastleUpdate', 4000, d => d.updateType === 0)).data;
      const nc = srv.store.db.castles[me.castles[cities0]];
      const lv = k => nc?.buildings[k] && [nc.buildings[k].typeId, nc.buildings[k].level].join();
      const capped = G.logic.upgrade(nc, me, 1001, Date.now()), L = G.logic;
      ok(add.castleBean.id === nc?.id && add.castleBean.powerlevel === 4 && G.beans.castle(nc, me).powerlevel === 4 && me.castles.length === cities0 + 1 && lv(-1) === '31,10' && lv(-2) === '32,10' && lv(31) === '29,11'
        && Object.keys(nc.buildings).filter(k => +k > 1000).length === 40 && [[7, 9], [4, 15], [6, 15], [5, 1]].every(([t, n]) => Object.values(nc.buildings).filter(b => b.typeId === t && b.level === 11).length === n) && Array.isArray(capped) && capped[0] === -57
        && L.checkOut(nc, me, nc.buildings[31]).ok === -57 && L.checkOut(nc, me, nc.buildings[1001]).ok === -57
        && L.maxLevelOf(nc, 7) === 10 && L.maxLevelOf(nc, 29) === 10 && L.maxLevelOf({ powerLevel: 2 }, 6) === 14 && L.maxLevelOf({ powerLevel: 4 }, 6) === 10,
        'a Bronze Amulet founds an ordinary city (power level 4) with a level 10 Town Hall and Walls, a level 11 Rally Spot on plot 31 and all 40 resource fields at 11 (9 Farms, 15 Sawmills, 15 Ironmines, 1 Quarry), none of them upgradeable (Fox\'s live capture); a level 14 Historic City\'s fields go to 14');

      // Michelangelo's Script for level 10.
      const farm = Object.entries(city.buildings).find(([, b]) => b.typeId === 7);
      farm[1].level = 9;
      // (A chest or the Wheel of Fortune earlier in the run may have given one.)
      const scripts = me.items['consume.blueprint.1'] || 0; me.items['consume.blueprint.1'] = 0;
      const cond = await c.call('castle.checkOutUpgrade', { castleId: castle.id, positionId: Number(farm[0]) });
      me.items['consume.blueprint.1'] = scripts;
      ok(cond.conditionBean.items.some(i => i.id === 'consume.blueprint.1' && !i.successFlag), "upgrading to level 10 asks for a Michelangelo's Script");
      farm[1].level = 1;
      // Civil Code.
      give('player.pop.1.a'); city.pop = 10;
      const cc = await c.call('shop.useCastleGoods', { castleId: castle.id, itemId: 'player.pop.1.a' });
      ok(cc.ok === 1 && city.pop >= 110, 'Civil Code adds population');
    }

    // ---------- quests, ranks and titles ----------
    {
      const G = srv.game;
      me.title = 0;
      ok(me.prestige > 0, `building, research and training earn prestige (${Math.floor(me.prestige)})`);
      const types = await c.call('quest.getQuestType', { castleId: castle.id, type: 1 });
      const rebuild = types.types.find(t => t.typeId === 66);
      const names = types.types.map(t => t.name);
      ok(rebuild && rebuild.mainId === 1 && names[0] === 'Queen' && types.types[0].version === 2 && names.indexOf('Rebuild') === 1 && names.includes('Consolation') && names.includes('Promotion') && names.includes('Hero Gear'),
        'Routine Quests list the live game\'s categories in its order (Queen first, with the Age II badge; Rebuild is typeId 66 as the tutorial expects)');
      const WIKI = ['Queen', 'Rebuild', 'Commodity Gathering', 'Consolation', 'Resources Levy', 'Administration', 'Trading', 'Domain Expansion', 'Scientific Research', 'Alliance',
        'Correspondence', 'Hero Recruitment', 'Military Service', 'Scouting', 'Fortification', 'Colony', 'City Expansion', 'Rich Store', 'Transportation', 'Alarming',
        'Population Increase', 'Wealthy Society', 'Prestige Building', 'Item Purchase', 'Promotion', 'Battlefield', 'Guidelines', 'Military Operation', 'The Medals',
        'Be an Evonian', 'Stratagem', 'Achievement', 'Uprising', 'Hero Gear', 'Daily Amulet'];
      const at = names.map(n => WIKI.indexOf(n));
      ok(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1])) && ['Colony', 'Scouting', 'Wealthy Society', 'Battlefield', 'Correspondence', 'Military Operation', 'Uprising', 'Achievement', 'Stratagem'].every(n => names.includes(n)),
        'the categories follow the wiki\'s order; Correspondence (mail), Military Operation (wounded troops), Uprising, Achievement and Stratagem show');
      const listOf = async name => (await c.call('quest.getQuestList', { castleId: castle.id, typeId: types.types.find(t => t.name === name)?.typeId })).quests || [];
      const queenQ = await listOf('Queen');
      ok(queenQ.length === 1 && queenQ[0].questId === 601 && queenQ[0].targets[0].name.startsWith('Prestige reaches 1,000'), 'the Queen chain starts with Prestige 1,000, as on the wiki');
      const sci = (await listOf('Scientific Research')).map(x => x.questId), acadLv = G.logic.level(srv.store.db.castles[castle.id], 25);
      ok(sci.includes(45) && !sci.includes(63) && acadLv < 10, `a technology's quest opens once the Academy can research it (Academy ${acadLv}: Agriculture yes, Privateering no)`);
      const dom = await listOf('Domain Expansion');
      ok(dom.some(x => x.questId === 26 && /Primary Guidelines 1/.test(x.award)) && dom.some(x => x.questId === 535 && /Gold 10000/.test(x.award)), 'Domain Expansion holds the Town Hall upgrades and starter packages with the wiki\'s awards');
      const ally = await listOf('Alliance');
      ok(ally.every(x => x.questId === 64), 'Alliance offers only the Embassy until alliances exist');
      const cons = await c.call('quest.getQuestList', { castleId: castle.id, typeId: types.types.find(t => t.name === 'Consolation').typeId });
      ok(cons.quests.map(x => x.name).join('|') === 'Disaster Relief|Pray for Your People|Bless for luck|Population Raising' && /Comforting/.test(cons.quests.find(x => x.questId === 6).manual),
        'Consolation holds the four comfort quests under their live names, with the live guide text');
      const heroTypes = await c.call('quest.getQuestType', { castleId: castle.id, type: 4 });
      ok(heroTypes.types.length === 1 && heroTypes.types[0].typeId === 1999999 && !heroTypes.types[0].isFinish, 'Hero Quests is never empty, so the client always redraws it (a guide entry when no hero is being hunted)');
      const list = await c.call('quest.getQuestList', { castleId: castle.id, typeId: 66 });
      const cot = list.quests.find(x => x.questId === 1);
      ok(cot && cot.name === 'Cottage Building' && cot.isFinish && cot.targets[0].finished && /Food 200/.test(cot.award), 'quest 1 is the client\'s Cottage Building, finished, with the client\'s reward');
      const food0 = city.res.food, guide0 = me.items['consume.2.a'] || 0;
      ok((await c.call('quest.award', { castleId: castle.id, questId: 1 })).ok === 1 && Math.round(city.res.food - food0) >= 199 && me.items['consume.2.a'] === guide0 + 1, 'claiming it pays the reward');
      const list2 = await c.call('quest.getQuestList', { castleId: castle.id, typeId: 66 });
      ok(!list2.quests.some(x => x.questId === 1) && list2.quests.some(x => x.questId === 2), 'the next quest in the chain (Upgrade Cottage) takes its place');
      ok((await c.call('quest.award', { castleId: castle.id, questId: 1 })).ok < 0, 'a quest can\'t be claimed twice');
      // Rank: Lieutenant needs Town Hall 2 and 10,000 gold.
      city.res.gold = 50000;
      c.order = [];
      const lt = await c.call('quest.award', { castleId: castle.id, questId: 194 });
      const info = c.order.find(m => m.cmd === 'server.PlayerInfoUpdate')?.data.playerInfo;
      ok(lt.ok === 1 && me.rank === 1 && Math.round(city.res.gold) <= 40000 && info?.office === 'Lieutenant', 'promotion to Lieutenant uses 10,000 gold and shows as the rank');
      const cap = await c.call('quest.award', { castleId: castle.id, questId: 195 });
      ok(cap.ok < 0 && /Town Hall|Cross Medal/.test(cap.errorMsg), 'Captain asks for Town Hall 4 and Cross Medals: ' + cap.errorMsg);
      // Title: Knight needs Lieutenant, 1,000 prestige, 20,000 gold, 10 Cross and 5 Rose Medals.
      me.prestige = Math.max(me.prestige, 1000); me.items['hero.loyalty.1'] = 10; me.items['hero.loyalty.2'] = 5; city.res.gold = 50000;
      c.order = [];
      const kn = await c.call('quest.award', { castleId: castle.id, questId: 199 });
      const info2 = c.order.find(m => m.cmd === 'server.PlayerInfoUpdate')?.data.playerInfo;
      ok(kn.ok === 1 && me.title === 1 && info2?.titleId === 1 && !me.items['hero.loyalty.1'] && !me.items['hero.loyalty.2'] && G.quests.maxCities(me) === 2, 'Knight uses the medals and gold, and lets you rule 2 cities');
      // Build City on a conquered flat: a free city slot, 250 Workers and 10,000 of each resource.
      {
        const fxy = world.xy(city.fieldId);
        let flat = null;
        for (let r = 1; r < 12 && !flat; r++) for (let dx = -r; dx <= r && !flat; dx++) for (const dy of [-r, r]){
          const id = world.idOf(fxy.x + dx, fxy.y + dy), t = world.tileAt(srv.store, id);
          if (t.type === world.T.FLAT && !srv.store.db.tiles[id] && !t.historic){ flat = id; break; }
        }
        const notMine = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        ok(notMine.ok < 0 && /Conquer this flat/.test(notMine.errorMsg), 'a city can only be built on a flat you hold: ' + notMine.errorMsg);
        srv.store.db.tiles[flat] = { type: world.T.FLAT, level: 3, ownerCastle: city.id }; city.valleys.push(flat);
        Object.assign(city.res, { food: 50000, wood: 20000, stone: 20000, iron: 20000, gold: 20000 }); city.troops.peasants = 300;
        const cities0 = me.castles.length;
        me.title = cities0 - 1;
        const full = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        ok(full.ok < 0 && /can rule/.test(full.errorMsg), 'building a city needs a free city slot from your title: ' + full.errorMsg);
        me.title = cities0; city.troops.peasants = 100;
        const few = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        ok(few.ok < 0 && /250 Workers|only have/.test(few.errorMsg), 'and 250 Workers: ' + few.errorMsg);
        city.troops.peasants = 300; city.res.iron = 5000;
        const poor = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        ok(poor.ok < 0 && /iron/.test(poor.errorMsg), 'and 10,000 of each resource: ' + poor.errorMsg);
        city.res.iron = 20000; c.order = [];
        const go = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        const march = Object.values(srv.store.db.armies).find(a => a.mission === 4 && a.target === flat);
        ok(go.ok === 1 && march && city.troops.peasants === 50 && city.res.stone < 15000 && city.res.gold < 15000 && c.order.some(m => m.cmd === 'server.SelfArmysUpdate' && m.data.armys.some(a => a.missionType === 4 && a.targetFieldId === flat)),
          'Build City sends 250 Workers with 10,000 of each resource to the flat' + (go.ok === 1 ? '' : ': ' + go.errorMsg));
        const again = await c.call('city.constructCastle', { castleId: castle.id, fieldId: flat, isTroopBack: true });
        ok(again.ok < 0 && /being built/.test(again.errorMsg), 'a second Build City on the same flat is refused while the first is on its way: ' + again.errorMsg);
        const add = await c.wait('server.CastleUpdate', 15000, d => d.updateType === 0 && d.castleBean.fieldId === flat).catch(() => null);
        const nc = srv.store.db.castles[me.castles[cities0]];
        const gone = c.order.find(m => m.cmd === 'server.CastleFieldUpdate' && m.data.updateType === 1 && m.data.bean.id === flat);
        ok(!!add && nc?.fieldId === flat && me.castles.length === cities0 + 1 && srv.store.db.tiles[flat]?.type === world.T.CASTLE && srv.store.db.tiles[flat].castleId === nc.id && !city.valleys.includes(flat) && !!gone,
          'the new city goes up on the flat, which leaves the valley list');
        ok(nc?.name === 'new', `the new city is called "new", as on the live game (${nc?.name})`);
        const near = (v, want) => Math.abs(v - want) < 50, rb = add?.data.castleBean.resource, nr = G.logic.rates(nc, me);
        ok(nc && Object.values(nc.buildings).length === 1 && nc.buildings['-1']?.typeId === 31 && nc.buildings['-1'].level === 1
          && ['food', 'wood', 'stone', 'iron'].every(k => near(nc.res[k], 5000)) && near(nc.res.gold, 68550) && nc.taxRate === 10 && Object.values(nc.commence).every(v => v === 80),
          'the new city starts as on the live game: a level 1 Town Hall only, 5,000 of each resource, 68,550 gold, 10% tax and 80% production rate');
        ok(nc?.troops.peasants === 250 && city.troops.peasants === 50 && !Object.values(srv.store.db.armies).some(a => a.mission === 4) && city.res.stone < 15000 && G.quests.maxCities(me) === me.castles.length,
          `the 250 Workers stay on in the new city and the materials are used up (${city.troops.peasants} workers left at home)`);
        ok(rb && rb.maxPopulation === 50 && rb.populationDirection === 0 && G.logic.popTarget(nc) === 45, 'with no Cottage the population limit is 50, and at 10% tax the population settles at 45 (90% of it)');
        nc.taxRate = 20;
        ok(G.logic.popTarget(nc) === 40 && G.beans.resource(nc, me).populationDirection === -1, 'raising the tax to 20% lowers that to 40, and the population falls');
        G.logic.settle(nc, me, nc.resAt + 3600000); nc.taxRate = 10;
        ok(Math.round(nc.pop) === 40, `and it settles there (${nc.pop.toFixed(1)})`);
        {
          // A brand-new lord's city with the server's default rules (the test world uses a richer start).
          const { DEFAULTS } = require('../src/rules'), tmp = { id: 'tmp-lord', name: 'Tmp', castles: [], techs: {}, items: {}, buffs: {} };
          const fc = G.createCastle(tmp, { start: DEFAULTS.start }), fr = G.beans.resource(fc, tmp);
          ok(Object.keys(fc.buildings).join() === '-1' && fc.buildings['-1'].typeId === 31 && fc.buildings['-1'].level === 1 && ['food', 'wood', 'stone', 'iron'].every(k => fr[k].amount === 5000 && fr[k].increaseRate === 100 * G.logic.speed)
            && fr.gold === 18771 && fr.texRate === 10 && fr.support === 90 && fr.complaint === 0 && fr.curPopulation === 45 && fr.maxPopulation === 50 && fr.taxIncome === Math.floor(4.5 * G.logic.speed) && Object.values(fc.commence).every(v => v === 80),
            `a new lord's city starts as on the live game: a level 1 Town Hall only, 5,000 of each resource (+100 an hour), 18,771 gold, 10% tax, 80% production rate, 45 of 50 people, loyalty 90/0 (${JSON.stringify({ gold: fr.gold, pop: fr.curPopulation, max: fr.maxPopulation, tax: fr.taxIncome })})`);
          delete srv.store.db.castles[fc.id]; delete srv.store.db.tiles[fc.fieldId];
        }
        ok(rb && rb.support === 90 && rb.complaint === 0 && rb.curPopulation === 45 && Math.round(nr.food) === 100 && G.logic.upkeep(nc) === 250 && Math.round(nr.wood) === 100 && Math.floor(nr.gold) === 4,
          `and its panel matches the live screenshot: loyalty 90/0, population 45, food -150 an hour (250 Workers' upkeep), 100 of the rest, 4 gold (${JSON.stringify({ s: rb?.support, c: rb?.complaint, pop: rb?.curPopulation, food: nr.food, up: nr.foodUpkeep, wood: nr.wood, gold: nr.gold })})`);
        me.title = 1;
      }
      // Daily Amulet: once a day.
      const am0 = me.items['player.box.gambling.3'] || 0;
      ok((await c.call('quest.award', { castleId: castle.id, questId: 1001 })).ok === 1 && me.items['player.box.gambling.3'] === am0 + 1, 'the Daily Amulet quest gives an Aries Amulet');
      ok((await c.call('quest.award', { castleId: castle.id, questId: 1001 })).ok < 0, 'but only once a day');
      // The Medals (wiki): contribute your first Lion Medal for two more, 100 prestige and 10,000 food, once.
      me.items['hero.loyalty.3'] = 1; const pr0 = me.prestige;
      const lion = await c.call('quest.award', { castleId: castle.id, questId: 216 });
      const lion2 = await c.call('quest.award', { castleId: castle.id, questId: 216 });
      ok(lion.ok === 1 && me.items['hero.loyalty.3'] === 2 && Math.round(me.prestige - pr0) >= 100 && lion2.ok < 0, 'contributing a Lion Medal gives two back and 100 prestige, once');
      // Saves from before 0.3.15: quests whose ids changed are moved, once.
      const old = { quest: { done: { 600: 1, 300: 2, 610: 3, 611: 3, 1: 4 }, flags: {}, max: {}, daily: '', notified: { 5: 1 } } };
      ok(G.quests.upgrade(old) && old.quest.done[602] === 1 && old.quest.done[113] === 2 && !old.quest.done[600] && !old.quest.done[610] && !old.quest.done[611] && old.quest.done[1] === 4 && !G.quests.upgrade(old),
        'old saves: the old Queen and Walls quests move to their new ids and the old gear quests are cleared');
      ok(G.quests.helmFor({ sex: 1 }, 'player.box.hero.king') === 'player.box.hero.queen' && G.quests.helmFor({ sex: 0 }, 'player.box.hero.king') === 'player.box.hero.king',
        'the last Queen quest gives a lady the Gold Helm of Queen');
      const hr = await c.call('rank.getHeroRank', { pageSize: 10, pageNo: 1, sortType: 3, key: null });
      const cr = await c.call('rank.getCastleRank', { pageSize: 10, pageNo: 1, sortType: 1, key: null });
      const prt = await c.call('rank.getPlayerRank', { pageSize: 10, pageNo: 1, sortType: 1, key: null });
      ok(hr.beans.length >= 2 && hr.beans[0].kind === 'Tester' && hr.beans[0].power >= hr.beans[1].power && cr.beans[0].kind === 'Tester' && prt.beans[0].titleId === 1,
        'hero, city and lord rankings fill in and sort (heroes by attack, lords by title)');
      ok(G.armies.medalDrop(1, () => 0) === 'hero.loyalty.1' && G.armies.medalDrop(10, () => 0) === 'hero.loyalty.9' && G.armies.medalDrop(5, () => 0.99) === null, 'NPC cities drop better medals the higher their level');
      // More from the wiki's building pages.
      {
        const L = G.logic, rs = L.condition(city, me, 24, 2), saved = { ...me.techs };
        me.techs[15] = 10; const prot10 = L.protectedAmount({ buildings: { 1: { typeId: 3, level: 1 } } }, me); me.techs = saved;
        const transporter = G.rules.troopUnlock[8].find(x => x[0] === 'b' && x[1] === 2)[2];
        const tile = { id: 987654, type: 12, level: 1 }, db = { npc: {} }, now = Date.now();
        db.npc[tile.id] = { troops: { militia: 1 }, forts: {}, res: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 }, hitAt: now - 86400000 };
        const refilled = G.npc.state(db, tile, now).fresh === true;
        db.npc[tile.id] = { troops: { militia: 1 }, forts: {}, res: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 }, hitAt: now - 1000 };
        const notYet = !G.npc.state(db, tile, now).fresh;
        ok(rs.techs.some(t => t.id === 13 && t.level === 2) && Math.round(prot10) === Math.round(10000 * Math.pow(1.1, 10)) && transporter === 6 && (refilled || G.npc.day(now - 86400000) === G.npc.day(now)) && notYet,
          'Relief Station 2 needs Horseback Riding 2; Stockpile 10 protects 1.1^10 times as much; Transporters need Barracks 6; NPC cities are full again after the daily reset');
      }
      // Defenses after a battle (Fox's 27 live attacks on an NPC 8, Oct 25): it rebuilds 27% of the Archer Towers,
      // 45% of the Traps, 63% of the Rolling Logs and 72% of the Trebuchets it lost at once, and everything grows back
      // at full strength an hour; a Historic City rebuilds nothing at once and grows back about 10% an hour (Fox).
      {
        const W = require('../src/game/world'), now = Date.now(), npc8 = { id: W.idOf(611, 287), type: W.T.NPC, level: 8 }, hc = W.tileAt(srv.store, W.idOf(33, 165));
        const all = { arrowTower: 100, trap: 100, rollingLogs: 100, rockfall: 100 }, none = { arrowTower: 0, trap: 0, rollingLogs: 0, rockfall: 0 };
        const r8 = G.npc.repair(npc8, all, none), rh = G.npc.repair(hc, all, none);
        const sp = G.npc.speed; G.npc.speed = 1;
        const fullH = G.npc.full(hc, now).forts, k = Object.keys(fullH).find(x => fullH[x] >= 100);
        db.npc[hc.id] = { troops: {}, forts: { ...Object.fromEntries(Object.keys(fullH).map(x => [x, 0])) }, res: null, hitAt: now - 3600000 };
        const hcHour = G.npc.state(db, hc, now).forts[k] / fullH[k];
        db.npc[npc8.id] = { troops: {}, forts: { trap: 0 }, res: null, hitAt: now - 1800000 };
        const half8 = G.npc.state(db, npc8, now).forts.trap / G.npc.full(npc8, now).forts.trap;
        delete db.npc[hc.id]; delete db.npc[npc8.id]; G.npc.speed = sp;
        ok(r8.arrowTower === 27 && r8.trap === 45 && r8.rollingLogs === 63 && r8.rockfall === 72 && rh.trap === 0 && rh.rockfall === 0 && Math.abs(hcHour - 0.1) < 0.01 && Math.abs(half8 - 0.5) < 0.01,
          'an NPC 8 rebuilds 27% of its lost Archer Towers, 45% of its Traps, 63% of its Rolling Logs and 72% of its Trebuchets at once and grows back fully in an hour, as live; a Historic City\'s defenses only grow back, 10% an hour');
      }
      // Scouting (rules.scouting). Live (Fox): one Scout at a level 4 lake gets in; Informatics 1-4 see nothing, 5 sees troops as words.
      {
        const W = require('../src/game/world'), A = G.armies, reports = [], rep = (pl, r) => reports.push({ pl, r }), saved = { ...me.techs };
        const lake = { id: W.idOf(3, 3), type: W.T.LAKE, level: 4 };
        const run = (inf, tile, n = 1) => { me.techs[7] = inf; reports.length = 0; A.scout({ troops: { scouter: n }, target: tile.id }, me, city, null, tile, rep, Date.now()); return reports.find(x => x.pl === me).r.content; };
        const r4 = run(4, lake), r5 = run(5, lake), one = run(10, lake, 1);
        ok(/isFound="false" isSuccess="true"/.test(r4) && /<scoutInfo\/>/.test(r4) && !/troopStrType/.test(r4) && /troopStrType typeId="\d+" count="[A-Za-z]+"/.test(r5) && !/<resource/.test(r5)
          && /troopStrType typeId="\d+" count="\d+"/.test(one),
          'scouting a valley: always gets in; Informatics 4 at a level 4 lake sees nothing, 5 sees troops as words, 10 exact numbers with one Scout');
        // Fox's live reports, Informatics 6 and one Scout: level 1 exact with its hero, 2-3 exact, 4-5 words, 6-10 nothing.
        const v = L => ({ id: W.idOf(550 + L, 740), type: W.T.GRASSLAND, level: L });
        const s1 = run(6, v(1)), s3 = run(6, v(3)), s4 = run(6, v(4)), s5 = run(6, v(5)), s6 = run(6, v(6)), s10 = run(6, v(10));
        ok(/count="35"/.test(s1) && /count="12"/.test(s1) && /heroName="\w+" heroLevel="\d+"/.test(s1) && /typeId="5" count="90"/.test(s3) && !/heroName/.test(s3)
          && /typeId="5" count="Horde"/.test(s4) && /typeId="6" count="Lots"/.test(s5) && /typeId="7" count="Lots"/.test(s5) && /<scoutInfo\/>/.test(s6) && /<scoutInfo\/>/.test(s10)
          && /<battleInfo isAttack="true"\/>/.test(s1),
          'Informatics 6 with one Scout, as live: a level 1 valley shows 35 warriors, 12 pikemen and its hero; level 3, 90 pikemen; level 4 "Horde"; level 5 "Lots" of swordsmen and archers; 6-10 nothing');
        const flat2 = G.npc.full({ type: W.T.FLAT, level: 2 }).troops;
        ok(flat2.militia === 51 && flat2.pikemen === 17 && Object.keys(flat2).length === 2, 'a level 2 flat holds 51 warriors and 17 pikemen, as live');
        ok(['Few', 'Pack', 'Lots', 'Horde', 'Giga'].join() === [24, 25, 99, 100, 10000].map(n => A.scoutWord(n)).join(), 'amounts use the wiki\'s words (Few 1-24, Pack 25-49, Lots 50-99 ... Giga 10,000+)');
        // Fox's live scout reports (Oct 22 2026), 100 Scouts and Informatics 10: everything, exact, at NPC 1-10 and Historic Cities.
        const npc10 = { id: W.idOf(613, 291), type: W.T.NPC, level: 10 }, npc1 = { id: W.idOf(623, 285), type: W.T.NPC, level: 1 };
        const hc14 = W.tileAt(srv.store, W.idOf(33, 165));
        const r10 = run(10, npc10, 100), r1 = run(10, npc1, 100), r14 = run(10, hc14, 100), rep10 = reports.find(x => x.pl === me).r;
        const farms = xml => (xml.match(/buildingType type="7" levels="([\d,]+)"/) || [])[1]?.split(',') || [];
        ok(/troopStrType typeId="3" count="400000"/.test(r10) && /population="78000"/.test(r10) && /support="90"/.test(r10) && farms(r10).length === 37 && farms(r10)[0] === '10'
          && /buildingType type="1" levels="10(,10){19}"/.test(r10) && /heroName="\w+" heroLevel="\d+" heroUrl=""/.test(r10) && /gold="1500000"/.test(r10)
          && /<battleInfo isAttack="true" unNomal="No defending troops found."><backTroop><troops><troopInfo typeId="4" remain="100"\/>/.test(r10),
          'scouting an NPC 10 with Informatics 10 and 100 Scouts shows everything as on the live game: exact troops, 78,000 people, loyalty 90, 20 Cottages and 37 Farms at level 10, its hero, "No defending troops found."');
        ok(/population="1000"/.test(r1) && /support="80"/.test(r1) && farms(r1).length === 10 && /troopStrType typeId="9" count="8"/.test(r1)
          && /troopStrType typeId="3" count="2800000"/.test(r14) && farms(r14).length === 37 && farms(r14)[0] === '14' && /buildingType type="2" levels="10"/.test(r14) && /heroLevel="100"/.test(r14),
          'NPC 1: 1,000 people, loyalty 80, 10 Farms; a level 14 Historic City: exact with 100 Scouts, its Farms at 14 and its other buildings at 10');
        // Fox's live reports (Oct 23 2026), Informatics 7 and one Scout: an NPC city compares against its level.
        const npcAt = L => ({ id: W.idOf(540 + L, 750), type: W.T.NPC, level: L }), i7 = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(L => L && run(7, npcAt(L)));
        let hc12 = null; for (let id = 0; id < 640000 && !hc12; id++){ const t = W.tileAt(srv.store, id); if (t.historic?.level === 12) hc12 = t; }
        const v12 = run(7, hc12), has = (xml, ...res) => res.every(re => re.test(xml)), lacks = (xml, ...res) => !res.some(re => re.test(xml));
        const noTroops = /troopStrType/, noForts = /fortificationsType/, noGold = /gold="/, noPop = /population="/, noHero = /heroName/, field = /buildingType type="[4-7]"/;
        ok(has(i7[7], /<resource /, /isFound="true" isSuccess="true"/, /remain="1"/) && lacks(i7[7], noGold, noPop, /<buildings>/, noTroops, noForts)
          && has(i7[6], /buildingType type="1" levels="6(,6){19}"/, /buildingType type="30" levels="6"/, /food="4000000"/) && lacks(i7[6], field, noGold, noPop, noTroops)
          && has(i7[5], /gold="450000"/, /population="25000"/, /support="90"/) && lacks(i7[5], field, noForts)
          && has(i7[4], /buildingType type="7" levels="4(,4){18}"/, /buildingType type="4" levels="4"/, /gold="300000"/) && lacks(i7[4], noForts, noTroops)
          && has(i7[3], /fortificationsType typeId="16" count="650"/, /fortificationsType typeId="14" count="2000"/) && lacks(i7[3], noTroops)
          && has(i7[2], /troopStrType typeId="3" count="50"/, /troopStrType typeId="9" count="25"/, /fortificationsType typeId="15" count="550"/) && lacks(i7[2], noHero)
          && has(i7[1], /troopStrType typeId="7" count="15"/) && lacks(i7[1], noHero)
          && /<scoutInfo\/>/.test(i7[8]) && /<scoutInfo\/>/.test(v12) && /unNomal="No defending troops found."/.test(v12),
          'Informatics 7 and one Scout, as live: NPC 7 only food/lumber/stone/iron; 6 adds buildings but no fields; 5 gold, population, loyalty; 4 the fields; 3 exact defenses; 2 exact troops; 1 still no hero; NPC 8 and a level 12 Historic City nothing');
        // Fox's live reports (Oct 23 2026), Informatics 10 and ONE Scout: everything at NPC 1, 2, 3 and 10.
        const one10 = run(10, npc10, 1), one3 = run(10, npcAt(3), 1), one14 = run(10, hc14, 1);
        ok(has(one10, /troopStrType typeId="3" count="400000"/, /fortificationsType typeId="17" count="2200"/, /fortificationsType typeId="18" count="1375"/, /heroName="\w+" heroLevel="\d+"/,
              /gold="1500000"/, /population="78000"/, /buildingType type="7" levels="10(,10){36}"/, /remain="1"/)
          && has(one3, /troopStrType typeId="3" count="200"/, /troopStrType typeId="9" count="60"/, /fortificationsType typeId="16" count="650"/, /population="8000"/, /buildingType type="7" levels="3(,3){15}"/)
          && has(one14, /troopStrType typeId="3" count="2800000"/, /heroLevel="100"/),
          'Informatics 10 and one Scout, as live: everything at NPC 10 (its hero too) and NPC 3, and at a level 14 Historic City');
        // Fox's live report (Oct 23 2026): Informatics 10 and one Scout at a level 10 desert show its exact troops,
        // with 0 for types it has lost, and its hero; no defenses, no stores, isFound false.
        const desert = { id: W.idOf(626, 291), type: W.T.DESERT, level: 10 }, d10 = run(10, desert, 1);
        const v5 = v(5); A.db.npc = A.db.npc || {}; A.db.npc[v5.id] = { hitAt: Date.now(), troops: { swordsmen: 0, archer: 30 }, forts: {} };
        const wiped = run(10, v5, 1); delete A.db.npc[v5.id];
        const NPCL = srv.game.npc, TID = { militia: 3, pikemen: 5, swordsmen: 6, archer: 7, lightCavalry: 9 };
        const g10 = NPCL.valley(10, desert.id, NPCL.day(Date.now()));
        ok(has(d10, ...Object.entries(g10).map(([k, n]) => new RegExp(`troopStrType typeId="${TID[k]}" count="${n}"`)), /heroName="\w+" heroLevel="\d+"/, /isFound="false" isSuccess="true"/) && lacks(d10, /<fortifications/, /<resource/, noGold, noPop)
          && has(wiped, /troopStrType typeId="6" count="0"/, /troopStrType typeId="7" count="30"/),
          `Informatics 10 and one Scout at a level 10 valley, as live: its exact troops (${JSON.stringify(g10)}) and its hero, no defenses or stores; a type it lost shows at 0`);
        // Levels 6-10 (Fox's live scouts): one to three kinds share the valley's strength, each kind's count its share
        // times its weight; levels 1-5 keep the live mixes.
        const vr = srv.game.rules.garrison.valley.random, wts = vr.weights;
        let shapeOk = true, sums = {};
        for (let L = 6; L <= 10; L++) for (let id = 1; id <= 200; id++){
          const g = NPCL.valley(L, id * 7919, 3), kinds = Object.keys(g), shares = kinds.map(k => g[k] / wts[k]);
          if (kinds.length < 1 || kinds.length > 3 || kinds.some(k => !wts[k]) || Math.max(...shares) - Math.min(...shares) > 1) shapeOk = false;
          sums[L] = (sums[L] || 0) + shares.reduce((a, b) => a + b, 0) / 200;
        }
        const near = (x, y) => x > y * 0.85 && x < y * 1.15;
        ok(shapeOk && [6, 7, 8, 9, 10].every(L => near(sums[L], 200 * Math.pow(1.92, L - 6))) && JSON.stringify(NPCL.valley(2, 5, 3)) === JSON.stringify({ militia: 51, pikemen: 17 }),
          `valleys 6-10 hold one to three kinds sharing their strength by the live weights (average ${[6, 7, 8, 9, 10].map(L => Math.round(sums[L])).join(', ')} cavalry's worth); level 2 still 51 warriors and 17 pikemen`);
        let realNpc = null; for (let id = 0; id < 640000 && !realNpc; id += 997){ const t = W.tileAt(srv.store, id); if (t.type === W.T.NPC && !t.historic) realNpc = t; }
        const npcName = A.placeName(realNpc.id), when = require('../src/game/reports').stamp(new Date(2026, 9, 22, 18, 58, 27).getTime());
        ok(rep10.title === 'Scout Reports' && /^Barbarian's city\(\d+,\d+\)$/.test(npcName) && when === '10/22 18:58:27',
          `scout reports are titled, named and timed as on the live game ("${rep10.title}", "${npcName}", "${when}")`);
        // A lord's city: Scouts fight Scouts.
        const rival = G.createPlayer({ name: 'Rival' }, { userName: 'Rival' }), rc = G.castlesOf(rival)[0], rt = W.tileAt(srv.store, rc.fieldId);
        me.techs[7] = 10;
        rc.troops.scouter = 500; reports.length = 0;
        const a1 = { troops: { scouter: 10 }, target: rc.fieldId }; A.scout(a1, me, city, null, rt, rep, Date.now());
        const lost = reports.find(x => x.pl === me).r.content, warned = reports.find(x => x.pl === rival)?.r.content || '';
        rc.troops.scouter = 0; reports.length = 0;
        const a2 = { troops: { scouter: 10 }, target: rc.fieldId }; A.scout(a2, me, city, null, rt, rep, Date.now());
        const got = reports.find(x => x.pl === me).r.content;
        me.techs = saved;
        ok(a1.troops.scouter === 0 && rc.troops.scouter === 0 && /isFound="true" isSuccess="false"/.test(lost) && !/scoutInfo/.test(lost) && /isAttack="false" isSuccess="false"/.test(warned)
          && a2.troops.scouter === 10 && /isSuccess="true"/.test(got) && /<buildings>/.test(got) && /<resource /.test(got) && /population="/.test(got),
          'scouting a lord: outnumbered Scouts die and bring nothing back; unopposed, Informatics 10 against 0 sees the whole city');
      }
    }

    // ---------- Town Hall ----------
    c.order = [];
    ok((await c.call('interior.taxation', { castleId: castle.id, typeId: 1 })).ok === 1, 'Levy works');
    ok(c.order.some(m => m.cmd === 'server.NewFinishedQuest'), 'levying gold finishes the Gold levy quest and the Quests button is told at once');
    const levy2 = await c.call('interior.taxation', { castleId: castle.id, typeId: 1 });
    ok(levy2.ok === -34, 'and has a cooldown');
    ok((await c.call('interior.pacifyPeople', { castleId: castle.id, typeId: 2 })).ok === 1, 'Comfort works');

    const quests = await c.call('quest.getQuestList', { castleId: castle.id, typeId: 1 });
    ok(quests.ok === 1, 'unimplemented read gets an empty, successful reply');
    const unsupported = await c.call('commission.issueCommissionQuest', { castleId: castle.id });
    ok(unsupported.ok === -1 && /doesn't support/.test(unsupported.errorMsg), 'unimplemented action is refused with a clear message');
    // Mail (MailWin): Inbox (1), System (2), Sent (3); unread counts reach the client in server.NewMail.
    {
      const G = srv.game, other = G.createPlayer({ name: 'Penpal' }, { userName: 'Penpal' });
      const bad = await c.call('mail.sendMail', { username: 'Nobody Here', title: 'hi', content: 'x' });
      const long = await c.call('mail.sendMail', { username: 'penpal', title: 'hi', content: 'x'.repeat(501) });
      const sent = await c.call('mail.sendMail', { username: 'penpal', title: 'Hello there', content: 'First letter.' });
      const pin = G.mail.page(other, 1, 1, 10), mine = await c.call('mail.receiveMailList', { pageNo: 1, type: 3, pageSize: 10 });
      ok(bad.ok < 0 && /no lord called/.test(bad.errorMsg) && long.ok < 0 && sent.ok === 1 && pin.mails.length === 1 && pin.mails[0].sender === me.name && pin.mails[0].isRead === 0
        && G.mail.counts(other).count_inbox === 1 && mine.mails[0]?.receiver === 'Penpal' && mine.mails[0].title === 'Hello there' && G.quests.state(me).flags.mail,
        'mail reaches another lord by name (any case), lands unread in the Inbox, shows in your Sent box, and ticks the Correspondence quest');
      G.mail.send(other, me.name, 'Re: Hello there', 'Got it.');
      const pushed = await c.wait('server.NewMail', 4000, x => x.count_inbox >= 1);
      const inbox = await c.call('mail.receiveMailList', { pageNo: 1, type: 1, pageSize: 10 }), id = inbox.mails[0]?.mailid;
      const read = await c.call('mail.readMail', { mailId: id });
      G.mail.system(me, 'Welcome', 'A system note.');
      const sys = await c.call('mail.receiveMailList', { pageNo: 1, type: 2, pageSize: 10 });
      const marked = await c.call('mail.readOverMailList', { mailIds: String(sys.mails[0]?.mailid) });
      const del = await c.call('mail.deleteMail', { str_mailid: `${id},${sys.mails[0]?.mailid}` });
      const after = await c.call('mail.receiveMailList', { pageNo: 1, type: 1, pageSize: 10 });
      ok(pushed.data.count_inbox >= 1 && read.ok === 1 && read.content === 'Got it.' && read.sender === 'Penpal' && G.mail.find(me, id) === null && sys.mails[0]?.title === 'Welcome'
        && marked.ok === 1 && del.ok === 1 && !after.mails.some(m => m.mailid === id) && G.mail.page(other, 3, 1, 10).mails.length === 1,
        'a reply is pushed as new mail; reading shows the text; System mails have their own box; marking and deleting work, and deleting your copy leaves the sender\'s');
    }
    // The Marketplace: one order book, a 0.5% fee on every post, trades at the waiting order's price, 30 minutes to deliver.
    {
      const G = srv.game, M = G.market, trader = G.createPlayer({ name: 'Trader' }, { userName: 'Trader' }), tc = G.castlesOf(trader)[0];
      const putMarket = (cc, L) => { const free = [...Array(32).keys()].find(i => !cc.buildings[i]); cc.buildings[free] = { ...cc.buildings['-1'], typeId: 23, level: L }; return free; };
      const myPos = Object.keys(city.buildings).find(k => city.buildings[k].typeId === 23) ?? putMarket(city, 1), myWas = city.buildings[myPos].level;
      city.buildings[myPos].level = 1; putMarket(tc, 2);
      city.res.food = 5000; city.res.gold = 1000; tc.res.gold = 10000;
      const sell = await c.call('trade.newTrade', { castleId: castle.id, resType: 0, tradeType: 1, amount: 1000, price: '2' });
      const second = await c.call('trade.newTrade', { castleId: castle.id, resType: 0, tradeType: 1, amount: 10, price: '2' });
      const mine = await c.call('trade.getMyTradeList', { castleId: castle.id }), look = await c.call('trade.searchTrades', { resType: 0 });
      const okSell = sell.ok === 1 && second.ok < 0 && /holds? 1 pending order/.test(second.errorMsg) && mine.trades.length === 1 && mine.trades[0].tradeTypeName === 'Sell'
        && Math.abs(city.res.food - 4000) < 50 && Math.abs(city.res.gold - (1000 - 10)) < 50 && look.sellers[0]?.price === 2 && look.sellers[0].amount === 1000;
      ok(okSell, 'posting an offer reserves the food and charges the 0.5% fee (10 gold on 2,000); a level 1 Marketplace holds one order; the offer shows among the lowest five');
      const gold0 = city.res.gold;
      const bought = M.post(tc, trader, 0, 0, 600, '3');
      const ship = M.shipsOf(tc)[0], left = M.ordersOf(city)[0];
      ok(!Array.isArray(bought) && Math.abs(city.res.gold - (gold0 + 1200)) < 1 && Math.abs(tc.res.gold - (10000 - 1800 - 9 + 600)) < 1 && ship?.amount === 600 && left?.dealed === 600
        && (me.reports || []).some(r => r.type === 0 && /Sold 600 food for 1,200 gold/.test(r.title) && /<tradeReport tradeType="Sell" dealedAmount="600" resName="Food" gold="1200"\/>/.test(r.content)),
        'a higher bid trades at the offer\'s price: the seller gets 1,200 gold at once, the buyer his 600 back and a shipment of 600 food on its way, and both get a trade report');
      const fleet = await (async () => { trader.items['consume.transaction.1'] = 1; const f0 = tc.res.food; const r = M.speedUp(tc, trader, ship.id); return !Array.isArray(r) && tc.res.food === f0 + 600 && !M.shipsOf(tc).length; })();
      const cancel = await c.call('trade.cancelTrade', { castleId: castle.id, tradeId: left.id });
      ok(fleet && cancel.ok === 1 && city.res.food >= 4300 && !M.ordersOf(city).length && G.quests.state(me).flags.sell,
        'a Merchant Fleet delivers a shipment at once; cancelling returns the 400 food not traded');
      const slow = M.post(tc, trader, 1, 1, 50, '1'), buy2 = M.post(city, me, 1, 0, 50, '1'), s2 = M.shipsOf(city)[0];
      const w0 = city.res.wood; M.tick(s2.endTime - 1); const early = city.res.wood === w0; M.tick(s2.endTime);
      ok(!Array.isArray(slow) && !Array.isArray(buy2) && Math.abs((s2.endTime - Date.now()) - 30 * 60000 / G.logic.speed) < 5000 && early && city.res.wood === w0 + 50,
        'bought lumber arrives after the 30-minute shipment');
      city.buildings[myPos].level = myWas;
    }
    // Wounded troops (Fox's live NPC 8 reports): a tenth of the losses, cured in the Hospital (Rally Spot) at Scout 69,
    // Archer 140, Cavalry 285, Cataphract 875 gold; Auto Heal cures them right after the battle.
    {
      const G = srv.game, A = G.armies, now = Date.now(), live = { scouter: 855, archer: 1027, lightCavalry: 1000, heavyCavalry: 1000 };
      const die = G.rules.wounded.diePerHour; G.rules.wounded.diePerHour = 0;   // the test clock runs fast
      city.wounded = {}; me.autoHeal = false;
      A.wound(city, me, live, now);
      const w = A.woundedWhole(city, now);
      const pushed = c.wait('server.InjuredTroopUpdate', 4000, x => x.troop.archer === 102);
      await c.call('army.getInjuredTroop', { castleId: castle.id });
      const upd = (await pushed).data;
      ok(w.scouter === 85 && w.archer === 102 && w.lightCavalry === 100 && w.heavyCavalry === 100 && upd.goldNeed === 136145 && upd.troop.archer === 102,
        'a battle that loses 855 Scouts, 1,027 archers, 1,000 cavalry and 1,000 cataphracts leaves 85, 102, 100 and 100 wounded, and curing them costs 136,145 gold, as live');
      G.logic.settle(city, me, Date.now()); city.res.gold = 1000;
      const poor = await c.call('army.cureInjuredTroop', { castleId: castle.id });
      city.res.gold = 200000; const arch0 = city.troops.archer || 0;
      const cured = await c.call('army.cureInjuredTroop', { castleId: castle.id });
      ok(poor.ok < 0 && /136,145 gold/.test(poor.errorMsg) && cured.ok === 1 && city.troops.archer === arch0 + 102 && Math.abs(city.res.gold - (200000 - 136145)) < 50
        && !Object.keys(A.woundedWhole(city, Date.now())).length && G.quests.state(me).flags.cure, 'curing takes the gold and puts the wounded back in the army (and ticks Heal the Wounded)');
      A.wound(city, me, { militia: 500 }, now);
      const dis = await c.call('army.disbandInjuredTroop', { castleId: castle.id });
      G.rules.wounded.diePerHour = die; city.wounded = { archer: 100 }; city.woundedAt = now - 3600000 / G.logic.speed;
      const hourLater = A.woundedWhole(city, now).archer;
      const autoOn = await c.call('common.setAutoHeal', { autoHeal: true });
      city.wounded = { scouter: 10 }; city.woundedAt = now; city.res.gold = 100000; const sc0 = city.troops.scouter || 0;
      const healed = A.wound(city, me, { archer: 50 }, now), xml = require('../src/game/reports').battleXml({ round: 3, isAttack: true, won: true, injuredPer: 10, autoHeal: A.healXml(healed, city), attacker: { units: [] }, defender: { units: [] } });
      ok(dis.ok === 1 && hourLater === 90 && autoOn.ok === 1 && me.autoHeal === true && G.beans.player(me, G.castlesOf(me), Date.now()).autoHeal === true && healed && healed.gold === 10 * 69 + 5 * 140 && city.troops.scouter === sc0 + 10
        && /injuredPer="10"/.test(xml) && /<autoHeal des="All of your wounded troops in the [^"]+ were automatically healed." gold="1390"><troopUnit typeId="4" count="10"\/><troopUnit typeId="7" count="5"\/>/.test(xml),
        'disbanding clears the wounded; untreated, a tenth die each hour; with Auto Heal on every wounded troop in the city is cured after the battle and the report says so as live');
      me.autoHeal = false; city.wounded = {};
    }
    // Historic City policies (PoliciesView; the client's texts): 30% of gold, 50% of idle population, 20% of food, 5% of
    // a troop branch (Draft) or 10% disbanded (Disarmament); a level 12 has 4 a day within 9 miles (Evony Advanced Guide).
    {
      const G = srv.game, P = G.policies, pw = city.powerLevel;
      city.powerLevel = 3; city.policies = null;
      const { x: cx, y: cy } = world.xy(city.fieldId), at = (x, y) => world.idOf(((x % 800) + 800) % 800, ((y % 800) + 800) % 800);
      let near = null, far = null;
      for (let r = 1; r <= 9 && !near; r++) for (let dx = -r; dx <= r && !near; dx++) for (const dy of [-r, r]){ const t = world.tileAt(srv.store, at(cx + dx, cy + dy)); if (t.type === world.T.NPC && !t.historic && !srv.store.db.tiles[t.id]) near = t; }
      // (The city's random spot may have no NPC city within 9 miles: then a flat nearby stands in for one.)
      let madeNpc = null;
      if (!near) for (let r = 1; r <= 9 && !near; r++) for (let dx = -r; dx <= r && !near; dx++) for (const dy of [-r, r]){ const id = at(cx + dx, cy + dy), t = world.tileAt(srv.store, id); if (t.type === world.T.FLAT && !t.historic && !srv.store.db.tiles[id]){ srv.store.db.tiles[id] = { type: world.T.NPC, level: 5 }; madeNpc = id; near = world.tileAt(srv.store, id); } }
      for (let dx = 40; dx < 120 && !far; dx++){ const t = world.tileAt(srv.store, at(cx + dx, cy)); if (t.type === world.T.NPC && !t.historic) far = t; }
      const st0 = G.npc.state(srv.store.db, near, Date.now()), gold0 = st0.res.gold, food0 = st0.res.food, big = P.biggest(st0.troops), n0 = st0.troops[big];
      const left0 = await c.call('capital.getLeftPoliciesTimes', { castleId: castle.id });
      const cityGold = city.res.gold;
      const tax = await c.call('capital.levyTaxes', { castleId: castle.id, targetFieldId: near.id });
      const draft = await c.call('capital.levyArmy', { castleId: castle.id, targetFieldId: near.id });
      const food = await c.call('capital.levyFood', { castleId: castle.id, targetFieldId: near.id });
      const pop = await c.call('capital.levyPopulation', { castleId: castle.id, targetFieldId: near.id });
      const fifth = await c.call('capital.reduceArmaments', { castleId: castle.id, targetFieldId: near.id });
      const used = await c.call('capital.getUsedPoliciesTimes', { castleId: castle.id });
      ok(left0.amount === 4 && tax.ok === 1 && tax.amount === Math.floor(gold0 * 0.3) && city.res.gold >= cityGold + tax.amount - 2000 && draft.amount === Math.floor(n0 * 0.05) && draft.armyType === P.troopName(big)
        && food.amount === Math.floor(food0 * 0.2) && pop.amount === Math.floor(G.npc.survey(near).population * 0.5) && fifth.ok < 0 && /all its 4 policies/.test(fifth.errorMsg) && used.amount === 4
        && draft.amount > 0,
        `a level 12 Historic City's policies on an NPC city take 30% of its gold (${tax.amount}), 5% of its biggest branch (${draft.amount} ${draft.armyType}), 20% of its food and 50% of its people, 4 a day`);
      city.policies = null;
      const tooFar = far && await c.call('capital.levyTaxes', { castleId: castle.id, targetFieldId: far.id });
      city.powerLevel = 4;
      const notHC = await c.call('capital.levyTaxes', { castleId: castle.id, targetFieldId: near.id });
      city.powerLevel = 3; G.rules.policies.range[12] = 400;
      const penpal = G.db.players[Object.keys(G.db.players).find(id => G.db.players[id].name === 'Penpal')], pc = G.castlesOf(penpal)[0];
      pc.troops.archer = 1000;
      const disarm = await c.call('capital.reduceArmaments', { castleId: castle.id, targetFieldId: pc.fieldId });
      G.rules.policies.range[12] = 9;
      ok((!far || (tooFar.ok < 0 && /draft area \(9 miles/.test(tooFar.errorMsg))) && notHC.ok < 0 && /Historic City/.test(notHC.errorMsg) && disarm.ok === 1 && disarm.amount === 100 && disarm.armyType === 'Archer'
        && pc.troops.archer === 900 && (penpal.reports || []).some(r => /used Disarmament on/.test(r.title) && /<policyReport detail="[^"]*100 Archer disbanded/.test(r.content)),
        'policies need a Historic City and a target in its draft area; Disarmament on another lord disbands 10% of his biggest branch and he gets a policy report');
      city.powerLevel = pw; city.policies = null;
      if (madeNpc != null){ delete srv.store.db.tiles[madeNpc]; delete srv.store.db.npc[madeNpc]; }
    }
    // War (the client's FieldInfoWin, PlayerInfo, war bar and texts): a lord's ordinary city can be attacked only in
    // wartime, which begins 30 minutes after the declaration and lasts 48 hours; new lords are protected.
    {
      const G = srv.game, W = G.war, A = G.armies, db = srv.store.db, created = me.createdAt;
      const foe = G.createPlayer({ name: 'Rival' }, { userName: 'Rival' }), fc = G.castlesOf(foe)[0];
      heroObj.status = 0; if (!G.heroes.find(city, heroObj.id)) G.heroes.list(city).push(heroObj);
      me.createdAt = Date.now() - 8 * 86400000;
      const onNew = await c.call('common.declaredWarAgainstPlayer', { playerId: foe.id });
      const rel0 = await c.call('common.getRelationship', { playerId: foe.id });
      city.troops.scouter = (city.troops.scouter || 0) + 5;
      const spyNew = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 3, heroId: -1, targetPoint: fc.fieldId, troops: { scouter: 5 }, resource: {}, restTime: 0 } });
      const thWas = fc.buildings['-1'].level; fc.buildings['-1'].level = 5; const thEnds = !W.beginner(foe); fc.buildings['-1'].level = thWas;
      foe.createdAt = Date.now() - 8 * 86400000;
      const can = await c.call('common.getCanDeclaredWarAgainstPlayer', { playerId: foe.id });
      const peaceSeen = (await c.call('field.getOtherFieldInfo', { fieldId: fc.fieldId })).bean;
      fc.troops = { militia: 10 }; city.troops.lightCavalry = (city.troops.lightCavalry || 0) + 200;
      const army = { castleId: castle.id, newArmyBean: { missionType: 5, heroId: hero.id, targetPoint: fc.fieldId, troops: { lightCavalry: 100 }, resource: {}, restTime: 0 } };
      const peace = await c.call('army.newArmy', army);
      const bar = c.wait('server.DeclaredWarUpdate', 4000, x => x.declaredWarBeans.some(b => b.playerName === 'Rival' && b.status === 1));
      const flag = c.wait('server.DeclaredWarStatusChange', 4000, x => x.userName === 'Rival' && x.status === 1);
      const dec = await c.call('common.declaredWarAgainstPlayer', { playerId: foe.id });
      const again = await c.call('common.declaredWarAgainstPlayer', { playerId: foe.id });
      const b1 = (await bar.catch(() => null))?.data, f1 = (await flag.catch(() => null))?.data, rec = W.between(me, foe);
      const early = await c.call('army.newArmy', army);
      const seen = await c.call('field.getOtherFieldInfo', { fieldId: fc.fieldId }), st = await c.call('common.getPlayerDeclaredWarStatus', { playerId: foe.id });
      const mine = (me.reports || []).find(r => /You have declared war against Rival/.test(r.title)), theirs = (foe.reports || []).find(r => /has declared war against you/.test(r.title));
      const login = G.beans.player(me, G.castlesOf(me), Date.now()).declaredWarBeans.find(b => b.playerName === 'Rival');
      ok(onNew.ok < 0 && /against new players/.test(onNew.errorMsg) && spyNew.ok < 0 && /Beginner's Protection and can't be scouted/.test(spyNew.errorMsg) && rel0.freshman === true && rel0.canDeclaredWar === false && rel0.allianceRelation === 2 && thEnds && can.isCanDeclaredWar === true
        && peace.ok < 0 && /not at war with Rival/.test(peace.errorMsg) && dec.ok === 1 && again.ok < 0 && /already declared war/.test(again.errorMsg) && b1 && f1
        && early.ok < 0 && /War begins in/.test(early.errorMsg) && seen.bean.declaredWarStatus === 1 && seen.bean.declaredWarStartTime === rec.declaredAt && seen.bean.relation === 2 && seen.bean.canDeclaredWar === false
        && st.status === 1 && login?.status === 1 && login.endTime - login.startTime === 30 * 60000
        && /<declaredWarReport myself="true" startTime="[^"]+" endTime="[^"]+"\/>/.test(mine?.content || '') && mine.targetPos === 'Rival' && /myself="false"/.test(theirs?.content || ''),
        'a new lord (7 days, or until a Town Hall 5) can\'t be declared on or scouted; without a war his city can\'t be attacked; Declare War starts 30 minutes of preparation, the war bar and both reports');
      // Wartime: thirty minutes after the declaration, for 48 hours.
      const warOn = c.wait('server.DeclaredWarStatusChange', 4000, x => x.userName === 'Rival' && x.status === 2);
      rec.declaredAt = Date.now() - 31 * 60000;
      const w2 = (await warOn.catch(() => null))?.data, fb = W.beans(foe)[0];
      const go = await c.call('army.newArmy', army);
      const march = Object.values(db.armies).find(a => a.playerId === me.id && a.target === fc.fieldId && a.direction === 1);
      const warSeen = (await c.call('field.getOtherFieldInfo', { fieldId: fc.fieldId })).bean;
      const toThird = W.cityState(foe, { id: -1, name: 'Onlooker' });   // (a lord at war with nobody)
      ok(peaceSeen.declaredWarStatus === 3 && peaceSeen.relation === 2 && peaceSeen.canOccupy === false && peaceSeen.state === 1 && seen.bean.canOccupy === false
        && peaceSeen.canSend === false && peaceSeen.canTrans === false && warSeen.canSend === false && warSeen.canTrans === false
        && warSeen.declaredWarStatus === 2 && warSeen.canOccupy === true && warSeen.state === 4 && toThird === 1,
        'a lord you aren\'t at war with shows Peacetime, Declare War and no Colonize or Reinforce; at war he shows you Wartime and Colonize (no Transport), and everyone else still Peacetime, as on live');
      ok(w2 && W.status(me, foe) === 2 && fb?.status === 2 && fb.endTime - fb.startTime === 48 * 3600000 && fb.playerName === me.name && go.ok === 1 && march,
        'thirty minutes after the declaration the war begins for 48 hours, and the lord\'s city can be attacked' + (go.errorMsg ? ': ' + go.errorMsg : ''));
      // Incoming armies, as the target's Beacon Tower sees them.
      const slot = [...Array(32).keys()].find(i => !fc.buildings[i]);
      const at = L => { if (L) fc.buildings[slot] = { ...fc.buildings['-1'], typeId: 30, level: L }; else delete fc.buildings[slot]; return G.armies.enemies(foe)[0] || null; };
      const e0 = at(0), e1 = at(1), e6 = at(6), e7 = at(7), e8 = at(8), e9 = at(9);
      ok(!e0 && e1 && e1.king === null && e1.startFieldId === -1 && e1.reachTime === 0 && e1.missionType === 0 && e1.troop.lightCavalry === '0'
        && e6.king === me.name && e6.missionType === 5 && e6.startFieldId === city.fieldId && e6.reachTime === march.reachTime && e6.troop.lightCavalry === '?' && e6.hero === null
        && e7.troop.lightCavalry !== '?' && e7.troop.lightCavalry !== '100' && e8.troop.lightCavalry === '100' && e8.hero === null && e9.hero === hero.name && e9.heroLevel > 0
        && G.beans.castle(fc, foe).hasEnemy === true && G.beans.player(foe, [fc], Date.now()).enemyArmys.length === 1,
        `the target sees the incoming attack in its Beacon Tower's detail: level 1 only that it comes, 6 the kinds of troops, 7 roughly how many (${e7?.troop.lightCavalry}), 8 exactly, 9 the hero`);
      delete fc.buildings[slot];
      await c.call('army.callBackArmy', { castleId: castle.id, armyId: march.id }); march.reachTime = Date.now();
      await (async () => { for (let i = 0; i < 100 && db.armies[march.id]; i++) await sleep(50); })();
      // A Truce shields the lord; the war ends after 48 hours.
      foe.buffs = foe.buffs || {}; foe.buffs.PlayerPeaceBuff = Date.now() + 3600000; const tr = W.cantAttack(me, fc, Date.now()); delete foe.buffs.PlayerPeaceBuff;
      const hc = { ...fc, powerLevel: 3 }, open = W.cantAttack(me, hc, Date.now());
      rec.declaredAt = Date.now() - 30 * 60000 - 48 * 3600000 - 1000; W.tick(Date.now());
      const after = W.cantAttack(me, fc, Date.now());
      foe.buffs.PlayerPeaceBuff = Date.now() + 3600000; const trNew = W.cantDeclare(me, foe, Date.now()); delete foe.buffs.PlayerPeaceBuff;
      ok(!db.armies[march.id] && tr && /Truce/.test(tr[1]) && open === null && !W.between(me, foe) && W.status(me, foe) === 3 && after && /not at war/.test(after[1]) && !W.beans(me).length
        && trNew && /in Truce/.test(trNew[1]),
        'a lord under a Truce Agreement can\'t be attacked or declared on; a held Historic City needs no war; after 48 hours the war is over');
      me.createdAt = created;
    }
    // Colonies (the client's colony windows and texts; Fox: an 8-hour Colonization Period, a limit by title, the army
    // comes home after the Stabilization battle, 5% of production as tribute).
    {
      const G = srv.game, A = G.armies, CL = G.colonies, db = srv.store.db, sp = G.logic.speed, titleWas = me.title || 0;
      const vassal = G.createPlayer({ name: 'Vassal' }, { userName: 'Vassal' }), vc = G.castlesOf(vassal)[0];
      const other = G.createPlayer({ name: 'Freeman' }, { userName: 'Freeman' }), oc = G.castlesOf(other)[0];
      const waitFor = async (cond, ms = 8000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await sleep(50); return cond(); };
      const reportOf = (pl, re) => (pl.reports || []).find(r => re.test(r.title));
      heroObj.status = 0; if (!G.heroes.find(city, heroObj.id)) G.heroes.list(city).push(heroObj);
      vc.troops = { militia: 20 }; vc.forts = {}; city.troops.lightCavalry = 20000; me.title = 0;
      // At war with the Vassal (war.js), 31 minutes after the declaration.
      const createdWas = me.createdAt; me.createdAt = vassal.createdAt = Date.now() - 8 * 86400000; city.res.food = Math.max(city.res.food, 200000);
      G.war.declare(me, vassal, Date.now() - 31 * 60000);
      const perRally = G.rules.rallyArmiesPerLevel; G.rules.rallyArmiesPerLevel = 5;   // a stationed army counts as one out
      const own = CL.cantColonize(me, city, world.tileAt(srv.store, city.fieldId), Date.now()), npc = CL.cantColonize(me, city, { type: world.T.NPC }, Date.now());
      const noHero = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 7, heroId: -1, targetPoint: vc.fieldId, troops: { lightCavalry: 10 }, resource: {}, restTime: 0 } });
      const pushed = c.wait('server.ColonyUpdate', 15000, x => x.castleId === castle.id && x.colonyBeans.some(b => b.castleId === vc.id && b.status === 1));
      const go = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 7, heroId: hero.id, targetPoint: vc.fieldId, troops: { lightCavalry: 10000 }, resource: {}, restTime: 0 } });
      const march = Object.values(db.armies).find(a => a.playerId === me.id && a.mission === 7);
      G.rules.colonies.max = 1; const limit = CL.cantColonize(me, city, world.tileAt(srv.store, oc.fieldId), Date.now()); G.rules.colonies.max = null;
      const unlimited = CL.limit(me, city);
      if (march) march.reachTime = Date.now();
      const parked = await waitFor(() => march && march.direction === 3);
      const rec = CL.ofColony(vc), cu = (await pushed.catch(() => null))?.data, mine = (me.reports || [])[0], theirs = (vassal.reports || [])[0];
      ok(own && npc && /NPC cities/.test(npc[1]) && noHero.ok < 0 && /needs a hero/.test(noHero.errorMsg) && go.ok === 1 && limit && /Tributary cities have reached the limit/.test(limit[1]) && unlimited === null
        && parked && rec && rec.status === 1 && march.reachTime === rec.endTime && Math.abs(rec.endTime - rec.startTime - 8 * 3600000 / sp) < 2 && cu && cu.colonyBeans[0].relation === 3
        && /isColonial="true"/.test(mine?.content || '') && /colonialStartTime="\d\d\/\d\d \d\d:\d\d:\d\d" colonialEndTime=/.test(mine.content) && !/backTroop/.test(mine.content) && /began colonizing/.test(mine.title)
        && /isColonial="true"/.test(theirs?.content || '') && /isAttack="false"/.test(theirs.content),
        'a won Colonize attack starts the 8-hour Colonization Period: the army stays in the city, both reports say so, and the colony bar gets its timer; there is no colony limit unless the rules set one' + (limit ? '' : ' (no limit message)'));
      // The map and the city list.
      const seen = await c.call('field.getOtherFieldInfo', { fieldId: vc.fieldId }), fresh = await c.call('field.getOtherFieldInfo', { fieldId: oc.fieldId });
      ok(seen.bean.colonialRelation === 3 && seen.bean.colonialStatus === 1 && fresh.bean.colonialRelation === 1 && fresh.bean.canColonize === true && G.beans.castle(city, me).colonyBeans[0]?.status === 1,
        'the map shows the city being colonized (relation 3) and an ordinary city as free to colonize (relation 1)');
      // Reinforcements join the stationed army; the Stabilization battle makes the city a Protectorate and the army comes home.
      const rf = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 2, heroId: -1, targetPoint: vc.fieldId, troops: { lightCavalry: 100 }, resource: {}, restTime: 0 } });
      const reinf = Object.values(db.armies).find(a => a.playerId === me.id && a.mission === 2 && a.target === vc.fieldId);
      if (reinf) reinf.reachTime = Date.now();
      const joined = await waitFor(() => reinf && reinf.direction === 3 && rec.armies.length === 2);
      ok(rf.ok === 1 && joined && reinf.reachTime === rec.endTime, 'Send to the city being colonized joins the colonizing army there' + (rf.errorMsg ? ': ' + rf.errorMsg : ''));
      rec.endTime = Date.now() - 1; march.reachTime = reinf.reachTime = rec.endTime;
      const stab = await waitFor(() => rec.status === 2);
      const sr = reportOf(me, /is now your Protectorate/), vr = reportOf(vassal, /became .*Protectorate/);
      ok(stab && march.direction === 2 && reinf.direction === 2 && march.reachTime > Date.now() && !rec.armies.length && /isSuppress="true"/.test(sr?.content || '') && /isAttackSuccess="true"/.test(sr.content)
        && /isSuppress="true"/.test(vr?.content || '') && CL.colonization(vc) === 2 && CL.colonization(city) === 1 && G.beans.castle(vc, vassal).colonization === 2,
        'at the end of the period the Stabilization battle is fought: won, the city is a Protectorate (colonization 2, the suzerain 1) and the troops head home');
      march.reachTime = reinf.reachTime = Date.now(); await waitFor(() => !db.armies[march.id] && !db.armies[reinf.id]);
      // Tribute: 5% of the colony's production, paid by it and received by the suzerain.
      const now = Date.now(), raw = G.logic.rates(vc, vassal, now, true), paid = G.logic.rates(vc, vassal, now), got = G.logic.rates(city, me, now), rb = G.beans.resource(vc, vassal);
      ok(Math.abs(paid.tribute.food + raw.food * 0.05) < 1e-6 && Math.abs(got.tribute.food - raw.food * 0.05) < 1e-6 && Math.abs(paid.food - raw.food * 0.95) < 1e-6 && rb.colonyFood < 0 && rb.colonyFood === Math.round(-raw.food * 0.05 * sp)
        && G.beans.resource(city, me).colonyFood === Math.round(raw.food * 0.05 * sp),
        `a Protectorate pays 5% of its production as tribute (${rb.colonyFood} food an hour) and its suzerain receives it`);
      // The colony can't colonize, and its suzerain can't attack it while it is quiet.
      const bound = CL.cantColonize(vassal, vc, world.tileAt(srv.store, oc.fieldId), Date.now());
      const hitIt = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 5, heroId: hero.id, targetPoint: vc.fieldId, troops: { lightCavalry: 100 }, resource: {}, restTime: 0 } });
      ok(bound && /regain your freedom/.test(bound[1]) && hitIt.ok < 0 && /your Protectorate/.test(hitIt.errorMsg) && CL.mapFields(city, vassal).colonialRelation === 2 && CL.mapFields(vc, vassal).colonialRelation === 2,
        'a colony must regain its freedom before it colonizes, the suzerain can\'t attack a quiet Protectorate, and the colony\'s lord sees Uprise on both cities');
      // Policies: one a day per colony, 10% each.
      const list = await c.call('colony.getColonialCastlesInfo', { castleId: castle.id });
      vc.res.gold = 10000; G.logic.settle(vc, vassal, Date.now()); const vg = vc.res.gold;
      const tax = await c.call('colony.levyTaxes', { castleId: castle.id, targetCastleId: vc.id });
      const again = await c.call('colony.levyFood', { castleId: castle.id, targetCastleId: vc.id });
      rec.policyDay = null; vc.troops = { archer: 500 }; const arch0 = city.troops.archer || 0;
      const draft = await c.call('colony.levyArmy', { castleId: castle.id, targetCastleId: vc.id });
      const imp = reportOf(vassal, /used Tax Imposition/);
      ok(list.colonyBeans[0]?.isCanLevy === true && list.colonyBeans[0].relation === 3 && list.colonyBeans[0].status === 2 && /^\d+,\d+$/.test(list.colonyBeans[0].position)
        && tax.ok === 1 && Math.abs(tax.amount - Math.floor(vg * 0.1)) <= 5 && again.ok < 0 && /already used a policy/.test(again.errorMsg) && draft.amount === 50 && draft.armyType === 'Archer' && city.troops.archer === arch0 + 50
        && /<ImpositionReport isColony="true" suzerain="[^"]+" colony="[^"]+" food="0" lumber="0" stone="0" iron="0" gold="\d+"\/>/.test(imp?.content || ''),
        'colony policies take 10% (Tax Imposition, Draft 50 of 500 archers), one a day per colony, and the colony gets an imposition report');
      // Sow Discord: -30 loyalty for the colony's heroes, and maybe a captive.
      rec.policyDay = null;
      const vh = { id: G.store.id(), name: 'Vassal Hero', level: 5, exp: 0, base: G.heroes.baseStats(5), added: { pol: 0, atk: 0, int: 0 }, points: 0, face: 1, status: 0, loyalty: 70 };
      const vh2 = { ...vh, id: G.store.id(), name: 'Loyal Hero', base: G.heroes.baseStats(5), added: { pol: 0, atk: 0, int: 0 }, loyalty: 80 };
      G.heroes.list(vc).push(vh, vh2);
      const vac = G.heroes.vacancies(city), sow = CL.sowDiscord(city, me, vc.id, Date.now(), () => 0), sr2 = reportOf(vassal, /used Sow Discord/);
      ok(!Array.isArray(sow) && vh2.loyalty === 50 && G.heroes.find(vc, vh2.id) && (vac ? sow.captured === vh && vh.status === 4 && G.heroes.find(city, vh.id) && !G.heroes.find(vc, vh.id) && /<capturedHero heroName="Vassal Hero" heroLevel="5"/.test(sr2?.content || '') : !sow.captured)
        && /<sowDiscordReport suzerainLord="[^"]+" suzerainCastle=/.test(sr2?.content || ''),
        `Sow Discord takes 30 loyalty from the colony's heroes${vac ? ' and can capture one into the Feasting Hall' : ''}`);
      if (G.heroes.find(city, vh.id)) city.heroes = city.heroes.filter(h => h !== vh);
      // The suppression army: a share of each kind of troop in the suzerain city; lowering it has a 5-hour cool down.
      const d0 = await c.call('colony.getDeployTroopsInfo', { castleId: castle.id, targetCastleId: vc.id });
      const set = await c.call('colony.setDeployTroops', { castleId: castle.id, targetCastleId: vc.id, troopBean: { lightCavalry: 50 } });
      const lower = await c.call('colony.setDeployTroops', { castleId: castle.id, targetCastleId: vc.id, troopBean: { lightCavalry: 20 } });
      const lower2 = await c.call('colony.setDeployTroops', { castleId: castle.id, targetCastleId: vc.id, troopBean: { lightCavalry: 10 } });
      const bad = await c.call('colony.setDeployTroops', { castleId: castle.id, targetCastleId: vc.id, troopBean: { lightCavalry: 101 } });
      const lc = city.troops.lightCavalry; city.troops.lightCavalry = 10000000;
      const huge = await c.call('colony.setDeployTroops', { castleId: castle.id, targetCastleId: vc.id, troopBean: { lightCavalry: 100 } });
      city.troops.lightCavalry = lc;
      const d1 = await c.call('colony.getDeployTroopsInfo', { castleId: castle.id, targetCastleId: vc.id });
      ok(d0.ok === 1 && d0.troopBean.lightCavalry === 0 && d0.reduceCoolDown === 0 && set.ok === 1 && lower.ok === 1 && lower2.ok < 0 && /modify your deploying troops again in/.test(lower2.errorMsg)
        && bad.ok < 0 && huge.ok < 0 && /dispatch limit/.test(huge.errorMsg) && d1.troopBean.lightCavalry === 20 && Math.abs(d1.reduceCoolDown - 5 * 3600000 / sp) < 2000,
        'the suppression army is a percentage of the suzerain city\'s troops within its Rally Spot limit, and lowering it starts a 5-hour cool down');
      // Uprise: 30 minutes later the colony fights the suppression army.
      vc.troops = { militia: 5 };
      const up = CL.uprise(vc, vassal, Date.now()), upr = reportOf(vassal, /rose up/), sur = reportOf(me, /Uprising in your Protectorate/);
      const again2 = CL.uprise(vc, vassal, Date.now());
      ok(!Array.isArray(up) && rec.status === 3 && Math.abs(rec.endTime - rec.startTime - 30 * 60000 / sp) < 2 && Array.isArray(again2) && G.quests.state(vassal).flags.uprising
        && /<uprisingWarReport isColony="true" startTime=/.test(upr?.content || '') && /<uprisingWarReport isColony="false"/.test(sur?.content || ''),
        'Uprise starts a 30-minute uprising war, both lords get an uprising report, and it ticks the Uprising quest');
      rec.endTime = Date.now() - 1; CL.tick(Date.now());
      const sup = reportOf(me, /suppressed/);
      ok(rec.status === 2 && /isUprising="true"/.test(sup?.content || '') && /isAttackSuccess="true"/.test(sup.content),
        'the suppression army beats the uprising and the city stays a Protectorate');
      // A won attack on an uprising colony suppresses it too.
      CL.uprise(vc, vassal, Date.now()); vc.troops = {};
      const sa = { id: G.store.id(), playerId: me.id, castleId: city.id, heroId: 0, mission: 5, from: city.fieldId, target: vc.fieldId, troops: { lightCavalry: 100 }, carry: {}, loot: null,
        startTime: Date.now(), reachTime: Date.now(), oneWay: 1000, direction: 1, restTime: 0 };
      db.armies[sa.id] = sa; A.arrive(sa, Date.now());
      const sar = reportOf(me, /suppressed the uprising/);
      ok(rec.status === 2 && sa.direction === 2 && /isUprising="true"/.test(sar?.content || '') && !/lootResource/.test(sar.content), 'attacking an uprising colony suppresses the uprising (and takes nothing)');
      delete db.armies[sa.id]; city.troops.lightCavalry += sa.troops.lightCavalry || 0;
      // With no suppression army the uprising wins and the city is free.
      rec.deploy = {}; CL.uprise(vc, vassal, Date.now()); rec.endTime = Date.now() - 1; CL.tick(Date.now());
      ok(!CL.ofColony(vc) && CL.colonization(vc) === 0 && reportOf(vassal, /is free/) && G.logic.rates(vc, vassal).tribute.food === 0,
        'with no suppression army set the uprising succeeds and the city is free (no more tribute)');
      // Abandon: handed back after the handover time, or at once with Instant Handover.
      const r2 = CL.list()[G.store.id()] = { id: 0, suzerainCastleId: city.id, suzerainPlayerId: me.id, colonyCastleId: vc.id, colonyPlayerId: vassal.id, status: 2, createdAt: Date.now(), since: Date.now(), startTime: Date.now(), endTime: 0, armies: [], deploy: {} };
      r2.id = Number(Object.keys(CL.list()).find(k => CL.list()[k] === r2));
      const ab = await c.call('colony.abandonColony', { castleId: castle.id, targetCastleId: vc.id });
      me.items['instant.handover'] = 0;
      const noItem = await c.call('colony.speedUpAbandonColony', { castleId: castle.id, targetCastleId: vc.id, itemId: 'instant.handover' });
      me.items['instant.handover'] = 1;
      const fast = await c.call('colony.speedUpAbandonColony', { castleId: castle.id, targetCastleId: vc.id, itemId: 'instant.handover' });
      const abr = reportOf(vassal, /is free/);
      ok(ab.ok === 1 && noItem.ok < 0 && fast.ok === 1 && !CL.ofColony(vc) && me.items['instant.handover'] === 0 && /ColonyAbadonReport isColony="true"/.test((vassal.reports || []).find(r => /ColonyAbadonReport/.test(r.content))?.content || '') && abr,
        'Abandon hands a colony back after the handover time; Instant Handover does it at once and the colony is told');
      // Recalling the last stationed army calls the colonization off.
      const ra = { id: G.store.id(), playerId: me.id, castleId: city.id, heroId: 0, mission: 7, from: city.fieldId, target: vc.fieldId, troops: { lightCavalry: 10 }, carry: {}, loot: null, startTime: Date.now(), reachTime: Date.now(), oneWay: 1000, direction: 1, restTime: 0 };
      db.armies[ra.id] = ra; city.troops.lightCavalry -= 10;
      const r3 = CL.begin(ra, me, city, vc, Date.now()), back = A.recall(me, ra.id, Date.now()); CL.tick(Date.now());
      ok(!Array.isArray(back) && ra.direction === 2 && ra.reachTime - Date.now() > 0 && !CL.list()[r3.id] && reportOf(me, /called off/), 'recalling the stationed army calls the colonization off');
      await waitFor(() => !db.armies[ra.id]);
      me.title = titleWas; G.rules.rallyArmiesPerLevel = perRally; me.createdAt = createdWas;
    }
    // Heroes (the Feasting Hall, the lord's profile, the Stone of Finding and Recruit Hero; Fox: an attacking hero
    // with 0 loyalty is captured by the city that beats it, and a taken city's heroes become prisoners).
    {
      const G = srv.game, A = G.armies, W = G.war, db = srv.store.db, titleWas = me.title || 0, createdWas = me.createdAt;
      const perRally = G.rules.rallyArmiesPerLevel; G.rules.rallyArmiesPerLevel = 5;
      heroObj.status = 0; if (!G.heroes.find(city, heroObj.id)) G.heroes.list(city).push(heroObj);
      const hallOf = cc => Object.values(cc.buildings).find(b => b.typeId === 27);
      const addHall = (cc, L) => { const h = hallOf(cc); if (h){ h.level = Math.max(h.level, L); return; } const i = [...Array(32).keys()].find(k => !cc.buildings[k]); cc.buildings[i] = { ...cc.buildings['-1'], typeId: 27, level: L }; };
      addHall(city, G.heroes.list(city).length + 3);
      // Status: out (3), coming back (5); the Feasting Hall's Recall brings the army back.
      const npcT = (() => { const { x, y } = world.xy(city.fieldId); for (let d = 1; d < 200; d++) for (let dx = -d; dx <= d; dx++) for (const dy of [-d, d]){ const t = world.tileAt(srv.store, world.idOf((x + dx + 800) % 800, (y + dy + 800) % 800)); if (t.type === world.T.NPC && !t.historic && !srv.store.db.tiles[t.id]) return t; } })();
      city.troops.lightCavalry = (city.troops.lightCavalry || 0) + 100;
      const out = await c.call('army.newArmy', { castleId: castle.id, newArmyBean: { missionType: 5, heroId: hero.id, targetPoint: npcT.id, troops: { lightCavalry: 100 }, resource: {}, restTime: 0 } });
      const st3 = G.heroes.bean(heroObj).status;
      const back = await c.call('hero.callBackHero', { castleId: castle.id, heroId: hero.id });
      const st5 = G.heroes.bean(heroObj).status, recalled = A.of(me).find(a => a.heroId === hero.id);
      const again = await c.call('hero.callBackHero', { castleId: castle.id, heroId: hero.id });
      if (recalled) recalled.reachTime = Date.now();
      await (async () => { for (let i = 0; i < 100 && recalled && db.armies[recalled.id]; i++) await sleep(50); })();
      ok(out.ok === 1 && st3 === 3 && back.ok === 1 && st5 === 5 && recalled?.direction === 2 && again.ok < 0 && heroObj.status === 0,
        'a hero out with an army shows as out (3), and the Feasting Hall\'s Recall brings the army back; coming home it shows as returning (5)');
      // Champions: the heroes a lord shows other lords.
      const show = await c.call('hero.SetShowHeroId', { heroid: hero.id, bAddOrDel: true });
      const seen = await c.call('hero.ShowPlayerHerosByUserName', { UserName: me.name.toUpperCase() });
      const hide = await c.call('hero.SetShowHeroId', { heroid: hero.id, bAddOrDel: false });
      const none = await c.call('hero.ShowPlayerHerosByUserName', { UserName: me.name }), nobody = await c.call('hero.ShowPlayerHerosByUserName', { UserName: 'No Such Lord' });
      const flee = await c.call('hero.getFleeHeroList', { castleId: castle.id });
      ok(show.ok === 1 && show.selectheroids.some(x => x.selectshowheroid === hero.id) && seen.heros.length === 1 && seen.heros[0].id === hero.id && hide.selectheroids.length === 0 && none.heros.length === 0
        && nobody.ok < 0 && flee.ok === 1 && flee.heros.length === 0, 'Champions: a lord picks the heroes other lords see; Hero Ransom stays empty (no salary penalty on Age II)');
      // An attacking hero with 0 loyalty is captured by the city that beats it.
      const foe = G.createPlayer({ name: 'Warden' }, { userName: 'Warden' }), fc = G.castlesOf(foe)[0];
      me.createdAt = foe.createdAt = Date.now() - 8 * 86400000; W.declare(me, foe, Date.now() - 31 * 60000);
      addHall(fc, 3); fc.troops = { archer: 3000 }; fc.forts = {};
      const brave = { id: srv.store.id(), name: 'Brave', level: 10, exp: 0, base: G.heroes.baseStats(10), added: { pol: 0, atk: 0, int: 0 }, points: 0, face: 1, status: 3, loyalty: 0 };
      G.heroes.list(city).push(brave);
      const army = (heroId, troops, target, mission = 5) => { const x = { id: srv.store.id(), playerId: me.id, castleId: city.id, heroId, mission, from: city.fieldId, target, troops, carry: {}, loot: null, startTime: Date.now(), reachTime: Date.now(), oneWay: 1000, direction: 1, restTime: 0 }; db.armies[x.id] = x; return x; };
      const a1 = army(brave.id, { militia: 5 }, fc.fieldId); A.arrive(a1, Date.now());
      const lostRep = (me.reports || [])[0], list = await c.call('hero.GetDisappearHeros', {});
      ok(brave.status === 4 && G.heroes.find(fc, brave.id) && !G.heroes.find(city, brave.id) && a1.heroId === 0 && /isHeroBeSeized="true"/.test(lostRep?.content || '') && /Brave was captured/.test(lostRep.title)
        && list.heros.some(h => h.id === String(brave.id) && h.name === 'Brave' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(h.disppeartime)),
        'an attacking hero with 0 loyalty is captured by the lord\'s city that beats it, and its lord sees it in the lost-hero list');
      delete db.armies[a1.id];
      const STONE = 'player.item.stoneoffinding';
      me.items[STONE] = 0;
      const noStone = await c.call('hero.RecoverDisappearHero', { castleid: castle.id, id: String(brave.id) });
      me.items[STONE] = 1;
      const found = await c.call('hero.RecoverDisappearHero', { castleid: castle.id, id: String(brave.id) });
      ok(noStone.ok < 0 && /Stone of Finding/.test(noStone.errorMsg) && found.ok === 1 && G.heroes.find(city, brave.id) && !G.heroes.find(fc, brave.id) && brave.status === 0 && !me.items[STONE]
        && (await c.call('hero.GetDisappearHeros', {})).heros.length === 0 && (foe.reports || []).some(r => /went back to/.test(r.title)),
        'a Stone of Finding brings a captured hero back from the captor\'s Feasting Hall within 24 hours');
      // Captured again and released: it goes home.
      brave.status = 3; brave.loyalty = 0; const a2 = army(brave.id, { militia: 5 }, fc.fieldId); A.arrive(a2, Date.now()); delete db.armies[a2.id];
      const caught = brave.status === 4 && !!G.heroes.find(fc, brave.id);
      G.heroes.release(fc, brave.id); G.captives.releaseHome(brave);
      ok(caught && G.heroes.find(city, brave.id) && brave.status === 0 && !(me.lostHeroes || []).some(e => e.id === brave.id), 'a captured lord\'s hero that is released goes home');
      city.heroes = city.heroes.filter(h => h !== brave);
      // Taking a lord's Historic City: won attacks lower its loyalty; at 0 it changes hands and its heroes become prisoners.
      me.title = me.castles.length + 3;
      const hc = G.createCastle(foe, { name: 'Wardenhold', now: Date.now() }); hc.powerLevel = 3; addHall(hc, 3); hc.troops = { militia: 5 }; hc.forts = {};
      const keeper = { id: srv.store.id(), name: 'Keeper', level: 5, exp: 0, base: G.heroes.baseStats(5), added: { pol: 0, atk: 0, int: 0 }, points: 0, face: 1, status: 1, loyalty: 70 };
      G.heroes.list(hc).push(keeper);
      hc.loyalty = 50; G.logic.settle(hc, foe, Date.now());
      const a3 = army(0, { lightCavalry: 2000 }, hc.fieldId); city.troops.lightCavalry = Math.max(0, (city.troops.lightCavalry || 0) - 2000); A.arrive(a3, Date.now());
      const loyAfter = hc.loyalty, still = hc.playerId === foe.id, rep1 = (me.reports || []).find(r => /support=/.test(r.content || '') && /Wardenhold/.test((r.title || '') + (r.content || '')));
      hc.loyalty = 1; hc.troops = { militia: 5 };
      const a4 = army(0, { lightCavalry: 2000 }, hc.fieldId); A.arrive(a4, Date.now());
      if (!(hc.playerId === me.id)) console.log('HCDBG', JSON.stringify({ still, loyAfter, loyNow: hc.loyalty, rep1: !!rep1, owner: hc.playerId === foe.id ? 'foe' : hc.playerId, a4: db.armies[a4.id] ? { dir: db.armies[a4.id].direction, troops: db.armies[a4.id].troops } : null, titles: (me.reports || []).slice(0, 4).map(r => r.title), title: me.title, castles: me.castles.length, max: G.quests.maxCities(me) }));
      ok(still && loyAfter < 50 && /support="-\d+"/.test(rep1?.content || '') && hc.playerId === me.id && me.castles.includes(hc.id) && !foe.castles.includes(hc.id) && keeper.status === 4 && G.heroes.find(hc, keeper.id)
        && (foe.lostHeroes || []).some(e => e.id === keeper.id) && (hc.troops.lightCavalry || 0) > 0 && !db.armies[a4.id] && (foe.reports || []).some(r => /Wardenhold was conquered/.test(r.title))
        && (me.reports || []).some(r => /City conquered/.test(r.title) && /Keeper/.test(r.content)),
        `won attacks lower a lord's Historic City's loyalty (50 to ${Math.floor(loyAfter)}); at 0 it is taken with its heroes as prisoners`);
      const honorRep = (me.reports || []).find(r => /honor="-?\d+"/.test(r.content || '') && /Wardenhold/.test((r.title || '') + (r.content || ''))), foeRep = (foe.reports || []).find(r => /honor="-?\d+"/.test(r.content || ''));
      ok(!!honorRep && !!foeRep && Number.isFinite(me.honor) && Number.isFinite(foe.honor) && G.beans.playerInfo(me, G.castlesOf(me)).honor === Math.round(me.honor),
        `battles between lords carry each side's honor in its report and add it to the lord's honor (here ${Math.round(me.honor)} and ${Math.round(foe.honor)})`);
      const last = A.cantTakeCity(me, foe);
      ok(last && /last city/.test(last), 'a lord\'s last city can\'t be taken');
      delete db.armies[a3.id];
      // Recruit Hero: a Legendary Ring makes one hero; three free re-rolls a day, then coins and gold.
      me.items['hero.gen.npc2'] = 0;
      const noRing = await c.call('hero.GetRandomHero', {});
      me.items['hero.gen.npc2'] = 1;
      const r0 = await c.call('hero.GetRandomHero', {});
      const rolls = []; for (let i = 0; i < 3; i++) rolls.push(await c.call('hero.RetSetHeroAttri', { lockmanagement: true, lockpower: false, lockstratagem: false, busecoin: false }));
      const coins0 = me.coins = 100, gold0 = Math.max(...G.castlesOf(me).map(x => x.res.gold));
      for (const x of G.castlesOf(me)) x.res.gold = Math.max(x.res.gold, 50000);
      const paid = await c.call('hero.RetSetHeroAttri', { lockmanagement: true, lockpower: true, lockstratagem: false, busecoin: false });
      const three = await c.call('hero.RetSetHeroAttri', { lockmanagement: true, lockpower: true, lockstratagem: true, busecoin: false });
      const pend = { ...me.ringHero };
      addHall(city, G.heroes.list(city).length + 2);
      const made = await c.call('hero.GenSaveRandomHero', { castleid: castle.id, heroname: 'Sir Ring', faceurl: 'images/icon/player/faceA3.jpg' });
      const rh = G.heroes.list(city).find(h => h.name === 'Sir Ring');
      ok(noRing.ok < 0 && /Legendary Ring/.test(noRing.errorMsg) && r0.ok === 1 && r0.randomherobean.resetcount === 3 && rolls.every(x => x.ok === 1 && x.randomherobean.management === r0.randomherobean.management)
        && rolls[2].randomherobean.resetcount === 0 && paid.ok === 1 && me.coins === coins0 - 40 && paid.randomherobean.power === rolls[2].randomherobean.power && three.ok < 0
        && made.ok === 1 && rh && rh.base.pol === pend.management && rh.base.atk === pend.power && rh.base.int === pend.stratagem && rh.face === 'images/icon/player/faceA3.jpg' && !me.items['hero.gen.npc2'] && !me.ringHero,
        'Recruit Hero needs a Legendary Ring; locked attributes keep their values, three re-rolls a day are free and then cost coins and gold (40 with two locks); recruiting uses the ring');
      // Fox's live capture of a Ring hero (Jessica): an On War book, then level-ups to 13 with 2,500 left over.
      me.items['player.experience.1.c'] = 1;
      const book = await c.call('hero.useItem', { castleId: castle.id, itemId: 'player.experience.1.c', heroId: rh.id });
      const ups = []; for (let i = 0; i < 13; i++) ups.push(await c.call('hero.levelUp', { castleId: castle.id, heroId: rh.id }));
      const rb = G.heroes.bean(rh);
      ok(book.ok === 1 && ups.slice(0, 12).every(u => u.ok === 1) && ups[12].ok === -99 && ups[12].errorMsg === 'You have insufficient experience points to upgrade.'
        && rh.level === 13 && rh.exp === 2500 && rh.points === 24 && rb.isHero === 4 && rb.upgradeExp === 25350 && rb.leadership === 13 && rb.leadershipAdded === 130 && rb.itemId === '',
        'a Ring hero, as live: On War gives 100,000 experience at level 1, each level costs 150 x level^2 and gives 2 points (level 13 with 2,500 left), and the hero shows as isHero 4');
      const H = G.heroes, at = (lv, extra = {}) => ({ level: lv, exp: 0, base: { pol: 1, atk: 1, int: 1 }, added: { pol: 0, atk: 0, int: 0 }, points: 0, ...extra });
      const need = lv => H.persuadeNeed(at(lv)).join('x');
      const cap = at(99, { exp: H.expToNext(99) + 500 }), capCity = { heroes: [cap] }; cap.id = 1;
      const capUp = H.levelUp(capCity, 1), past = H.levelUp(capCity, 1); H.gainExp(cap, 1000);
      const ringTop = at(120, { ringHero: true, exp: 10 }); H.gainExp(ringTop, 1000);
      ok(need(47) === 'x0' && need(50) === 'x0' && need(54) === 'hero.loyalty.1x1' && need(100) === 'hero.loyalty.5x5' && need(120) === 'hero.loyalty.7x7'
        && !Array.isArray(capUp) && cap.level === 100 && cap.exp === 0 && Array.isArray(past) && H.maxLevel(ringTop) === 120 && ringTop.exp === 1010 && H.leadership(ringTop) === 120,
        'persuading a captive above level 50 takes a medal tier per 10 levels (54: 1 Cross Medal, 100: 5 Courage, 120: 7 Freedom); an ordinary hero stops at 100 with no experience kept, a Ring hero at 120 keeps gathering it');
      const hist = at(149, { historic: 146, exp: H.expToNext(149) }), histCity = { heroes: [hist] }; hist.id = 2;
      const histUp = H.levelUp(histCity, 2), histTop = H.levelUp(histCity, 2);
      const sp = G.logic.speed; G.logic.speed = 1;
      const live28 = G.armies.travelMs(554631, 555432, { archer: 150000 }, { techs: { 12: 10 } }, null, 6); G.logic.speed = sp;
      ok(!Array.isArray(histUp) && hist.level === 150 && hist.points === 2 && Array.isArray(histTop) && H.maxLevel(hist) === 150 && G.heroes.bean(rh).isHero === 4 && live28 === 28000,
        'a historic hero goes to level 150 with 2 points a level (the live ranking), and 150,000 Archers reinforce a city 1.4 tiles away in 28 seconds with a level 10 Relief Station, as live');
      // A historic hero from before 0.3.61 had 1 point a level for his first 30 (Fox: Holy Water gave back 30, not 60).
      const old35 = { historic: 146, level: 35, added: { pol: 20, atk: 10, int: 10 }, points: 0 }, wild = { pol: 10, atk: 10, int: 10 };
      const owed = G.hh.owed(old35), owedAgain = G.hh.owed(old35), topped = G.hh.topUp(wild);
      ok(owed && !owedAgain && old35.points === 30 && old35.added.pol + old35.added.atk + old35.added.int + old35.points === 70 && topped && wild.pol + wild.atk + wild.int === 60,
        'historic heroes from older saves get the points they were short (2 a level, counting the first 30: 70 at level 35), and wild ones waiting in NPC cities come with 60');
      if (rh) city.heroes = city.heroes.filter(h => h !== rh);
      me.title = titleWas; me.createdAt = createdWas; G.rules.rallyArmiesPerLevel = perRally;
    }
    // The Governor election (Fox and the wiki: one vote a day for any lord, himself included, from 1,000 prestige; the
    // weekly winner is Governor) and the Hall of Fame.
    {
      const G = srv.game, F = G.fame, prestigeWas = me.prestige, titleWas = me.title || 0;
      const fan = G.createPlayer({ name: 'Voter' }, { userName: 'Voter' });
      me.prestige = 500;
      const poor = await c.call('vote.voteToPlayerByName', { name: me.name });
      me.prestige = 2000; fan.prestige = 1000;
      const own = await c.call('vote.voteToPlayerByName', { name: me.name.toLowerCase() });
      const twice = await c.call('vote.voteToPlayerById', { playerId: me.id });
      const other = F.vote(fan, me, Date.now());
      const cur = await c.call('rank.getVoteRank', { key: '', pageNo: 1, pageSize: 10, sortType: 1 });
      ok(poor.ok < 0 && /1,000 prestige/.test(poor.errorMsg) && own.ok === 1 && twice.ok < 0 && /already voted today/.test(twice.errorMsg) && !Array.isArray(other)
        && cur.beans[0]?.userName === me.name && cur.beans[0].getvotes === 2 && cur.votestoal === 2 && cur.voteendtime > 0 && cur.voteendtime <= 7 * 86400,
        'a lord with 1,000 prestige votes once a day for any lord (himself too), and this week\'s poll shows the votes and when it closes');
      // The poll closes: the top lord is Governor for the next week.
      const st = F.state(); st.term -= 1; F.roll(Date.now());
      const pre = await c.call('rank.getVoteRank', { key: '', pageNo: 1, pageSize: 10, sortType: 0 }), his = await c.call('rank.getTopVotesPlayer', {});
      const me2 = G.beans.playerInfo(me, G.castlesOf(me));
      ok(F.isGovernor(me) && (me.buffs.TopeVotesPrivilegeBuf || 0) > Date.now() && F.chatName(me) === (me.sex ? 'Governess ' : 'Governor ') + me.name && me2.bdenyotherplayer === 1
        && pre.beans[0]?.userName === me.name && pre.beans[0].prweekvotes === 2 && his.beans[0]?.userName === me.name && his.beans[0].topvotes === 2 && /^\d{4}-\d\d-\d\d ~ \d{4}-\d\d-\d\d$/.test(his.beans[0].term),
        'when the poll closes its winner is Governor for the next week (the privilege buff, "Governor" in World Chat, the chat mute), and the results and the winners list show it');
      delete me.buffs.TopeVotesPrivilegeBuf;
      // The Hall of Fame: the first 100 lords to reach each mark.
      // (A new lord: the tick notes every lord, and the tester's prestige and title change during the run.)
      const star = G.createPlayer({ name: 'Famous' }, { userName: 'Famous' }); star.prestige = 30000; star.title = 4; F.check(star, Date.now());
      const p10 = await c.call('celeb.findPlayerByPrestige', { prestige: '10000' }), p50 = await c.call('celeb.findPlayerByPrestige', { prestige: '50000' });
      const baron = await c.call('celeb.findPlayerByTitle', { title: 'Baron' }), earl = await c.call('celeb.findPlayerByTitle', { title: 'Earl' });
      const stars = await c.call('celeb.findPlayerByStar', { starlv: 5 }), alliances = await c.call('celeb.findAllianceByPrestige', { prestige: '1000000' });
      const mine = p10.playerBean.find(b => b.userName === 'Famous');
      ok(mine && mine.ranking >= 1 && /^\d{4}\.\d\d\.\d\d/.test(mine.date) && !p50.playerBean.some(b => b.userName === 'Famous') && baron.playerBean.some(b => b.userName === 'Famous')
        && !earl.playerBean.some(b => b.userName === 'Famous') && stars.ok === 1 && alliances.ok === 1 && alliances.allianceBean.length === 0,
        'the Hall of Fame lists the first lords to reach each prestige mark and title, with the date');
      me.prestige = prestigeWas; me.title = titleWas;
    }
    // Account and profile: the Security Code, Vacation, Dream Truce, the portrait and the membership options.
    {
      const G = srv.game, A = G.account, city = G.db.castles[castle.id], taxNow = city.taxRate, pwd = sha1('secret');
      const tax = () => c.call('interior.modifyTaxRate', { castleId: castle.id, tax: taxNow });
      const unset = await c.call('common.getIsSecurityCodeSetted', {});
      const short = await c.call('common.setSecurityCode', { code: '12' });
      const set = await c.call('common.setSecurityCode', { code: '1234' });
      const isSet = await c.call('common.getIsSecurityCodeSetted', {});
      const guarded = await tax();
      const early = await c.call('common.setUnlockOption', { option: 16 });
      const wrong = await c.call('common.authSecurityCode', { code: '9999' });
      const right = await c.call('common.authSecurityCode', { code: '1234' });
      const unlock = await c.call('common.setUnlockOption', { option: 16 });
      const freed = await tax();
      ok(unset.isSetSecurityCode === false && short.ok < 0 && set.ok === 1 && isSet.isSetSecurityCode === true && guarded.ok === -200 && early.ok === -200
        && wrong.ok < 0 && right.ok === 1 && unlock.ok === 1 && freed.ok === 1,
        'a Security Code guards the tax rate (-200 asks for it); the right code unlocks that action for the session');
      const opt = await c.call('common.setProtectOption', { option: 15 }), got = await c.call('common.getProtectOption', {});
      const badChange = await c.call('common.changeSecurityCode', { curCode: '0000', newCode: '5678' });
      const changed = await c.call('common.changeSecurityCode', { curCode: '1234', newCode: '5678' });
      const oldCode = await c.call('common.authSecurityCode', { code: '1234' }), newCode = await c.call('common.authSecurityCode', { code: '5678' });
      ok(opt.ok === 1 && got.option === 15 && badChange.ok < 0 && changed.ok === 1 && oldCode.ok < 0 && newCode.ok === 1,
        'the protected actions can be chosen, and the code can be changed with the current one');
      // Removing a forgotten code takes 72 hours, and nothing protected can be done meanwhile.
      const rm = await c.call('common.removeSecurityCode', {});
      const removing = (me.buffs.RemovingSecurityCodeBuff || 0) - G.now();
      const blocked = await c.call('colony.abandonColony', { castleId: castle.id, targetCastleId: 1 });
      const back = await c.call('common.cancelRemovingSecurityCodeProcess', {});
      const kept = !!me.security && !me.security.removeAt && !me.buffs.RemovingSecurityCodeBuff;
      await c.call('common.removeSecurityCode', {});
      me.security.removeAt = G.now() - 1;
      const gone = await c.call('common.getIsSecurityCodeSetted', {});
      const ev = await c.wait('server.SecurityCodeRemovedEvent').then(() => true, () => false);
      ok(rm.ok === 1 && removing > 71 * 3600000 && removing <= 72 * 3600000 && blocked.ok === -1 && /being removed/.test(blocked.errorMsg) && back.ok === 1 && kept
        && gone.isSetSecurityCode === false && ev && !me.security,
        'removing the Security Code takes 72 hours (no protected actions meanwhile) and can be called off; when it is done the client is told');

      // Vacation: 10 cents a day (and 10 more per colony every 3 days), at least 2 days, at least 24 hours.
      const coinsWas = me.coins, createdWas = me.createdAt;
      me.coins = 5;
      const badPwd = await c.call('furlough.isFurlought', { playerId: me.id, day: 3, password: sha1('nope'), isAutoFurlough: false });
      const oneDay = await c.call('furlough.isFurlought', { playerId: me.id, day: 1, password: pwd, isAutoFurlough: false });
      const broke = await c.call('furlough.isFurlought', { playerId: me.id, day: 3, password: pwd, isAutoFurlough: false });
      me.coins = 1000;
      const cost = A.vacationCost(me, 3), colonies = G.colonies.records().filter(r => r.suzerainPlayerId === me.id && r.status !== 1).length;
      const away = await c.call('furlough.isFurlought', { playerId: me.id, day: 3, password: pwd, isAutoFurlough: false });
      const raider = G.createPlayer({ name: 'Raider' }, { userName: 'Raider' }); raider.createdAt = 0; me.createdAt = 0;
      const noWar = G.war.cantDeclare(raider, me, G.now());
      const busy = await tax();
      ok(badPwd.ok < 0 && oneDay.ok < 0 && /2 days/.test(oneDay.errorMsg) && broke.ok === -28 && cost === 30 + colonies * 10 && away.ok === 1 && me.coins === 1000 - cost
        && away.playerBean.furlough === true && away.playerBean.furloughDay === 3 && noWar && /vacation/.test(noWar[1]) && busy.ok < 0 && /vacation/i.test(busy.errorMsg),
        `Vacation costs 10 cents a day plus 10 per colony every 3 days (${cost} cents here), needs the password and 2 days; meanwhile nothing can be done and no war declared`);
      const c4 = new FakeClient(PORTS.gamePort); await c4.ready();
      c4.send('gameClient.version', '091103_11'); c4.send('login', { user: 'tester', pwd });
      const hol = (await c4.wait('server.LoginResponse')).data;
      const tooSoon = await c4.call('furlough.cancelFurlought', {});
      me.furlough.start -= 25 * 3600000;
      const home = await c4.call('furlough.cancelFurlought', {});
      c4.close();
      const [hh, mm, wait] = String(hol.msg).split(',').map(Number);
      ok(hol.ok === -100 && hh >= 71 && hh <= 72 && mm >= 0 && wait > 1430 && wait <= 1440 && tooSoon.ok < 0 && /24 hours/.test(tooSoon.errorMsg) && home.ok === 1 && !me.furlough && (await tax()).ok === 1,
        'logging in on vacation shows the Holiday window (time left, and when it can be called off); it can be called off after 24 hours');
      me.coins = 100; me.furlough = { start: G.now() - 2 * 86400000, end: G.now() - 1, days: 2, auto: true }; A.tick(G.now());
      const renewed = me.furlough && me.furlough.end > G.now() && me.coins === 100 - A.vacationCost(me, 2);
      me.coins = 0; me.furlough.end = G.now() - 1; A.tick(G.now());
      ok(renewed && !me.furlough, 'Auto Extend renews a vacation while the coins last');
      me.coins = coinsWas;

      // Dream Truce: 10 hours of truce a day from the chosen time, one item a day; the time can change once in 72 hours.
      const t0 = G.now(), hour = (new Date(t0).getHours() + 2) % 24;
      me.items['player.truce.dream'] = 0;
      const none = await c.call('truce.setDreamTruce', { hour, minute: 0, second: 0, password: pwd });
      me.items['player.truce.dream'] = 2;
      const badDream = await c.call('truce.setDreamTruce', { hour, minute: 0, second: 0, password: sha1('nope') });
      const d1 = await c.call('truce.setDreamTruce', { hour, minute: 0, second: 0, password: pwd });
      const [a1, b1] = A.dreamWindows(me)[0];
      const d2 = await c.call('truce.setDreamTruce', { hour: (hour + 5) % 24, minute: 0, second: 0, password: pwd });
      const wins = A.dreamWindows(me);
      ok(none.ok === -44 && badDream.ok < 0 && d1.ok === 1 && d2.ok === 1 && b1 - a1 === 10 * 3600000 && a1 > t0 && a1 - t0 <= 2 * 3600000 && wins.length === 2 && Math.abs(wins[1][0] - a1 - 86400000) <= 3600000
        && !me.items['player.truce.dream'] && me.buffs.DreamTruceBuff === wins[1][1] && G.war.truce(me, a1 + 1000) && !G.war.truce(me, a1 - 1000)
        && /Truce/.test(G.war.cantDeclare(raider, me, a1 + 1000)?.[1] || ''),
        'a Dream Truce gives 10 hours of truce a day from the chosen time (another one adds a day at the same time), and no war can be declared during it');
      const ch = await c.call('truce.changeDreamTruceTime', { hour: (hour + 3) % 24, minute: 30, second: 0, password: pwd });
      const ch2 = await c.call('truce.changeDreamTruceTime', { hour: hour, minute: 0, second: 0, password: pwd });
      const after = A.dreamWindows(me);
      const cancelBad = await c.call('truce.cancelDreamTruce', { password: sha1('nope') }), cancel = await c.call('truce.cancelDreamTruce', { password: pwd });
      ok(ch.ok === 1 && ch2.ok < 0 && /72 hours/.test(ch2.errorMsg) && after.length === wins.length && cancelBad.ok < 0 && cancel.ok === 1 && !me.dreamTruce && !me.buffs.DreamTruceBuff,
        'the Dream Truce starting time can be changed once every 72 hours, and the Dream Truce can be cancelled with the password');

      // The portrait changes once; the headline and the membership e-mail are kept.
      const faceWas = me.faceUrl, sexWas = me.sex;
      const badFace = await c.call('common.changeUserFace', { faceUrl: 'http://example.com/x.jpg', sex: 1 });
      const face = await c.call('common.changeUserFace', { faceUrl: 'images/icon/player/faceB2.jpg', sex: 1 });
      const face2 = await c.call('common.changeUserFace', { faceUrl: 'images/icon/player/faceA1.jpg', sex: 0 });
      const faceBean = G.beans.player(me, G.castlesOf(me), G.now());
      const head = await c.call('common.changeHeadline', { headline: 'Fox den' });
      const badMail = await c.call('common.setEvonyMemberEMail', { email: 'not-mail' }), mail = await c.call('common.setEvonyMemberEMail', { email: 'lord@example.com' });
      const bean = G.beans.player(me, G.castlesOf(me), G.now());
      ok(badFace.ok < 0 && face.ok === 1 && face2.ok < 0 && faceBean.changedFace === true && me.faceUrl === 'images/icon/player/faceB2.jpg' && head.ok === 1 && bean.headline === 'Fox den'
        && badMail.ok < 0 && mail.ok === 1 && bean.emailAddress === 'lord@example.com' && bean.isEvonyMember === true,
        'the portrait can be changed once, and the headline and the membership e-mail are kept');
      me.faceUrl = faceWas; me.sex = sexWas; delete me.changedFace; me.createdAt = createdWas;
    }
    // Building queues (Bernini's Hammer): per city, 1 a title; queuing pays the cost; the hammer is used up.
    {
      const G = srv.game, Q = G.buildQueue, L = G.logic, city = G.db.castles[castle.id], now0 = Date.now();
      const titleWas = me.title || 0, coinsWas = me.coins, hammersWas = me.items['player.queue.building'] || 0, resWas = { ...city.res };
      for (const k of ['food', 'wood', 'stone', 'iron']) city.res[k] = 1e6;
      const entries = () => Object.entries(city.buildings).map(([pos, b]) => [Number(pos), b]);
      const [farmPos, farm] = entries().find(([, b]) => b.typeId === 7 && b.status === 0 && b.level >= 1 && b.level <= 7);
      const [busyPos, bb] = entries().find(([pos, b]) => b.status === 0 && b.level >= 1 && pos !== farmPos && b.typeId !== 31 && b.typeId !== 32);
      const [demPos, dem] = entries().find(([pos, b]) => b.status === 0 && b.level >= 1 && pos !== farmPos && pos !== busyPos && b.typeId !== 31 && b.typeId !== 32);
      const plot = Array.from({ length: 32 }, (_, i) => i).find(i => !city.buildings[i]);
      const farmLv = farm.level, bbWas = { ...bb }, demWas = { ...dem };
      Object.assign(bb, { status: 1, startTime: now0, endTime: now0 + 3600000, cost: null });   // the builders are busy
      me.title = 0; me.items['player.queue.building'] = 1; me.coins = 3;
      // (Resources also move with production and upkeep, so the payments are watched where they're made.)
      const pays = [], payWas = L.pay; L.pay = (...a) => { pays.push([a[1].food, a[2]]); return payWas.apply(L, a); };
      const q1 = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 7, level: farmLv + 1, positionId: farmPos });
      const add1 = await c.wait('server.BuildingQueueUpdate', 3000, d => d.buildingQueueBean.status === 1).then(m => m.data, () => null);
      const civFull = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 7, level: farmLv + 2, positionId: farmPos });
      me.title = 3;
      const broke = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 7, level: farmLv + 2, positionId: farmPos });
      me.coins = 100;
      const q2 = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 7, level: farmLv + 2, positionId: farmPos });
      const q3 = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 1, level: 1, positionId: plot });
      const q4 = await c.call('castle.demolishBuildingQueue', { castleId: castle.id, type: dem.typeId, level: dem.level - 1, positionId: demPos });
      const baronFull = await c.call('castle.newBuildingQueue', { castleId: castle.id, type: 7, level: farmLv + 3, positionId: farmPos });
      const list = Q.list(city).map(q => [q.pos, q.level, q.kind]);
      ok(q1.ok === 1 && add1 && add1.buildingQueueBean.level === farmLv + 1 && add1.buildingQueueBean.queueType === 1 && add1.buildingQueueBean.costTime > 0 && !me.items['player.queue.building']
        && pays[0]?.[0] === L.condition(city, me, 7, farmLv + 1).food && pays[0][1] === -1 && civFull.ok < 0 && /queue 1 building/.test(civFull.errorMsg) && broke.ok === -28 && q2.ok === 1 && me.coins === 85
        && q3.ok === 1 && q4.ok === 1 && baronFull.ok < 0 && /4 buildings/.test(baronFull.errorMsg)
        && JSON.stringify(list) === JSON.stringify([[farmPos, farmLv + 1, 1], [farmPos, farmLv + 2, 1], [plot, 1, 1], [demPos, dem.level - 1, 0]]),
        'while the builders are busy a city queues buildings, new ones, next levels and demolitions (1 per title: a Civilian 1, a Baron 4), paying for each and a Bernini\'s Hammer (bought for 5 cents when there is none)');
      const free = await c.call('castle.speedupBuildingQueue', { castleId: castle.id, queueId: Q.list(city)[0].id, itemId: 'free.speed' });
      const need = await c.call('castle.getBuildingQueueCoinsNeed', { castleId: castle.id, queueId: Q.list(city)[1].id });
      const sped = await c.call('castle.speedupBuildingQueue', { castleId: castle.id, queueId: Q.list(city)[1].id, itemId: 'coins.speed' });
      const coinsLeft = me.coins;
      const cancel = await c.call('castle.cancelBuildingQueue', { castleId: castle.id, queueId: Q.list(city)[3].id });
      const bean = G.beans.castle(city, me);
      ok(free.ok === 1 && need.coinsNeed >= 1 && sped.ok === 1 && coinsLeft === 85 - need.coinsNeed && Q.list(city).slice(0, 2).every(q => Q.seconds(city, me, q) === 0)
        && cancel.ok === 1 && Q.list(city).length === 3 && !me.items['player.queue.building'] && bean.buildingQueues.length === 3 && bean.buildingQueues[2].name === 'Cottage',
        'a queued building can be sped up before it starts, and called off (the hammer is used up); the city shows its queue');
      // The builder comes free: the queue runs in order; an entry whose plot was taken meanwhile is dropped and refunded.
      city.buildings[plot] = { typeId: 3, level: 1, status: 0, startTime: 0, endTime: 0 };
      pays.length = 0;
      bb.endTime = Date.now() - 1000;
      G.completeDue(city, true);
      const started = await c.wait('server.BuildingQueueUpdate', 3000, d => d.buildingQueueBean.status === 3).then(() => true, () => false);
      const dropped = await c.wait('server.BuildingQueueUpdate', 3000, d => d.buildingQueueBean.status === 4).then(m => m.data.buildingQueueBean, () => null);
      ok(farm.level === farmLv + 2 && farm.status === 0 && Q.list(city).length === 0 && started && dropped && dropped.name === 'Cottage' && dropped.positionId === plot
        && pays.some(([f, sign]) => sign === 1 && f === L.condition(city, me, 1, 1).food),
        'when the builder is free the queued buildings start one after another; one whose requirements are no longer met is dropped and its cost returned');
      delete L.pay;
      delete city.buildings[plot]; Object.assign(bb, bbWas); Object.assign(dem, demWas); farm.level = farmLv;
      Object.assign(city.res, resWas); me.title = titleWas; me.coins = coinsWas; me.items['player.queue.building'] = hammersWas;
    }
    // Chat: the World channel (a Speaker a message, not for beginners), the Beginners' channel, whispers, the Governor.
    {
      const G = srv.game, F = G.fame, SP = 'consume.1.a', speakersWas = me.items[SP] || 0;
      const t = new FakeClient(PORTS.gamePort); await t.ready();
      t.send('gameClient.version', '091103_11'); t.send('login', { user: 'Talker', pwd: sha1('talk') });
      await t.wait('server.LoginResponse');
      const tp = G.chat.byName('talker');
      tp.items[SP] = 2;
      const newbie = await t.call('common.worldChat', { msg: 'hi', languageType: 0 });
      const starter = await t.call('common.channelChat', { channel: 'beginner', sendMsg: 'hello <b>all</b>', languageType: 0 });
      const got = await c.wait('server.ChannelChatMsg').then(m => m.data, () => null);
      tp.createdAt = 0; tp.items[SP] = 0;
      const noSpeaker = await t.call('common.worldChat', { msg: 'hello', languageType: 0 });
      tp.items[SP] = 1;
      const w = await t.call('common.worldChat', { msg: 'Hello world', languageType: 0 });
      const heard = await c.wait('server.WorldChatMsg').then(m => m.data, () => null);
      const echo = t.inbox.some(m => m.cmd === 'server.WorldChatMsg');
      ok(newbie.ok < 0 && /Beginner/.test(newbie.errorMsg) && starter.ok === 1 && got?.channel === 'beginner' && got.fromUser === 'Talker' && got.msg === 'hello &lt;b&gt;all&lt;/b&gt;'
        && noSpeaker.ok < 0 && /Speakers/.test(noSpeaker.errorMsg) && w.ok === 1 && tp.items[SP] === 0 && heard?.fromUser === 'Talker' && heard.msg === 'Hello world' && heard.channel === 'world' && !echo,
        'World chat takes a Speaker a message and is closed to lords under beginner\'s protection, who have the Beginners\' channel; the other lords hear it');
      // Speaker packages: the World channel opens one when there's no loose Speaker, and they can be opened by hand.
      tp.items['consume.1.b'] = 1; tp.items[SP] = 0;
      const fromPack = await t.call('common.worldChat', { msg: 'from a pack', languageType: 0 });
      const packLeft = { pack: tp.items['consume.1.b'] || 0, loose: tp.items[SP] };
      tp.items['consume.1.c'] = 1; const tc = G.castlesOf(tp)[0];
      const opened = await t.call('shop.useGoods', { castleId: tc.id, itemId: 'consume.1.c', num: 1 });
      ok(fromPack.ok === 1 && packLeft.pack === 0 && packLeft.loose === 9 && opened.ok === 1 && tp.items[SP] === 109 && !(tp.items['consume.1.c'] > 0),
        'a Speaker package (10 or 100) works for World chat when there are no loose Speakers, and opens into Speakers from the inventory');
      tp.items[SP] = 0;
      // The Governor (the poll above made the tester Governor): his title in the chat, no Speaker, and the mute.
      const bornWas = me.createdAt; me.createdAt = 0; me.items[SP] = 0;
      const gw = await c.call('common.worldChat', { msg: 'Hear ye', languageType: 0 });
      const gheard = await t.wait('server.WorldChatMsg').then(m => m.data, () => null);
      const wh = await t.call('common.privateChat', { targetName: gheard?.fromUser, msg: 'psst' });
      const pm = await c.wait('server.PrivateChatMessage').then(m => m.data, () => null);
      const back = await c.call('common.privateChat', { targetName: 'TALKER', msg: 'yes?' });
      const pm2 = await t.wait('server.PrivateChatMessage').then(m => m.data, () => null);
      const self = await c.call('common.privateChat', { targetName: me.name, msg: 'x' });
      const nobody = await c.call('common.privateChat', { targetName: 'Nobody Here', msg: 'x' });
      G.createPlayer({ name: 'Ghost' }, { userName: 'Ghost' });
      const away = await c.call('common.privateChat', { targetName: 'Ghost', msg: 'x' });
      const ally = await c.call('common.allianceChat', { msg: 'x', languageType: 0 });
      ok(F.isGovernor(me) && gw.ok === 1 && /^Govern(or|ess) /.test(gheard?.fromUser || '') && wh.ok === 1 && pm?.fromUser === 'Talker' && pm.msg === 'psst' && back.ok === 1 && pm2?.msg === 'yes?'
        && self.ok < 0 && nobody.ok === -3 && away.ok === -3 && /not online/.test(away.errorMsg) && ally.ok < 0 && /not in an alliance/.test(ally.errorMsg),
        'the Governor talks in the World channel without Speakers as "Governor <name>"; whispers reach the lord named (the Governor by his chat name too), not yourself, nobody or a lord offline');
      const notGov = await t.call('common.denyPlayerSpeak', { playername: me.name, time: 30 });
      const mute = await c.call('common.denyPlayerSpeak', { playername: 'Talker', time: 30 });
      const told = await t.wait('server.SystemInfoMsg', 3000, d => /muted/.test(d.msg)).then(() => true, () => false);
      tp.items[SP] = 1;
      const hushed = await t.call('common.worldChat', { msg: 'let me speak', languageType: 0 });
      ok(notGov.ok < 0 && mute.ok === 1 && told && hushed.ok < 0 && /muted for 30/.test(hushed.errorMsg) && tp.items[SP] === 1 && tp.mutedUntil - Date.now() > 29 * 60000,
        'the Governor can mute a lord for 30 minutes (who is told); nobody else can');
      t.close(); me.items[SP] = speakersWas; me.createdAt = bornWas;
    }
    // Troops: dismissing (30% of the training cost back; the Security Code can guard it), the Fugitive Camp (empty on
    // Age II), the Drill Grounds' Maneuver, and the hungry icon.
    {
      const G = srv.game, city = G.db.castles[castle.id], archers = city.troops.archer || 0, t = Object.values(G.data.troops).find(x => x.field === 'archer');
      city.troops.archer = archers + 100;
      G.account.setCode(me, '4321', Date.now());
      const locked = await c.call('troop.disbandTroop', { castleId: castle.id, troopType: t.id, num: 40 });
      await c.call('common.authSecurityCode', { code: '4321' }); await c.call('common.setUnlockOption', { option: 4 });
      const wood0 = city.res.wood;
      const too = await c.call('troop.disbandTroop', { castleId: castle.id, troopType: t.id, num: archers + 101 });
      const dis = await c.call('troop.disbandTroop', { castleId: castle.id, troopType: t.id, num: 40 });
      const back = city.res.wood - wood0, want = Math.floor(40 * t.wood * 0.3);
      const tu = await c.wait('server.TroopUpdate', 3000, d => d.troop.archer === archers + 60).then(() => true, () => false);
      ok(locked.ok === -200 && too.ok < 0 && dis.ok === 1 && city.troops.archer === archers + 60 && tu && want > 0 && Math.abs(back - want) < 60,
        `dismissing troops gives back 30% of their training cost (${want} lumber for 40 Archers) and can be guarded by the Security Code`);
      delete me.security; city.troops.archer = archers;
      const flee = await c.call('army.getFleeTroop', { castleId: castle.id });
      const camp = await c.wait('server.FleeTroopUpdate').then(m => m.data, () => null);
      const rec = await c.call('army.recruitFleeTroop', { castleId: castle.id });
      ok(flee.ok === 1 && camp && camp.castleId === castle.id && camp.goldNeed === 0 && Object.values(camp.troop).every(n => n === 0) && rec.ok < 0 && /Age II/.test(rec.errorMsg),
        'the Fugitive Camp opens empty: on Age II hungry troops don\'t desert (Fox)');
      const troopsBefore = JSON.stringify(city.troops);
      const ex = await c.call('army.exerciseArmy', { castleId: castle.id, troopParamAttack: { archer: 5000 }, troopParamDefend: { militia: 50 } });
      const ex2 = await c.call('army.exerciseArmy', { castleId: castle.id, troopParamAttack: { militia: 10 }, troopParamDefend: { archer: 5000, pikemen: 2000 } });
      const empty = await c.call('army.exerciseArmy', { castleId: castle.id, troopParamAttack: {}, troopParamDefend: { militia: 5 } });
      ok(ex.ok === 1 && ex.result === 1 && ex.round >= 1 && ex.defendLostTroop.militia === 50 && ex.attackLostTroop.archer >= 0 && ex2.result === -1 && ex2.attackLostTroop.militia === 10
        && empty.ok < 0 && JSON.stringify(city.troops) === troopsBefore,
        'the Drill Grounds\' Maneuver fights a practice battle between the forces entered and reports the losses, without touching the city');
      // Out of food and eating more than it grows: the hungry icon.
      const foodWas = city.res.food, milWas = city.troops.militia || 0;
      const others = G.castlesOf(me).filter(x => x !== city), othersFood = others.map(x => x.res.food);
      city.res.food = 0; city.troops.militia = milWas + 5000000; G.hungerShown.set(me.id, false);
      G.pushHunger(me, Date.now());
      const hungry = await c.wait('server.PlayerBuffUpdate', 3000, d => d.buffBean.typeId === 'HungerBuff' && d.updateType === 0).then(m => m.data.buffBean, () => null);
      const inBean = G.beans.player(me, G.castlesOf(me), Date.now()).buffs.some(b => b.typeId === 'HungerBuff');
      city.res.food = foodWas; city.troops.militia = milWas; for (const x of others) x.res.food = Math.max(1, x.res.food);   // (the tester's other cities may be hungry too)
      G.pushHunger(me, Date.now());
      others.forEach((x, i) => { x.res.food = othersFood[i]; });
      const fed = await c.wait('server.PlayerBuffUpdate', 3000, d => d.buffBean.typeId === 'HungerBuff' && d.updateType === 1).then(() => true, () => false);
      ok(hungry && /run out of food/.test(hungry.descName) && inBean && fed, 'a city out of food and eating more than it grows shows the hungry icon, which goes when it is fed');
    }
    // Achievements: counted from what the lord does, with points and the 12 bonuses.
    {
      const G = srv.game, E = G.effort, L = G.logic, city = G.db.castles[castle.id];
      const st = E.state(me), saved = JSON.stringify(me.effort);
      const counted = ['scout', 'miles'].every(k => st.stats[k] > 0) && Object.keys(st.stats).some(k => k.startsWith('kill:')) && Object.keys(st.stats).some(k => k.startsWith('train:'))
        && ['food', 'wood', 'gold'].every(k => st.stats[`produce:${k}`] > 0);
      st.done = {}; st.points = 0; st.stats['produce:food'] = 0;
      const cost0 = L.condition(city, me, 1, 2).wood, troop0 = G.troops.condition(city, me, 3, 100).food, rate0 = L.rates(city, me).detail.food.item;
      st.stats['produce:food'] = 15000; st.stats.captive = 1;
      const list = await c.call('quest.getEffortList', { castleId: castle.id });
      const tip = await c.wait('server.QuestCompleteTipResponse', 3000, d => d.questId === 395).then(m => m.data, () => null);
      const buff = await c.wait('server.PlayerBuffUpdate', 3000, d => d.buffBean.typeId === 'IncFoodProduceEffortBuff').then(m => m.data.buffBean, () => null);
      const cat = await c.call('quest.getEffortListByTargeTypeid', { castleId: castle.id, TargeTypeid: 8 });
      const a395 = cat.quests.find(q => q.questId === 395), a396 = cat.quests.find(q => q.questId === 396);
      const rate1 = L.rates(city, me).detail.food.item, troop1 = G.troops.condition(city, me, 3, 100).food;
      ok(counted && list.ok === 1 && list.effortlistbean.length === 12 && list.effortlistbean[0].effortListInfo === 'Scouting' && Number(list.effortpoint) >= 20 && st.done[395] && st.done[386] && st.done[309]
        && tip?.quest.manual === 'Produce 10,000 Food' && tip.quest.award === '10' && buff?.descName === '1'
        && a395?.isFinish && a395.name === '10000/10000' && a395.description === 'Resource Production:IncFoodProduceEffortBuff/1' && a396 && !a396.isFinish && a396.name === '15000/100000'
        && rate1 - rate0 === 5 && troop1 === Math.round(troop0 / 100 * 0.95) * 100,
        'achievements count what the lord does (scouting, marching, kills, training, production); each done one gives its points, and the bonus levels raise production and cut troop costs');
      // Domain: owning 2 cities cuts construction by 5%; points open the Achievement quests.
      st.done[367] = Date.now();
      const cost1 = L.condition(city, me, 1, 2).wood;
      st.points = 150; E.check(me, Date.now());
      const blv = E.level(me, 'DecProduceBuildEffortBuff');   // (the tester owns several cities, so more Domain steps may be done)
      ok(blv >= 1 && cost1 === Math.round(cost0 * (1 - 0.05 * blv)) && G.quests.state(me).flags.achievement100 && !G.quests.state(me).flags.achievement500 && G.beans.playerInfo(me, G.castlesOf(me)).effortPoint >= 150,
        'the Domain bonus cuts construction costs, and achievement points count toward the Achievement quests and show in the profile');
      me.effort = JSON.parse(saved);
    }
    // City management: the Warehouse's Store Percents, Abandon City, saved troop settings.
    {
      const G = srv.game, L = G.logic, city = G.db.castles[castle.id], world = require('../src/game/world');
      const total = L.protectedAmount(city, me);
      const list = await c.call('city.getStoreList', { castleId: castle.id });
      const bad = await c.call('city.modifyStorePercent', { castleId: castle.id, foodrate: 60, woodrate: 30, stonerate: 20, ironrate: 0 });
      const set = await c.call('city.modifyStorePercent', { castleId: castle.id, foodrate: 50, woodrate: 30, stonerate: 10, ironrate: 10 });
      const list2 = await c.call('city.getStoreList', { castleId: castle.id });
      ok(list.ok === 1 && list.totalCap === total && list.storeBeans.length === 4 && list.storeBeans.every(b => b.storePercent === 25) && bad.ok < 0 && set.ok === 1
        && list2.storeBeans[0].storePercent === 50 && L.protectedOf(city, me, 'food') === Math.ceil(total * 0.5) && L.protectedOf(city, me, 'iron') === Math.ceil(total * 0.1) && L.protectedOf(city, me, 'gold') === 0,
        'the Warehouse\'s capacity is shared between the resources by the Store Percents (25% each until changed; at most 100% in all)');
      delete city.storePct;
      // Abandon City.
      const home = world.findHome(G.store), flatWas = world.tileAt(G.store, home).level, nc = G.createCastle(me, { fieldId: home, name: 'Outpost', start: { buildings: { '-1': [31, 4] } } });
      nc.troops.archer = 500;
      const wrong = await c.call('city.giveupCastle', { castleId: nc.id, password: sha1('nope') });
      G.account.setCode(me, '2468', Date.now());
      const guarded = await c.call('city.giveupCastle', { castleId: nc.id, password: sha1('secret') });
      delete me.security;
      const done = await c.call('city.giveupCastle', { castleId: nc.id, password: sha1('secret') });
      const gone = await c.wait('server.CastleUpdate', 3000, d => d.updateType === 1 && d.castleBean.id === nc.id).then(() => true, () => false);
      const t = world.tileAt(G.store, home);
      const lone = new FakeClient(PORTS.gamePort); await lone.ready();
      lone.send('gameClient.version', '091103_11'); lone.send('login', { user: 'Loner', pwd: sha1('alone') });
      const lp = (await lone.wait('server.LoginResponse')).data.player;
      const only = await lone.call('city.giveupCastle', { castleId: lp.castles[0].id, password: sha1('alone') });
      lone.close();
      ok(wrong.ok === -50 && guarded.ok === -200 && done.ok === 1 && gone && !G.db.castles[nc.id] && !me.castles.includes(nc.id) && t.type === world.T.NPC && t.level === flatWas && nc.flatLevel === flatWas && only.ok === -19,
        `Abandon City needs the password (and the Security Code when it guards it) and another city; the city is gone and its spot is a barbarian city of the flat's level (${flatWas}; Fox)`);
      // Saved troop settings in the march window.
      const cfg = await c.call('common.setTroopConfig', { name: 'Settings 1', config: { archer: 100, militia: 5 } });
      const bean = G.beans.player(me, G.castlesOf(me), Date.now());
      ok(cfg.ok === 1 && cfg.troopConfigBeans.some(b => b.name === 'Settings 1' && b.troop.archer === 100 && b.troop.militia === 5) && bean.troopConfigBeans.some(b => b.name === 'Settings 1'),
        'the march window saves troop settings');
    }
    // Fox's bug reports (Oct 25): a hero reinforcing one of your cities stays there if its Feasting Hall has room;
    // waves that reach a city an earlier wave conquered land without a fight and come home.
    {
      const G = srv.game, A = G.armies, HS = require('../src/game/heroes').HERO_STATUS, city = G.db.castles[castle.id];
      const other = G.createCastle(me, { name: 'Post', start: { buildings: { '-1': [31, 5], 8: [29, 2], 3: [27, 3] } } });
      const h = G.heroes.list(city).find(x => x.status === HS.FREE);
      city.troops.lightCavalry = (city.troops.lightCavalry || 0) + 20;
      const perRally = G.rules.rallyArmiesPerLevel; G.rules.rallyArmiesPerLevel = 50;   // (an earlier test's army may still be on its way home)
      const sent = A.send(city, me, { missionType: 2, heroId: h.id, targetPoint: other.fieldId, troops: { lightCavalry: 10 }, resource: {}, restTime: 0 }, Date.now());
      if (Array.isArray(sent)) console.log('SENDDBG', JSON.stringify({ sent, out: A.fromCastle(city).map(a => ({ m: a.mission, d: a.direction, t: a.target })), hero: h && h.status, food: city.res.food }));
      sent.army.reachTime = Date.now() - 1; G.moveArmies(Date.now());
      const joined = G.heroes.list(other).includes(h) && !G.heroes.list(city).includes(h) && h.status === HS.FREE && !G.db.armies[sent.army.id];
      // No seat: the hero rides home.
      const vac = G.heroes.vacancies; G.heroes.vacancies = () => 0;
      const back = A.send(other, me, { missionType: 2, heroId: h.id, targetPoint: city.fieldId, troops: { lightCavalry: 5 }, resource: {}, restTime: 0 }, Date.now());
      back.army.reachTime = Date.now() - 1; G.moveArmies(Date.now());
      delete G.heroes.vacancies; G.rules.rallyArmiesPerLevel = perRally;
      const a2 = G.db.armies[back.army.id], rode = a2 && a2.direction === 2 && a2.heroId === h.id && !Object.values(a2.troops).some(n => n > 0) && G.heroes.list(other).includes(h);
      if (a2){ delete G.db.armies[a2.id]; h.status = HS.FREE; }
      ok(vac && joined && rode, 'a hero reinforcing one of your cities moves into its Feasting Hall; with no free seat he heads home');
      // A wave reaching a city that is already yours: no battle, recalled.
      const seq0 = me.reportSeq || 0, before = { ...other.troops };
      city.troops.lightCavalry += 100;
      const wave = { id: G.store.id(), playerId: me.id, castleId: city.id, heroId: 0, mission: 5, from: city.fieldId, target: other.fieldId, troops: { lightCavalry: 100 }, carry: {}, loot: null,
        startTime: Date.now() - 1000, reachTime: Date.now() - 1, oneWay: 1000, direction: 1, restTime: 0 };
      city.troops.lightCavalry -= 100; G.db.armies[wave.id] = wave;
      G.moveArmies(Date.now());
      const rep = G.reports.list(me).filter(r => r.id > seq0).map(r => r.title);
      ok(G.db.armies[wave.id]?.direction === 2 && wave.troops.lightCavalry === 100 && JSON.stringify(other.troops) === JSON.stringify(before) && rep.some(t => /recalled/.test(t)) && !rep.some(t => /won|beaten/.test(t)),
        'a wave that reaches a city already yours (an earlier wave took it) lands without a fight and heads home');
      delete G.db.armies[wave.id]; city.troops.lightCavalry -= 20;
      other.heroes = other.heroes.filter(x => x !== h); G.heroes.list(city).push(h); G.abandonCastle(me, other, Date.now());
    }
    // Stratagems: on your own city, another lord's city (any time, Fox), your army or one coming at you.
    {
      const G = srv.game, S = G.stratagems, city = G.db.castles[castle.id], use = (castleId, armyid, itemId) => c.call('shop.useTrickItem', { castleId, armyid, itemId });
      const give = id => { me.items[id] = (me.items[id] || 0) + 1; };
      const coinsWas = me.coins, troopsWas = { ...city.troops };
      city.troops.archer = 1000;
      give('player.trick.kcj');
      const empty = await use(city.fieldId, 0, 'player.trick.kcj');
      const small = S.shownTroops(city).archer;
      me.coins = 100; me.items['player.trick.cmjb'] = 0;
      const bushes = await use(city.fieldId, 0, 'player.trick.cmjb');
      const big = S.shownTroops(city).archer;
      const wrongPlace = await use(city.fieldId, 0, 'player.trick.yyhz');
      ok(empty.ok === 1 && small >= 100 && small <= 200 && bushes.ok === 1 && me.coins === 95 && big >= 5000 && big <= 10000 && !city.tricks.kcj && wrongPlace.ok < 0 && G.quests.state(me).flags.stratagemOwn,
        `on your own city, Empty City shows scouts 10-20% of the troops (${small} of 1,000) and Regard Bushes and Trees as Soldiers 5-10 times (${big}); one without the item is bought for its price`);
      // Another lord's city.
      const vp = G.createPlayer({ name: 'Mark' }, { userName: 'Mark' }), vc = G.castlesOf(vp)[0];
      const bornWas = me.createdAt; vp.createdAt = 0; me.createdAt = 0;   // (no Beginner's Protection on either side)
      vc.res.food = 10000; vc.complaint = 0;
      const seq0 = vp.reportSeq || 0;
      for (const id of ['yyhz', 'bxez', 'fslc', 'smmf', 'chdj', 'zsmj', 'lywh', 'mrj', 'tblj', 'wwjz']) me.items[`player.trick.${id}`] = 2;
      const rum = await use(vc.fieldId, 0, 'player.trick.yyhz'), rum2 = await use(vc.fieldId, 0, 'player.trick.yyhz');
      const wage = await use(vc.fieldId, 0, 'player.trick.bxez');
      const notYet = G.war.status(me, vp), window = S.instant(me, vp);
      const declared = G.war.declare(me, vp, Date.now());
      const burn = await use(vc.fieldId, 0, 'player.trick.fslc');
      const amb = await use(vc.fieldId, 0, 'player.trick.smmf'), house = await use(vc.fieldId, 0, 'player.trick.chdj');
      const vrep = G.reports.list(vp).filter(r => r.id > seq0);
      const wageText = vrep.find(r => /Wage War/.test(r.title))?.content || '';
      const warEnd = G.war.between(me, vp) && G.war.between(me, vp).declaredAt + G.war.prepMs() + G.war.warMs();
      ok(rum.ok === 1 && vc.complaint >= 14 && rum2.ok < 0 && wage.ok === 1 && notYet === 3 && window && !Array.isArray(declared) && G.war.atWar(me, vp) && Math.abs(warEnd - Date.now() - 48 * 3600000) < 60000 && !G.war.cantAttack(me, vc) && !S.instant(me, vp)
        && /^Player Tester has applied Wage War without Declaration to you\. You are at war with him now\.Wartime ends at \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.You can apply Truce Agreement to counteract this stratagem\.$/.test(wageText)
        && burn.ok === 1 && vc.res.food <= 9000 && vc.res.food >= 5000 && amb.ok === 1 && S.ambushed(vc) && house.ok === 1 && S.warehouseShare(vc) === 0.5 && vrep.filter(r => /^Victim of/.test(r.title)).length >= 5 && vrep.filter(r => /^Victim of/.test(r.title)).every(r => r.type === 2),
        'on another lord\'s city: Inundate with Rumors (+15 grievance, once a day), Wage War without Declaration (for 15 minutes a war declared on him starts at once and lasts 48 hours; live\'s report), Burn the Warehouses, Ambush from All Sides and Loot a Burning House work, and he gets a report in Others for each');
      vp.items = vp.items || {}; vp.items['player.trick.adcc'] = 1;
      vc.troops.archer = 50; vc.buildings[8] = { typeId: 29, level: 1, status: 0, startTime: 0, endTime: 0 };
      const blocked = G.armies.send(vc, vp, { missionType: 2, heroId: 0, targetPoint: city.fieldId, troops: { archer: 5 }, resource: {}, restTime: 0 }, Date.now());
      const lift = S.use(vp, vc.fieldId, 0, 'player.trick.adcc', Date.now());
      ok(Array.isArray(blocked) && /Ambush/.test(blocked[1]) && !Array.isArray(lift) && !S.ambushed(vc), 'an ambushed city can\'t send troops until Advance by A Hidden Path lifts it');
      // Spies, Ears and Eyes, heroes, and a forced recall.
      const bait = { id: G.store.id(), name: 'Bait', level: 10, base: { pol: 50, atk: 60, int: 40 }, added: { pol: 0, atk: 0, int: 0 }, status: 0, loyalty: 70, face: 'images/icon/player/faceA1.jpg' };
      vc.heroes = [bait];
      const atk0 = G.heroes.effective(bait, 'atk');
      const out = { id: G.store.id(), playerId: vp.id, castleId: vc.id, heroId: 0, mission: 1, from: vc.fieldId, target: city.fieldId, troops: { archer: 10 }, carry: {}, loot: null,
        startTime: Date.now(), reachTime: Date.now() + 3600000, oneWay: 3600000, direction: 1, restTime: 0 };
      G.db.armies[out.id] = out;
      const myseq = me.reportSeq || 0;
      const spies = await use(vc.fieldId, 0, 'player.trick.zsmj'), eyes = await use(vc.fieldId, 0, 'player.trick.lywh');
      const mine = G.reports.list(me).filter(r => r.id > myseq);
      const trap = await use(vc.fieldId, 0, 'player.trick.mrj'), alien = await use(vc.fieldId, 0, 'player.trick.tblj');
      ok(spies.ok === 1 && mine.some(r => /Spies/.test(r.title) && /10 Archer/.test(r.content)) && eyes.ok === 1 && mine.some(r => r.type === 3 && /scoutReport|troop/i.test(r.content))
        && trap.ok === 1 && G.heroes.effective(bait, 'atk') <= atk0 * 0.7 + 1e-9 && alien.ok === 1 && bait.loyalty <= 60,
        'Sow Spies reports the armies marching to and from the city, Ears and Eyes gives a scout report, Beauty Trap weakens a hero and Alienating and Instigating costs him loyalty');
      // Armies: one coming at you, and your own.
      me.items['player.trick.bmjs'] = 1; me.items['player.trick.gmdg'] = 1; me.items['player.trick.qlbx'] = 1;
      const r0 = out.reachTime, slow = await use(vc.fieldId, out.id, 'player.trick.bmjs'), slower = out.reachTime - r0;
      const bolt = await use(vc.fieldId, out.id, 'player.trick.gmdg'), cantRecall = G.armies.recall(vp, out.id, Date.now());
      const besiege = await use(vc.fieldId, 0, 'player.trick.wwjz');
      const mineArmy = { ...out, id: G.store.id(), playerId: me.id, castleId: city.id, from: city.fieldId, target: vc.fieldId, reachTime: Date.now() + 3600000, direction: 1 };
      G.db.armies[mineArmy.id] = mineArmy;
      const raid = await use(city.fieldId, mineArmy.id, 'player.trick.qlbx');
      ok(slow.ok === 1 && slower > 0.25 * 3600000 && bolt.ok === 1 && Array.isArray(cantRecall) && /Bolt the Door/.test(cantRecall[1]) && besiege.ok === 1 && out.direction === 2
        && raid.ok === 1 && mineArmy.reachTime - Date.now() < 0.72 * 3600000,
        'Entrapping slows an army coming at you, Bolt the Door stops its recall, Besiege Enemy\'s Fort recalls a city\'s armies anyway, and Thunder Raid speeds your own');
      delete G.db.armies[out.id]; delete G.db.armies[mineArmy.id];
      const rec = G.war.between(me, vp); if (rec) delete G.war.list()[rec.id];
      delete city.tricks; city.troops = troopsWas; me.coins = coinsWas; me.createdAt = bornWas;
    }
    // The building window's upgrade check, as the live server answers it (Fox's capture).
    {
      const G = srv.game, L = G.logic;
      const [pos, farm] = Object.entries(city.buildings).find(([, b]) => b.typeId === 7);
      const was = { level: farm.level, status: farm.status, startTime: farm.startTime, endTime: farm.endTime };
      Object.assign(farm, { level: 3, status: 0, startTime: 0, endTime: 0 });
      const mid = await c.call('castle.checkOutUpgrade', { castleId: city.id, positionId: Number(pos) });
      farm.level = 10;
      const top = await c.call('castle.checkOutUpgrade', { castleId: city.id, positionId: Number(pos) });
      const refused = L.upgrade(city, me, Number(pos), Date.now());
      Object.assign(farm, was);
      const d3 = L.levelData(7, 3), d10 = L.levelData(7, 10);
      ok(mid.ok === 1 && mid.conditionBean.food === L.condition(city, me, 7, 4).food && mid.conditionBean.destructTime === L.destructCondition(city, me, 7, 3).destructTime
        && mid.conditionBean.destructTime > 0 && mid.desConditionBean.food === d3.food && mid.desConditionBean.iron === d3.iron && mid.desConditionBean.destructTime === 0,
        'the upgrade check carries the demolish time in conditionBean and the current level\'s cost in desConditionBean, for the client\'s demolish tooltip');
      ok(top.ok === -57 && top.errorMsg === 'The building has already reached maximum level.' && top.conditionBean.food === 0 && top.conditionBean.destructTime === L.destructCondition(city, me, 7, 10).destructTime
        && top.desConditionBean.wood === d10.wood && Array.isArray(refused) && refused[0] === -57,
        'at the top level the upgrade check answers -57 "The building has already reached maximum level." and an upgrade is refused the same way');
      const r14 = L.levelData(29, 14);
      ok(L.data.buildings[29].levels.length === 18 && r14 && r14.food === 819200 && r14.wood === 4915200 && r14.stone === 16384000 && r14.iron === 1228800 && r14.time === 1228800
        && r14.limit === 14 && r14.workPeople === 140000, 'the Rally Spot goes to level 18, each level past 10 doubling the one before (level 14 as on the live server)');
      // Storage, the Script and the mayor's politics, as Fox's captures show them.
      const st = { buildings: { 1001: { typeId: 7, level: 14, status: 0 }, 1002: { typeId: 7, level: 14, status: 0 } } };
      const cap0 = L.capacity(st, { techs: {} }, 'food'), capS = L.capacity(st, { techs: { 15: 10 } }, 'food'), cap5 = L.capacity(st, { techs: { 15: 5 } }, 'food');
      const f11 = L.condition(city, me, 7, 12), f10 = L.condition(city, me, 7, 10);
      ok(cap0 === 10000 + 2 * 1050000 && capS === 10000 + 4 * 1050000 && cap5 === 10000 + 3 * 1050000 && f10.items.some(i => i.id === 'consume.blueprint.1') && !f11.items.length,
        'a city stores 10,000 plus its fields\' limits, which Stockpile raises 10% a level (twice them at 10, as live), and Michelangelo\'s Script is for level 10 only (live: not for 11-14)');
      const npcBean = G.mapBean({ player: me }, { id: 5, type: world.T.NPC, level: 5 });
      ok(npcBean.name === "Barbarian's city" && !npcBean.flag, 'an NPC city is "Barbarian\'s city" on the map, with no flag (live)');
      // Building time, as live (Fox's capture: an Academy going 8 to 9 with Construction 10).
      {
        const sp = L.speed; L.speed = 1;
        const acad = { buildings: { 0: { typeId: 25, level: 8, status: 0 } } }, lord = { techs: { 17: 10 } }, mayorWas = L.hooks.mayor;
        const t = pol => { L.hooks.mayor = (c, k) => k === 'points:pol' ? pol : mayorWas(c, k); return [L.buildSeconds(lord, 25, 9, acad), L.destructCondition(acad, lord, 25, 8).destructTime]; };
        const none = t(0), low = t(19), high = t(558.7), kampala = (L.hooks.mayor = (c, k) => k === 'points:pol' ? 753.7 : 0, L.destructCondition(acad, lord, 29, 10).destructTime);
        L.hooks.mayor = mayorWas; L.speed = sp;
        ok(none.join() === '42845,10711' && low.join() === '41720,10430' && high.join() === '19606,4901' && kampala === 4662,
          'building takes 10% off a Construction level and 0.14% off a point of the mayor\'s politics, to the second as live (42,845 s with no mayor, 41,720 at 19 politics, 19,606 at 558)');
      }
      const cf = s => G.items.coinsFor(s * 1000);
      ok(cf(6877) === 20 && cf(15880) === 50 && cf(39662) === 85 && cf(600) === 5 && cf(3000) === 10,
        'Instant Finish costs what the Guidelines would, as live: 20 coins with 1.91 hours left, 50 with 4.41, 85 with 11.02');
    }
    // Resource fields go one level above the Town Hall (Fox: live), and to the city's own cap at Town Hall 10.
    {
      const L = srv.game.logic;
      const town = (th, power = 4) => ({ powerLevel: power, res: { food: 1e9, wood: 1e9, stone: 1e9, iron: 1e9, gold: 1e9 }, pop: 1e6, troops: {}, buildings: { '-1': { typeId: 31, level: th, status: 0 }, 1001: { typeId: 7, level: 6, status: 0 } } });
      const need = (c, typeId, lv) => L.condition(c, me, typeId, lv).buildings.find(b => b.typeId === 31);
      const t5 = town(5), r7 = need(t5, 7, 7), refused = L.check(t5, me, 7, 7, L.condition(t5, me, 7, 7));
      ok(r7 && r7.level === 6 && r7.curLevel === 5 && !r7.successFlag && !need(t5, 7, 6) && !need(town(9), 4, 10) && !need(town(10), 6, 10) && !need(town(10, 2), 5, 14)
        && Array.isArray(refused) && refused[0] === -48 && /Town Hall level 6/.test(refused[1]) && L.check(t5, me, 7, 6, L.condition(t5, me, 7, 6)) === null,
        'a resource field goes at most one level above the Town Hall (a Farm 7 needs Town Hall 6, shown red in the upgrade window); at Town Hall 10 a Historic City\'s fields go on to its cap');
      // Neither the Town Hall nor the Walls can be demolished, directly or through the queue (Fox: live).
      const walled = town(5); walled.buildings['-2'] = { typeId: 32, level: 3, status: 0 };
      const dw = L.destruct(walled, me, -2, Date.now()), dt = L.destruct(walled, me, -1, Date.now());
      walled.buildings[1] = { typeId: 1, level: 1, status: 1, startTime: Date.now(), endTime: Date.now() + 1e7 };   // (builders busy, so the queue takes it)
      const qw = srv.game.buildQueue.add(walled, me, 0, 32, -2, Date.now());
      ok(Array.isArray(dw) && /Walls cannot be demolished/.test(dw[1]) && Array.isArray(dt) && /Town Hall cannot be demolished/.test(dt[1]) && Array.isArray(qw) && /Walls cannot/.test(qw[1])
        && walled.buildings['-2'].level === 3 && walled.buildings['-2'].status === 0,
        'the Town Hall and the Walls can\'t be demolished, now or through the building queue');
    }
    // Honor (Fox's live reports, Oct 2026): (worth of what you killed - worth of what you lost) / 8 for the winner,
    // / 2 for the loser, a unit's worth being what a hero's experience counts it at.
    {
      const C = srv.game.combat, rows = o => Object.entries(o).map(([t, l]) => ({ typeId: Number(t), lose: l }));
      const live = [[{ 5: 125000 }, { 5: 14267, 9: 731, 10: 6885 }, true, 93331], [{ 10: 100000 }, { 8: 195512 }, true, 733379], [{ 10: 100000 }, { 8: 219645 }, true, 553890],
        [{ 7: 100000 }, { 9: 33300 }, true, 100237], [{ 10: 100000 }, { 18: 2, 6: 369, 8: 123571, 11: 6969, 12: 79, 14: 9, 15: 24624 }, true, 987111],
        [{ 5: 26209 }, { 2: 2, 3: 2, 5: 1, 6: 1, 8: 30698, 11: 6032, 12: 50 }, false, -1287492], [{ 5: 39 }, { 16: 40, 14: 15 }, false, -5960],
        [{ 15: 36 }, { 9: 13, 10: 9 }, true, -139], [{ 15: 42 }, { 9: 6, 10: 11 }, true, -107]];
      const off = live.map(([k, l, w, want]) => Math.abs(C.honor(rows(k), rows(l), w) - want));
      ok(off.every(x => x <= 40) && off.filter(x => x <= 1).length >= 6,
        `honor matches Fox's live battle reports (a defender killing 100,000 Cataphracts for 195,512 Transporters: +733,379; losing 40 Archer Towers and 15 Traps for 39 Pikemen: -5,960), off by ${Math.max(...off)} at most`);
    }
    // The march window's War Ensign (useFlag, +25%) and Stygandr's Banner of the Horde (useItem, x10), as the client sends them.
    {
      const G = srv.game, A = G.armies, E = 'player.troop.1.a', B = 'player.item.stygandrsbannerofthehorde';
      const camp = G.createCastle(me, { name: 'Muster', start: { buildings: { '-1': [31, 10], 8: [29, 10] } } });
      camp.troops = { militia: 5000000 }; camp.res.food = 1e12;
      const titleWas = me.title; me.title = Math.max(me.title || 0, 9);
      const go = (n, flags) => A.send(camp, me, { missionType: 2, heroId: 0, targetPoint: castle.fieldId, troops: { militia: n }, resource: {}, restTime: 0, ...flags, targetPoint: G.db.castles[castle.id].fieldId }, Date.now());
      me.items[E] = 1; me.items[B] = 0;
      const plain = go(120000, {}), withE = go(120000, { useFlag: true }), eLeft = me.items[E];
      const noBanner = go(900000, { useItem: true }); me.items[B] = 2;
      const small = go(50000, { useItem: true, useFlag: true }), bLeft0 = me.items[B];
      const horde = go(1000000, { useItem: true }), bLeft = me.items[B];
      me.items[E] = 1; const both = go(1250000, { useItem: true, useFlag: true }), tooMany = go(1300000, { useItem: true, useFlag: true });
      for (const a of A.fromCastle(camp)) delete G.db.armies[a.id];
      me.title = titleWas; G.abandonCastle(me, camp, Date.now());
      ok(Array.isArray(plain) && /at most 100,000/.test(plain[1]) && !Array.isArray(withE) && eLeft === 0 && withE.usedItems.join() === E
        && Array.isArray(noBanner) && /Banner of the Horde/.test(noBanner[1]) && !Array.isArray(small) && small.usedItems.length === 0 && bLeft0 === 2
        && !Array.isArray(horde) && horde.usedItems.join() === B && bLeft === 1 && !Array.isArray(both) && both.usedItems.length === 2
        && Array.isArray(tooMany) && /1,250,000/.test(tooMany[1]),
        'the War Ensign box lets a level 10 Rally Spot send 125,000 and Stygandr\'s Banner of the Horde 1,000,000 (both: 1,250,000), using up only what the army needs');
    }
    // Prestige (the wiki and Evony Advanced Guide; Fox's NPC 8 run): divided by all the lord's Town Hall levels;
    // a won attack on an NPC earns more the fewer troops it took.
    {
      const G = srv.game, A = G.armies, Q = G.quests, thWas = Q.townHalls;
      const mk = o => Object.entries(o).map(([t, [c, l]]) => ({ typeId: Number(t), count: c, lose: l })), army = lose => mk({ 7: [160000, lose] });
      Q.townHalls = () => 86;   // (Fox's nine cities)
      const p72 = A.battlePrestige(me, army(3660), mk({ 17: [1440, 1440], 16: [2400, 2400], 18: [900, 900], 3: [15000, 15000], 5: [6750, 6750], 6: [4000, 4000], 7: [3000, 3000], 9: [2000, 2000], 14: [7200, 4248], 15: [3600, 0] }));
      const p74 = A.battlePrestige(me, army(1431), mk({ 17: [608, 549], 16: [180, 180], 18: [486, 441], 3: [24, 24], 5: [10, 10], 6: [6, 6], 7: [4, 4], 9: [2, 2], 14: [3440, 1793], 15: [3600, 0] }));
      const p78 = A.battlePrestige(me, army(396), mk({ 17: [206, 189], 16: [117, 117], 18: [209, 189], 3: [707, 707], 5: [318, 318], 6: [188, 188], 7: [141, 141], 9: [94, 94], 14: [1307, 568], 15: [3600, 0] }));
      const def9 = mk({ 3: [60000, 60000], 5: [18000, 18000], 6: [2000, 2000], 7: [6750, 6750], 9: [2500, 2500], 14: [9000, 4500], 16: [3000, 3000], 17: [1800, 1800], 18: [1125, 1125] });
      Q.townHalls = () => 100;
      const big = A.battlePrestige(me, mk({ 3: [100000, 23000] }), def9), lean = A.battlePrestige(me, mk({ 3: [70000, 25000] }), def9);
      const build100 = Q.prestigeFor({ food: 800, wood: 4000, stone: 800, iron: 400 }, 1, me);
      Q.townHalls = () => 7; const build7 = Q.prestigeFor({ food: 800, wood: 4000, stone: 800, iron: 400 }, 1, me), lost = A.lostPrestige(me, mk({ 3: [3000, 3000] }));
      Q.townHalls = thWas;
      ok(p72 === 106 && p74 >= 2 && p74 <= 3 && p78 === 0 && lean > big && big > 0 && build100 === 0 && build7 === 8 && lost === Math.floor(3000 * 230 * 0.01 / 7),
        `prestige is divided by all the lord's Town Hall levels (a level 4 Cottage: 8 with 7 levels, none with 100); a won NPC attack earns more with fewer troops (NPC 9: ${big} with 100,000 Warriors, ${lean} with 70,000), and Fox's NPC 8 run comes out at 106, ${p74} and 0 (live 106, 3, 0); a lost battle costs the lost troops' prestige`);
    }
    // Alliances: founding, applying, invitations, ranks, diplomacy, chat, the members' battles and quitting.
    {
      const G = srv.game, AL = G.alliances, city = G.db.castles[castle.id];
      const freePlot = () => { for (let i = 0; i < 32; i++) if (!city.buildings[i]) return i; return null; };
      const emb = Object.entries(city.buildings).find(([, b]) => b.typeId === 28), embPos = emb ? emb[0] : freePlot(), embWas = city.buildings[embPos];
      city.buildings[embPos] = { typeId: 28, level: 1, status: 0, startTime: 0, endTime: 0 };
      G.logic.settle(city, me, Date.now()); city.res.gold = Math.max(city.res.gold, 50000);
      const low = await c.call('alliance.createAlliance', { castleId: castle.id, allianceName: 'Wolves' });
      city.buildings[embPos].level = 2;
      const long = await c.call('alliance.createAlliance', { castleId: castle.id, allianceName: 'Wolvesxyz' });
      const taxWas = city.taxRate; city.taxRate = 0; G.logic.settle(city, me, Date.now());   // (no gold coming in while we look)
      const gold0 = city.res.gold;
      c.send('alliance.createAlliance', { castleId: castle.id, allianceName: 'Wolves' });
      const info0 = (await c.wait('server.PlayerInfoUpdate', 4000, d => d.playerInfo?.alliance === 'Wolves')).data.playerInfo;
      const made = (await c.wait('alliance.createAlliance')).data;
      const a = AL.of(me); G.logic.settle(city, me, Date.now()); const gold1 = city.res.gold; city.taxRate = taxWas;
      ok(low.ok < 0 && /Level 2 Embassy/.test(low.errorMsg) && long.ok < 0 && /8 characters/.test(long.errorMsg) && made.ok === 1 && a?.name === 'Wolves'
        && info0.levelId === 4 && info0.allianceLevel === 'Host' && gold1 <= gold0 - 10000 + 1,
        'a level 2 Embassy and 10,000 gold found an alliance (names up to 8 letters), and its founder is its Host');
      // Two more lords: one to join, one with an alliance of his own.
      const lord = async name => { const x = new FakeClient(PORTS.gamePort); await x.ready(); x.send('gameClient.version', '091103_11'); x.send('login', { user: name, pwd: sha1('pw' + name) });
        const pl = (await x.wait('server.LoginResponse')).data.player; const q = G.db.players[pl.playerInfo.id], qc = G.castlesOf(q)[0];
        qc.buildings[5] = { typeId: 28, level: 2, status: 0, startTime: 0, endTime: 0 }; qc.res.gold = 50000; q.prestige = 1000; return { x, q, qc }; };
      const ally = await lord('Allyson'), rival = await lord('Rivalor');
      const applied = await ally.x.call('alliance.userWantInAlliance', { allianceName: 'Wolves' });
      const wanted = await ally.x.call('alliance.getAllianceWanted', {});
      const apps = await c.call('alliance.agreeComeinAllianceList', {});
      const accepted = await c.call('alliance.agreeComeinAllianceByLeader', { userName: 'Allyson' });
      const allyInfo = (await ally.x.wait('server.PlayerInfoUpdate', 4000, d => d.playerInfo?.alliance === 'Wolves')).data.playerInfo;
      const members = await c.call('alliance.getAllianceMembers', {}), index = await c.call('alliance.isHasAlliance', {});
      ok(applied.ok === 1 && applied.waitIntoAllianceName === 'Wolves' && wanted.allianceName === 'Wolves' && apps.allianceAddPlayerByUserInfoBeanList.some(b => b.userName === 'Allyson')
        && accepted.ok === 1 && allyInfo.levelId === 8 && allyInfo.allianceLevel === 'Member' && members.members.length === 2 && members.members[0].userName === me.name
        && !members.members.find(m => m.userName === 'Allyson').accountName && index.indexAllianceInfoBean.memberCount === 2 && index.indexAllianceInfoBean.memberLimit === 20 && index.indexAllianceInfoBean.leaderName === me.name,
        'a lord with an Embassy applies, an officer accepts him as a Member, and the member list and alliance info show it (20 members for a level 2 Embassy)');
      const vice = await c.call('alliance.setPowerForUserByAlliance', { userName: 'Allyson', typeId: 5 });
      const up = await ally.x.call('alliance.setPowerForUserByAlliance', { userName: me.name, typeId: 6 });
      const crows = await rival.x.call('alliance.createAlliance', { castleId: rival.qc.id, allianceName: 'Crows' });
      const hostile = await c.call('alliance.setAllianceFriendship', { targetAllianceName: 'Crows', type: 3 });
      const again = await c.call('alliance.setAllianceFriendship', { targetAllianceName: 'Crows', type: 1 });
      const lists = await c.call('alliance.getAllianceFriendshipList', {});
      const W = G.war, beanAlly = G.mapBean({ player: me }, world.tileAt(srv.store, ally.qc.fieldId)), beanRival = G.mapBean({ player: me }, world.tileAt(srv.store, rival.qc.fieldId));
      ok(vice.ok === 1 && AL.rank(ally.q) === 5 && up.ok < 0 && crows.ok === 1 && hostile.ok === 1 && again.ok < 0 && /again in/.test(again.errorMsg) && lists.enemyList.some(u => u.allianceName === 'Crows')
        && AL.relation(me, ally.q) === 0 && AL.relation(me, rival.q) === 3 && AL.relation(rival.q, me) === 2
        && beanAlly.relation === 0 && beanAlly.allianceName === 'Wolves' && beanRival.relation === 3 && beanRival.allianceName === 'Crows',
        'ranks go to lower members only; another alliance can be set hostile, once a day; the map shows an ally green (0) and a hostile alliance red (3)');
      const protWas = G.rules.beginnerProtection.enabled; G.rules.beginnerProtection.enabled = false;
      const declAlly = W.cantDeclare(me, ally.q), atkAlly = W.cantAttack(me, ally.qc), atkRival = W.cantAttack(me, rival.qc), atkBack = W.cantAttack(rival.q, city);
      const hostileState = W.cityState(rival.q, me), allyState = W.cityState(ally.q, me);
      G.rules.beginnerProtection.enabled = protWas;
      ok(Array.isArray(declAlly) && /your alliance and friendly/.test(declAlly[1]) && Array.isArray(atkAlly) && atkRival === null && Array.isArray(atkBack) && /not at war/.test(atkBack[1])
        && hostileState === 4 && allyState === 1 && beanAlly.canSend === true && beanAlly.canTrans === true && beanRival.canSend === false,
        'war can\'t be declared on an ally, and a hostile alliance\'s cities can be attacked without a war (but not the other way round until they set it too); their cities show Wartime');
      // Alliance chat, mail and the members' battles.
      c.send('common.allianceChat', { msg: 'Hello, pack', languageType: 0 });
      const heard = (await ally.x.wait('server.AllianceChatMsg', 4000)).data;
      const lone = await rival.x.call('common.allianceChat', { msg: 'hi', languageType: 0 });
      G.reports.add(me, { type: 1, startPos: 'Home(1,1)', targetPos: 'Nest(2,2)', title: 'Battle', content: `<reportData><battleReport isAttack="true"><attackTroop king="${me.name}"/><defendTroop king="Rivalor"/></battleReport></reportData>` });
      const sit = await c.call('alliance.getMilitarySituationList', { pageNo: 1, pageSize: 10 });
      const mailed = await c.call('alliance.messagesForAllianceMember', { title: 'Orders', message: 'Hold the line', type: 11 });
      const s0 = sit.situations[0];
      ok(heard.msg === 'Hello, pack' && heard.fromUser === G.fame.chatName(me) && lone.ok === 1 && s0 && s0.eventName === `${me.name} Attack Nest(2,2)` && s0.otherAllianceName === 'Crows' && s0.attack === true
        && mailed.ok === 1 && G.mail.list(ally.q).some(m => /Orders/.test(m.title)),
        'alliance chat reaches the members online, the Military Situation lists the members\' battles with lords, and the Host can mail every member');
      // Quitting, inviting and expelling.
      const hostQuit = await c.call('alliance.sayByetoAlliance', {});
      ally.q.prestige = 1000; const quit = await ally.x.call('alliance.sayByetoAlliance', {});
      const invited = await c.call('alliance.addUsertoAlliance', { userName: 'Allyson' });
      const sentList = await c.call('alliance.addUsertoAllianceList', {}), offers = await ally.x.call('alliance.leaderWantUserInAllianceList', {});
      const joined = await ally.x.call('alliance.agreeComeinAllianceByUser', { castleId: ally.qc.id, allianceName: 'Wolves' }), inAgain = AL.same(me, ally.q);
      const kicked = await c.call('alliance.kickOutMemberfromAlliance', { userName: 'Allyson' });
      const events = await c.call('alliance.getAllianceEventList', { pageNo: 1 }), ranking = await c.call('rank.getAllianceRank', { pageSize: 10, pageNo: 1, sortType: 2, key: null });
      ok(hostQuit.ok < 0 && /Host/.test(hostQuit.errorMsg) && quit.ok === 1 && ally.q.prestige === 900 && !AL.of(ally.q) && invited.ok === 1 && sentList.allianceAddPlayerInfoBeanList.some(b => b.userName === 'Allyson')
        && offers.allianceAddPlayerByLeaderInfoBeanList.some(b => b.allianceName === 'Wolves') && joined.ok === 1 && inAgain && kicked.ok === 1 && !AL.of(ally.q)
        && events.events.some(e => e.eventName === `${me.name} has invited Allyson to an alliance.`) && ranking.beans.length === 2 && ranking.beans.every(b => ['Wolves', 'Crows'].includes(b.name)),
        'the Host can\'t quit while others remain; quitting costs 10% of prestige; an invitation can be accepted; officers expel; events and the Alliance ranking show it all');
      c.inbox = c.inbox.filter(m => m.cmd !== 'shop.useGoods');   // (an earlier test's reply nobody waited for)
      const lim0 = AL.memberLimit(a); me.items['consume.hegemony.1'] = 1; me.items['alliance.ritual_of_pact.advanced'] = 1;
      const pact = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'consume.hegemony.1', num: 1 }), lim1 = AL.memberLimit(a);
      const pact2 = await c.call('shop.useGoods', { castleId: castle.id, itemId: 'alliance.ritual_of_pact.advanced', num: 1 });
      ok(lim0 === 20 && pact.ok === 1 && lim1 === 100 && pact2.ok === 1 && AL.memberLimit(a) === 1000 && AL.memberLimit(a, Date.now() + 16 * 86400000) === 100,
        'a Ritual of Pact makes the alliance 100 strong, an Advanced one 1,000 for 15 days');
      ally.x.close(); rival.x.close();
      // (leave the tester out of any alliance for the tests after this)
      AL.leave(a, me); AL.disband(a); const cr = AL.byName('Crows'); if (cr){ for (const q of AL.members(cr)) AL.leave(cr, q); AL.disband(cr); }
      if (embWas) city.buildings[embPos] = embWas; else delete city.buildings[embPos];
    }
    // Allied troops in an ally's city: the Embassy hosts them, they defend the city with its own troops, and they go
    // home when the city's lord sends them back, their stay ends, or the two lords' alliance parts.
    {
      const G = srv.game, A = G.armies, AL = G.alliances, city = G.db.castles[castle.id];
      const freePlot = () => { for (let i = 0; i < 32; i++) if (!city.buildings[i]) return i; return null; };
      const emb = Object.entries(city.buildings).find(([, b]) => b.typeId === 28), embPos = emb ? emb[0] : freePlot(), embWas = city.buildings[embPos];
      city.buildings[embPos] = { typeId: 28, level: 2, status: 0, startTime: 0, endTime: 0 };
      G.logic.settle(city, me, Date.now()); city.res.gold = Math.max(city.res.gold, 50000);
      const lord = async name => { const x = new FakeClient(PORTS.gamePort); await x.ready(); x.send('gameClient.version', '091103_11'); x.send('login', { user: name, pwd: sha1('pw' + name) });
        const pl = (await x.wait('server.LoginResponse')).data.player; const q = G.db.players[pl.playerInfo.id], qc = G.castlesOf(q)[0];
        qc.buildings[8] = { typeId: 29, level: 5, status: 0, startTime: 0, endTime: 0 }; qc.troops.archer = (qc.troops.archer || 0) + 1000; qc.res.food = 1e7; return { x, q, qc }; };
      const { x, q, qc } = await lord('Garrison');
      const march = (n, rest = 0) => A.send(qc, q, { missionType: 2, heroId: 0, targetPoint: city.fieldId, troops: { archer: n }, resource: {}, restTime: rest }, Date.now());
      const land = a => { a.reachTime = Date.now() - 1; G.moveArmies(Date.now()); };
      const newReports = (pl, since, re) => G.reports.list(pl).some(r => r.id > since && re.test(r.title + ' ' + (r.content || '')));
      const stranger = march(100);
      const al = AL.create(me, city, 'Keep').alliance; AL.enter(al, q);
      await c.call('army.setAllowAllianceArmy', { castleId: castle.id, isAllow: false });
      const shut = march(100);
      const opened = await c.call('army.setAllowAllianceArmy', { castleId: castle.id, isAllow: true });
      city.buildings[embPos].level = 1;
      const sentR = await x.call('army.newArmy', { castleId: qc.id, newArmyBean: { missionType: 2, heroId: 0, targetPoint: city.fieldId, troops: { archer: 300 }, resource: {}, restTime: 0 } });
      const ga = A.of(q).find(a => a.mission === 2 && a.direction === 1);
      const coming = ga ? (await c.wait('server.FriendArmysUpdate', 4000, d => d.armys.some(b => b.armyId === ga.id))).data.armys.find(b => b.armyId === ga.id) : null;
      const full = march(100);
      const up0 = G.logic.rates(city, me, Date.now()).foodUpkeep;
      land(ga);
      const up1 = G.logic.rates(city, me, Date.now()).foodUpkeep, rate = G.logic.hooks.upkeepRate(me, Date.now());
      const stay = await c.call('army.getStayAllianceArmys', { castleId: castle.id }), pb = G.beans.player(me, G.castlesOf(me), Date.now());
      ok(Array.isArray(stranger) && /same alliance/.test(stranger[1]) && Array.isArray(shut) && /doesn't allow/.test(shut[1]) && opened.ok === 1
        && sentR.ok === 1 && coming && coming.king === 'Garrison' && coming.alliance === 'Keep' && Array.isArray(full) && /level 1 Embassy can host 1/.test(full[1])
        && ga.direction === 3 && ga.stationedAt === city.id && stay.allianceArmys.some(b => b.armyId === ga.id) && pb.friendArmys.some(b => b.armyId === ga.id)
        && Math.abs((up1 - up0) - A.upkeepOf({ archer: 300 }) * rate) < 1e-6,
        'an ally\'s troops can be stationed in a city whose lord allows it, one army per Embassy level; the host sees them coming and in the Embassy, and feeds them while no stay time is set');
      // They defend the city with its own troops, and both lose the same share.
      const unit = (() => { const g1 = { troops: { archer: 300 } }, cityLeft = A.shareLosses({ archer: 100 }, [g1], { archer: 200 }); return cityLeft.archer === 50 && g1.troops.archer === 150; })();
      const { x: rx, q: rp, qc: rc } = await lord('Raider');
      city.troops.archer = (city.troops.archer || 0) + 2000;
      const total = city.troops.archer + ga.troops.archer, g0 = ga.troops.archer, seqQ = q.reportSeq || 0;
      const fight0 = G.combat.fight, cant0 = G.war.cantAttack; let seen = null, res = null;
      // (the battle itself is left as it is, but 40% of the archers are made to fall so the sharing shows)
      G.combat.fight = (att, def) => { seen = { ...def.troops }; res = fight0.call(G.combat, att, def); res.defLeft = { ...res.defLeft, archer: Math.floor((res.defLeft.archer || 0) * 0.6) }; return res; };
      G.war.cantAttack = () => null;
      const raid = { id: G.store.id(), playerId: rp.id, castleId: rc.id, heroId: 0, mission: 5, from: rc.fieldId, target: city.fieldId, troops: { lightCavalry: 400 }, carry: {}, loot: null,
        startTime: Date.now() - 1000, reachTime: Date.now() - 1, oneWay: 1000, direction: 1, restTime: 0 };
      G.db.armies[raid.id] = raid;
      try { G.moveArmies(Date.now()); } finally { G.combat.fight = fight0; G.war.cantAttack = cant0; }
      delete G.db.armies[raid.id];
      const shareOk = res && ga.troops.archer === Math.round(g0 * (res.defLeft.archer || 0) / total);
      ok(unit && seen && seen.archer === total && shareOk && newReports(q, seqQ, /where your troops are stationed/) && (res.attackerWon || ga.direction === 3),
        `allied troops fight alongside the city's own and lose the same share (${g0} archers came out of it with ${ga.troops.archer}, the city ${total - g0} with ${city.troops.archer}; attacker ${res?.attackerWon ? "won" : "lost"}); their lord gets the battle report`);
      // The strongest hero leads the defence (Fox: live): an ally's only when his total stats beat every hero at home.
      {
        const H = G.heroes, HS = require('../src/game/heroes').HERO_STATUS, tot = h => H.effective(h, 'pol') + H.effective(h, 'atk') + H.effective(h, 'int');
        const homeBest = H.list(city).filter(h => [HS.CHIEF, HS.FREE, HS.GUARD].includes(h.status)).reduce((b, h) => !b || tot(h) > tot(b) ? h : b, null);
        const mk = n => ({ id: G.store.id(), name: 'Ally' + n, level: 50, face: 1, status: HS.SENT, base: { pol: n, atk: n, int: n }, added: { pol: 0, atk: 0, int: 0 }, equip: {} });
        const strong = mk(100000), weak = mk(1); G.heroes.list(qc).push(strong, weak);
        const leadStrong = A.defender(city, [{ castleId: qc.id, heroId: strong.id }]), leadWeak = A.defender(city, [{ castleId: qc.id, heroId: weak.id }]);
        qc.heroes = G.heroes.list(qc).filter(h => h !== strong && h !== weak);
        ok(leadStrong === strong && leadWeak === homeBest, 'the defence is led by the hero with the highest total stats: an ally\'s stationed hero only when he beats every hero at home');
      }
      // The host sends them home from the Embassy.
      const seqQ2 = q.reportSeq || 0, wasHere = ga.direction === 3;
      const sentBack = wasHere ? await c.call('army.callBackArmy', { castleId: castle.id, armyId: ga.id }) : { ok: 1 };
      ok(sentBack.ok === 1 && ga.direction === 2 && !ga.stationedAt && !A.guests(city).length && (!wasHere || newReports(q, seqQ2, /sent your troops home/)),
        'the city\'s lord can send allied troops home (the Embassy\'s Send Back), and their lord is told');
      if (G.db.armies[ga.id]) land(ga);
      // Camp time (Fox: live): the army waits at home before marching, eating the city's food (the march window adds
      // it to the food the march needs); called off in camp it is back at once with the food it didn't eat. Troops
      // that can no longer stay, or whose lords part, go home.
      city.buildings[embPos].level = 2;
      const food0 = qc.res.food, arch0 = qc.troops.archer, sentAt = Date.now(), camped = march(200, 3600), food1 = qc.res.food, campFood = Math.ceil(A.upkeepOf({ archer: 200 }));
      const paid = food0 - food1 === A.foodFor({ archer: 200 }, camped.army.oneWay) + campFood && camped.army.restTime === 3600
        && camped.army.reachTime - sentAt >= 3600000 + camped.army.oneWay - 1 && camped.army.reachTime - sentAt < 3600000 + camped.army.oneWay + 2000;
      G.moveArmies(Date.now());
      const stillHome = camped.army.direction === 1 && !A.guests(city).includes(camped.army);
      const off = A.recall(q, camped.army.id, Date.now()), refund = qc.res.food - food1; G.moveArmies(Date.now() + 1);
      const backAtOnce = !Array.isArray(off) && !G.db.armies[camped.army.id] && qc.troops.archer === arch0 && Math.abs(refund - campFood) <= 1;
      const seqQ3 = q.reportSeq || 0;
      const late = march(50); city.allowAlliance = false; land(late.army); city.allowAlliance = true;
      const refusedLate = late.army.direction === 2 && newReports(q, seqQ3, /couldn't stay/);
      const open = march(100); land(open.army);
      const openStays = open.army.direction === 3 && !open.army.stayUntil, gu = A.guestUpkeep(city), seqQ4 = q.reportSeq || 0;
      const tp = (me.items['consume.move.1'] = (me.items['consume.move.1'] || 0) + 1, await c.call('city.moveCastle', { castleId: castle.id, zoneId: -1 }));
      me.items['consume.move.1'] = Math.max(0, me.items['consume.move.1'] - 1);
      AL.leave(al, q);
      const parted = open.army.direction === 2 && newReports(q, seqQ4, /can no longer stay/);
      ok(paid && stillHome && backAtOnce && refusedLate && openStays && gu === A.upkeepOf({ archer: 100 }) && parted && tp.ok < 0 && /Allied troops/.test(tp.errorMsg),
        'camp time keeps an army at home that long before it marches, on the city\'s food (the march takes it along), and called off in camp it is back at once with the food left; allied troops stay until called back, the host feeding them; troops arriving when they\'re no longer allowed, or whose lord leaves the alliance, head home; a city hosting them can\'t teleport');
      for (const a of A.of(q)) delete G.db.armies[a.id];
      x.close(); rx.close();
      AL.leave(al, me); AL.disband(al);
      city.troops.archer = Math.max(0, city.troops.archer - 2000);
      if (embWas) city.buildings[embPos] = embWas; else delete city.buildings[embPos];
    }
    // The Coordinates List (map signs): "Add to CL" on another lord's city.
    {
      const G = srv.game, other = Object.values(G.db.castles).find(x => x.playerId && x.playerId !== me.id);
      const mine = await c.call('castle.saveCastleSignList', { id: castle.id, x: 0, y: 0 });
      const s1 = await c.call('castle.saveCastleSignList', { id: other.id, x: 0, y: 0 });
      const s2 = await c.call('castle.saveCastleSignList', { id: other.id, x: 0, y: 0 });
      const pb = G.beans.player(me, G.castlesOf(me), G.now());
      const maxWas = G.rules.coordinates; G.rules.coordinates = { max: 1 };
      const third = Object.values(G.db.castles).find(x => x.playerId && x.playerId !== me.id && x.id !== other.id);
      const full = third ? await c.call('castle.saveCastleSignList', { id: third.id, x: 0, y: 0 }) : { ok: -1, errorMsg: 'Coordinates List is full' };
      G.rules.coordinates = maxWas;
      const del = await c.call('castle.deleteCastleSign', { id: s1.castleSignInfoArr[0].id });
      const { x, y } = require('../src/game/world').xy(other.fieldId);
      ok(mine.ok < 0 && s1.ok === 1 && s1.castleSignInfoArr.length === 1 && s1.castleSignInfoArr[0].name === other.name && s1.castleSignInfoArr[0].x === x && s1.castleSignInfoArr[0].y === y
        && s2.castleSignInfoArr.length === 1 && pb.castleSignBean.length === 1 && full.ok < 0 && /full/.test(full.errorMsg) && del.ok === 1 && del.castleSignInfoArr.length === 0,
        'another lord\'s city can be added to the Coordinates List (once, until the list is full) and removed again');
    }
    c.close();

    // Log back in: state persisted in memory and the second login sees the finished buildings.
    const c2 = new FakeClient(PORTS.gamePort); await c2.ready();
    c2.send('gameClient.version', '091103_11'); c2.send('login', { user: 'tester', pwd: sha1('secret') });
    const again = (await c2.wait('server.LoginResponse')).data;
    ok(again.ok === 1 && again.player.castles[0].buildings.some(b => b.positionId === 3 && b.level === 1), 'second login sees the finished Cottage');
    c2.send('login', { user: 'tester', pwd: sha1('wrong') });
    c2.close();
    const c3 = new FakeClient(PORTS.gamePort); await c3.ready();
    c3.send('login', { user: 'tester', pwd: sha1('wrong') });
    ok((await c3.wait('server.LoginResponse')).data.ok === -2, 'wrong password is refused');
    c3.close();

    {
      // m3.75: Ruffle. /ruffle.html runs the client without Flash; its game socket comes over a WebSocket on /ws.
      const page = (await get('/ruffle.html')).body.toString();
      ok(page.includes('socketProxy') && page.includes('EvonyClient1921.swf') && page.includes('function getGuid'), '/ruffle.html runs the client in Ruffle with the page functions the client calls');
      const ws = net.connect(PORTS.httpPort, '127.0.0.1'); await new Promise(r => ws.once('connect', r));
      let raw = Buffer.alloc(0), head = null; const msgs = [];
      let stream = Buffer.alloc(0);
      ws.on('data', d => {
        raw = Buffer.concat([raw, d]);
        if (!head){ const i = raw.indexOf('\r\n\r\n'); if (i < 0) return; head = raw.subarray(0, i).toString(); raw = raw.subarray(i + 4); }
        while (raw.length >= 2){
          let len = raw[1] & 0x7f, q = 2;
          if (len === 126){ if (raw.length < 4) return; len = raw.readUInt16BE(2); q = 4; } else if (len === 127){ if (raw.length < 10) return; len = Number(raw.readBigUInt64BE(2)); q = 10; }
          if (raw.length < q + len) return;
          if ((raw[0] & 0x0f) === 2) stream = Buffer.concat([stream, raw.subarray(q, q + len)]);
          raw = raw.subarray(q + len);
        }
        while (stream.length >= 4){
          const h = stream.readUInt32BE(0), n = h & 0x7fffffff; if (stream.length < 4 + n) break;
          let pl = stream.subarray(4, 4 + n); stream = stream.subarray(4 + n);
          if (h & 0x80000000) pl = zlib.inflateSync(pl);
          msgs.push(amf3.decode(pl));
        }
      });
      const key = crypto.randomBytes(16).toString('base64');
      ws.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORTS.httpPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      const masked = data => { const m = crypto.randomBytes(4), d = Buffer.from(data); for (let i = 0; i < d.length; i++) d[i] ^= m[i & 3];
        const h = d.length < 126 ? Buffer.from([0x82, 0x80 | d.length]) : Buffer.from([0x82, 0x80 | 126, d.length >> 8, d.length & 255]); return Buffer.concat([h, m, d]); };
      const packet = (cmd, data) => { const b = amf3.encode({ cmd, data }), h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]); };
      const both = Buffer.concat([packet('gameClient.version', '091103_11'), packet('login', { user: 'Ruffler', pwd: sha1('ruffle') })]);
      ws.write(masked(both.subarray(0, 7))); ws.write(masked(both.subarray(7))); // split across frames, as a stream may be
      const t0 = Date.now(); while (!msgs.some(m => m.cmd === 'server.LoginResponse') && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      const lr = msgs.find(m => m.cmd === 'server.LoginResponse');
      ok(/^HTTP\/1\.1 101/.test(head || '') && (head || '').includes(accept) && lr?.data.ok === 1 && lr.data.player.playerInfo.userName === 'Ruffler',
        'the /ws WebSocket bridge carries the game socket: a lord logs in through it as Ruffle would' + (lr?.data.ok === 1 ? '' : ` [${(head || 'no reply').split('\r\n')[0]}; ${msgs.map(m => m.cmd + ':' + JSON.stringify(m.data).slice(0, 120)).join(', ')}]`));
      ws.destroy();
    }
    // RoboEvony, patched to take an address: config.xml from the typed address, serverID must repeat it,
    // then the game socket at <server> (host:port), version, and login with an SHA-1 password.
    {
      // The bot's Flex HTTPService sends a POST with an XML content type, not a GET.
      const cfgXml = await new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port: PORTS.httpPort, path: '/config.xml', method: 'POST', headers: { 'Content-Type': 'application/xml' } }, res => {
          const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(res.statusCode === 200 ? Buffer.concat(c).toString() : `HTTP ${res.statusCode}`)); });
        rq.on('error', reject); rq.end('');
      });
      const typed = `127.0.0.1:${PORTS.httpPort}`;
      const tag = t => (cfgXml.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1];
      const [host, port] = tag('server').split(':');
      const bot = new FakeClient(Number(port)); await bot.ready();
      bot.send('gameClient.version', '091103_11'); bot.send('login', { user: 'tester', pwd: sha1('secret') });
      const lr = (await bot.wait('server.LoginResponse')).data;
      ok(tag('serverID').toUpperCase() === typed.toUpperCase() && host === '127.0.0.1' && Number(port) === PORTS.gamePort && lr.ok === 1 && lr.player.playerInfo.userName === 'Tester',
        'RoboEvony: config.xml (POSTed, as Flex sends it) names the typed address as the server and gives the game socket, and the bot\'s login works');
      bot.close();
    }

    // Big replies are compressed with the top bit set, as the client expects.
    const net2 = require('../src/net');
    ok(typeof net2.startGameServer === 'function', 'net module loads');
    {
      // m3.77: RoboEvony can't unzip (it read the compressed flag as a negative size: "invalid package size
      // -2147475778"), so messages go out plain up to the clients' 1 MB limit.
      const sent = [], fake = { on(){}, setNoDelay(){}, write: b => sent.push(b), end(){} };
      const conn = new net2.Connection(fake, () => {}, () => {}, { warn(){}, debug(){} });
      conn.send('server.LoginResponse', { ok: 1, filler: 'x'.repeat(200000) });
      const head = sent[0].readUInt32BE(0);
      ok(!(head & 0x80000000) && head === sent[0].length - 4 && amf3.decode(sent[0].subarray(4)).data.filler.length === 200000,
        'a 200 KB message goes out uncompressed, as RoboEvony needs (it treats the compressed flag as an invalid size)');
      sent.length = 0; conn.send('server.Big', { filler: crypto.randomBytes(800000).toString('base64') });
      ok(!!(sent[0].readUInt32BE(0) & 0x80000000), 'only a message over the 1 MB limit is compressed');
    }
  } catch (e){
    failures++; console.log('FAIL ' + e.stack);
  } finally {
    srv.close();
    const unhandled = path.join(dataDir, 'unhandled.log');
    if (fs.existsSync(unhandled)) console.log('unhandled.log entries:', fs.readFileSync(unhandled, 'utf8').trim().split('\n').length);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
