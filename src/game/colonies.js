'use strict';
// Colonies. Everything here follows the client (ColonyConstants, ColonyCommands, FieldInfoWin, ColonyInfoWin,
// SuzerainInfoWin, ArmyInColonie, ColonyBar, the battle report and its texts) and Fox's live answers
// (rules.colonies):
//   1. Colonize (the map's Colonize button, march mission 7) another lord's ordinary city. A won first fight
//      starts the Colonization Period (8 hours): the army stays in the city ("Attackers won the battle, Troops
//      stationed in the target city"), and the lord can send more troops to it (Send). At the end the
//      Stabilization battle is fought: the stationed troops against the city's troops and defenses. Won, the city
//      becomes the lord's Protectorate and the army comes home; lost, the colonization fails.
//   2. A Protectorate pays tribute (5% of what it produces, continuously; the Town Hall's "Colonies Tributes"
//      and "Tributes paid" rows) and its suzerain may use one policy on it a day, all sharing one cool down that
//      ends at the daily maintenance: Tax Imposition, Food Levy, Population Redeployment (10% each of its gold,
//      food or idle population), Draft (10% of one branch of troops joins the suzerain city), Disarmament (10% of
//      one branch disbanded) and Sow Discord (every hero there loses 30 loyalty, with a chance to capture one if
//      the suzerain city's Feasting Hall has a free seat).
//   3. The suzerain sets a suppression army: a percentage of each kind of troop in the suzerain city ("You can
//      set a percentage of the troops in your Suzerain city, as the suppression Army"), within the Rally Spot's
//      dispatch limit; lowering it has a 5-hour cool down.
//   4. The colony's lord can Uprise: "Your city's army fight your suzerain's suppression army in 30 minutes."
//      Then the suppression army fights the colony's troops and defenses: won, the city stays a Protectorate;
//      lost (or no army set), it is free. Before that the suzerain may also attack it (an attack on an uprising
//      colony is a suppression); a won attack ends the uprising.
//   5. The suzerain can Abandon a colony: it is handed back after abandonHours, or at once with Instant Handover.
// Not done: Anti-Colonization quests (commission quests), and colonies in alliance wars.
const world = require('./world');
const { REPORT_TYPE, battleXml, stamp } = require('./reports');
const { HERO_STATUS } = require('./heroes');

const STATUS = { FREE: 0, ATTACKING: 1, OCCUPIED: 2, UPRISING: 3, ABANDON: 4 };
const RELATION = { NULL: 0, FREE: 1, BEING_COLONIED: 2, COLONYING: 3 };
const CASTLE = { FREE: 0, SUZERAIN: 1, COLONY: 2 };
const HELD = new Set([STATUS.OCCUPIED, STATUS.UPRISING, STATUS.ABANDON]);
const RES = ['food', 'wood', 'stone', 'iron', 'gold'];
const DIR_STAY = 3, DIR_BACK = 2, MISSION_COLONIZE = 7;
const POLICY = {
  tax: 'Tax Imposition', food: 'Food Levy', population: 'Population Redeployment', draft: 'Draft', disarm: 'Disarmament', sow: 'Sow Discord',
};
const pad = n => String(n).padStart(2, '0');
const dateTime = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const esc = s => String(s ?? '').replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));
const xml = (name, a) => `<reportData><${name}${Object.entries(a).filter(([, v]) => v != null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}/></reportData>`;
const N = n => Math.floor(n).toLocaleString('en-US');

