'use strict';
const fs = require('fs');
const path = require('path');
const world = require('./world');
const { CastleLogic, STATUS } = require('./castle');
const { TroopLogic } = require('./troops');
const { ResearchLogic } = require('./research');
const { Items } = require('./items');
const { Beans } = require('./beans');
const { HeroLogic, HERO_STATUS } = require('./heroes');
const { ArmyLogic, DIR } = require('./armies');
const { Combat } = require('./combat');
const { NpcLogic } = require('./npc');
const { FortLogic } = require('./forts');
const { Reports } = require('./reports');
const historic = require('./historic');
const { HistoricHeroLogic } = require('./historicHeroes');
const { EquipmentLogic } = require('./equipment');
const { ItemUse } = require('./itemUse');
const { QuestLogic } = require('./quests');
const { Mail } = require('./mail');
const { Market } = require('./market');
const { Policies } = require('./policies');
const { Colonies } = require('./colonies');
const { War } = require('./war');
const { Captives } = require('./captives');
const { Fame } = require('./fame');
const { Account, SECURITY } = require('./account');
const { BuildQueue } = require('./buildQueue');
const { Chat } = require('./chat');
const { Effort } = require('./effort');
const { Stratagems } = require('./stratagems');
const { Alliances } = require('./alliances');
const { CLASS } = require('./combat');

const CLIENT_VERSION = '091103_11';
const OK = 1;
const STARTER_PACKS = ['player.box.present.2', 'player.box.present.4'];   // Newbies Package, Package for Lords
const LOGIN = { BAD_USER: -2, FULL: -3, NEED_PLAYER: -4 };
// Reads that are safe to answer with an empty result until they are implemented.
// (an "is" check must be isSomething: issueCommissionQuest is an action)
const READ_VERB = /^(get|receive|read|query|list|search|check|view|load|has|map|zone|all|my|show|find)/i, IS_VERB = /^[iI]s[A-Z]/;
// Writes that only record a preference or tutorial step; acknowledging them is harmless.
const HARMLESS = new Set(['common.step', 'common.setEventDone', 'common.addToFavorites', 'common.setReturnReport', 'common.setAutoHeal']);
const HANDLER_FILES = ['account', 'castle', 'map', 'troops', 'shop', 'research', 'info', 'heroes', 'army', 'reports', 'field', 'forts', 'interior', 'npchero', 'city', 'equipment', 'quests', 'mail', 'market', 'capital', 'colony', 'war', 'fame', 'profile', 'signs', 'chat', 'effort', 'stratagem', 'alliance'];

class Game {
  constructor({ store, data, rules, speed, protocol, log, logDir, faces, art }){
    this.store = store; this.data = data; this.rules = rules; this.protocol = protocol; this.log = log; this.clientVersion = CLIENT_VERSION;
    this.logic = new CastleLogic(data, rules, speed);
    this.troops = new TroopLogic(data, rules, this.logic);
    this.research = new ResearchLogic(data, rules, this.logic);
    this.items = new Items(data, rules);
    this.beans = new Beans(data, this.logic, this.items);
    this.heroes = new HeroLogic(data, rules, this.logic);
    this.armies = new ArmyLogic(this);
    this.combat = new Combat(data, rules);
    this.npc = new NpcLogic(rules, this.logic.speed);
    this.forts = new FortLogic(data, rules, this.logic);
    this.reports = new Reports(this);
    this.faces = faces || null;       // which hero portraits exist on the art server (see http.js)
    this.art = art || null;           // other art the client couldn't get (see http.js)
    this.beans.game = this;
    this.equipment = new EquipmentLogic(this);
    this.logic.hooks = {
      mayor: (c, kind) => this.heroes.mayorBonus(c, kind),
      valleys: c => this.armies.valleyBonuses(c),
      salary: c => this.heroes.salary(c),
      upkeepRate: (p, now) => this.items.upkeepRate(p, now),
      themeBonus: (p, now) => this.items.castleThemeActive(p, now) ? 10 : 0,
      buildSlots: p => this.items.buildSlots(p),
      items: p => p?.items || {},
      tribute: (c, r, now) => this.colonies.tribute(c, r, now),
      guestUpkeep: c => this.armies.guestUpkeep(c),
      // Achievements (effort.js): their bonuses, and what is produced.
      effort: (p, k) => this.effort?.bonus(p, k) || 0,
      produced: (p, k, n) => this.effort?.note(p, `produce:${k}`, n),
    };
    // Hero gear belongs to the lord's Workshop research; find the lord from the hero's city.
    this.heroes.ownerOf = h => { for (const c of Object.values(this.db.castles)) if (c.heroes?.includes(h)) return this.db.players[c.playerId]; return null; };
    this.heroes.gearOf = h => this.equipment.bonus(this.heroes.ownerOf(h), h);
    this.heroes.gearBeans = h => this.equipment.beans(this.heroes.ownerOf(h), h);
    // A hero leading an army shows as out (3), coming back (5) or stationed in a city being colonized (2, "Guard").
    this.heroes.statusOf = h => { if (h.status !== 3) return h.status; const a = Object.values(this.db.armies || {}).find(x => x.heroId === h.id); return !a ? 3 : a.direction === DIR.BACK ? 5 : a.direction === DIR.STAY ? 2 : 3; };
    this.combat.heroAttr = (h, k) => this.heroes.effective(h, k);
    this.combat.heroLeadership = h => this.heroes.leadership(h);
    this.combat.playerBuff = p => this.items.battleBuff(p);
    this.research.mayorBonus = c => this.heroes.mayorBonus(c, 'points:int');
    const hist = historic.build(data.historicNames || [], rules);
    world.setHistoric(hist);
    world.setValleyCycle({ enabled: rules.valleyCycle !== false, resetHourUTC: rules.dailyResetHourUTC || 0 });
    this.historicCount = hist.size;
    this.online = new Map();          // playerId -> Connection
    this.unhandledFile = path.join(logDir, 'unhandled.log');
    this.dataDir = logDir;
    this.mail = new Mail(this);
    this.market = new Market(this);
    this.policies = new Policies(this);
    this.colonies = new Colonies(this);
    this.war = new War(this);
    this.captives = new Captives(this);
    this.fame = new Fame(this);
    this.account = new Account(this);
    this.buildQueue = new BuildQueue(this);
    // HungerBuff: the client's "hungry" icon while one of the lord's cities is out of food and eating more than it
    // grows (on Age II nothing deserts, Fox; armies just can't march without food for the road).
    this.items.extraBuffs = (p, now) => { const c = this.hungryCity(p, now); return [...this.effort.buffs(p, now), ...(c ? [{ typeId: 'HungerBuff', endTime: now + 86400000, descName: `Hunger: ${c.name} has run out of food. Its troops can't march without food for the road.` }] : [])]; };
    this.hungerShown = new Map();
    this.chat = new Chat(this);
    this.effort = new Effort(this);
    this.stratagems = new Stratagems(this);
    this.alliances = new Alliances(this);
    this.seenUnhandled = new Set();
    this.handlers = {};
    this.hh = new HistoricHeroLogic(this, logDir);
    this.itemUse = new ItemUse(this);
    this.quests = new QuestLogic(this);
    // Prestige for what is built, researched and trained (quests.prestigeFor).
    const gain = (c, cost, n = 1) => { const p = this.playerOf(c); if (p) p.prestige = (p.prestige || 0) + this.quests.prestigeFor(cost, n, p); };
    this.logic.hooks.built = (c, p, typeId, level) => gain(c, this.data.buildings[typeId]?.levels[level - 1]);
    this.troops.onDone = (c, type, num) => { gain(c, this.data.troops[type], num); this.effort.note(this.playerOf(c), `train:${this.data.troops[type]?.field}`, num); };
    this.troops.costCut = (p, typeId) => this.effort.bonus(p, { foot: 'infantry', mounted: 'cavalry', siege: 'machine' }[CLASS[typeId]] || 'none');
    this.items.onAdd = (p, id, n) => { if (/^hero\.loyalty\.\d$/.test(id)) this.effort.note(p, `medal:${id}`, n); };
    this.forts.onDone = (c, type, num) => gain(c, this.data.forts[type], num);
    for (const f of HANDLER_FILES) require('./handlers/' + f)(this, this.handlers);
    this.migrate();
    const placed = this.hh.seed();
    if (placed) log.info(`Placed ${placed} historic heroes in NPC cities`);
  }

