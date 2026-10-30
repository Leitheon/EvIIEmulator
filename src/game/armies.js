'use strict';
// Armies on the march: sending, travel, what happens on arrival, the trip home and recalls.
// Travel time and food use the client's own formula (NewArmyWin): time in seconds = distance x 60,000 /
// slowest speed, where foot troops gain Compass and horses, siege and transporters gain Horseback Riding,
// and a march between your own cities is sped up by the Relief Station; food = 2 x upkeep x troops x hours
// on the road. (Cavalry, speed 1,500, take 40 seconds a tile.)
const world = require('./world');
const { battleXml, scoutXml, REPORT_TYPE, stamp } = require('./reports');
const { HERO_STATUS } = require('./heroes');
const { TYPE, addTroops } = require('./castle');

const MISSION = { TRANS: 1, SEND: 2, SCOUT: 3, CONSTRUCT: 4, OCCUPY: 5, COLONIZE: 7, ANTI_COLONIAL: 10 };
const DIR = { FORWARD: 1, BACK: 2, STAY: 3 };
const FOOT = new Set([2, 3, 4, 5, 6, 7]);           // Compass (marchSkillParam) in the client
const TECH = { COMPASS: 12, HORSE: 13, LOGISTICS: 11, PRIVATEERING: 20, INFORMATICS: 7 };
const VALLEY_RES = { 1: 'wood', 2: 'stone', 3: 'iron', 4: 'food', 5: 'food', 6: 'food' };
const VALLEY_BONUS = { 1: [3, 2], 2: [3, 2], 3: [3, 2], 4: [3, 2], 5: [2, 1], 6: [5, 3] };   // FieldConstants base, rate
const VALLEY_NAME = { 1: 'Forest', 2: 'Desert', 3: 'Hill', 4: 'Swamp', 5: 'Grassland', 6: 'Lake' };
const RES = ['food', 'wood', 'stone', 'iron', 'gold'];
const RELIEF_STATION = [2, 2, 2, 3, 4, 4, 4, 5, 5, 6];

function distance(a, b){
  const p = world.xy(a), q = world.xy(b), S = world.SIZE;
  const dx = Math.min(Math.abs(p.x - q.x), S - Math.abs(p.x - q.x)), dy = Math.min(Math.abs(p.y - q.y), S - Math.abs(p.y - q.y));
  return Math.hypot(dx, dy);
}
const valleyBonus = t => { const [b, r] = VALLEY_BONUS[t.type] || [0, 0]; return b + r * (t.level || 0); };

// The client's Rally Spot factor by power level (FieldConstants: 0 City, 1 Fort, 2 Town, 3 Village, 4 ordinary).
const POWER_FACTOR = { 0: 3, 1: 2, 2: 1.5, 3: 1.25, 4: 1 };

class ArmyLogic {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  list(){ return this.db.armies || (this.db.armies = {}); }
  of(p){ return Object.values(this.list()).filter(a => a.playerId === p.id); }
  fromCastle(c){ return Object.values(this.list()).filter(a => a.castleId === c.id); }

  placeName(id, coords = true){
    const t = world.tileAt(this.g.store, id), { x, y } = world.xy(id);
    let n;
    if (t.type === world.T.CASTLE) n = this.db.castles[t.castleId]?.name || 'City';
    else if (t.historic) n = t.historic.name.replace(/^﻿/, '').trim();
    else if (t.type === world.T.NPC) n = "Barbarian's city";   // as the live server names it in reports
    else if (t.type === world.T.FLAT) n = 'Flat';
    else n = `${VALLEY_NAME[t.type] || 'Valley'} Lv.${t.level}`;
    return coords ? `${n}(${x},${y})` : n;
  }
  // A hero's mount gear adds its speed (in %) on top, as NewArmyWin does: speed x (1 + tech%) x (1 + hero speed%).
  speedOf(troops, p, hero = null){
    const L = this.g.logic, compass = L.techEffect(p, TECH.COMPASS), horse = L.techEffect(p, TECH.HORSE);
    const heroSpeed = hero ? this.g.heroes.gear(hero).speed || 0 : 0;
    let min = Infinity;
    for (const t of Object.values(this.g.data.troops)) if ((troops[t.field] || 0) > 0)
      min = Math.min(min, t.speed * (1 + (FOOT.has(t.id) ? compass : horse) / 100) * (1 + heroSpeed / 100));
    return min === Infinity ? 0 : min;
  }
  travelMs(from, to, troops, p, hero = null, station = 1){
    const s = this.speedOf(troops, p, hero) * station; if (!s) return 0;
    // (whole seconds: live, 37 reinforcements over 1.41 tiles took 28 s, where the formula gives 28.3)
    return Math.max(1000, Math.floor(distance(from, to) * 60000 / s) * 1000 / this.g.logic.speed);
  }
  foodFor(troops, ms){ let f = 0; for (const t of Object.values(this.g.data.troops)) f += (troops[t.field] || 0) * t.upkeep * 2; return Math.ceil(f * ms / 3600000); }
  load(troops, p){ let l = 0; for (const t of Object.values(this.g.data.troops)) l += (troops[t.field] || 0) * t.load; return Math.floor(l * (1 + this.g.logic.techEffect(p, TECH.LOGISTICS) / 100)); }
  rallyLevel(c){ return this.g.logic.level(c, 29); }
  // Relief Station: marches between your own cities go this many times faster (army.getTroopParam).
  stationParam(c){ const L = this.g.logic.level(c, 24); return L ? RELIEF_STATION[L - 1] : 1; }
  // Most troops one army may hold (NewArmyWin): 10,000 a Rally Spot level up to 10, then 15,000 a level; a
  // captured Historic City multiplies the first part by 1.25 (Village), 1.5 (Town), 2 (Fort) or 3 (City), a
  // Haunted or Christmas Castle adds 0.25 to that, and a War Ensign 25% on top of everything.
  troopLimit(c, p, ensign = false, now = Date.now()){
    const L = this.rallyLevel(c), per = this.g.rules.rallyTroopsPerLevel;
    const mult = (POWER_FACTOR[c.powerLevel ?? 4] ?? 1) + (this.g.items.castleThemeActive(p, now) ? 0.25 : 0);
    const base = L <= 10 ? L * per * mult : 10 * per * mult + (L - 10) * (this.g.rules.rallyTroopsPerLevelAbove10 ?? 15000);
    return Math.floor(base * (ensign ? 1.25 : 1));
  }