class Colonies {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.colonies || {}; }
  list(){ return this.db.colonies || (this.db.colonies = {}); }
  records(){ return Object.values(this.list()); }
  // Hours of game time in real milliseconds.
  ms(hours){ return hours * 3600000 / this.g.logic.speed; }
  today(now){ return this.g.npc.day(now); }
  castle(id){ return this.db.castles[id] || null; }
  player(id){ return this.db.players[id] || null; }
  // The record that makes this city a colony (or is colonizing it), and the ones where it is the suzerain.
  ofColony(c){ return c ? this.records().find(r => r.colonyCastleId === c.id) || null : null; }
  ofSuzerain(c){ return c ? this.records().filter(r => r.suzerainCastleId === c.id) : []; }
  colonyOf(c, targetCastleId){ return this.ofSuzerain(c).find(r => r.colonyCastleId === Number(targetCastleId)) || null; }
  // CastleBean.colonization: 2 a colony, 1 a suzerain, 0 free. (The client only reads it at login.)
  colonization(c){
    const own = this.ofColony(c);
    if (own && HELD.has(own.status)) return CASTLE.COLONY;
    return this.ofSuzerain(c).some(r => HELD.has(r.status)) ? CASTLE.SUZERAIN : CASTLE.FREE;
  }
  // Colonies a lord holds or is colonizing (and Colonize marches on the way), all of them or from city c.
  count(p, self = null, c = null){
    const marching = Object.values(this.db.armies || {}).filter(a => a !== self && a.playerId === p.id && a.mission === MISSION_COLONIZE && a.direction === 1 && (!c || a.castleId === c.id)).length;
    return this.records().filter(r => r.suzerainPlayerId === p.id && (!c || r.suzerainCastleId === c.id)).length + marching;
  }
  // The limit, if any (rules.colonies.max for a lord, perCity for one city). Fox holds 28 colonies from one city
  // on the live game, so there is none by default.
  limit(p, c, self = null){
    const r = this.rules, all = this.count(p, self), here = this.count(p, self, c);
    if (r.max != null && all >= r.max) return { have: all, max: r.max, what: 'a lord' };
    if (r.perCity != null && here >= r.perCity) return { have: here, max: r.perCity, what: 'one city' };
    return null;
  }
  place(c){ return c ? this.g.armies.placeName(c.fieldId) : ''; }
  position(c){ const { x, y } = world.xy(c.fieldId); return `${x},${y}`; }

  // ---------- colonizing ----------
  // Why lord p can't colonize the city on `tile` from city c, or null. `self` is the march being checked on arrival.
  cantColonize(p, c, tile, now, self = null){
    if (this.rules.enabled === false) return [-13, "Colonies aren't turned on on this server."];
    if (tile.type !== world.T.CASTLE) return [-13, "Only lords' cities can be colonized, not NPC cities or valleys."];
    const dc = this.castle(tile.castleId);
    if (!dc || !this.player(dc.playerId)) return [-13, 'There is no city there.'];
    if (dc.playerId === p.id) return [-13, 'You cannot colonize your own city.'];
    if ((dc.powerLevel ?? 4) !== 4) return [-13, "Historic Cities can't be colonized."];
    if (this.colonization(c) === CASTLE.COLONY) return [-13, 'You need to regain your freedom first before you can colonize the city.'];
    const rec = this.ofColony(dc);
    if (rec){
      const mine = rec.suzerainPlayerId === p.id;
      if (rec.status === STATUS.ATTACKING) return [-13, mine ? 'Your army is already colonizing that city.' : 'Another lord is colonizing that city.'];
      return [-13, mine ? 'That city is already your Protectorate.' : "That city is already another lord's Protectorate."];
    }
    const lim = this.limit(p, c, self);
    if (lim) return [-13, `Tributary cities have reached the limit.You cannot launch more 'Colonize' attacks. (This server allows ${lim.max} for ${lim.what}, counting colonizations under way.)`];
    // Colonize is an attack: it takes a war with the city's lord (war.js; FieldInfoWin enables it only in wartime).
    return this.g.war.cantAttack(p, dc, now);
  }
  // A won Colonize attack: the Colonization Period begins and the army stays in the city.
  begin(a, p, c, dc, now){
    const id = this.g.store.id();
    const rec = this.list()[id] = { id, suzerainCastleId: c.id, suzerainPlayerId: p.id, colonyCastleId: dc.id, colonyPlayerId: dc.playerId, status: STATUS.ATTACKING,
      createdAt: now, startTime: now, endTime: now + this.ms(this.rules.periodHours ?? 8), armies: [], deploy: {}, policyDay: null, withdrawUntil: 0 };
    this.park(a, rec, now);
    this.g.store.touch();
    this.push(rec);
    this.g.log.info(`${p.name} began colonizing ${dc.name}; the Stabilization battle is at ${new Date(rec.endTime).toLocaleString()}`);
    return rec;
  }
  park(a, rec, now){
    Object.assign(a, { direction: DIR_STAY, startTime: now, reachTime: rec.endTime, colonyId: rec.id });
    if (!rec.armies.includes(a.id)) rec.armies.push(a.id);
  }
  stationed(rec){ return (rec.armies || []).map(id => this.db.armies?.[id]).filter(a => a && a.direction === DIR_STAY && a.colonyId === rec.id); }
  // Send from the colonizing lord to the city during the Colonization Period: the troops join the stationed army.
  canReinforce(p, dest){ const rec = this.ofColony(dest); return !!rec && rec.status === STATUS.ATTACKING && rec.suzerainPlayerId === p.id; }
  reinforce(a, p, dest, now){
    const rec = this.ofColony(dest);
    if (!rec || rec.status !== STATUS.ATTACKING || rec.suzerainPlayerId !== p.id) return false;
    this.park(a, rec, now);
    this.g.store.touch();
    return true;
  }
  sendHome(a, now){
    if (!a) return;
    delete a.colonyId;
    Object.assign(a, { direction: DIR_BACK, startTime: now, reachTime: now + (a.oneWay || 1000) });
  }

  // The Stabilization battle at the end of the Colonization Period: every stationed army together, led by the
  // first one's hero, against the city's troops and defenses.
  stabilize(rec, now){
    const g = this.g, c = this.castle(rec.suzerainCastleId), dc = this.castle(rec.colonyCastleId), p = this.player(rec.suzerainPlayerId), dp = dc && this.player(dc.playerId);
    const armies = this.stationed(rec);
    if (!c || !dc || !p || !dp || !armies.length) return this.fail(rec, now, armies.length ? 'The city is gone.' : 'Your troops left the city.');
    const lead = armies[0], home = this.castle(lead.castleId) || c, hero = g.heroes.find(home, lead.heroId);
    const troops = {};
    for (const a of armies) for (const [k, n] of Object.entries(a.troops)) if (n > 0) troops[k] = (troops[k] || 0) + n;
    const b = g.armies.cityBattle(p, home, hero, troops, dc, now);
    // What's left goes back to each army in proportion to what it brought.
    for (const k of Object.keys(troops)){
      const left = b.left[k] || 0; let given = 0;
      for (const a of armies){ const n = Math.floor((a.troops[k] || 0) * left / troops[k]); a.troops[k] = n; given += n; }
      lead.troops[k] += left - given;
    }
    const colony = { isSuppress: true };
    g.reports.add(p, { type: REPORT_TYPE.ARMY, armyType: MISSION_COLONIZE, startPos: this.place(home), targetPos: this.place(dc), title: b.won ? `${dc.name} is now your Protectorate` : `Colonization of ${dc.name} failed`,
      content: battleXml({ ...b.body, isAttack: true, won: b.won, colony, injuredPer: b.injuredPer, autoHeal: g.armies.healXml(b.attHeal, home), honor: b.honor?.att }) });
    g.reports.add(dp, { type: REPORT_TYPE.ARMY, armyType: MISSION_COLONIZE, attack: false, startPos: this.place(home), targetPos: this.place(dc), title: b.won ? `${dc.name} became ${p.name}'s Protectorate` : `${dc.name} resisted ${p.name}'s colonization`,
      content: battleXml({ ...b.body, isAttack: false, won: b.won, colony, injuredPer: b.injuredPer, autoHeal: g.armies.healXml(b.defHeal, dc), honor: b.honor?.def }) });
    for (const a of armies) this.sendHome(a, now);
    if (b.won){
      Object.assign(rec, { status: STATUS.OCCUPIED, since: now, startTime: now, endTime: 0, armies: [] });
      g.log.info(`${p.name} won the Stabilization battle: ${dc.name} is now a Protectorate of ${c.name}`);
    } else {
      delete this.list()[rec.id];
      g.log.info(`${p.name} lost the Stabilization battle at ${dc.name}`);
    }
    g.store.touch();
    this.push(rec, true);
    g.pushArmies(p);
    for (const a of armies) if (a.heroId){ const hc = this.castle(a.castleId), h = hc && g.heroes.find(hc, a.heroId); if (h) g.pushHero(hc, h, 2); }
  }
  // The colonization ends without a battle (the stationed troops were recalled, or a city is gone).
  fail(rec, now, why){
    const g = this.g, p = this.player(rec.suzerainPlayerId), dc = this.castle(rec.colonyCastleId), dp = dc && this.player(dc.playerId);
    for (const a of this.stationed(rec)) this.sendHome(a, now);
    delete this.list()[rec.id];
    const name = dc ? dc.name : 'the city';
    if (p) g.reports.add(p, { type: REPORT_TYPE.OTHER, title: `Colonization of ${name} called off`, content: `${why} The colonization of ${name} has ended.` });
    if (dp) g.reports.add(dp, { type: REPORT_TYPE.OTHER, title: `${p ? p.name : 'The enemy'} gave up colonizing ${name}`, content: `The colonizing army left ${name}. Your city is free.` });
    g.store.touch();
    this.push(rec, true);
    if (p) g.pushArmies(p);
  }

  // ---------- uprising ----------
  uprise(c, p, now){
    const rec = this.ofColony(c);
    if (!rec || rec.colonyPlayerId !== p.id || !HELD.has(rec.status)) return [-1, 'This city is not a colony. Switch to the colony city to rise up.'];
    if (rec.status === STATUS.UPRISING) return [-1, 'This city is already rising up.'];
    if (rec.status === STATUS.ABANDON) return [-1, 'Your suzerain is already handing this city back.'];
    const g = this.g, sc = this.castle(rec.suzerainCastleId), sp = this.player(rec.suzerainPlayerId);
    Object.assign(rec, { status: STATUS.UPRISING, startTime: now, endTime: now + this.ms((this.rules.uprisingMinutes ?? 30) / 60) });
    const a = { startTime: stamp(rec.startTime), endTime: stamp(rec.endTime) };
    g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(sc), title: `${c.name} rose up against ${sp ? sp.name : 'its suzerain'}`, content: xml('uprisingWarReport', { isColony: true, ...a }) });
    if (sp) g.reports.add(sp, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(sc), title: `Uprising in your Protectorate ${c.name}`, content: xml('uprisingWarReport', { isColony: false, ...a }) });
    g.quests.flag(p, 'uprising');
    g.store.touch();
    this.push(rec);
    g.log.info(`${p.name}'s ${c.name} rose up against ${sp ? sp.name : '?'}`);
    return {};
  }
  // The uprising colony of lord p's in city dc, if there is one (an attack on it is a suppression).
  rising(p, dc){ const rec = this.ofColony(dc); return rec && rec.status === STATUS.UPRISING && rec.suzerainPlayerId === p.id ? rec : null; }
  // A won attack on an uprising colony ends the uprising.
  suppressed(rec, now){
    Object.assign(rec, { status: STATUS.OCCUPIED, startTime: now, endTime: 0 });
    this.g.store.touch();
    this.push(rec);
  }
  // The deployed suppression army: the set share of each kind of troop in the suzerain city, scaled down to the
  // Rally Spot's dispatch limit if the city has grown.
  suppressionArmy(rec, c, p, now){
    const t = {}; let total = 0;
    for (const [k, pct] of Object.entries(rec.deploy || {})){ const n = Math.floor((c.troops[k] || 0) * Math.max(0, Math.min(100, pct)) / 100); if (n > 0){ t[k] = n; total += n; } }
    const limit = this.g.armies.troopLimit(c, p, false, now);
    if (total > limit) for (const k of Object.keys(t)) t[k] = Math.floor(t[k] * limit / total);
    return t;
  }
  // The end of the uprising war: the suppression army fights the colony.
  uprisingEnd(rec, now){
    const g = this.g, sc = this.castle(rec.suzerainCastleId), dc = this.castle(rec.colonyCastleId), sp = this.player(rec.suzerainPlayerId), dp = dc && this.player(dc.playerId);
    if (!sc || !dc || !sp || !dp) return this.drop(rec);
    g.logic.settle(sc, sp, now);
    const troops = this.suppressionArmy(rec, sc, sp, now);
    if (!Object.values(troops).some(n => n > 0)){
      g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: this.place(dc), targetPos: this.place(sc), title: `${dc.name} is free`, content: `${sp.name} sent no suppression army. Your troops won the uprising war, and your city regained freedom.` });
      g.reports.add(sp, { type: REPORT_TYPE.OTHER, startPos: this.place(dc), targetPos: this.place(sc), title: `${dc.name} is free`, content: `No suppression army was set in ${sc.name}, so ${dc.name}'s uprising succeeded. The Protectorate city was freed from your colonization.` });
      g.log.info(`${dc.name} won its uprising against ${sp.name} (no suppression army)`);
      return this.drop(rec, true);
    }
    for (const [k, n] of Object.entries(troops)) sc.troops[k] -= n;
    const b = g.armies.cityBattle(sp, sc, null, troops, dc, now);
    for (const [k, n] of Object.entries(b.left)) if (n > 0) sc.troops[k] = (sc.troops[k] || 0) + n;
    g.pushTroops(sc);
    const colony = { isUprising: true };
    g.reports.add(sp, { type: REPORT_TYPE.ARMY, startPos: this.place(sc), targetPos: this.place(dc), title: b.won ? `Uprising in ${dc.name} suppressed` : `${dc.name} won its uprising`,
      content: battleXml({ ...b.body, isAttack: true, won: b.won, colony, injuredPer: b.injuredPer, autoHeal: g.armies.healXml(b.attHeal, sc), honor: b.honor?.att }) });
    g.reports.add(dp, { type: REPORT_TYPE.ARMY, attack: false, startPos: this.place(sc), targetPos: this.place(dc), title: b.won ? `${dc.name}'s uprising was suppressed` : `${dc.name} regained its freedom`,
      content: battleXml({ ...b.body, isAttack: false, won: b.won, colony, injuredPer: b.injuredPer, autoHeal: g.armies.healXml(b.defHeal, dc), honor: b.honor?.def }) });
    g.log.info(`Uprising war at ${dc.name}: ${b.won ? `suppressed by ${sp.name}` : 'the colony won'}`);
    if (b.won) return this.suppressed(rec, now);
    this.drop(rec, true);
  }
  // The colony is free again.
  drop(rec, report = false){
    for (const a of this.stationed(rec)) this.sendHome(a, this.g.now());
    delete this.list()[rec.id];
    this.g.store.touch();
    this.push(rec, true);
    return report;
  }

  // ---------- abandoning ----------
  abandon(c, p, target, now){
    const rec = this.colonyOf(c, target);
    if (!rec) return [-1, 'That city is not a Protectorate of this city.'];
    if (rec.status === STATUS.ATTACKING) return [-1, 'Recall your stationed troops to call off the colonization.'];
    if (rec.status === STATUS.ABANDON) return [-1, 'That city is already being handed back.'];
    if (rec.status === STATUS.UPRISING) return [-1, 'That city is rising up. Deal with the uprising first.'];
    Object.assign(rec, { status: STATUS.ABANDON, startTime: now, endTime: now + this.ms(this.rules.abandonHours ?? 12) });
    this.g.store.touch();
    this.push(rec);
    return {};
  }
  speedUpAbandon(c, p, target, itemId, now){
    const rec = this.colonyOf(c, target);
    if (!rec || rec.status !== STATUS.ABANDON) return [-1, 'That city is not being handed back.'];
    if (itemId !== 'instant.handover') return [-1, 'Use an Instant Handover.'];
    if (!(p.items?.[itemId] > 0)) return [-44, 'You have no Instant Handover.'];
    p.items[itemId] -= 1;
    this.abandonEnd(rec, now);
    return { usedItem: itemId };
  }
  abandonEnd(rec, now){
    const g = this.g, sc = this.castle(rec.suzerainCastleId), dc = this.castle(rec.colonyCastleId), sp = this.player(rec.suzerainPlayerId), dp = dc && this.player(dc.playerId);
    if (sp && dc) g.reports.add(sp, { type: REPORT_TYPE.OTHER, startPos: this.place(sc), targetPos: this.place(dc), title: `You gave up ${dc.name}`, content: xml('ColonyAbadonReport', { isColony: false, colony: dc.name }) });
    if (dp && sc) g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: this.place(sc), targetPos: this.place(dc), title: `${dc.name} is free`, content: xml('ColonyAbadonReport', { isColony: true, suzerain: sp ? sp.name : sc.name, colony: dc.name }) });
    this.drop(rec);
  }

  // ---------- policies ----------
  policyLeft(rec, now){ return rec.status === STATUS.OCCUPIED && rec.policyDay !== this.today(now); }
  held(c, target, now){
    const rec = this.colonyOf(c, target);
    if (!rec || !HELD.has(rec.status)) return [-1, 'That city is not a Protectorate of this city.'];
    if (rec.status !== STATUS.OCCUPIED) return [-1, rec.status === STATUS.UPRISING ? 'That city is rising up against you.' : 'That city is being handed back.'];
    if (rec.policyDay === this.today(now)) return [-1, 'You have already used a policy on this colony today. Policies come back after the daily maintenance.'];
    const dc = this.castle(rec.colonyCastleId), dp = dc && this.player(dc.playerId);
    if (!dc || !dp) return [-1, 'That city is gone.'];
    return { rec, dc, dp };
  }
  idle(c){ return this.g.policies.idle(c); }
  troopName(field){ return Object.values(this.g.data.troops).find(t => t.field === field)?.name || field; }
  levy(c, p, target, kind, now){
    const g = this.g, h = this.held(c, target, now);
    if (Array.isArray(h)) return h;
    const { rec, dc, dp } = h, share = this.rules.policyShare ?? 0.1;
    g.logic.settle(c, p, now); g.logic.settle(dc, dp, now);
    let amount = 0, armyType = '';
    if (kind === 'tax' || kind === 'food'){
      const k = kind === 'tax' ? 'gold' : 'food';
      amount = Math.floor((dc.res[k] || 0) * share);
      dc.res[k] -= amount; c.res[k] = (c.res[k] || 0) + amount;
    } else if (kind === 'population'){
      amount = Math.floor(this.idle(dc) * share);
      dc.pop -= amount; c.pop = (c.pop || 0) + amount;
    } else {
      const field = g.policies.biggest(dc.troops);
      if (!field) return [-1, 'That city has no troops.'];
      amount = Math.floor(dc.troops[field] * share); armyType = this.troopName(field);
      dc.troops[field] -= amount;
      if (kind === 'draft') c.troops[field] = (c.troops[field] || 0) + amount;
    }
    rec.policyDay = this.today(now);
    const name = POLICY[kind];
    if (kind === 'tax' || kind === 'food'){
      const got = { food: 0, lumber: 0, stone: 0, iron: 0, gold: 0, [kind === 'tax' ? 'gold' : 'food']: amount };
      g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `${name} on ${dc.name}`, content: xml('ImpositionReport', { isColony: false, colony: dc.name, ...got }) });
      g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `${p.name} used ${name} on ${dc.name}`, content: xml('ImpositionReport', { isColony: true, suzerain: p.name, colony: dc.name, ...got }) });
    } else {
      const what = kind === 'population' ? `${N(amount)} people` : `${N(amount)} ${armyType}`;
      const verb = { population: ['moved to', 'taken'], draft: ['joined the army in', 'taken'], disarm: ['disbanded in', 'disbanded'] }[kind];
      g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `${name} on ${dc.name}`, content: xml('policyReport', { detail: kind === 'disarm' ? `${name} on your Protectorate ${dc.name}: ${what} disbanded.` : `${name} on your Protectorate ${dc.name}: ${what} ${verb[0]} ${c.name}.` }) });
      g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `${p.name} used ${name} on ${dc.name}`, content: xml('policyReport', { detail: `${p.name} issued ${name} from ${c.name} on your city ${dc.name}: ${what} ${verb[1]}.` }) });
    }
    g.store.touch();
    for (const x of [c, dc]){ g.pushResources(x); g.pushTroops(x); }
    this.push(rec);
    g.log.info(`${p.name} used ${name} on ${dc.name}: ${N(amount)}${armyType ? ' ' + armyType : ''}`);
    return { amount, armyType };
  }
  // Sow Discord: every hero in the colony loses loyalty, and one may be captured into the suzerain city.
  sowDiscord(c, p, target, now, rnd = Math.random){
    const g = this.g, h = this.held(c, target, now);
    if (Array.isArray(h)) return h;
    const { rec, dc, dp } = h, drop = this.rules.sowDiscordLoyalty ?? 30, start = g.rules.heroStartLoyalty ?? 70;
    const heroes = g.heroes.list(dc).filter(x => x.status !== HERO_STATUS.SEIZED);
    for (const x of heroes) x.loyalty = Math.max(0, (x.loyalty ?? start) - drop);
    let captured = null;
    const free = heroes.filter(x => x.status === HERO_STATUS.FREE);
    if (free.length && g.heroes.vacancies(c) > 0 && rnd() < (this.rules.sowCaptureChance ?? 0.2)){
      captured = free.reduce((a, b) => (b.loyalty < a.loyalty ? b : a));
      g.captives.capture(captured, dc, c, dp, now);   // its lord counts it lost (Stone of Finding)
      g.effort.note(p, 'captive');
    }
    rec.policyDay = this.today(now);
    g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `${p.name} used Sow Discord on ${dc.name}`,
      content: `<reportData><sowDiscordReport suzerainLord="${esc(p.name)}" suzerainCastle="${esc(this.place(c))}">${captured ? `<capturedHero heroName="${esc(captured.name)}" heroLevel="${captured.level}" heroURL="${esc(g.heroes.bean(captured).logoUrl)}"/>` : ''}</sowDiscordReport></reportData>` });
    g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: this.place(c), targetPos: this.place(dc), title: `Sow Discord on ${dc.name}`,
      content: xml('policyReport', { detail: `Sow Discord on your Protectorate ${dc.name}: the loyalty of ${heroes.length} hero${heroes.length === 1 ? '' : 'es'} fell by ${drop}.${captured ? ` ${captured.name} (level ${captured.level}) was captured and is held in the Feasting Hall in ${c.name}.` : ''}` }) });
    for (const x of heroes) if (x !== captured) g.pushHero(dc, x, 2);
    g.store.touch();
    this.push(rec);
    return { captured };
  }

  // ---------- the suppression army ----------
  deployInfo(c, p, target, now){
    const rec = this.colonyOf(c, target);
    if (!rec || !HELD.has(rec.status)) return [-1, 'That city is not a Protectorate of this city.'];
    const t = {}; for (const x of Object.values(this.g.data.troops)) t[x.field] = Math.floor(rec.deploy?.[x.field] || 0);
    return { troopBean: t, reduceCoolDown: Math.max(0, (rec.withdrawUntil || 0) - now) };
  }
  setDeploy(c, p, target, bean, now){
    const g = this.g, rec = this.colonyOf(c, target);
    if (!rec || !HELD.has(rec.status)) return [-1, 'That city is not a Protectorate of this city.'];
    if (rec.status === STATUS.ABANDON) return [-1, 'That city is being handed back.'];
    const want = {}; let lowered = false, total = 0;
    for (const x of Object.values(g.data.troops)){
      const v = Math.floor(Number(bean?.[x.field]) || 0);
      if (v < 0 || v > 100) return [-1, 'Set a share from 0 to 100 percent for each kind of troop.'];
      if (v) want[x.field] = v;
      if (v < (rec.deploy?.[x.field] || 0)) lowered = true;
      total += Math.floor((c.troops[x.field] || 0) * v / 100);
    }
    const wait = (rec.withdrawUntil || 0) - now;
    if (lowered && wait > 0) return [-1, `You can modify your deploying troops again in ${this.duration(wait)}.`];
    g.logic.settle(c, p, now);
    const limit = g.armies.troopLimit(c, p, false, now);
    if (total > limit) return [-1, `That suppression army would be ${N(total)} troops. The amount of the troops deployment cannot exceed the troops dispatch limit (${N(limit)}).`];
    rec.deploy = want;
    if (lowered) rec.withdrawUntil = now + this.ms(this.rules.withdrawHours ?? 5);
    g.store.touch();
    return {};
  }
  duration(ms){ const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`; }

  // ---------- what the client shows ----------
  overview(c, p, target){
    const rec = this.colonyOf(c, target);
    if (!rec || !HELD.has(rec.status)) return [-1, 'That city is not a Protectorate of this city.'];
    const dc = this.castle(rec.colonyCastleId), dp = dc && this.player(dc.playerId);
    if (!dc || !dp) return [-1, 'That city is gone.'];
    this.g.logic.settle(dc, dp, this.g.now());
    return { castleBean: this.g.beans.castle(dc, dp) };
  }
  // The armies in or heading to a colony.
  armyInfo(c, p, target){
    const rec = this.colonyOf(c, target), dc = this.castle(Number(target));
    if (!dc) return { armyBeans: [] };
    const here = Object.values(this.db.armies || {}).filter(a => a.playerId === p.id && a.target === dc.fieldId && (a.direction !== DIR_BACK) && (!a.colonyId || a.colonyId === rec?.id));
    return { armyBeans: here.map(a => this.g.armies.bean(a)) };
  }
  // ColonyBean: the other city of the relation, seen from this side.
  bean(rec, side, now = this.g.now()){
    const other = this.castle(side === 'suzerain' ? rec.colonyCastleId : rec.suzerainCastleId), op = other && this.player(other.playerId);
    if (!other || !op) return null;
    return { castleId: other.id, cityName: other.name, lordName: op.name, position: this.position(other), prestige: Math.floor(op.prestige || 0), allianceName: '',
      relation: side === 'suzerain' ? RELATION.COLONYING : RELATION.BEING_COLONIED, status: rec.status, startTime: rec.startTime || 0, endTime: rec.endTime || 0,
      time: dateTime(rec.since || rec.createdAt), isCanLevy: side === 'suzerain' && this.policyLeft(rec, now), isCanOverview: side === 'suzerain' && HELD.has(rec.status) };
  }
  beans(c, now = this.g.now()){
    const own = this.ofColony(c);
    return [...this.ofSuzerain(c).map(r => this.bean(r, 'suzerain', now)), ...(own ? [this.bean(own, 'colony', now)] : [])].filter(Boolean);
  }
  // The map's MapCastleBean fields for city c as lord `me` sees it: colonialRelation COLONYING for a city he is
  // colonizing or holds, BEING_COLONIED for his own colony and for its suzerain (FieldInfoWin then shows Uprise),
  // NULL for another lord's colony (no Colonize button), FREE otherwise. suzerain: the suzerain lord's name.
  mapFields(c, me){
    const rec = this.ofColony(c), sp = rec && this.player(rec.suzerainPlayerId);
    const suzerain = rec && HELD.has(rec.status) && sp ? sp.name : '';
    const out = (relation, status) => ({ colonialRelation: relation, colonialStatus: status, suzerain, canColonize: relation === RELATION.FREE && !!me && c.playerId !== me.id && (c.powerLevel ?? 4) === 4 });
    if (rec && me && rec.suzerainPlayerId === me.id) return out(RELATION.COLONYING, rec.status);
    if (rec && me && rec.colonyPlayerId === me.id) return out(RELATION.BEING_COLONIED, rec.status);
    const mine = me && this.ofSuzerain(c).find(r => r.colonyPlayerId === me.id);
    if (mine) return out(RELATION.BEING_COLONIED, mine.status);
    if (rec) return out(RELATION.NULL, rec.status);
    return out(RELATION.FREE, STATUS.FREE);
  }
  // Tribute (castle.js rates): what city c pays (negative) and receives (positive) an hour, by resource.
  // `gross` is c's own production before tribute; a suzerain gets the share of each Protectorate's own production.
  tribute(c, gross, now){
    const share = this.rules.tributeShare ?? 0.05, out = { food: 0, wood: 0, stone: 0, iron: 0, gold: 0 };
    if (!share || this.rules.enabled === false) return out;
    const of = r => ({ food: r.food, wood: r.wood, stone: r.stone, iron: r.iron, gold: r.gold + r.salary });
    const own = this.ofColony(c);
    if (own && own.status === STATUS.OCCUPIED){ const g = of(gross); for (const k of RES) out[k] -= Math.max(0, g[k]) * share; }
    for (const r of this.ofSuzerain(c)){
      if (r.status !== STATUS.OCCUPIED) continue;
      const col = this.castle(r.colonyCastleId), cp = col && this.player(col.playerId);
      if (!col || !cp) continue;
      const g = of(this.g.logic.rates(col, cp, now, true));
      for (const k of RES) out[k] += Math.max(0, g[k]) * share;
    }
    return out;
  }

  // ---------- updates ----------
  // server.ColonyUpdate for both cities (the colony bars, the city list's colony marks), their resources (tribute)
  // and, with `armies`, both lords' army lists.
  push(rec, armies = false){
    const g = this.g;
    for (const id of [rec.suzerainCastleId, rec.colonyCastleId]){
      const c = this.castle(id); if (!c) continue;
      g.push(c.playerId, 'server.ColonyUpdate', { castleId: c.id, colonyBeans: this.beans(c) });
      g.pushResources(c);
      if (armies){ const p = this.player(c.playerId); if (p) g.pushArmies(p); }
    }
  }
  tick(now){
    for (const rec of this.records()){
      if (!this.list()[rec.id]) continue;
      try {
        if (!this.castle(rec.suzerainCastleId) || !this.castle(rec.colonyCastleId)){
          if (rec.status === STATUS.ATTACKING) this.fail(rec, now, 'The city is gone.'); else this.drop(rec);
          continue;
        }
        if (rec.status === STATUS.ATTACKING){
          if (!this.stationed(rec).length) this.fail(rec, now, 'Your stationed troops left the city.');
          else if (rec.endTime <= now) this.stabilize(rec, rec.endTime);
        } else if (rec.status === STATUS.UPRISING && rec.endTime <= now) this.uprisingEnd(rec, rec.endTime);
        else if (rec.status === STATUS.ABANDON && rec.endTime <= now) this.abandonEnd(rec, rec.endTime);
      } catch (e){ this.g.log.error(`colony ${rec.id}: ${e.stack || e.message}`); }
    }
  }
}

module.exports = { Colonies, COLONY_STATUS: STATUS, COLONY_RELATION: RELATION, COLONIZATION: CASTLE };