  // Bring saves from older versions up to date.
  migrate(){
    for (const p of Object.values(this.db.players)){
      if (p.coins == null) p.coins = this.rules.startCoins;
      p.items = p.items || {}; p.buffs = p.buffs || {}; p.techs = p.techs || {};
      if (p.research === undefined) p.research = null;
    }
    // 0.3.13: prestige for what older saves already built, and the starter packages (quests ask you to open them).
    for (const p of Object.values(this.db.players)){
      if (this.quests.upgrade(p)) this.log.info(`${p.name}'s quests were moved to the 0.3.15 quest list`);
      const got = this.quests.backfill(p);
      if (got) this.log.info(`${p.name} was credited ${got.toLocaleString('en-US')} prestige for what was already built, researched and trained`);
      if (!p.starterPacks){ p.starterPacks = 1; for (const id of STARTER_PACKS) this.items.add(p, id, 1); }
      // Before 0.3.13 hiring a historic hero left the finished quest behind, keeping the Quests button lit.
      for (const id of Object.keys(p.hhQuests || {})) if (this.db.hh?.[id]?.status === 'hired') delete p.hhQuests[id];
    }
    for (const c of Object.values(this.db.castles)){
      c.troops = c.troops || {}; c.forts = c.forts || {}; c.trainQ = c.trainQ || {}; c.heroes = c.heroes || []; c.valleys = c.valleys || []; c.fortQ = c.fortQ || [];
      if (this.heroes.migrate(c)) this.store.touch?.();
      // 0.3.28: the historic hero sheet had attack and intelligence swapped; hired heroes take the corrected stats.
      let fixed = 0;
      for (const h of [...c.heroes, ...(c.innHistoric || [])]) if (this.hh.sync(h)) fixed++;
      if (fixed){ this.store.touch?.(); this.log.info(`${c.name}: ${fixed} historic hero${fixed > 1 ? 'es' : ''} updated to the corrected stats`); }
      // 0.3.71: historic heroes from before 0.3.61 get the points they were short (2 a level, counting the first 30).
      let owed = 0;
      for (const h of [...c.heroes, ...(c.innHistoric || [])]) if (this.hh.owed(h)) owed++;
      if (owed){ this.store.touch?.(); this.log.info(`${c.name}: ${owed} historic hero${owed > 1 ? 'es' : ''} given the points they were short`); }
    }
    // ... and wild ones still waiting in NPC cities.
    for (const st of Object.values(this.db.hh || {})) if (st?.alloc && this.hh.topUp(st.alloc)) this.store.touch?.();
    this.db.armies = this.db.armies || {}; this.db.npc = this.db.npc || {};
    // A city that a Historic City now occupies would hide it; move nothing, just warn.
    for (const c of Object.values(this.db.castles)) if (world.historicAt(c.fieldId)) this.log.warn(`${c.name} sits on a Historic City tile (${world.xy(c.fieldId).x},${world.xy(c.fieldId).y}).`);
  }