  // ---------- sending ----------
  send(c, p, bean, now){
    const g = this.g, mission = Number(bean.missionType), target = Number(bean.targetPoint);
    if (!(target >= 0 && target < world.SIZE * world.SIZE)) return [-18, 'That map location does not exist.'];
    if (target === c.fieldId) return [-13, 'Your army is already there.'];
    // (Anti-Colonization marches come only from a commission quest: commission.js.)
    if (![MISSION.TRANS, MISSION.SEND, MISSION.SCOUT, MISSION.CONSTRUCT, MISSION.OCCUPY, MISSION.COLONIZE].includes(mission) && !(mission === MISSION.ANTI_COLONIAL && bean.commission))
      return [-13, "That kind of march isn't supported on this server yet."];
    if (mission === MISSION.CONSTRUCT){ const bad = this.canConstruct(p, world.tileAt(g.store, target, now)); if (bad) return bad; }
    if (mission === MISSION.COLONIZE){ const bad = g.colonies.cantColonize(p, c, world.tileAt(g.store, target, now), now); if (bad) return bad; }
    const rally = this.rallyLevel(c);
    if (!rally) return [-13, 'Build a Rally Spot to send armies.'];
    // Ambush from All Sides: this city's troops can't be deployed for 2 hours (stratagems.js).
    if (g.stratagems.ambushed(c, now)) return [-13, 'This city is under Ambush from All Sides: its troops cannot be deployed for now. Advance by A Hidden Path lifts it.'];
    if (this.fromCastle(c).length >= rally * g.rules.rallyArmiesPerLevel) return [-13, `Your level ${rally} Rally Spot can have ${rally * g.rules.rallyArmiesPerLevel} army out at a time.`];
    const troops = {}; let count = 0;
    for (const t of Object.values(g.data.troops)){
      const n = Math.floor(Number(bean.troops?.[t.field]) || 0);
      if (n < 0) return [-29, 'Troop numbers cannot be negative.'];
      if (n > (c.troops[t.field] || 0)) return [-29, `You only have ${c.troops[t.field] || 0} ${t.name} at home.`];
      if (n){ troops[t.field] = n; count += n; }
    }
    if (!count) return [-27, 'Choose at least one soldier.'];
    // The march window's two boxes (NewArmyWin): useFlag, the War Ensign ("increase personnel limit 25%"), and
    // useItem, Stygandr's Banner of the Horde (the client's limit x 10). The cheapest ticked choice that fits the
    // army is used up; nothing is used when the Rally Spot's own limit is enough.
    const tick = v => v === true || v === 'true' || v === 1;
    const owned = id => (p.items?.[id] || 0) > 0, ENSIGN = 'player.troop.1.a', BANNER = 'player.item.stygandrsbannerofthehorde';
    const base = this.troopLimit(c, p, false, now), withE = this.troopLimit(c, p, true, now), hordeX = g.rules.hordeBannerFactor ?? 10;
    const choices = [[[], base], [[ENSIGN], withE], [[BANNER], base * hordeX], [[ENSIGN, BANNER], withE * hordeX]]
      .filter(([ids]) => ids.every(id => id === ENSIGN ? tick(bean.useFlag) : tick(bean.useItem)));
    const pick = choices.find(([, lim]) => count <= lim);
    if (!pick){
      const [ids, most] = choices[choices.length - 1];
      return [-13, `Your level ${rally} Rally Spot can send at most ${most.toLocaleString('en-US')} troops in one army${ids.length ? ' with ' + ids.map(id => g.items.name(id)).join(' and ') : ''}.`];
    }
    const missing = pick[0].find(id => !owned(id));
    if (missing) return [-44, `Sending more than ${base.toLocaleString('en-US')} troops this way needs ${g.items.name(missing)}.`];
    const useUp = pick[0];
    if (mission === MISSION.SCOUT && Object.keys(troops).some(k => k !== 'scouter')) return [-13, 'Only Scouts can go scouting.'];
    // Fox (live): a lord under Beginner's Protection can't be scouted (war.js).
    if (mission === MISSION.SCOUT){
      const tt = world.tileAt(g.store, target), sc = tt.type === world.T.CASTLE ? this.db.castles[tt.castleId] : null, sq = sc && this.db.players[sc.playerId];
      if (sq && sq.id !== p.id && g.war.beginner(sq, now)) return [-13, `${sq.name} is under Beginner's Protection and can't be scouted.`];
      if (sq && sq.id !== p.id && g.war.vacation(sq, now)) return [-13, `${sq.name} is on vacation and can't be scouted.`];
    }
    let hero = null;
    const heroId = Number(bean.heroId);
    if (heroId > 0){
      hero = g.heroes.find(c, heroId);
      if (!hero) return [-1, 'That hero is not in this city.'];
      if (hero.status === HERO_STATUS.CHIEF) return [-1, `${hero.name} is the mayor. Relieve them before sending them out.`];
      if (hero.status === HERO_STATUS.SEIZED) return [-1, `${hero.name} is a captive. Persuade the hero first.`];
      if (hero.status !== HERO_STATUS.FREE) return [-1, `${hero.name} is busy.`];
    } else if (mission === MISSION.OCCUPY || mission === MISSION.COLONIZE) return [-13, `${mission === MISSION.COLONIZE ? 'Colonizing' : 'An attack'} needs a hero to lead it.`];
    const tile = world.tileAt(g.store, target);
    if (mission === MISSION.TRANS || mission === MISSION.SEND){
      if (tile.type !== world.T.CASTLE) return [-13, 'Transports and reinforcements can only go to a city.'];
      // Send to another lord's city only reinforces a colonization of it (the troops stay there with the
      // colonizing army until the Stabilization battle).
      const dest = this.db.castles[tile.castleId];
      // Or stations them in an ally's city (allied troops: the Embassy).
      if (mission === MISSION.SEND && dest?.playerId !== p.id && !(dest && g.colonies.canReinforce(p, dest))){ const why = this.cantStation(p, dest); if (why) return why; }
    }
    if (mission === MISSION.OCCUPY && tile.type === world.T.FLAT && !g.rules.flatsConquerable) return [-13, 'There is nothing to attack there.'];
    if (mission === MISSION.OCCUPY && tile.type === world.T.CASTLE && this.db.castles[tile.castleId]?.playerId === p.id) return [-13, 'You cannot attack your own city.'];
    // A Protectorate is attacked only to suppress an uprising.
    const held = mission === MISSION.OCCUPY && tile.type === world.T.CASTLE ? g.colonies.ofColony(this.db.castles[tile.castleId]) : null;
    if (held && held.suzerainPlayerId === p.id && [2, 4].includes(held.status)) return [-13, 'That city is your Protectorate. Attack it only to suppress an uprising.'];
    // War (war.js): a lord's ordinary city can be attacked only in wartime.
    if (mission === MISSION.OCCUPY && tile.type === world.T.CASTLE){
      const bad = g.war.cantAttack(p, this.db.castles[tile.castleId], now, { suppress: !!(held && held.suzerainPlayerId === p.id && held.status === 3) });
      if (bad) return bad;
    }
    if ((mission === MISSION.OCCUPY || mission === MISSION.SCOUT || mission === MISSION.COLONIZE) && tile.type === world.T.CASTLE && this.db.castles[tile.castleId]?.playerId !== p.id && g.war.truce(p, now)) return [-13, "You're under a Truce Agreement and can't attack other lords until it ends."];
    if (mission === MISSION.OCCUPY && tile.ownerCastle && this.db.castles[tile.ownerCastle]?.playerId === p.id) return [-13, 'That valley is already yours.'];
    const carry = {};
    if (mission === MISSION.CONSTRUCT){
      if ((troops.peasants || 0) < g.rules.buildCity.workers) return [-29, `Building a city takes ${g.rules.buildCity.workers} Workers.`];
      // The building materials go along with the workers and are used up when the city goes up.
      const cost = this.g.rules.buildCity.cost;
      for (const k of RES) if ((cost[k] || 0) > c.res[k]) return [-1, `Building a city takes ${this.costText(cost)}. This city is short of ${k === 'wood' ? 'lumber' : k}.`];
      for (const k of RES) if (cost[k]) carry[k] = cost[k];
    }
    if (mission === MISSION.TRANS || mission === MISSION.SEND){
      let total = 0;
      for (const k of RES){ const v = Math.max(0, Math.floor(Number(bean.resource?.[k]) || 0)); if (v > c.res[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k} to send.`]; if (v){ carry[k] = v; total += v; } }
      if (total > this.load(troops, p)) return [-13, 'Your troops cannot carry that much.'];
    }
    const destLord = tile.type === world.T.CASTLE ? this.db.players[this.db.castles[tile.castleId]?.playerId] : null;
    const own = !!destLord && (destLord.id === p.id || g.alliances.same(p, destLord));   // (an ally's city too: the march window)
    // (Fleet Feet on the lord speeds it up; Lost in the Wastes on the city slows it down: charms.js.)
    const ms = Math.round(this.travelMs(c.fieldId, target, troops, p, hero, own ? this.stationParam(c) : 1) * (g.charms ? g.charms.marchFactor(p, c, now) : 1));
    // Camp time (the march window's hours and minutes, up to 24 hours; Fox: live): the army waits at home that long
    // before it marches, eating the city's food meanwhile, so the window adds an hour's upkeep for each hour of it to
    // the food the march needs.
    const campS = Math.min(24 * 3600, Math.max(0, Math.floor(Number(bean.restTime) || 0)));
    const campFood = Math.ceil(this.upkeepOf(troops) * campS / 3600);
    const food = this.foodFor(troops, ms) + campFood;
    if (c.res.food - (carry.food || 0) < food) return [-1, `This march needs ${food.toLocaleString('en-US')} food for the road.`];
    // All good: take the troops, food, cargo and hero out of the city.
    for (const [k, n] of Object.entries(troops)) c.troops[k] -= n;
    for (const [k, v] of Object.entries(carry)) c.res[k] -= v;
    c.res.food -= food;
    for (const id of useUp) p.items[id] -= 1;
    if (hero) hero.status = HERO_STATUS.SENT;
    p.armySeq = (p.armySeq || 0) + 1;
    const id = g.store.id();
    const a = { id, playerId: p.id, castleId: c.id, heroId: hero ? hero.id : 0, mission, from: c.fieldId, target, troops, carry, loot: null,
      startTime: now, reachTime: now + campS * 1000 + ms, oneWay: ms, direction: DIR.FORWARD, restTime: campS };
    if (campS){ a.campUntil = now + campS * 1000; a.campFood = campFood; }
    // The march window asks whether the troops come home once the city is built or stay to guard it.
    if (mission === MISSION.CONSTRUCT) a.backAfter = bean.backAfterConstruct !== false && bean.backAfterConstruct !== 'false';
    this.list()[id] = a;
    g.effort.note(p, 'miles', distance(c.fieldId, target));   // (achievements: Marching)
    return { army: a, hero, usedItems: useUp };
  }

  // ---------- building a new city ----------
  // A city goes up on a flat one of your cities holds (conquered with an attack), sent from any of your cities with
  // 250 Workers and 10,000 of each resource (rules.buildCity), as long as your title has a free city slot: Civilian
  // 1 city, Knight 2 ... Prinzessin 10. A city already on its way counts against the slots. The materials are used
  // up and the workers become the new city's.
  canConstruct(p, tile, troops = null, self = null){
    const g = this.g, rule = g.rules.buildCity, marches = Object.values(this.list()).filter(x => x !== self && x.mission === MISSION.CONSTRUCT && x.direction === DIR.FORWARD);
    if (!rule || rule.enabled === false) return [-13, "Building new cities isn't turned on on this server."];
    if (tile.type !== world.T.FLAT) return [-13, 'New cities can only be built on a flat.'];
    if (!tile.ownerCastle || this.db.castles[tile.ownerCastle]?.playerId !== p.id) return [-13, 'Conquer this flat first: attack it, then build your city on it.'];
    if (marches.some(x => x.target === tile.id)) return [-13, 'Your new city is being built now.'];
    const pending = marches.filter(x => x.playerId === p.id).length;
    const max = g.quests.maxCities(p), have = p.castles.length + pending;
    if (have >= max) return [-13, have >= (g.rules.maxCities || 10) ? `You already rule ${p.castles.length} cities${pending ? ` with ${pending} more on the way` : ''}, the most a lord can hold.`
      : `As ${/^[AEIOU]/.test(g.quests.titleName(p)) ? 'an' : 'a'} ${g.quests.titleName(p)} you can rule ${max} ${max === 1 ? 'city' : 'cities'}${pending ? ` (${pending} already on the way)` : ''}. Earn the next title (Quests, Title) to found another.`];
    if (troops && (troops.peasants || 0) < rule.workers) return [-29, `Building a city takes ${rule.workers} Workers.`];
    return null;
  }
  costText(cost){ return RES.filter(k => cost[k]).map(k => `${cost[k].toLocaleString('en-US')} ${k === 'wood' ? 'lumber' : k}`).join(', '); }
  // On arrival everything is checked again: the flat may have been lost, or a city founded some other way, meanwhile.
  construct(a, p, c, tile, report, now){
    const g = this.g;
    const bad = p && this.canConstruct(p, tile, a.troops, a);
    if (!p || bad){
      // Nothing is built: the workers bring the materials home.
      if (p) report(p, { type: REPORT_TYPE.OTHER, title: `Couldn't build a city at ${this.placeName(a.target)}`, content: `${bad ? bad[1] : ''} The workers are bringing the materials home.` });
      return false;
    }
    const owner = this.db.castles[tile.ownerCastle];
    owner.valleys = (owner.valleys || []).filter(v => v !== tile.id);
    g.push(owner.playerId, 'server.CastleFieldUpdate', { castleId: owner.id, updateType: 1, bean: this.fieldBean(tile) });
    if (owner !== c) g.pushResources(owner);
    delete this.db.tiles[tile.id];
    const rule = g.rules.buildCity;
    const nc = g.createCastle(p, { fieldId: tile.id, now, start: rule.start || {} });
    a.carry = {};
    // The workers stay on in the new city (live: it starts with the 250 Workers sent); other troops follow the
    // march window's choice.
    const move = (k, n) => { if (n > 0){ nc.troops[k] = addTroops(nc.troops[k], n); a.troops[k] -= n; } };
    move('peasants', Math.min(rule.workers, a.troops.peasants || 0));
    if (!a.backAfter) for (const [k, n] of Object.entries(a.troops)) move(k, n);
    const left = Object.values(a.troops).some(n => n > 0);
    g.store.touch();
    g.pushCastle(nc, 0); g.pushPlayerInfo(p);
    const { x, y } = world.xy(tile.id);
    report(p, { type: REPORT_TYPE.OTHER, title: `New city founded at (${x},${y})`, content: `${nc.name} was built on the flat at (${x},${y}). The workers stayed on to work there.${left ? ' The other troops are heading home.' : ''}` });
    g.log.info(`${p.name} founded ${nc.name} at (${x},${y})`);
    return !left;
  }

  // ---------- recall ----------
  // force: a compulsory recall (Besiege Enemy's Fort to Rescue Ally's City), which Bolt the Door doesn't stop.
  recall(p, armyId, now, force = false){
    const a = this.list()[armyId], host = a?.stationedAt ? this.db.castles[a.stationedAt] : null;
    // (the lord whose city allied troops are stationed in can send them home: the Embassy's Send Back)
    if (!a || (a.playerId !== p.id && !(host && host.playerId === p.id))) return [-23, 'That army has already returned.'];
    if (a.direction === DIR.BACK) return [-14, 'That army is already on its way home.'];
    if (this.g.commission?.locked(a)) return [-14, 'Mercenaries on a commission quest can only be called back by giving up the quest (Quests, Commission).'];
    if (!force && a.bolted && a.direction === DIR.FORWARD) return [-14, 'Bolt the Door to Catch the Thief: these troops cannot be recalled until they finish the attack. Cicada Sheds Its Skin lifts it.'];
    // An army stationed in a city it is colonizing marches the whole way home (and the colonization fails if it
    // was the last one there; colonies.tick).
    if (a.direction === DIR.STAY){ const sentBack = !!host && a.playerId !== p.id; this.sendHome(a, now); return { army: a, sentBack, host }; }
    // Still in camp at home: it never left, so it is back at once, with the food for the camp time it didn't use.
    if (a.direction === DIR.FORWARD && (a.campUntil || 0) > now){
      const c = this.db.castles[a.castleId], left = Math.floor((a.campFood || 0) * (a.campUntil - now) / (a.restTime * 1000 || 1));
      if (c && left > 0){ c.res.food += left; this.g.pushResources(c); }
      delete a.campUntil; delete a.campFood;
      Object.assign(a, { direction: DIR.BACK, startTime: now, reachTime: now });
      return { army: a };
    }
    const gone = Math.max(1000, now - a.startTime);
    Object.assign(a, { direction: DIR.BACK, startTime: now, reachTime: now + this.homeMs(a, Math.min(gone, a.oneWay)) });
    return { army: a };
  }
  // ---------- allied troops in an ally's city ----------
  // The Embassy: "Level N Embassy allows N alliance troops to be garrisoned", and its "Allied Garrison Troops"
  // ("Allows troops of allied members to garrison your current city."). They stay until recalled or sent home, the
  // city feeding them meanwhile (Fox: live; the Embassy shows how long they have been there). They defend the city
  // with its own troops, and go home when their lord or the city's lord calls them back, the city changes hands,
  // or the two lords' alliance parts.
  guests(c){ return Object.values(this.list()).filter(a => a.direction === DIR.STAY && a.stationedAt === c.id); }
  guestsComing(c){ return Object.values(this.list()).filter(a => a.direction === DIR.FORWARD && a.mission === MISSION.SEND && a.playerId !== c.playerId && this.targetCity(a) === c); }
  cantStation(p, dc, self = null){
    const g = this.g, q = dc ? this.db.players[dc.playerId] : null;
    if (!dc || !q) return [-13, 'That city is gone.'];
    if (!g.alliances.same(p, q)) return [-13, "Reinforcements can go to your own cities and your alliance's: you and that lord aren't in the same alliance."];
    if (dc.allowAlliance === false) return [-13, `${q.name} doesn't allow allied troops in ${dc.name}.`];
    const L = g.logic.level(dc, 28);   // (the Embassy)
    if (!L) return [-13, `${dc.name} has no Embassy, so it can't host allied troops.`];
    const n = this.guests(dc).length + this.guestsComing(dc).filter(x => x !== self).length;
    if (n >= L) return [-13, `${dc.name}'s level ${L} Embassy can host ${L} allied ${L === 1 ? 'army' : 'armies'}, and that many are there or on their way.`];
    return null;
  }
  station(a, p, dc, host, here, report, now){
    const g = this.g;
    Object.assign(a, { direction: DIR.STAY, stationedAt: dc.id, startTime: now, reachTime: now });
    const what = Object.entries(a.carry || {}).filter(([, v]) => v > 0);
    if (what.length){ g.logic.settle(dc, host, now); for (const [k, v] of what) dc.res[k] += v; a.carry = {}; g.pushResources(dc); }
    const until = 'They stay until you call them back (the city feeds them meanwhile).';
    report(p, { type: REPORT_TYPE.OTHER, title: `Your troops are stationed in ${here}`, content: `Your troops arrived in ${dc.name} to help ${host.name} defend it. ${until}` });
    report(host, { type: REPORT_TYPE.OTHER, attack: false, title: `${p.name}'s troops arrived in ${dc.name}`, content: `${p.name}'s troops are stationed in ${dc.name} and will help defend it. You can send them home from the Embassy.` });
    g.pushFriends(host);
  }
  sendHome(a, now){
    delete a.colonyId; delete a.stationedAt; delete a.commissionId;
    Object.assign(a, { direction: DIR.BACK, startTime: now, reachTime: now + this.homeMs(a, a.oneWay) });
  }
  // Allied troops in cities gone or changed hands, or between lords no longer allied.
  checkGuests(now){
    const g = this.g;
    for (const a of Object.values(this.list())){
      if (a.direction !== DIR.STAY || !a.stationedAt) continue;
      const dc = this.db.castles[a.stationedAt], owner = this.db.players[a.playerId], host = dc ? this.db.players[dc.playerId] : null;
      if (dc && host && g.alliances.same(owner, host)) continue;
      this.sendHome(a, now);
      if (owner) g.reports.add(owner, { type: REPORT_TYPE.OTHER, title: `Your troops are leaving ${dc ? dc.name : 'their post'}`, content: 'They can no longer stay there. They are heading home.' });
      if (owner) g.pushArmies(owner);
      if (host) g.pushFriends(host);
      g.store.touch();
    }
  }
  // The hero who leads a city's defence (Fox: live, in attacks and suppression fights alike): the one with the
  // highest total of politics, attack and intelligence (gear and item buffs included) among the city's heroes at
  // home and the heroes of allied armies stationed there; on a tie the mayor.
  defender(dc, guests = this.guests(dc), now = this.g.now()){
    const H = this.g.heroes, home = H.list(dc).filter(h => [HERO_STATUS.CHIEF, HERO_STATUS.FREE, HERO_STATUS.GUARD].includes(h.status))
      .sort((x, y) => (y.status === HERO_STATUS.CHIEF) - (x.status === HERO_STATUS.CHIEF));
    const allied = guests.map(a => { const gc = this.db.castles[a.castleId]; return gc && a.heroId ? H.find(gc, a.heroId) : null; }).filter(Boolean);
    let best = null, top = -Infinity;
    for (const h of [...home, ...allied]){ const t = H.effective(h, 'pol', now) + H.effective(h, 'atk', now) + H.effective(h, 'int', now); if (t > top){ top = t; best = h; } }
    return best;
  }
  merged(troops, guests){ const m = { ...troops }; for (const a of guests) for (const [k, n] of Object.entries(a.troops)) m[k] = (m[k] || 0) + n; return m; }
  shareLosses(cityTroops, guests, left){
    const city = {}, total = this.merged(cityTroops, guests);
    for (const [k, all] of Object.entries(total)){
      const share = all > 0 ? (left[k] || 0) / all : 0;
      city[k] = Math.round((cityTroops[k] || 0) * share);
      for (const a of guests) if (a.troops[k]) a.troops[k] = Math.round(a.troops[k] * share);
    }
    return city;
  }
  upkeepOf(troops){ let f = 0; for (const t of Object.values(this.g.data.troops)) f += (troops[t.field] || 0) * t.upkeep; return f; }
  // What a city feeds of the allied troops staying in it with no time set.
  // The Rally Spot's "Open gate to fight": open, the city's troops come out to defend it; closed, only its defenses
  // fight. A city starts with it open (UNVERIFIED), and Broken Gates can hold it open or shut for an hour (charms.js).
  gateOpen(c, now = this.g.now()){
    const lock = c?.charms?.gateLock;
    if (lock && lock.until > now) return !!lock.open;
    return c?.goOut !== false;
  }
  // Troops a city feeds besides its own: allies stationed in it, and its own mercenaries camped for a commission quest
  // ("Troops cost normal upkeep of bidders").
  // (allies' troops count with the city's own of each type, CastleLogic.upkeep; the commission's camp on its own)
  guestUpkeep(c){ return this.g.commission?.upkeep(c) || 0; }
  guestTroops(c){ const o = {}; for (const a of this.guests(c)) for (const [k, n] of Object.entries(a.troops || {})) o[k] = (o[k] || 0) + (n || 0); return o; }
  // Other lords' armies on their way to lord p's cities as reinforcements, or stationed in them (FriendArmysUpdate).
  friends(p){
    return Object.values(this.list()).filter(a => a.mission === MISSION.SEND && a.playerId !== p.id && (a.stationedAt ? this.db.castles[a.stationedAt]?.playerId === p.id : a.direction === DIR.FORWARD && this.targetCity(a)?.playerId === p.id))
      .map(a => this.bean(a));
  }
  // The way home takes ms, less with Cicada Sheds Its Skin (stratagems.js: 30% faster).
  homeMs(a, ms){ return a.fastHome ? Math.max(1000, Math.round(ms / (1 + (this.g.rules.stratagems?.cicadaSpeed ?? 0.3)))) : ms; }

  // ---------- arrival ----------
  arrive(a, now){
    const g = this.g, p = this.db.players[a.playerId], c = this.db.castles[a.castleId];
    const hero = c ? g.heroes.find(c, a.heroId) : null;
    const tile = world.tileAt(g.store, a.target, now);
    const here = this.placeName(a.target), home = c ? this.placeName(c.fieldId) : '';
    const report = (pl, r) => g.reports.add(pl, { startPos: home, targetPos: here, armyType: a.mission, ...r });
    let stay = false;
    if (a.mission === MISSION.SCOUT) this.scout(a, p, c, hero, tile, report, now);
    else if (a.mission === MISSION.TRANS || a.mission === MISSION.SEND){
      const dest = this.db.castles[tile.castleId];
      if (dest && a.mission === MISSION.SEND && dest.playerId !== p.id){
        // Reinforcing a colonization: the troops (and what they carry) stay with the stationed army.
        if (g.colonies.reinforce(a, p, dest, now)){ report(p, { type: REPORT_TYPE.OTHER, title: `Reinforcements joined the colonizing army at ${here}`, content: '' }); return; }
        const host = this.db.players[dest.playerId], ally = g.alliances.same(p, host), why = ally ? this.cantStation(p, dest, a) : null;
        if (ally && !why){ this.station(a, p, dest, host, here, report, now); return; }
        report(p, { type: REPORT_TYPE.OTHER, title: `Reinforcements couldn't stay at ${here}`, content: why ? `${why[1]} Your troops are heading home.` : `The colonization of ${dest.name} is over. Your troops are heading home.` });
        Object.assign(a, { direction: DIR.BACK, startTime: now, reachTime: now + a.oneWay });
        return;
      }
      if (dest){
        g.logic.settle(dest, this.db.players[dest.playerId], now);
        for (const [k, v] of Object.entries(a.carry || {})) dest.res[k] += v;
        const what = Object.entries(a.carry || {}).map(([k, v]) => `${v.toLocaleString('en-US')} ${k === 'wood' ? 'lumber' : k}`).join(', ') || 'no resources';
        if (a.mission === MISSION.SEND && dest.playerId === p.id){
          for (const [k, n] of Object.entries(a.troops)) dest.troops[k] = addTroops(dest.troops[k], n);
          a.troops = {}; stay = true;
          // The hero moves into the city's Feasting Hall when it has a free seat (Fox); otherwise he rides home. A King
          // or Queen needs no seat, so always moves (Fox).
          let moved = false;
          if (hero && c && dest !== c && (hero.king || g.heroes.vacancies(dest) > 0)){
            c.heroes = g.heroes.list(c).filter(h => h !== hero); g.heroes.list(dest).push(hero);
            hero.status = HERO_STATUS.FREE; a.heroId = 0; moved = true;
            g.pushHero(c, hero, 1); g.pushHero(dest, hero, 0);
          }
          report(p, { type: REPORT_TYPE.OTHER, title: `Reinforcements reached ${here}`,
            content: hero ? (moved ? `${hero.name} has joined ${dest.name}.` : `${dest.name}'s Feasting Hall has no free seat, so ${hero.name} is heading home.`) : '' });
        } else report(p, { type: REPORT_TYPE.TRADE, title: `Transport delivered ${what} to ${here}`, content: '' });
        if (dest.playerId !== p.id) report(this.db.players[dest.playerId], { type: REPORT_TYPE.TRADE, attack: false, title: `${p.name} delivered ${what} to ${dest.name}`, content: '' });
        a.carry = {};
        g.pushResources(dest); g.pushTroops(dest);
      }
    } else if (a.mission === MISSION.OCCUPY || a.mission === MISSION.COLONIZE) stay = this.attack(a, p, c, hero, tile, report, now);
    else if (a.mission === MISSION.CONSTRUCT) stay = this.construct(a, p, c, tile, report, now);
    else if (a.mission === MISSION.ANTI_COLONIAL) stay = g.commission.arrive(a, p, report, now);
    if (stay === 'parked') return;   // stationed in a city it is colonizing (colonies.js)
    // Head home (or end the march if everyone stayed).
    const anyone = Object.values(a.troops).some(n => n > 0) || (hero && hero.status === HERO_STATUS.SENT);
    if (stay && !anyone){ delete this.list()[a.id]; if (hero) hero.status = HERO_STATUS.FREE; return; }
    // Live (Fox): only a won attack marches home with its loot; after a lost one the hero (and any troops left) are
    // back in the city at once.
    if (a.lost){ const back = this.home(a); if (back) g.pushTroops(back.c); return; }
    delete a.bolted;
    Object.assign(a, { direction: DIR.BACK, startTime: now, reachTime: now + this.homeMs(a, a.oneWay) });
  }

  // ---------- scouting ----------
  // How much a lord sees (rules.scouting): his Informatics minus the target's level (a lord's Informatics, a
  // valley's level, an NPC city's level, a Historic City's 12-18).
  scoutDetail(p, target){ return this.g.logic.techLevel(p, TECH.INFORMATICS) - (target || 0); }
  // The Informatics a lord's level counts as against NPC cities, Historic Cities and valleys
  // (rules.scouting.informaticsAs).
  wildInformatics(p){
    const inf = this.g.logic.techLevel(p, TECH.INFORMATICS);
    return this.g.rules.scouting?.informaticsAs?.[inf] ?? inf;
  }
  // Extra detail for sending more Scouts to an NPC or Historic City (rules.scouting.scoutTiers).
  scoutBonus(scouts){
    let b = 0;
    for (const [n, x] of this.g.rules.scouting?.scoutTiers || []) if (scouts >= n) b = Math.max(b, x);
    return b;
  }
  // Exact numbers need a big enough party: rules.scouting.scoutsPerLevel Scouts per level of the target.
  scoutsEnough(scouts, level){ return scouts >= (this.g.rules.scouting?.scoutsPerLevel ?? 0) * Math.max(1, level || 1); }
  scoutWord(n){
    for (const [upTo, word] of this.g.rules.scouting?.words || []) if (upTo == null || n <= upTo) return word;
    return n;
  }
  // What the scouts bring back at detail level d. place: { troops, forts, res, survey, hero, buildings, techs }.
  // reveal: the level each part shows at (rules.scouting.reveal, or cityReveal for NPC and Historic Cities). gold
  // comes with the resources and the resource fields (buildings 4-7) with the other buildings unless reveal
  // lists them. Without `exact` (too few Scouts) amounts stay words however high d is. null: nothing seen.
  scoutView(d, place, exact = true, reveal = this.g.rules.scouting?.reveal || {}){
    const r = reveal, at = k => r[k] != null && d >= r[k];
    const words = o => Object.fromEntries(Object.entries(o).map(([t, n]) => [t, this.scoutWord(n)]));
    const s = {};
    if (place.troops){ if (at('troops') && exact) s.troops = place.troops; else if (at('troopWords') || at('troops')) s.troops = words(place.troops); }
    if (place.forts){ if (at('forts') && exact) s.forts = place.forts; else if (at('fortWords') || at('forts')) s.forts = words(place.forts); }
    if (at('resources') && place.res) s.resource = place.res;
    if (place.res && (r.gold != null ? at('gold') : at('resources'))) s.gold = place.res.gold || 0;
    if (at('survey') && place.survey){ s.population = place.survey.population; s.support = place.survey.support; }
    if (at('hero') && place.hero) s.hero = place.hero;
    if (place.buildings){
      const field = b => b.type >= 4 && b.type <= 7 && r.fields != null;
      const seen = place.buildings.filter(b => field(b) ? at('fields') : at('buildings'));
      if (seen.length) s.buildings = seen;
    }
    if (at('techs') && place.techs) s.techs = place.techs;
    return Object.keys(s).length ? s : null;
  }
  scout(a, p, c, hero, tile, report, now){
    const g = this.g, cfg = g.rules.scouting || {}, here = this.placeName(a.target);
    let view, outcome, battle = null;
    if (tile.type === world.T.CASTLE){
      const dc = this.db.castles[tile.castleId], dp = dc && this.db.players[dc.playerId];
      if (!dc || !dp) return;
      g.logic.settle(dc, dp, now);
      // Scouts against Scouts. With none at home the city's army catches them, and loses (as on valleys). With the gates
      // closed the city's scouts stay in (the Age I guide: "Defendin' cities scouts (with open gates, ofc) will take
      // the initiative and attack enemy scouts invadin' them").
      const theirs = this.gateOpen(dc, now) ? dc.troops.scouter || 0 : 0, ours = a.troops.scouter || 0, mayor = g.heroes.chief(dc);
      const strength = (n, pl, h) => n * (1 + g.logic.techLevel(pl, TECH.INFORMATICS) * (cfg.perInformatics ?? 0.1)) * (1 + (h ? g.heroes.effective(h, 'int', now) : 0) * (cfg.perIntelligence ?? 0.01));
      const atk = strength(ours, p, hero), def = strength(theirs, dp, mayor);
      if (!theirs){ outcome = { isAttack: true, isFound: false, isSuccess: true }; battle = { unNomal: 'No defending troops found.', back: [{ typeId: 4, remain: ours }] }; }
      else if (atk > def){
        a.troops.scouter = Math.max(1, Math.round(ours * (1 - def / atk)));
        dc.troops.scouter = 0; g.pushTroops(dc);
        outcome = { isAttack: true, isFound: true, isSuccess: true };
      } else {
        a.troops.scouter = 0;
        dc.troops.scouter = Math.max(0, theirs - Math.round(theirs * atk / def)); g.pushTroops(dc);
        outcome = { isAttack: true, isFound: true, isSuccess: false };
      }
      const won = outcome.isSuccess;
      view = won ? this.scoutView(this.scoutDetail(p, g.logic.techLevel(dp, TECH.INFORMATICS)), this.cityPlace(dc, dp, now),
        this.scoutsEnough(a.troops.scouter || 0, g.logic.townHall(dc))) : null;
      report(dp, { type: REPORT_TYPE.SCOUT, attack: false, title: won ? `${p.name} scouted ${dc.name}` : `You drove off ${p.name}'s Scouts at ${dc.name}`,
        content: theirs ? scoutXml(null, { isAttack: false, isSuccess: won }) : '' });
    } else {
      // Valleys, NPC and Historic Cities: the Scouts always get in (live: one Scout at a level 4 lake "won the fight").
      // Live (Fox's reports, Oct 2026): an NPC city also shows its hero, population, loyalty and buildings; a
      // valley its hero.
      const st = g.npc.state(this.db, tile, now), npcCity = tile.type === world.T.NPC;
      // (an ordinary NPC hero is shown without a portrait in a scout report, as live: heroUrl="")
      const plainHero = h => (h ? { name: h.name, level: h.level } : null);
      const defender = npcCity ? st.ruler || (!tile.historic ? g.hh.defender(tile.id, now) || plainHero(g.npc.hero(tile, now)) : null) : plainHero(g.npc.hero(tile, now));
      // Live (Informatics 7, one Scout): an NPC city compares against its level; a Historic City against its own.
      const scouts = a.troops.scouter || 0, level = npcCity ? (tile.historic ? tile.historic.level : g.npc.techLevel(tile)) : tile.level || 0;
      const d = this.wildInformatics(p) - level + (npcCity ? this.scoutBonus(scouts) : 0);
      // Live, a troop type the place has lost entirely still shows, at 0 (a level 10 desert: "w:0 ... sw:0"),
      // and a valley's report has no defenses or stores.
      const all = { ...Object.fromEntries(Object.keys(g.npc.full(tile, now).troops || {}).map(k => [k, 0])), ...st.troops };
      view = this.scoutView(d, { troops: this.byType(all, true), forts: npcCity ? this.fortsByType(st.forts) : null, res: npcCity ? st.res : null,
        hero: defender ? { name: defender.name, level: defender.level, face: defender.face } : null,
        survey: npcCity ? { ...g.npc.survey(tile), support: Math.floor(st.loyalty ?? g.npc.survey(tile).support) } : null, buildings: npcCity ? g.npc.buildings(tile) : null },
        this.scoutsEnough(scouts, level), npcCity ? cfg.cityReveal || cfg.reveal : cfg.reveal);
      // Live: isFound is true at NPC and Historic Cities, false at valleys.
      outcome = { isAttack: true, isFound: npcCity, isSuccess: true };
      // Live: an NPC city's report says "No defending troops found." and lists the Scouts coming back; a valley's
      // has an empty battleInfo.
      battle = npcCity ? { unNomal: 'No defending troops found.', back: [{ typeId: 4, remain: scouts }] } : {};
    }
    // Live title "Scout Reports" (Fox's reports, Oct 2026).
    report(p, { type: REPORT_TYPE.SCOUT, title: outcome.isSuccess ? 'Scout Reports' : `Your Scouts were caught at ${here}`, content: scoutXml(view, outcome, battle) });
    if (!outcome.isSuccess) return;
    g.effort.note(p, 'scout');
    g.quests.flag(p, VALLEY_RES[tile.type] || tile.type === world.T.FLAT ? 'scoutValley' : 'scoutCity');
    if (tile.historic) g.quests.flag(p, `scoutHC${tile.historic.level}`);
    if (tile.id === world.idOf(0, 0)) g.quests.flag(p, 'scoutCapital');
  }

  // What a scout (or Ears and Eyes in Enemy's City) finds in a lord's city. The city's own stratagems can make its
  // troops and resources look bigger or smaller (stratagems.js).
  cityPlace(dc, dp, now = this.g.now()){
    const g = this.g, mayor = this.defender(dc, undefined, now), S = g.stratagems;
    return { troops: this.byType(S.shownTroops(dc, now)), forts: this.fortsByType(dc.forts), res: S.shownRes(dc, now),
      survey: { population: Math.floor(dc.pop), support: Math.round(dc.loyalty ?? (100 - dc.taxRate)) }, hero: mayor ? { name: mayor.name, level: mayor.level, face: mayor.face } : null,
      buildings: this.buildingSummary(dc), techs: Object.entries(dp.techs || {}).filter(([, l]) => l > 0).map(([t, l]) => ({ type: Number(t), level: l })) };
  }
  // The attacker's battle bonuses. The star set life bonus counts against NPC cities and Historic Cities (and
  // valleys too if rules.starSetLife.valleys).
  attackMods(p, hero, troops, tile){
    const g = this.g, ssl = g.rules.starSetLife;
    const vsNpc = tile.type === world.T.NPC || (!!ssl?.valleys && tile.type !== world.T.CASTLE);
    const life = hero && vsNpc ? g.equipment.setLife(p, hero) : 0;
    return g.combat.mods(g.logic, p, hero, troops, { side: 'attack', life });
  }
  attack(a, p, c, hero, tile, report, now){
    const g = this.g;
    // A Colonize march checks again on arrival: the city may have been colonized, or the lord's limit reached.
    const colonize = a.mission === MISSION.COLONIZE;
    if (colonize){
      const bad = p && c ? g.colonies.cantColonize(p, c, tile, now, a) : [-1, 'The city the army came from is gone.'];
      if (bad){ if (p) report(p, { type: REPORT_TYPE.OTHER, title: `Colonization of ${this.placeName(a.target)} called off`, content: `${bad[1]} Your army is heading home.` }); return false; }
    }
    // The target became one of the lord's own (an earlier wave conquered it, or took the valley): the army lands
    // without a fight and is recalled home (Fox).
    const ownCity = tile.type === world.T.CASTLE && this.db.castles[tile.castleId]?.playerId === p?.id;
    const ownField = tile.type !== world.T.CASTLE && tile.ownerCastle && this.db.castles[tile.ownerCastle]?.playerId === p?.id;
    if (p && (ownCity || ownField)){
      report(p, { type: REPORT_TYPE.OTHER, title: `Army recalled from ${this.placeName(a.target)}`, content: `${this.placeName(a.target)} is already yours, so your army landed without a fight and is heading home.` });
      return false;
    }
    // A war may have ended (or a Truce begun) while the army marched.
    if (!colonize && tile.type === world.T.CASTLE && p){
      const tc = this.db.castles[tile.castleId], bad = tc && g.war.cantAttack(p, tc, now, { suppress: !!g.colonies.rising(p, tc) });
      if (bad){ report(p, { type: REPORT_TYPE.OTHER, title: `Attack on ${this.placeName(a.target)} called off`, content: `${bad[1]} Your army is heading home.` }); return false; }
    }
    const attacker = { troops: a.troops, mods: this.attackMods(p, hero, a.troops, tile) };
    let defender, defName, dc = null, dp = null, npcState = null, defHero = null, defHeroObj = null, hhDef = null, npcHero = null, rising = null, guests = [], shut = false;
    if (tile.type === world.T.CASTLE){
      dc = this.db.castles[tile.castleId]; dp = dc && this.db.players[dc.playerId];
      if (!dc) return;
      g.logic.settle(dc, dp, now);
      // Allied troops stationed in the city fight alongside its own, led by the strongest hero among them all.
      // With the gates closed (the Rally Spot's "Open gate to fight" off) they all stay inside: only the defenses fight.
      shut = !this.gateOpen(dc, now);
      guests = shut ? [] : this.guests(dc);
      defHero = defHeroObj = this.defender(dc, guests, now);
      const defTroops = shut ? {} : guests.length ? this.merged(dc.troops, guests) : dc.troops;
      defender = { troops: defTroops, forts: dc.forts, mods: g.combat.mods(g.logic, dp, defHero, defTroops, { side: 'defence', walls: g.logic.level(dc, TYPE.WALLS) }) };
      defName = dp.name;
      // An attack on an uprising colony of this lord's suppresses the uprising when it wins.
      rising = g.colonies.rising(p, dc);
    } else {
      npcState = g.npc.state(this.db, tile, now);
      // A historic hero waiting in an NPC city leads its defence instead of the NPC's ordinary hero.
      hhDef = tile.type === world.T.NPC && !tile.historic ? g.hh.defender(tile.id, now) : null;
      const ruler = npcState.ruler || hhDef;
      // The NPC city's own hero (live: "Aaron (Level 3)").
      npcHero = !ruler && tile.type === world.T.NPC ? g.npc.hero(tile, now) : null;
      defender = { troops: npcState.troops, forts: npcState.forts, mods: tile.type === world.T.NPC ? g.npc.mods(tile, g.data.techs, ruler) : {} };
      if (ruler) defHero = { name: ruler.name, level: ruler.level, face: ruler.face };
      else if (npcHero) defHero = npcHero;
      // Live (Fox's Basilisk reports, Oct 29 2026): the barbarians' side has no lord's name ("Defender (Enemy's Side)
      // Defeat").
      defName = tile.ownerCastle ? (this.db.players[this.db.castles[tile.ownerCastle]?.playerId]?.name || '') : '';
    }
    const before = { ...a.troops };
    const r = g.combat.fight(attacker, defender);
    g.effort.kills(p, r.def); if (dp) g.effort.kills(dp, r.att);   // (achievements)
    a.troops = r.attLeft;
    // Penicillin: 30% of the troops lost in battle survive.
    this.relive(p, before, a.troops, now);
    // The survivors are shared out: each kind loses the same share in the city and in every allied army.
    const cityLeft = dc && shut ? dc.troops : dc && guests.length ? this.shareLosses(dc.troops, guests, r.defLeft) : r.defLeft;
    const defBefore = dc ? { ...dc.troops } : null;
    if (dc) this.relive(dp, { ...dc.troops }, cityLeft, now);
    // Wounded: a share of each side's losses waits in its own city (the attacker's home city).
    const lostOf = (was, now) => Object.fromEntries(Object.entries(was).map(([k, n]) => [k, n - (now[k] || 0)]).filter(([, n]) => n > 0));
    const attHeal = c ? this.wound(c, p, lostOf(before, a.troops), now) : null;
    const defHeal = dc ? this.wound(dc, dp, lostOf(defBefore, cityLeft), now) : null;
    const xp = r.expAttacker;
    if (hero) g.heroes.gainExp(hero, xp);
    if (defHeroObj && r.expDefender) g.heroes.gainExp(defHeroObj, r.expDefender);
    // Apply losses to the defender.
    const fortsAfter = { ...(defender.forts || {}) };
    for (const [k, n] of Object.entries(r.fortsUsed)) fortsAfter[k] = Math.max(0, (fortsAfter[k] || 0) - n);
    if (defender.forts?.arrowTower) fortsAfter.arrowTower = r.towersLeft;
    // Loot and valley capture.
    let loot = null, captured = false;
    if (r.attackerWon){
      const cap = this.load(a.troops, p);
      if (dc && (colonize || rising)){
        // Colonizing and suppressing take nothing.
      } else if (dc){
        const pstep = g.rules.privateeringStep;
        const priv = pstep ? Math.pow(pstep, g.logic.techLevel(p, TECH.PRIVATEERING)) : Math.max(0, 1 - g.logic.techEffect(p, TECH.PRIVATEERING) / 100);
        // Each resource keeps its share of the Warehouse (the Store Percents), less what Privateering gets past.
        loot = this.take(dc.res, cap, k => Math.max(0, dc.res[k] - g.logic.protectedOf(dc, dp, k) * priv * g.stratagems.warehouseShare(dc, now)));   // (Loot a Burning House halves it)
      } else if (npcState.res){
        loot = this.take(npcState.res, cap, k => npcState.res[k]);
      } else if (VALLEY_RES[tile.type] || tile.type === world.T.FLAT){
        captured = this.capture(c, tile, now);
      }
      if (loot) a.loot = loot;
    }
    // Treasure (rules.battleDrops, Fox's drop table): medals, gear materials, gems and scripts from NPC cities,
    // Historic Cities and valleys, amulets and teleporters from lords' cities.
    const found = this.battleTreasure(p, tile, dc, r, now);
    if (found.length){ for (const f of found) g.items.add(p, f.id, f.n); g.pushItems(p, found.map(f => f.id)); }
    if (dc) this.repairForts(dp, defender.forts, fortsAfter);
    if (!dc && tile.type === world.T.NPC) Object.assign(fortsAfter, g.npc.repair(tile, defender.forts || {}, fortsAfter));
    // City loyalty (rules.npcConquest): a won attack on an NPC or Historic City lowers it; at 0 the city is
    // conquered.
    const here = this.placeName(a.target);
    let conquest = null;
    if (r.attackerWon && !dc && tile.type === world.T.NPC && g.rules.npcConquest?.enabled !== false){
      const before = npcState.loyalty ?? g.npc.topLoyalty(tile), drop = this.loyaltyDrop(before, r.round);
      npcState.loyalty = Math.max(0, before - drop);
      conquest = { drop, loyalty: Math.floor(npcState.loyalty) };
      if (npcState.loyalty < 1){   // (the report shows the whole points: 0.4 is "loyalty 0")
        const why = this.cantConquer(p, tile);
        if (why) conquest.problem = why;
        else conquest.city = this.conquer(a, p, c, hero, tile, npcState, fortsAfter, npcHero, now);
      }
    }
    if (dc){ dc.troops = cityLeft; dc.forts = fortsAfter; g.pushTroops(dc); g.pushResources(dc); g.push(dp.id, 'server.FortificationsUpdate', { castleId: dc.id, fortification: g.beans.forts(dc) }); }
    else if (!conquest?.city){ npcState.troops = r.defLeft; npcState.forts = fortsAfter; g.npc.save(this.db, tile, npcState, now); }
    // A Historic City a lord holds (Fox): won attacks lower its loyalty the same way, and at 0 it is taken; every
    // hero still in it becomes the new lord's prisoner.
    if (r.attackerWon && dc && (dc.powerLevel ?? 4) !== 4 && !colonize && !rising && g.rules.npcConquest?.lords !== false){
      const before = dc.loyalty ?? (100 - dc.taxRate), drop = this.loyaltyDrop(before, r.round);
      dc.loyalty = Math.max(0, before - drop);
      conquest = { drop, loyalty: Math.floor(dc.loyalty) };
      if (dc.loyalty < 1){
        const why = this.cantTakeCity(p, dp);
        if (why) conquest.problem = why;
        else conquest.city = this.takeCity(a, p, c, hero, dc, dp, now);
      }
      if (!conquest.city) g.pushResources(dc);
    }
    // An attacking hero whose loyalty is 0 is captured by the lord's city that beats it (Fox), if its Feasting Hall
    // has a free seat. Its lord counts it lost (captives.js).
    let heroSeized = false;
    if (dc && !r.attackerWon && hero && c && (hero.loyalty ?? g.rules.heroStartLoyalty ?? 70) <= 0 && g.heroes.vacancies(dc) > 0){
      g.captives.capture(hero, c, dc, p, now); a.heroId = 0; heroSeized = true; g.effort.note(dp, 'captive');
      g.log.info(`${dp.name}'s ${dc.name} captured ${p.name}'s hero ${hero.name}`);
    }
    const won = conquest?.city;
    // Colonies: a won Colonize attack starts the Colonization Period and the army stays in the city; a won attack
    // on an uprising colony ends the uprising (battle report: isColonial with the period's times, isUprising).
    let colony = null, parked = false;
    if (colonize && r.attackerWon){
      const rec = g.colonies.begin(a, p, c, dc, now);
      colony = { isColonial: true, colonialStartTime: stamp(rec.startTime), colonialEndTime: stamp(rec.endTime) }; parked = true;
    } else if (rising && r.attackerWon){ g.colonies.suppressed(rising, now); colony = { isUprising: true }; }
    const units = list => list.map(u => ({ typeId: u.typeId, count: u.count, lose: u.lose }));
    // After a conquest the army stays in its new city, so no troops come home (BattleReportDetail).
    const back = won || parked ? null : { hero, seized: heroSeized, units: Object.entries(before).map(([f, n]) => ({ typeId: this.typeOf(f), preCount: n, remain: a.troops[f] || 0 })), loot };
    const body = { round: r.round, heroExp: hero ? xp : undefined,
      // (live, a battle at an NPC city has no "Castle: ..." line on either side: the first line names both places)
      attacker: { king: p.name, hero, pos: dc ? this.placeName(a.from) : undefined, units: units(r.att) },
      defender: { king: defName, hero: defHero, pos: dc ? here : undefined, units: units(r.def) }, loot, back, conquest, colony };
    const verb = won ? `conquered ${here}` : parked ? `began colonizing ${here}` : colony ? `suppressed the uprising at ${here}` : captured ? `took ${here}` : r.attackerWon ? `won at ${here}` : `was beaten at ${here}`;
    // Honor, in battles between lords: each side's own (combat.honor; live reports carry it as honor="...").
    const hon = p && dp ? this.honor(p, dp, r.def, r.att, r.attackerWon) : null;
    // Prestige: a won attack on an NPC city, Historic City or valley earns it (live: prestige="106"); the loser of a
    // battle pays the prestige his lost troops earned when trained.
    const prestige = p && r.attackerWon && !dp ? this.battlePrestige(p, r.att, r.def) : 0;
    const pLoss = r.attackerWon ? 0 : this.lostPrestige(p, r.att), dLoss = dp && r.attackerWon ? this.lostPrestige(dp, r.def) : 0;
    if (p && (prestige || pLoss)){ p.prestige = Math.max(0, (p.prestige || 0) + prestige - pLoss); g.pushPlayerInfo(p); }
    if (dp && dLoss){ dp.prestige = Math.max(0, (dp.prestige || 0) - dLoss); g.pushPlayerInfo(dp); }
    let note = '';
    const foundText = found.map(f => `${f.n > 1 ? f.n + ' ' : ''}${g.items.name(f.id)}`).join(', ');
    if (found.length) note += `; found ${foundText}`;
    if (conquest && !won) note += conquest.problem ? '; loyalty 0' : `; loyalty ${conquest.loyalty}`;
    if (won?.captive) note += `; captured ${won.captive.name}`;
    if (won?.captives?.length) note += `; captured ${won.captives.map(h => h.name).join(', ')}`;
    if (heroSeized) note += `; ${hero.name} was captured`;
    const injuredPer = Math.round((g.rules.wounded?.share ?? 0) * 100) || undefined;
    // Live (Fox's Basilisk report, Oct 29 2026): an attack's report is titled "Attack Reports", whatever came of it,
    // as a scout's is "Scout Reports"; a conquest, a colonization, a taken valley and a captured hero keep their own.
    const plain = !won && !parked && !colony && !captured && !heroSeized && !won?.captive;
    report(p, { type: REPORT_TYPE.ARMY, title: plain ? 'Attack Reports' : `Your army ${verb}${note}`, content: battleXml({ ...body, injuredPer, autoHeal: this.healXml(attHeal, c), isAttack: true, won: r.attackerWon, honor: hon?.att, prestige: prestige || undefined, items: found.length ? found.map(f => (f.n > 1 ? `${f.id}=${f.n}` : f.id)).join(',') : undefined }) });
    if (won) this.conquestReports(p, won, here);
    // The allied troops' lords get the battle too; an army with nobody left, or in a city that changed hands, goes home.
    for (const ga of guests){
      const gp = this.db.players[ga.playerId]; if (!gp) continue;
      report(gp, { type: REPORT_TYPE.ARMY, attack: false, title: `${p.name} attacked ${dc.name}, where your troops are stationed`, content: battleXml({ ...body, injuredPer, isAttack: false, won: r.attackerWon, back: null }) });
      if (won || parked || !Object.values(ga.troops).some(n => n > 0)) this.sendHome(ga, now);
      g.pushArmies(gp);
    }
    if (guests.length) g.pushFriends(dp);
    if (dp) report(dp, { type: REPORT_TYPE.ARMY, attack: false, title: won ? `${p.name} conquered ${dc.name}` : parked ? `${p.name} is colonizing ${dc.name}` : colony ? `${p.name} suppressed ${dc.name}'s uprising` : heroSeized ? `${p.name} attacked ${dc.name}; you captured ${hero.name}` : `${p.name} attacked ${dc.name}`, content: battleXml({ ...body, injuredPer, autoHeal: this.healXml(defHeal, dc), isAttack: false, won: r.attackerWon, back: null, honor: hon?.def }) });
    g.log.info(`${p.name} attacked ${here}: ${r.attackerWon ? 'won' : 'lost'} in ${r.round} round${r.round > 1 ? 's' : ''}${loot ? `, loot ${Object.values(loot).reduce((x, y) => x + y, 0)}` : ''}${captured ? ', valley taken' : ''}${conquest ? `, loyalty ${conquest.loyalty}` : ''}${found.length ? `, found ${foundText}` : ''}`);
    // Live (Fox): a lost attack doesn't march home; what is left of the army is home at once (arrive()).
    if (!r.attackerWon) a.lost = true;
    return parked ? 'parked' : !!won;   // a conquering army stays in its new city; a colonizing one in the city
  }
  // Prestige for a won attack on an NPC city, Historic City or valley (rules.battlePrestige): what was killed is
  // worth x (what the defenders were worth / what the army sent was worth) x factor / all p's Town Hall levels.
  // Fox's NPC 8 run: 106 for the first attack on the full city, 3 for the next, nothing for the 25 after.
  battlePrestige(p, attRows, defRows){
    const g = this.g, bp = g.rules.battlePrestige || {}; if (bp.enabled === false || !p) return 0;
    const C = g.combat, worth = rows => C.value(rows.map(u => ({ typeId: u.typeId, lose: u.count })));
    const A = worth(attRows), D = worth(defRows), ratio = A > 0 ? Math.min(bp.maxRatio ?? 10, D / A) : 0;
    return Math.max(0, Math.floor(C.value(defRows) * ratio * (bp.factor ?? 0.01477) / g.quests.townHalls(p)));
  }
  // The prestige lord p's lost troops earned when trained (the wiki: "you lose the same amount of prestige as the
  // troops you lose").
  lostPrestige(p, rows){
    const g = this.g; if (!p || g.rules.battlePrestige?.losses === false) return 0;
    return rows.filter(u => u.typeId < 14 && u.lose > 0).reduce((s, u) => s + g.quests.prestigeFor(g.data.troops[u.typeId], u.lose, p), 0);
  }
  // Honor for attacker p and defender dp from a battle: attRows and defRows are the two sides' units (with lose).
  honor(p, dp, defRows, attRows, attackerWon){
    const C = this.g.combat, h = { att: C.honor(defRows, attRows, attackerWon), def: C.honor(attRows, defRows, !attackerWon) };
    p.honor = (p.honor || 0) + h.att; dp.honor = (dp.honor || 0) + h.def;
    if (h.att) this.g.pushPlayerInfo(p);
    if (h.def) this.g.pushPlayerInfo(dp);
    return h;
  }
  // Penicillin: a share of the troops lost in battle survive (`after` is raised in place).
  relive(pl, before, after, now){
    const share = pl ? this.g.items.reliveShare(pl, now) : 0;
    if (share) for (const [k, n] of Object.entries(before)){ const lost = n - (after[k] || 0); if (lost > 0) after[k] = (after[k] || 0) + Math.floor(lost * share); }
  }
  // Part of a city's destroyed defenses repair themselves: destroyed x rate x 2^Machinery (dxcalc), unless none
  // of that kind is left (dxcalc and the wiki agree on that). `after` is raised in place.
  repairForts(dp, before, after){
    const mach = Math.pow(2, this.g.logic.techLevel(dp, 19));
    for (const [k, rate] of Object.entries(this.g.rules.repairRate)){
      const lost = (before?.[k] || 0) - (after[k] || 0);
      if (lost > 0 && (after[k] || 0) > 0) after[k] = Math.min(before[k], (after[k] || 0) + Math.floor(lost * rate * mach));
    }
  }
  // A battle at a lord's city outside an ordinary march (colonies: the Stabilization battle and the uprising war).
  // `troops`, already out of their city, attack city dc's troops and defenses under `hero`; Penicillin, the
  // wounded (into `home`) and the defenses' repairs work as in an attack. Returns who won, what's left of `troops`
  // and the battle report's body.
  cityBattle(p, home, hero, troops, dc, now){
    const g = this.g, dp = this.db.players[dc.playerId];
    g.logic.settle(dc, dp, now);
    const defHero = this.defender(dc, [], now), before = { ...troops }, defBefore = { ...dc.troops }, fortsBefore = { ...(dc.forts || {}) };
    const attacker = { troops, mods: g.combat.mods(g.logic, p, hero, troops, { side: 'attack', life: 0 }) };
    const defender = { troops: dc.troops, forts: dc.forts, mods: g.combat.mods(g.logic, dp, defHero, dc.troops, { side: 'defence', walls: g.logic.level(dc, TYPE.WALLS) }) };
    const r = g.combat.fight(attacker, defender), left = r.attLeft;
    g.effort.kills(p, r.def); g.effort.kills(dp, r.att);
    this.relive(p, before, left, now); this.relive(dp, defBefore, r.defLeft, now);
    const lostOf = (was, after) => Object.fromEntries(Object.entries(was).map(([k, n]) => [k, n - (after[k] || 0)]).filter(([, n]) => n > 0));
    const attHeal = home ? this.wound(home, p, lostOf(before, left), now) : null, defHeal = this.wound(dc, dp, lostOf(defBefore, r.defLeft), now);
    if (hero) g.heroes.gainExp(hero, r.expAttacker);
    if (defHero && r.expDefender) g.heroes.gainExp(defHero, r.expDefender);
    const fortsAfter = { ...fortsBefore };
    for (const [k, n] of Object.entries(r.fortsUsed)) fortsAfter[k] = Math.max(0, (fortsAfter[k] || 0) - n);
    if (fortsBefore.arrowTower) fortsAfter.arrowTower = r.towersLeft;
    this.repairForts(dp, fortsBefore, fortsAfter);
    dc.troops = r.defLeft; dc.forts = fortsAfter;
    g.pushTroops(dc); g.pushResources(dc); g.push(dp.id, 'server.FortificationsUpdate', { castleId: dc.id, fortification: g.beans.forts(dc) });
    const units = list => list.map(u => ({ typeId: u.typeId, count: u.count, lose: u.lose }));
    const body = { round: r.round, heroExp: hero ? r.expAttacker : undefined,
      attacker: { king: p.name, hero, pos: home ? this.placeName(home.fieldId) : '', units: units(r.att) },
      defender: { king: dp.name, hero: defHero, pos: this.placeName(dc.fieldId), units: units(r.def) }, loot: null, back: null };
    g.log.info(`${p.name} fought at ${this.placeName(dc.fieldId)}: ${r.attackerWon ? 'won' : 'lost'} in ${r.round} round${r.round > 1 ? 's' : ''}`);
    const honor = this.honor(p, dp, r.def, r.att, r.attackerWon);
    const pLoss = r.attackerWon ? 0 : this.lostPrestige(p, r.att), dLoss = r.attackerWon ? this.lostPrestige(dp, r.def) : 0;
    if (pLoss){ p.prestige = Math.max(0, (p.prestige || 0) - pLoss); g.pushPlayerInfo(p); }
    if (dLoss){ dp.prestige = Math.max(0, (dp.prestige || 0) - dLoss); g.pushPlayerInfo(dp); }
    return { won: r.attackerWon, left, body, attHeal, defHeal, honor, injuredPer: Math.round((g.rules.wounded?.share ?? 0) * 100) || undefined };
  }
  // ---------- wounded troops (rules.wounded) ----------
  // The wounded resting in a city's Rally Spot, after the ones left too long have died.
  wounded(c, now = this.g.now()){
    const w = c.wounded || (c.wounded = {}), die = this.g.rules.wounded?.diePerHour ?? 0;
    if (c.woundedAt && die > 0){
      const hours = Math.max(0, (now - c.woundedAt) / 3600000 * this.g.logic.speed), keep = Math.pow(1 - Math.min(1, die), hours);
      for (const k of Object.keys(w)){ w[k] *= keep; if (w[k] < 1) delete w[k]; }
    }
    c.woundedAt = now;
    return w;
  }
  woundedWhole(c, now){ return Object.fromEntries(Object.entries(this.wounded(c, now)).map(([k, n]) => [k, Math.floor(n)]).filter(([, n]) => n > 0)); }
  healGold(field){
    const r = this.g.rules.wounded || {}, t = Object.values(this.g.data.troops).find(x => x.field === field);
    return r.healGold?.[field] ?? Math.round((r.healShare ?? 0.147) * ((t?.food || 0) + (t?.wood || 0) + (t?.stone || 0) + (t?.iron || 0)));
  }
  cureCost(troops){ return Object.entries(troops).reduce((s, [k, n]) => s + n * this.healGold(k), 0); }
  // Losses from a battle: a share comes back wounded. With Auto Heal on and the gold in the city, every wounded
  // troop there is cured at once. Returns what was healed and its cost, or null.
  wound(c, p, lost, now){
    const share = (this.g.rules.wounded?.share ?? 0) + (this.g.effort.bonus(p, 'wounded') || 0) / 100, w = this.wounded(c, now);   // (+1% a level: achievements)
    let any = false;
    for (const [k, n] of Object.entries(lost)){ const hurt = Math.floor(n * share); if (hurt > 0){ w[k] = (w[k] || 0) + hurt; any = true; } }
    if (!any) return null;
    if (p?.autoHeal){
      const r = this.cure(c, p, now);
      if (!Array.isArray(r)) return r;
    }
    this.g.pushInjured(c);
    return null;
  }
  cure(c, p, now = this.g.now()){
    const g = this.g, whole = this.woundedWhole(c, now), cost = this.cureCost(whole);
    if (!Object.keys(whole).length) return [-1, 'There are no wounded troops here.'];
    g.logic.settle(c, p, now);
    if (c.res.gold < cost) return [-1, `Curing the wounded costs ${cost.toLocaleString('en-US')} gold.`];
    c.res.gold -= cost;
    for (const [k, n] of Object.entries(whole)) c.troops[k] = addTroops(c.troops[k], n);
    c.wounded = {};
    if (p) g.quests.flag(p, 'cure');
    g.store.touch(); g.pushTroops(c); g.pushResources(c); g.pushInjured(c);
    return { troops: whole, gold: cost };
  }
  disbandWounded(c, now = this.g.now()){ c.wounded = {}; c.woundedAt = now; this.g.store.touch(); this.g.pushInjured(c); return {}; }
  // The battle report's autoHeal part (live: des="All of your wounded troops in the 0(3,399) were automatically
  // healed." gold="136145" and the troops).
  healXml(h, c){
    if (!h) return null;
    return { des: `All of your wounded troops in the ${this.placeName(c.fieldId)} were automatically healed.`, gold: h.gold,
      units: Object.entries(h.troops).map(([k, n]) => ({ typeId: this.typeOf(k), count: n })) };
  }
  // How much a won attack lowers an NPC or Historic City's loyalty (rules.npcConquest.loyaltyDrop). Fox (Oct 25):
  // how long a battle lasts has nothing to do with it. Each won attack takes 1, 2 or 3 loyalty (10%, 40% and 50% of
  // the time, so a level 8 takes about 34 wins as his run did), and 2, 3 or 4 while its loyalty is above 80.
  loyaltyDrop(before, rounds, rnd = Math.random){
    const r = this.g.rules.npcConquest?.loyaltyDrop || {}, high = before > (r.above ?? 80);
    const odds = (high ? r.high : r.low) || (high ? [[2, 0.2], [3, 0.5], [4, 0.3]] : [[1, 0.1], [2, 0.4], [3, 0.5]]);
    let x = rnd();
    for (const [n, p] of odds){ if (x < p) return n; x -= p; }
    return odds[odds.length - 1][0];
  }
  // Why a lord can't take a city whose loyalty is 0, or null if he can: his title needs a free city slot (a
  // city on its way to a flat counts), and Historic Cities can't be taken here unless rules.npcConquest.historic.
  cantConquer(p, tile){
    const g = this.g;
    if (tile.historic && !g.rules.npcConquest?.historic) return 'Conquering Historic Cities is turned off on this server.';
    const pending = Object.values(this.list()).filter(x => x.mission === MISSION.CONSTRUCT && x.direction === DIR.FORWARD && x.playerId === p.id).length;
    const max = g.quests.maxCities(p), have = p.castles.length + pending;
    if (have < max) return null;
    return have >= (g.rules.maxCities || 10) ? `You already rule ${p.castles.length} cities, the most a lord can hold.`
      : `As ${/^[AEIOU]/.test(g.quests.titleName(p)) ? 'an' : 'a'} ${g.quests.titleName(p)} you can rule ${max} ${max === 1 ? 'city' : 'cities'}. Earn the next title (Quests, Title) to conquer this one.`;
  }
  // The NPC city becomes this lord's: its buildings (cityLayout), what's left of its stores and defenses, its
  // population, and the army that took it (troops, the loot they carried, and their hero). Its hero is captured
  // into the new city's Feasting Hall (or the home city's when that's full); a historic hero waiting there is
  // captured too if the lord holds the hero's quest and portrait, and otherwise moves to another NPC city.
  conquer(a, p, c, hero, tile, st, forts, npcHero, now){
    const g = this.g, cq = g.rules.npcConquest || {}, hc = tile.historic;
    // A Historic City starts afresh (5,000 of each resource, 50 people); an NPC city keeps what's left of its stores.
    const res = hc ? { ...(cq.historicStart?.resources || {}) } : { ...(st.res || {}) };
    for (const [k, n] of Object.entries(a.loot || {})) res[k] = (res[k] || 0) + n;
    delete this.db.npc[tile.id];
    const nc = g.createCastle(p, { fieldId: tile.id, now, name: hc ? hc.name : cq.cityName || 'New city',
      start: { buildings: g.npc.cityLayout(tile), resources: res, taxRate: cq.taxRate ?? 10, productionRate: cq.productionRate ?? 80 } });
    if (hc) nc.powerLevel = hc.powerLevel;
    // Live (Fox): an NPC city comes full, its population limit less the tax rate's share (72,050 x 90% = 64,845 at
    // level 8), with every production rate at 80; a Historic City has 50 people.
    nc.pop = hc ? cq.historicStart?.population ?? 50 : g.logic.popTarget(nc);
    nc.forts = Object.fromEntries(Object.entries(forts).filter(([, n]) => n > 0));
    for (const [k, n] of Object.entries(a.troops)) if (n > 0) nc.troops[k] = n;
    a.troops = {}; a.loot = null; a.carry = {};
    if (hero && c){ c.heroes = g.heroes.list(c).filter(h => h !== hero); hero.status = HERO_STATUS.FREE; nc.heroes.push(hero); g.pushHero(c, hero, 1); }
    const seize = tmpl => {
      for (const at of [nc, c].filter(Boolean)){ const h = g.heroes.seize(at, tmpl, () => g.store.id()); if (h) return { hero: h, castle: at }; }
      return null;
    };
    const hh = g.hh.conquered(tile.id, p, seize);
    const held = hh ? (hh.captive ? { hero: hh.captive, castle: hh.castle } : null) : npcHero ? seize(npcHero) : null;
    if (held && held.castle === c) g.pushHero(c, held.hero, 0);
    g.store.touch();
    g.pushCastle(nc, 0); g.pushPlayerInfo(p); g.pushTroops(c);
    g.quests.record(p, 'npcCity', hc ? 10 : tile.level || 0);
    g.effort.note(p, 'seize'); if (!hc && tile.level >= 10) g.effort.note(p, 'barbarian10'); if (held) g.effort.note(p, 'captive');
    g.log.info(`${p.name} conquered ${this.placeName(tile.id)}${held ? `, capturing ${held.hero.name}` : ''}`);
    return { castle: nc, captive: held?.hero || null, heldIn: held?.castle || null, hh, npcHero };
  }
  conquestReports(p, won, here){
    const g = this.g, { x, y } = world.xy(won.castle.fieldId), add = (title, content) => g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: here, targetPos: here, title, content });
    if (won.lord){
      const names = won.captives.map(h => `${h.name} (level ${h.level})`);
      add(`City conquered at (${x},${y})`, `You took ${won.castle.name} from ${won.lord.name}. The army that took it stays there as its garrison.${names.length ? ` Its heroes are your prisoners in its Feasting Hall: ${names.join(', ')}. Persuade them to join you, or release them to go home.` : ''}`);
      g.reports.add(won.lord, { type: REPORT_TYPE.OTHER, startPos: here, targetPos: here, title: `${won.castle.name} was conquered`, content: `${p.name} took your city ${won.castle.name} at (${x},${y}).${names.length ? ` Heroes captured there: ${names.join(', ')}. A Stone of Finding brings one back within 24 hours.` : ''}` });
      return;
    }
    add(`City conquered at (${x},${y})`, `${here} is now your city ${won.castle.name}. The army that took it stays there as its garrison.`);
    const h = won.captive;
    if (h){
      const cost = (h.level * (g.rules.persuadeGoldPerLevel ?? 1000)).toLocaleString('en-US');
      add(`${h.name} captured`, `${h.name} (level ${h.level}) was captured at ${here} and is held in the Feasting Hall in ${won.heldIn.name}. Persuade the hero to join you for ${cost} gold${h.persuadeItem ? ` and ${h.name}'s portrait` : ''}, or release them.`);
    } else if (won.hh?.moved){
      const need = [won.hh.needQuest && 'accept the hero\'s quest at the Inn', won.hh.needPortrait && 'hold the hero\'s portrait (Enquire Details at the Inn)'].filter(Boolean);
      add(`${won.hh.hero.name} got away`, `${won.hh.hero.name} has left for another NPC city. To capture a historic hero, ${need.join(' and ')} before you take the city.`);
    } else if (won.hh?.full || won.npcHero) add(`${(won.hh?.hero || won.npcHero).name} got away`, 'Your Feasting Halls had no empty seat to hold the hero.');
  }
  // What a won battle turns up (rules.battleDrops, Fox's drop table): [{ id, n }], each item rolled on its own.
  // kind: 'valley' | 'npc' | 'historic' | 'pvp'; level: the valley's or NPC city's 1-10, the Historic City's 12-18
  // (a level between the table's columns uses the one below). bonus: the achievements' treasure bonus, in %.
  treasure(kind, level, rnd = Math.random, bonus = 0){
    const cfg = this.g.rules.battleDrops || {}, out = [];
    if (cfg.enabled === false) return out;
    for (const [id, t] of Object.entries(cfg.items || {})){
      const row = t[kind];
      let pc = 0;
      if (typeof row === 'number') pc = row;
      else if (Array.isArray(row)) pc = row[Math.max(1, Math.min(row.length + 1, level)) - 1] || 0;
      else if (row && typeof row === 'object'){ const at = Object.keys(row).map(Number).filter(l => l <= level).sort((a, b) => b - a)[0]; pc = at === undefined ? 0 : row[at]; }
      if (pc > 0 && rnd() < Math.min(1, pc / 100 * (1 + bonus / 100)) && this.g.data.items?.[id]) out.push({ id, n: 1 });
    }
    return out;
  }
  // The treasure of a battle that has been fought (r: the combat result): none unless the attacker won and killed at
  // least rules.battleDrops.minKillShare of the place's full troops (an NPC city's, Historic City's or valley's full
  // garrison; the lord's troops that fought), so a city already emptied of troops gives nothing (Fox).
  battleTreasure(p, tile, dc, r, now){
    const g = this.g, cfg = g.rules.battleDrops || {};
    if (!p || !r.attackerWon || cfg.enabled === false) return [];
    const troopRows = r.def.filter(u => !u.fort && u.typeId < 14);
    const killed = troopRows.reduce((a, u) => a + (u.lose || 0), 0);
    let kind, level, full;
    if (dc){ kind = 'pvp'; level = 0; full = troopRows.reduce((a, u) => a + (u.count || 0), 0); }
    else {
      kind = tile.type === world.T.NPC ? (tile.historic ? 'historic' : 'npc') : 'valley';
      level = tile.historic ? tile.historic.level : tile.level || 1;
      full = Object.values(g.npc.full(tile, now).troops || {}).reduce((a, n) => a + (n || 0), 0);
    }
    if (killed <= 0 || killed < (cfg.minKillShare ?? 0.1) * full) return [];
    return this.treasure(kind, level, Math.random, g.effort.bonus(p, 'drops'));
  }
  // Take up to `cap` resources, evenly, from what's available.
  take(store, cap, avail){
    const out = {}; let left = cap;
    let keys = RES.filter(k => avail(k) >= 1);
    for (let i = 0; i < 6 && left >= 1 && keys.length; i++){
      const share = left / keys.length;
      for (const k of keys){ const t = Math.floor(Math.min(share, avail(k))); out[k] = (out[k] || 0) + t; store[k] -= t; left -= t; }
      keys = keys.filter(k => avail(k) >= 1);
    }
    return out;
  }
  capture(c, tile, now){
    const g = this.g, held = (c.valleys || []).length, max = g.logic.townHall(c);
    if (held >= max) return false;
    if (tile.ownerCastle){
      const old = this.db.castles[tile.ownerCastle];
      if (old){ old.valleys = (old.valleys || []).filter(v => v !== tile.id); g.push(old.playerId, 'server.CastleFieldUpdate', { castleId: old.id, updateType: 1, bean: this.fieldBean({ ...tile, ownerCastle: old.id }) }); }
    }
    c.valleys = c.valleys || []; c.valleys.push(tile.id);
    const owner = this.db.players[c.playerId];
    if (owner){ if (tile.type === world.T.FLAT) g.quests.flag(owner, 'flat'); else { g.quests.record(owner, 'valley', tile.level || 0); g.effort.valley(owner, tile.level || 0); } }
    this.db.tiles[tile.id] = { type: tile.type, level: tile.level, ownerCastle: c.id };
    g.push(c.playerId, 'server.CastleFieldUpdate', { castleId: c.id, updateType: 0, bean: this.fieldBean({ ...tile, ownerCastle: c.id }) });
    g.pushResources(c);
    return true;
  }
  giveUp(c, fieldId){
    if (!(c.valleys || []).includes(fieldId)) return [-18, 'That valley is not yours.'];
    const t = world.tileAt(this.g.store, fieldId);
    c.valleys = c.valleys.filter(v => v !== fieldId);
    delete this.db.tiles[fieldId];
    return { bean: this.fieldBean(t) };
  }
  fieldBean(t){ return { id: t.id, type: t.type, level: t.level, name: t.type === world.T.FLAT ? 'Flat' : VALLEY_NAME[t.type] || 'Valley', statu: 0, armys: [] }; }
  valleyBonuses(c){
    const b = { food: 0, wood: 0, stone: 0, iron: 0 };
    for (const id of c.valleys || []){ const t = world.tileAt(this.g.store, id); const k = VALLEY_RES[t.type]; if (k) b[k] += valleyBonus(t); }
    return b;
  }

  // ---------- coming home ----------
  home(a){
    const g = this.g, c = this.db.castles[a.castleId], p = this.db.players[a.playerId];
    delete this.list()[a.id];
    if (!c) return null;
    for (const [k, n] of Object.entries(a.troops)) c.troops[k] = addTroops(c.troops[k], n);
    for (const src of [a.carry, a.loot]) for (const [k, v] of Object.entries(src || {})) c.res[k] += v;
    const hero = g.heroes.find(c, a.heroId);
    if (hero && hero.status === HERO_STATUS.SENT) hero.status = HERO_STATUS.FREE;
    return { c, p, hero };
  }

  // ---------- taking a lord's Historic City ----------
  // Why lord p can't take lord dp's city whose loyalty is 0, or null: his title needs a free city slot, and a lord
  // keeps at least one city.
  cantTakeCity(p, dp){
    const g = this.g;
    if (g.castlesOf(dp).length <= 1) return `This is ${dp.name}'s last city, which can't be taken.`;
    const pending = Object.values(this.list()).filter(x => x.mission === MISSION.CONSTRUCT && x.direction === DIR.FORWARD && x.playerId === p.id).length;
    const max = g.quests.maxCities(p), have = p.castles.length + pending;
    if (have < max) return null;
    return have >= (g.rules.maxCities || 10) ? `You already rule ${p.castles.length} cities, the most a lord can hold.`
      : `As ${/^[AEIOU]/.test(g.quests.titleName(p)) ? 'an' : 'a'} ${g.quests.titleName(p)} you can rule ${max} ${max === 1 ? 'city' : 'cities'}. Earn the next title (Quests, Title) to conquer this one.`;
  }
  // The city changes hands: colonies tied to it end, its lord's armies out from it go home to his other city,
  // every hero left in it becomes the new lord's prisoner, and the army that took it moves in with its loot and hero.
  takeCity(a, p, c, hero, dc, dp, now){
    const g = this.g;
    for (const r of [g.colonies.ofColony(dc), ...g.colonies.ofSuzerain(dc)].filter(Boolean)) g.colonies.drop(r);
    const other = g.castlesOf(dp).find(x => x !== dc);
    for (const x of Object.values(this.list())){
      if (x.playerId !== dp.id || x.castleId !== dc.id) continue;
      x.castleId = other.id;
      const h = g.heroes.find(dc, x.heroId);
      if (h){ dc.heroes = g.heroes.list(dc).filter(y => y !== h); g.heroes.list(other).push(h); g.pushHero(other, h, 0); }
    }
    const captives = [];
    for (const h of [...g.heroes.list(dc)]) if (h.status !== HERO_STATUS.SEIZED) captives.push(g.captives.capture(h, dc, dc, dp, now));
    dp.castles = dp.castles.filter(id => id !== dc.id); p.castles.push(dc.id);
    dc.playerId = p.id;
    if (this.db.tiles[dc.fieldId]) this.db.tiles[dc.fieldId].playerId = p.id;
    dc.trainQ = {}; dc.wounded = {}; dc.policies = null; dc.loyalty = 100 - dc.taxRate;
    for (const [k, n] of Object.entries(a.troops)) if (n > 0) dc.troops[k] = addTroops(dc.troops[k], n);
    for (const [k, v] of Object.entries(a.loot || {})) dc.res[k] = (dc.res[k] || 0) + v;
    a.troops = {}; a.loot = null; a.carry = {};
    if (hero && c){ c.heroes = g.heroes.list(c).filter(h => h !== hero); hero.status = HERO_STATUS.FREE; g.heroes.list(dc).push(hero); g.pushHero(c, hero, 1); }
    g.store.touch();
    g.push(dp.id, 'server.CastleUpdate', { updateType: 1, castleBean: { id: dc.id, name: dc.name, fieldId: dc.fieldId } });
    g.pushCastle(dc, 0); g.pushPlayerInfo(p); g.pushPlayerInfo(dp); g.pushArmies(dp); g.pushTroops(c);
    g.effort.note(p, 'seize'); g.effort.note(p, 'captive', captives.length);
    g.log.info(`${p.name} took ${dp.name}'s ${dc.name}${captives.length ? `, capturing ${captives.map(h => h.name).join(', ')}` : ''}`);
    return { castle: dc, lord: dp, captives, captive: null, heldIn: null };
  }

  // ---------- incoming armies (the Beacon Tower) ----------
  // The city a march is heading for: the city on the tile, or the one holding the valley.
  targetCity(a){ const t = world.tileAt(this.g.store, a.target), id = t.type === world.T.CASTLE ? t.castleId : t.ownerCastle; return id ? this.db.castles[id] || null : null; }
  hostile(a){ return a.direction === DIR.FORWARD && [MISSION.SCOUT, MISSION.OCCUPY, MISSION.COLONIZE].includes(a.mission); }
  incoming(c){ return Object.values(this.list()).filter(a => a.playerId !== c.playerId && this.hostile(a) && this.targetCity(a) === c); }
  // Other lords' Scouts, attacks and Colonize marches on their way to lord p's cities and valleys, as the
  // target city's Beacon Tower sees them. The wiki's table: level 1 warns of the march, 2 its purpose, 3 the
  // arrival time, 4 the lord, 5 where it set out from, 6 the kinds of troops, 7 roughly how many, 8 exactly how
  // many, 9 the hero leading it (rules.beacon). What it can't see goes the way the client shows it unknown:
  // no name ("--"), field -1 ("(- -)"), no time ("- -").
  enemies(p){
    const out = [];
    for (const c of this.g.castlesOf(p)){
      const L = this.g.logic.level(c, 30);
      if (L >= 1) for (const a of this.incoming(c)) out.push(this.enemyBean(a, L));
    }
    return out.sort((x, y) => (x.reachTime || 0) - (y.reachTime || 0));
  }
  enemyBean(a, L){
    const b = this.bean(a), r = { purpose: 2, arrival: 3, lord: 4, origin: 5, kinds: 6, rough: 7, exact: 8, hero: 9, ...(this.g.rules.beacon || {}) }, at = k => L >= r[k];
    const troop = {};
    for (const t of Object.values(this.g.data.troops)){
      const n = Math.round((a.troops[t.field] || 0) * this.g.stratagems.armyShown(a));   // (Bluffing, Cover up Army Maneuvers)
      troop[t.field] = !n || !at('kinds') ? '0' : at('exact') ? String(n) : at('rough') ? String(this.scoutWord(n)) : '?';
    }
    return { ...b, missionType: at('purpose') ? b.missionType : 0, startTime: at('arrival') ? b.startTime : 0, reachTime: at('arrival') ? b.reachTime : 0,
      king: at('lord') ? b.king : null, startFieldId: at('origin') ? b.startFieldId : -1, startPosName: at('origin') ? b.startPosName : null,
      hero: at('hero') ? b.hero : null, heroLevel: at('hero') ? b.heroLevel : 0, heroid: 0, troop, resource: { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 } };
  }

  // ---------- data for the client ----------
  typeOf(field){ return Object.values(this.g.data.troops).find(t => t.field === field)?.id || 0; }
  byType(troops, zeros = false){ const o = {}; for (const [f, n] of Object.entries(troops || {})) if (n > 0 || (zeros && n === 0)) o[this.typeOf(f)] = n; return o; }
  fortsByType(forts){ const o = {}; for (const x of Object.values(this.g.data.forts)) if ((forts || {})[x.field] > 0) o[x.id] = forts[x.field]; return o; }
  buildingSummary(c){
    const m = {};
    for (const b of Object.values(c.buildings)) if (b.level > 0) (m[b.typeId] = m[b.typeId] || []).push(b.level);
    return Object.entries(m).map(([type, lv]) => ({ type: Number(type), levels: lv.sort((x, y) => y - x).join(',') }));
  }
  bean(a){
    const g = this.g, p = this.db.players[a.playerId], c = this.db.castles[a.castleId], hero = c ? g.heroes.find(c, a.heroId) : null;
    const troop = {}; for (const t of Object.values(g.data.troops)) troop[t.field] = String(a.troops[t.field] || 0);
    const r = {}; for (const k of RES) r[k] = Math.floor((a.direction === DIR.BACK ? (a.loot?.[k] || 0) : 0) + (a.carry?.[k] || 0));
    return { armyId: a.id, missionType: a.mission, direction: a.direction, startTime: a.startTime, reachTime: a.reachTime, restTime: a.restTime || 0,
      startFieldId: a.from, targetFieldId: a.target, startPosName: this.placeName(a.from, false), targetPosName: this.placeName(a.target, false),
      hero: hero ? hero.name : '', heroLevel: hero ? hero.level : 0, heroid: hero ? hero.id : 0, king: p ? p.name : '', alliance: g.alliances.of(p)?.name || '', troop, resource: r, selected: false };
  }
  beans(p){ return this.of(p).map(a => this.bean(a)); }
}

module.exports = { ArmyLogic, MISSION, DIR, distance, VALLEY_RES, valleyBonus };