  // ---------- helpers ----------
  get db(){ return this.store.db; }
  now(){ return Date.now(); }
  castlesOf(p){ return p.castles.map(id => this.db.castles[id]).filter(Boolean); }
  playerOf(c){ return this.db.players[c.playerId]; }
  castleFor(conn, id){
    const p = conn.player; if (!p) return null;
    const c = this.db.castles[id];
    return c && c.playerId === p.id ? c : null;
  }
  // Look up the caller's city, bring it up to date, or answer with an error.
  castleOr(conn, cmd, id){
    const c = this.castleFor(conn, id);
    if (!c){ this.fail(conn, cmd, -30, 'That city is not yours.'); return null; }
    this.catchUp(c); return c;
  }
  catchUp(c){ this.completeDue(c, true); this.logic.settle(c, this.playerOf(c), this.now()); }
  reply(conn, cmd, data){ this.flushChanges(conn, cmd); this.observe(conn, cmd); conn.send(cmd, { ok: OK, packageId: 0, ...data }); }
  // Quest targets that are actions rather than state ("levy gold", "rename a city"): noted when the command succeeds.
  observe(conn, cmd){
    const t = conn.tracking, p = conn.player;
    if (!t || t.cmd !== cmd || t.observed || !p) return;
    t.observed = true;
    const d = t.data || {}, flag = k => this.quests.flag(p, k), item = String(d.itemId || '');
    switch (cmd){
      case 'interior.pacifyPeople': flag(`pacify${Number(d.typeId)}`); break;
      case 'interior.taxation': flag(`levy${Number(d.typeId)}`); break;
      case 'city.modifyCastleName': flag('rename'); break;
      case 'city.modifyFlag': flag('flag'); break;
      case 'common.worldChat': flag('worldChat'); break;
      case 'hero.hireHero': flag('hire'); break;
      case 'hero.addPoint': case 'hero.addPoint2': flag('heroPoints'); break;
      case 'hero.refreshHerosListFromTavern': flag('refreshInn'); break;
      case 'castle.speedUpBuildCommand': if (item === 'consume.2.a') flag('guideBuild'); break;
      case 'tech.speedUpResearch': if (item === 'consume.2.b') flag('guideResearch'); break;
      case 'shop.buy': flag('buy'); break;
      case 'quest.accept': flag('hearsay'); break;
      case 'npchero.getNpcHeroInfroByID': flag('enquire'); break;
      case 'npchero.getNpcHerosListByMoney': flag('moreHearsay'); break;
      case 'npchero.getNpcHerosListByFilter': flag('heroSearch'); break;
      case 'equipment.WearAll': flag('wearAll'); break;
      case 'shop.useGoods':
        if (/^player\.box\.gambling\.\d+$/.test(item)) flag('amulet');
        if (item === 'player.box.present.2') flag('newbiePack');
        if (item === 'player.box.present.4') flag('lordsPack');
        break;
    }
  }
  // Tell the client when a quest becomes ready to claim, so the Quests button lights up straight away.
  questNotice(p, c = null){
    if (!this.online.has(p.id)) return;
    c = c || this.castlesOf(p)[0]; if (!c) return;
    const s = this.quests.state(p), now = this.now();
    const ready = [...this.quests.finishedIds(p, c, now), ...Object.entries(this.hh.quests(p)).filter(([, q]) => q.done).map(([id]) => 'h' + id)];
    const fresh = ready.filter(id => !s.notified[id]);
    for (const id of Object.keys(s.notified)) if (!ready.includes(isNaN(id) ? id : Number(id))) delete s.notified[id];
    if (!fresh.length) return;
    for (const id of fresh) s.notified[id] = now;
    this.push(p.id, 'server.NewFinishedQuest', {});
  }
  fail(conn, cmd, code, msg){ this.flushChanges(conn, cmd); conn.send(cmd, { ok: code, packageId: 0, errorMsg: msg, msg }); }
  // The client stores item counts and coins from server.ItemUpdate / PlayerInfoUpdate without redrawing, and
  // redraws the item list when a command's reply arrives. So whatever a command changed is sent before its
  // reply; pushes made after the reply then skip what was already sent.
  flushChanges(conn, cmd){
    const t = conn.tracking; if (!t || t.cmd !== cmd || t.flushed) return;
    t.flushed = true;
    const p = conn.player; if (!p) return;
    const ids = [...new Set([...Object.keys(t.items), ...Object.keys(p.items || {})])].filter(id => (t.items[id] || 0) !== (p.items?.[id] || 0));
    if (ids.length){ conn.send('server.ItemUpdate', { ok: OK, packageId: 0, items: ids.map(id => this.items.itemBean(p, id)) }); for (const id of ids) t.sent[id] = p.items?.[id] || 0; }
    if ((t.coins || 0) !== (p.coins || 0)){ this.pushPlayerInfo(p); t.sentCoins = p.coins || 0; }
  }
  push(playerId, cmd, data){ const conn = this.online.get(playerId); if (conn) conn.send(cmd, { ok: OK, packageId: 0, ...data }); }
  pushBuilding(c, pos){
    const b = c.buildings[pos]; if (!b) return;
    this.push(c.playerId, 'server.BuildComplate', { castleId: c.id, buildingBean: this.beans.building(pos, b) });
  }
  // Give up a city (handlers/city.js checks first): its heroes, troops, buildings and resources go; prisoners held
  // there go home, historic heroes back to the world; its valleys, colonies and trades end; the spot becomes a
  // barbarian city at the level the flat had when the city was founded (Fox: "Building a city on a flat, then
  // abandoning that city will produce a barbarian city that is the same level the flat was"; it stays until it is
  // taken or a War Teleporter lands on it). A Historic City's spot is the Historic City again.
  abandonCastle(p, c, now = this.now()){
    for (const r of [this.colonies.ofColony(c), ...this.colonies.ofSuzerain(c)].filter(Boolean)) this.colonies.drop(r);
    for (const v of [...(c.valleys || [])]) this.armies.giveUp(c, v);
    for (const h of [...this.heroes.list(c)]){
      if (h.capturedFrom && this.captives.releaseHome(h)) continue;
      if (h.historic) this.hh.release(h.historic);
    }
    const m = this.market.db();
    for (const [id, o] of Object.entries(m.orders)) if (o.castleId === c.id) delete m.orders[id];
    for (const [id, s] of Object.entries(m.ships)) if (s.castleId === c.id) delete m.ships[id];
    p.castles = p.castles.filter(id => id !== c.id);
    delete this.db.castles[c.id];
    const id = c.fieldId, was = world.terrain(this.db.seed, id);
    delete this.db.npc?.[id];
    let level;
    if (world.historicAt(id) || was.type === world.T.NPC){ delete this.db.tiles[id]; level = world.tileAt(this.store, id).level; }
    else { level = Math.max(1, Math.min(10, c.flatLevel || world.naturalTile(this.db.seed, id, c.createdAt || now).level || 1)); this.db.tiles[id] = { type: world.T.NPC, level }; }
    this.store.touch();
    return { level };
  }
  // A city of p's that is out of food and eating more than it grows, or null.
  hungryCity(p, now = this.now()){
    for (const c of this.castlesOf(p)){
      if ((c.res?.food || 0) >= 1) continue;
      const r = this.logic.rates(c, p, now);
      if (r.food - r.foodUpkeep < 0) return c;
    }
    return null;
  }
  // Show or clear the hungry icon when that changes.
  pushHunger(p, now = this.now()){
    const hungry = !!this.hungryCity(p, now);
    if (hungry === !!this.hungerShown.get(p.id)) return;
    this.hungerShown.set(p.id, hungry);
    const b = this.items.extraBuffs(p, now).find(x => x.typeId === 'HungerBuff');
    this.push(p.id, 'server.PlayerBuffUpdate', b ? { buffBean: b, updateType: 0 } : { buffBean: { typeId: 'HungerBuff', endTime: 0, descName: '' }, updateType: 1 });
  }
  // The Coordinates List (handlers/signs.js), with the cities' names as they are now.
  signs(p){ return (p.signs || []).map(s => ({ id: s.id, name: this.db.castles[s.castleId]?.name || s.name, x: s.x, y: s.y })); }
  pushResources(c){ this.push(c.playerId, 'server.ResourceUpdate', { castleId: c.id, resource: this.beans.resource(c, this.playerOf(c)) }); }
  pushTroops(c){ this.push(c.playerId, 'server.TroopUpdate', { caslteId: c.id, troop: this.beans.troop(c) }); }
  // The Hospital window (Rally Spot): the wounded resting in a city and what curing them costs.
  pushInjured(c){ const w = this.armies.woundedWhole(c, this.now()); this.push(c.playerId, 'server.InjuredTroopUpdate', { castleId: c.id, goldNeed: this.armies.cureCost(w), troop: this.beans.troop({ troops: w }) }); }
  pushPlayerInfo(p){
    const t = this.online.get(p.id)?.tracking;
    if (t?.flushed && t.sentCoins === (p.coins || 0)) return;
    this.push(p.id, 'server.PlayerInfoUpdate', { playerInfo: this.beans.playerInfo(p, this.castlesOf(p)) });
  }
  pushItems(p, ids){
    const t = this.online.get(p.id)?.tracking;
    const send = t?.flushed ? ids.filter(id => t.sent[id] !== (p.items?.[id] || 0)) : ids;
    if (send.length) this.push(p.id, 'server.ItemUpdate', { items: send.map(id => this.items.itemBean(p, id)) });
  }
  // updateType: 0 add, 1 delete, 2 update. Only ever update or delete a hero the client already has.
  pushHero(c, h, updateType){ this.push(c.playerId, 'server.HeroUpdate', { castleId: c.id, updateType, hero: this.heroes.bean(h) }); }
  pushArmies(p){ this.push(p.id, 'server.SelfArmysUpdate', { armys: this.armies.beans(p) }); }
  // Other lords' armies on their way to p's cities (the Beacon Tower's warning; the Report window's Enemy tab).
  pushFriends(p){ if (p) this.push(p.id, 'server.FriendArmysUpdate', { armys: this.armies.friends(p) }); }
  pushEnemies(p){ if (p) this.push(p.id, 'server.EnemyArmysUpdate', { armys: this.armies.enemies(p) }); }
  // The lord whose city or valley an army is heading for, if it's someone else's.
  targetLord(a){ const c = this.armies.targetCity(a), q = c && this.db.players[c.playerId]; return q && q.id !== a.playerId ? q : null; }
  // Buffs that changed: added if the client didn't have them yet (`had`: ids active before), else updated.
  pushBuffs(p, had = new Set(), now = this.now()){
    for (const b of this.items.buffBeans(p, now)) this.push(p.id, 'server.PlayerBuffUpdate', { buffBean: b, updateType: had.has(b.typeId) ? 2 : 0 });
  }
  activeBuffs(p, now = this.now()){ return new Set(this.items.buffBeans(p, now).map(b => b.typeId)); }
  pushCastle(c, updateType = 2){ this.push(c.playerId, 'server.CastleUpdate', { updateType, castleBean: this.beans.castle(c, this.playerOf(c)) }); }

  // ---------- accounts ----------
  createPlayer(account, opts = {}){
    const now = this.now(), p = {
      id: this.store.id(), account: account.name, name: opts.userName || account.name, sex: opts.sex || 0,
      faceUrl: opts.faceUrl || (opts.sex ? 'images/icon/player/faceB1.jpg' : 'images/icon/player/faceA8.jpg'), flag: (opts.flag || account.name.slice(0, 1)).slice(0, 3),
      createdAt: now, lastLoginAt: now, prestige: 0, coins: this.rules.startCoins, techs: {}, items: {}, buffs: {}, research: null, castles: [],
      prestigeBackfill: 1, starterPacks: 1,
    };
    for (const id of STARTER_PACKS) p.items[id] = 1;
    this.db.players[p.id] = p;
    // The client always asks for "City Name" (EvonyClient's createNewPlayer), and the live game keeps it.
    const c = this.createCastle(p, { name: opts.castleName || 'City Name', now });
    account.playerId = p.id;
    this.store.touch();
    this.log.info(`New lord ${p.name} founded ${c.name} at (${world.xy(c.fieldId).x}, ${world.xy(c.fieldId).y})`);
    return p;
  }
  // A new city for a lord on a free flat tile, with the starting buildings and resources.
  // `start` overrides the first city's starting state (rules.start), as a city built on a flat does.
  createCastle(p, { name, now = this.now(), fieldId = world.findHome(this.store), start = {} } = {}){
    const r = { ...this.rules.start, ...start };
    const c = {
      id: this.store.id(), playerId: p.id, name: name || this.rules.newCityName || 'new', fieldId, icon: 0, createdAt: now, flatLevel: this.spotLevel(fieldId, now),
      res: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, ...r.resources }, resAt: now, pop: r.population, taxRate: r.taxRate, buildings: {}, troops: {}, forts: {}, trainQ: {}, heroes: [], valleys: [], fortQ: [],
    };
    if (r.productionRate != null){ const k = r.productionRate; c.commence = { food: k, wood: k, stone: k, iron: k }; }
    for (const [pos, [typeId, level]] of Object.entries(r.buildings)) c.buildings[pos] = { typeId, level, status: STATUS.NORMAL, startTime: 0, endTime: 0 };
    c.pop = Math.min(c.pop, this.logic.popTarget(c));   // no more than the tax rate lets it hold
    p.castles.push(c.id);
    this.db.castles[c.id] = c;
    this.db.tiles[fieldId] = { type: world.T.CASTLE, level: 1, castleId: c.id, playerId: p.id };
    this.store.touch();
    return c;
  }
  // The level of the spot a city is founded or lands on (a flat's, or a barbarian city's), kept for when it is given up.
  spotLevel(id, now = this.now()){ const t = world.tileAt(this.store, id, now); return Math.max(1, Math.min(10, t.level || 1)); }
  // The client sends SHA1(password) on login and "SHA1=MD5" on register.
  pwdHash(pwd){ return String(pwd).split('=')[0].toLowerCase(); }
  login(conn, user, pwd){
    const name = String(user || '').trim();
    if (!name) return this.fail(conn, 'server.LoginResponse', LOGIN.BAD_USER, 'Enter an account name.');
    let account = this.db.accounts[name.toLowerCase()];
    if (!account){
      // Local server: the first login with a new name creates the account.
      account = this.db.accounts[name.toLowerCase()] = { name, pwd: this.pwdHash(pwd), createdAt: this.now(), playerId: null };
      this.store.touch();
      this.log.info(`Created account ${name}`);
    } else if (account.pwd !== this.pwdHash(pwd)){
      return this.fail(conn, 'server.LoginResponse', LOGIN.BAD_USER, 'Wrong password for that account.');
    }
    const p = account.playerId ? this.db.players[account.playerId] : this.createPlayer(account);
    // On vacation (account.js): the client shows its Holiday window with the time left, and may call it off.
    if (this.account.vacation(p, this.now())){
      conn.holidayPlayer = p;
      return conn.send('server.LoginResponse', { ok: -100, packageId: 0, msg: this.account.vacationNote(p, this.now()), errorMsg: 'You are on vacation.' });
    }
    const old = this.online.get(p.id);
    if (old && old !== conn){ old.send('gameClient.kickout', { msg: 'You logged in from somewhere else.' }); old.close(); }
    conn.player = p; this.online.set(p.id, conn);
    p.lastLoginAt = this.now();
    const castles = this.castlesOf(p);
    this.colonies.tick(this.now());
    this.moveArmies(this.now());
    for (const c of castles){ this.completeDue(c, false); this.logic.settle(c, p, this.now()); }
    this.store.touch();
    this.log.info(`${p.name} logged in from ${conn.ip}`);
    this.hungerShown.set(p.id, !!this.hungryCity(p, this.now()));   // the login bean carries the hungry icon
    this.effort.check(p, this.now(), false);
    this.reply(conn, 'server.LoginResponse', { player: this.beans.player(p, castles, this.now()) });
  }
  disconnect(conn){
    if (conn.player && this.online.get(conn.player.id) === conn){ this.online.delete(conn.player.id); this.log.info(`${conn.player.name} disconnected`); }
  }

  // ---------- timers ----------
  completeDue(c, notify = true){
    const p = this.playerOf(c), now = this.now();
    const changed = this.logic.completeDue(c, p, now);
    for (const pos of changed){ if (notify) this.pushBuilding(c, pos); this.logic.removeEmpty(c, pos); }
    // Building queues: the next queued building starts once a builder is free (when catching up, it may finish too).
    for (let i = 0; i < 20 && this.buildQueue.advance(c, p, now, notify); i++){
      const more = this.logic.completeDue(c, p, now);
      for (const pos of more){ if (notify) this.pushBuilding(c, pos); this.logic.removeEmpty(c, pos); }
      changed.push(...more);
      if (!more.length) break;
    }
    const trained = this.troops.completeDue(c, now);
    if (trained && notify) this.pushTroops(c);
    if (this.forts.completeDue(c, now)){ this.store.touch(); if (notify) this.push(c.playerId, 'server.FortificationsUpdate', { castleId: c.id, fortification: this.beans.forts(c) }); }
    const gr = this.equipment.completeDue(p, now);
    if (gr){
      this.push(p.id, 'server.EquipmentResearchCompleteUpdate', { castleId: gr.castleId, typeId: gr.type, level: gr.level });
      for (const pc of this.castlesOf(p)) for (const h of this.heroes.list(pc)) if (h.gear && Object.keys(h.gear).length) this.pushHero(pc, h, 2);
      this.store.touch();
    }
    const r = this.research.completeDue(p, now);
    if (r) p.prestige = (p.prestige || 0) + this.quests.prestigeFor(this.data.techs[r.techId]?.levels[r.level - 1], 1, p);
    if (r){
      this.push(p.id, 'server.ResearchCompleteUpdate', { castleId: r.castleId, typeId: r.techId, level: r.level });
      const rc = this.db.castles[r.castleId];
      if (rc) this.push(p.id, 'server.AcademyResearchUpdate', { castleId: rc.id, researchBean: this.research.bean(rc, p, r.techId) });
    }
    if (changed.length || trained || r){ this.store.touch(); if (notify) this.pushResources(c); }
  }
  nextDue(c){ const p = this.playerOf(c); return Math.min(this.logic.nextDue(c), this.buildQueue.due(c), this.troops.nextDue(c), this.forts.nextDue(c), p?.research ? p.research.endTime : Infinity, p?.gearResearch ? p.gearResearch.endTime : Infinity); }
  tick(){
    const now = this.now();
    for (const c of Object.values(this.db.castles)) if (this.nextDue(c) <= now) this.completeDue(c, true);
    this.war.tick(now);
    this.account.tick(now);
    this.colonies.tick(now);
    this.moveArmies(now);
    this.market.tick(now);
    // Population, production and prestige grow on their own: look for newly finished quests now and then.
    if (now - (this.lastQuestScan || 0) > 20000){
      this.lastQuestScan = now;
      try { this.fame.roll(now); this.fame.checkAll(now); } catch (e){ this.log.error(`fame: ${e.stack || e.message}`); }
      for (const id of this.online.keys()){
        const p = this.db.players[id]; if (!p) continue;
        try { this.questNotice(p); } catch (e){ this.log.error(`quest check: ${e.message}`); }
        try { for (const c of this.castlesOf(p)) this.logic.settle(c, p, now); this.pushHunger(p, now); } catch (e){ this.log.error(`hunger check: ${e.message}`); }
        try { this.effort.check(p, now); } catch (e){ this.log.error(`achievements: ${e.stack || e.message}`); }
      }
    }
  }
  // Armies that reached their target or came home. Arrivals are processed in time order.
  moveArmies(now){
    this.armies.checkGuests(now);   // (allied troops whose stay is over)
    // Armies stationed in a city they are colonizing (direction STAY) wait for colonies.tick.
    const due = Object.values(this.db.armies || {}).filter(a => a.reachTime <= now && a.direction !== DIR.STAY).sort((x, y) => x.reachTime - y.reachTime);
    for (const a of due){
      if (this.db.armies[a.id] !== a || a.reachTime > now || a.direction === DIR.STAY) continue;
      const p = this.db.players[a.playerId];
      try {
        const c = this.db.castles[a.castleId];
        if (c) this.logic.settle(c, p, a.reachTime);
        if (a.direction === DIR.BACK){
          const r = this.armies.home(a);
          if (r){ this.pushTroops(r.c); this.pushResources(r.c); if (r.hero) this.pushHero(r.c, r.hero, 2); }
        } else {
          const hero = c ? this.heroes.find(c, a.heroId) : null, foe = this.armies.hostile(a) ? this.targetLord(a) : null;
          this.armies.arrive(a, a.reachTime);
          if (foe) this.pushEnemies(foe);
          // (The hero may have been captured, or moved to a conquered city, meanwhile.)
          if (hero && c && this.heroes.find(c, hero.id)) this.pushHero(c, hero, 2);
          if (c) this.pushResources(c);
        }
      } catch (e){
        this.log.error(`army ${a.id}: ${e.stack || e.message}`);
        if (this.db.armies[a.id] && this.db.armies[a.id].reachTime <= now) this.armies.home(a);
      }
      this.store.touch();
      if (p) this.pushArmies(p);
    }
  }

  // ---------- dispatch ----------
  handle(conn, cmd, data){
    const h = this.handlers[cmd];
    const open = cmd === 'gameClient.version' || cmd === 'login' || cmd === 'register' || cmd.startsWith('login.') || (cmd === 'furlough.cancelFurlought' && conn.holidayPlayer);
    if (!open && !conn.player) return this.fail(conn, cmd, -1, 'Please log in first.');
    const p = conn.player;
    // "Once Vacation mode is activated, no operation of the game is allowed" (the client reloads the page after it).
    const isRead = v => READ_VERB.test(v) || IS_VERB.test(v);
    if (p && cmd !== 'furlough.cancelFurlought' && !isRead(cmd.split('.').pop()) && this.account.vacation(p, this.now())) return this.fail(conn, cmd, -1, 'You are on vacation: no operation of the game is allowed.');
    conn.tracking = p ? { cmd, data, items: { ...(p.items || {}) }, coins: p.coins || 0, sent: {}, flushed: false } : null;
    try {
      if (h) return h(conn, data || {}, cmd);
      return this.unhandled(conn, cmd, data);
    } catch (e){
      this.log.error(`${cmd} failed: ${e.stack || e.message}`);
      this.fail(conn, cmd, -1, 'The server hit an error handling that. Check the server window for details.');
    } finally {
      conn.tracking = null;
      // Anything that changes the game may finish a quest; reads and polls can't.
      if (p && h && !isRead(cmd.split('.').pop())){
        try { this.questNotice(p, this.castleFor(conn, data?.castleId)); } catch (e){ this.log.error(`quest check after ${cmd}: ${e.stack || e.message}`); }
      }
    }
  }
  unhandled(conn, cmd, data){
    // Logged once per command per run, so polling requests don't flood the file.
    if (!this.seenUnhandled.has(cmd)){
      this.seenUnhandled.add(cmd);
      this.log.warn(`Not implemented yet: ${cmd} ${JSON.stringify(data)?.slice(0, 300)}`);
      try { fs.appendFileSync(this.unhandledFile, JSON.stringify({ at: new Date().toISOString(), cmd, data }) + '\n'); } catch (e){}
    }
    const verb = cmd.split('.').pop();
    if (HARMLESS.has(cmd) || READ_VERB.test(verb) || IS_VERB.test(verb)) return this.reply(conn, cmd, this.emptyReply(cmd));
    this.fail(conn, cmd, -1, `This server doesn't support that yet (${cmd}).`);
  }
  // An empty but well-formed reply: every array the reply type declares is present and empty.
  emptyReply(cmd){
    const bean = this.protocol.replies[cmd]; const fields = bean && this.protocol.beans[bean]?.fields || {};
    const out = {};
    for (const [k, f] of Object.entries(fields)) if (f.array) out[k] = [];
    return out;
  }

  // ---------- local web pages ----------
  // "Get More Coins" in the client opens <addFund>&user=NAME. On this server that page is a small
  // owner's panel: add coins, or fill every city's resources. Turn it off with coinsPage: false.
  coinsPage(query){
    const esc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
    const n = v => Math.floor(v).toLocaleString('en-US');
    const name = String(query.get('user') || '');
    const acct = this.db.accounts[name.toLowerCase()], p = acct?.playerId ? this.db.players[acct.playerId] : null;
    let note = '';
    const eq = this.equipment, techIds = Object.keys(this.data.techs).map(Number), gearTypes = eq.types();
    if (p && this.rules.coinsPage){
      const add = Math.floor(Number(query.get('add')));
      if (add > 0 && add <= 100000000){
        p.coins = (p.coins || 0) + add; this.store.touch(); this.pushPlayerInfo(p);
        note = `<p class="ok">Added ${n(add)} coins. They're already in your wallet in the game.</p>`;
        this.log.info(`Owner page: added ${add} coins to ${p.name}`);
      }
      // Items: "give" is an item id or name from the client's item table.
      const giveRaw = String(query.get('give') || '').trim();
      if (giveRaw){
        const n = Math.max(1, Math.min(9999, Math.floor(Number(query.get('n')) || 1)));
        const low = giveRaw.toLowerCase(), all = Object.values(this.data.items).filter(i => !/^hero\.taskitem\./.test(i.id));
        const it = this.data.items[giveRaw] || all.find(i => i.name.trim().toLowerCase() === low) || all.find(i => i.name.toLowerCase().includes(low));
        if (it){
          this.items.add(p, it.id, n); this.store.touch(); this.pushItems(p, [it.id]);
          note = `<p class="ok">Added ${n} x ${esc(it.name)} (${esc(it.id)}). Find it under Items in the game.</p>`;
          this.log.info(`Owner page: gave ${p.name} ${n} x ${it.name}`);
        } else note = `<p class="bad">No item called "${esc(giveRaw)}".</p>`;
      }
      // Troops: "troop" is a troop's field name or "all", "tn" how many, "city" the city (any of his).
      const troopRaw = String(query.get('troop') || '').trim();
      if (troopRaw){
        const tn = Math.floor(Number(query.get('tn')) || 0), cs = this.castlesOf(p), c = cs.find(x => x.id === Number(query.get('city'))) || cs[0];
        const kinds = troopRaw === 'all' ? Object.values(this.data.troops) : Object.values(this.data.troops).filter(t => t.field === troopRaw);
        if (!c || !kinds.length || !(tn > 0 && tn <= 100000000)) note = '<p class="bad">Pick a city, a kind of troop and an amount from 1 to 100,000,000.</p>';
        else {
          for (const t of kinds) c.troops[t.field] = (c.troops[t.field] || 0) + tn;
          this.store.touch(); this.pushTroops(c);
          const what = troopRaw === 'all' ? 'of every kind of troop' : esc(kinds[0].name);
          note = `<p class="ok">Added ${n(tn)} ${what} to ${esc(c.name)}. They're already in the city in the game.</p>`;
          this.log.info(`Owner page: gave ${p.name} ${tn} ${troopRaw} in ${c.name}`);
        }
      }
      // Research and gear: "tech" (a research id or "all") to level "tl" 0-10; "gear" (a gear technology or "all")
      // to level "gl" 0-10; "star" (a gear technology or "all") to "sl" 0-15 stars, at most its level + 6 as in the
      // game. Gear levels are set before stars, so one link can max everything.
      const pick = (raw, all) => raw === 'all' ? all : all.filter(x => x === Number(raw));
      const said = [], changed = { tech: false, gear: false };
      const techRaw = String(query.get('tech') || '').trim();
      if (techRaw){
        const L = Math.floor(Number(query.get('tl'))), ids = pick(techRaw, techIds);
        if (!ids.length || !(L >= 0 && L <= 10)) said.push('<p class="bad">Pick a research topic and a level from 0 to 10.</p>');
        else {
          p.techs = p.techs || {};
          for (const id of ids){ if (L) p.techs[id] = L; else delete p.techs[id]; }
          if (p.research && ids.includes(p.research.techId) && p.research.level <= L) p.research = null;
          changed.tech = true;
          said.push(`<p class="ok">${ids.length > 1 ? 'All research' : esc(this.data.techs[ids[0]].name.trim())} is now level ${L}. Reopen the Academy to see it.</p>`);
          this.log.info(`Owner page: set ${p.name}'s research ${techRaw} to ${L}`);
        }
      }
      const gearRaw = String(query.get('gear') || '').trim();
      if (gearRaw){
        const L = Math.floor(Number(query.get('gl'))), types = pick(gearRaw, gearTypes);
        if (!types.length || !(L >= 0 && L <= 10)) said.push('<p class="bad">Pick a gear technology and a level from 0 to 10.</p>');
        else {
          for (const t of types){ const st = eq.state(p, t); st.lv = L; st.star = L ? Math.min(st.star, L + 6) : 0; }
          if (p.gearResearch && types.includes(p.gearResearch.type) && p.gearResearch.level <= L) p.gearResearch = null;
          changed.gear = true;
          said.push(`<p class="ok">${types.length > 1 ? 'All gear technologies are' : esc(eq.techs[types[0]].name) + ' is'} now level ${L}. Reopen the Workshop to see it.</p>`);
          this.log.info(`Owner page: set ${p.name}'s gear ${gearRaw} to level ${L}`);
        }
      }
      const starRaw = String(query.get('star') || '').trim();
      if (starRaw){
        const S = Math.floor(Number(query.get('sl'))), types = pick(starRaw, gearTypes);
        if (!types.length || !(S >= 0 && S <= 15)) said.push('<p class="bad">Pick a gear technology and 0 to 15 stars.</p>');
        else {
          const capped = [], none = [];
          for (const t of types){
            const L = eq.level(p, t);
            if (!L){ if (S) none.push(eq.techs[t].name); continue; }
            const st = eq.state(p, t); st.star = Math.min(S, eq.maxStar(p, t));
            if (st.star < S) capped.push(`${eq.techs[t].name} (level ${L}: at most ${st.star})`);
          }
          changed.gear = true;
          said.push(`<p class="ok">${types.length > 1 ? 'All gear technologies' : esc(eq.techs[types[0]].name)}: ${S} star${S === 1 ? '' : 's'}.</p>`
            + (capped.length ? `<p class="bad">A gear level holds at most its level + 6 stars, so these got fewer: ${capped.map(esc).join(', ')}. Raise their level for more.</p>` : '')
            + (none.length ? `<p class="bad">Not researched yet, so no stars: ${none.map(esc).join(', ')}.</p>` : ''));
          this.log.info(`Owner page: set ${p.name}'s gear ${starRaw} to ${S} stars`);
        }
      }
      if (changed.tech || changed.gear){
        this.store.touch();
        for (const c of this.castlesOf(p)){
          this.pushResources(c);
          if (changed.gear) for (const h of this.heroes.list(c)) this.pushHero(c, h, 2);
        }
      }
      if (said.length) note += said.join('');
      const fill = Math.floor(Number(query.get('fill')));
      if (fill > 0 && fill <= 1000000000){
        const now = this.now();
        for (const c of this.castlesOf(p)){
          this.logic.settle(c, p, now);
          for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) c.res[k] = Math.max(c.res[k], fill);
          this.pushResources(c);
        }
        this.store.touch();
        note = `<p class="ok">Every city now has at least ${n(fill)} food, lumber, stone, iron and gold.</p>`;
        this.log.info(`Owner page: filled ${p.name}'s cities to ${fill}`);
      }
    }
    const link = (q, label) => `<a class="btn" href="?user=${encodeURIComponent(name)}&${q}">${label}</a>`;
    const levels = (max, sel) => Array.from({ length: max + 1 }, (_, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i}</option>`).join('');
    const body = !this.rules.coinsPage ? '<p>This page is turned off on this server (coinsPage in data/rules.json).</p>'
      : !p ? '<p>Open this page from the "Get More Coins" button in the game so it knows your account.</p>'
      : `<p><b>${esc(p.name)}</b> has <b>${n(p.coins || 0)}</b> coins.</p>${note}
         <h2>Coins</h2><p>${[1000, 10000, 100000, 1000000].map(v => link('add=' + v, 'Add ' + n(v))).join(' ')}</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input name="add" type="number" min="1" max="100000000" placeholder="Other amount"> <button class="btn">Add coins</button></form>
         <h2>Resources</h2><p>Raises food, lumber, stone, iron and gold in every city to at least this much. Amounts above a city's storage stay until you spend them.</p>
         <p>${[1000000, 10000000, 100000000].map(v => link('fill=' + v, n(v) + ' each')).join(' ')}</p>
         <h2>Troops</h2><p>Adds troops to one of your cities, straight into its army.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><select name="city">${this.castlesOf(p).map(c => { const { x, y } = world.xy(c.fieldId); return `<option value="${c.id}">${esc(c.name)} (${x},${y})</option>`; }).join('')}</select>
         <select name="troop"><option value="all">Every kind</option>${Object.values(this.data.troops).map(t => `<option value="${esc(t.field)}">${esc(t.name)}</option>`).join('')}</select>
         <input name="tn" type="number" min="1" max="100000000" value="10000" style="width:110px"> <button class="btn">Add troops</button></form>
         <h2>Research</h2><p>Sets research levels at once (they're shared by all your cities). Now: ${techIds.map(id => `${esc(this.data.techs[id].name.trim())} ${p.techs?.[id] || 0}`).join(', ')}.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><select name="tech"><option value="all">All research</option>${techIds.map(id => `<option value="${id}">${esc(this.data.techs[id].name.trim())}</option>`).join('')}</select>
         <select name="tl">${levels(10, 10)}</select> <button class="btn">Set research</button></form>
         <h2>Gear and stars</h2><p>Sets the Workshop's gear technologies and their stars. A level holds at most level + 6 stars, and a hero wears at most one gear level per 10 hero levels.
           Star set: <b>${eq.setStars(p)}</b> (+${eq.setLife(p)}% troop life against NPC and Historic Cities).</p>
         <p>${gearTypes.map(t => `${esc(eq.techs[t].name)} ${eq.level(p, t)}${eq.star(p, t) ? ` (${eq.star(p, t)}★)` : ''}`).join(', ')}.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><select name="gear"><option value="all">All gear</option>${gearTypes.map(t => `<option value="${t}">${esc(eq.techs[t].name)}</option>`).join('')}</select>
         <select name="gl">${levels(10, 10)}</select> <button class="btn">Set gear level</button></form>
         <form><input type="hidden" name="user" value="${esc(name)}"><select name="star"><option value="all">All gear</option>${gearTypes.map(t => `<option value="${t}">${esc(eq.techs[t].name)}</option>`).join('')}</select>
         <select name="sl">${levels(15, 15)}</select> <button class="btn">Set stars</button></form>
         <p>${link('tech=all&tl=10&gear=all&gl=10&star=all&sl=15', 'Max everything (research 10, gear 10, 15 stars)')}</p>
         <h2>Items</h2><p>Puts any item from the client's item table into your inventory, including event chests the shop doesn't sell. Type part of the name.</p>
         <form><input type="hidden" name="user" value="${esc(name)}"><input name="give" list="itemlist" placeholder="Item name" style="width:260px"> <input name="n" type="number" min="1" max="9999" value="1" style="width:70px"> <button class="btn">Give</button>
         <datalist id="itemlist">${[...new Set(Object.values(this.data.items).filter(i => !/^hero\.taskitem\./.test(i.id)).map(i => i.name.trim()))].sort().map(x => `<option value="${esc(x)}">`).join('')}</datalist></form>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debug menu</title><style>body{font:15px Arial,sans-serif;background:#1d1a16;color:#eee;padding:40px;max-width:600px}
      h2{font-size:17px;margin:28px 0 6px;color:#e6c27a}input,select{padding:7px;border-radius:4px;border:1px solid #666;background:#2b2722;color:#eee;width:160px}select{width:auto;margin-right:4px}
      .btn{display:inline-block;background:#b8860b;color:#111;padding:8px 14px;border-radius:4px;text-decoration:none;font-weight:bold;margin:4px 6px 4px 0;border:0;cursor:pointer;font:bold 14px Arial,sans-serif}.ok{color:#9be29b}.bad{color:#f29b9b}</style></head>
      <body><h1>Debug menu</h1><p>This is your local server, so coins, resources, troops, items, research and gear are free here.</p>${body}</body></html>`;
  }
}

module.exports = { Game, CLIENT_VERSION, OK, LOGIN };
