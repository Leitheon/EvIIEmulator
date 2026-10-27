'use strict';
// Garrisons and stores for NPC cities (levels 1-10, Evony's real numbers in rules.npcLevels), Historic
// Cities (12-18, rules.historicGarrison) and wild valleys (1-10, estimates in rules.garrison); after a fight the losses are kept in db.npc and the
// place recovers fully after rules.npcRecoverHours of game time.
const world = require('./world');

class NpcLogic {
  constructor(rules, speed){ this.rules = rules; this.speed = speed > 0 ? speed : 1; }

  // A valley's or flat's troops (rules.garrison.valley). From level `random.from` on (Fox's live scouts, levels 6-10:
  // "Valleys vary wildly in troop type and count. The higher tier, the more units, but also the higher tier unit,
  // the less of them there are"): one to three of the five kinds, picked anew each day, share the valley's
  // strength equally, a kind's count being its share times its weight (Warriors 9.3, Pikemen 3.16, Swordsmen and
  // Archers 2.11, Cavalry 1: every live report fits these, levels 1 to 10).
  valley(L, id = 0, day = 0){
    const v = this.rules.garrison?.valley || {}, r = v.random;
    if (r && L >= (r.from ?? 6)){
      const pool = [...(r.types || Object.keys(r.weights || {}))], n = 1 + this.pickOf(Math.max(1, r.maxTypes || 3), id, day, 11), chosen = [];
      for (let i = 0; i < n && pool.length; i++) chosen.push(pool.splice(this.pickOf(pool.length, id, day, 12 + i), 1)[0]);
      const vary = 1 + (r.vary ?? 0) * (2 * this.pickOf(1001, id, day, 20) / 1000 - 1);
      const strength = (r.strength || 200) * Math.pow(r.growth || 2, L - (r.from ?? 6)) * vary, o = {};
      for (const k of chosen) o[k] = Math.max(1, Math.round(strength / chosen.length * (r.weights?.[k] || 1)));
      return o;
    }
    if (v.exact?.[L]) return { ...v.exact[L] };
    const total = (v.base || 0) + (v.perLevel || 0) * L, mix = v.mix?.[L] || v.mix?.[10] || {}, o = {};
    for (const [k, share] of Object.entries(mix)){ const n = Math.round(total * share); if (n > 0) o[k] = n; }
    return o;
  }
  scaled(table, L){
    const o = {};
    for (const [field, [per, from]] of Object.entries(table || {})) if (L >= from) o[field] = Math.round(per * L * L);
    return o;
  }
  // Which day it is for the daily reset (either/or Historic City troops change then).
  day(now){ return Math.floor((now - (this.rules.dailyResetHourUTC || 0) * 3600000) / 86400000); }
  pickOf(n, id, day, salt){
    let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(day + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b); h ^= h >>> 16;
    return (h >>> 0) % n;
  }
  // The King or Queen leading a Historic City's defence.
  ruler(tile){
    const hg = this.rules.historicGarrison.hero, s = hg[tile.historic?.level] || hg[12];
    return { name: this.pickOf(2, tile.id, 0, 7) ? 'Queen' : 'King', level: hg.level, attack: s.attack, intelligence: s.intelligence };
  }
  full(tile, now = Date.now()){
    if (tile.type === world.T.NPC && tile.historic){
      const hg = this.rules.historicGarrison, L = tile.historic.level, f = hg.storesFactor[L] || 1, day = this.day(now);
      const troops = {}, forts = { ...hg.forts };
      (hg.levels[L] || hg.levels[12]).forEach(([choices, n], i) => {
        const c = choices[this.pickOf(choices.length, tile.id, day, i)], [k, m] = Array.isArray(c) ? c : [c, n];
        troops[k] = (troops[k] || 0) + m;
      });
      const r = this.rules.npcLevels[10][2];
      return { troops, forts, res: { food: r[0] * f, wood: r[1] * f, stone: r[2] * f, iron: r[3] * f, gold: r[4] * f }, ruler: this.ruler(tile) };
    }
    if (tile.type === world.T.NPC){
      const [t, f, r] = this.rules.npcLevels[Math.max(1, Math.min(10, tile.level))];
      const pick = (fields, v) => Object.fromEntries(fields.map((k, i) => [k, v[i] || 0]).filter(([, n]) => n > 0));
      return { troops: pick(['militia', 'pikemen', 'swordsmen', 'archer', 'lightCavalry'], t),
        forts: pick(['trap', 'abatis', 'arrowTower', 'rollingLogs', 'rockfall'], f),
        res: { food: r[0], wood: r[1], stone: r[2], iron: r[3], gold: r[4] } };
    }
    // Valleys and flats (live, a level 2 flat held 51 warriors and 17 pikemen).
    return { troops: this.valley(tile.level || 1, tile.id || 0, this.day(now)), forts: {}, res: null };
  }
  // Current state of a place. Troops and defenses grow back at 1/3600 of full strength per second of game time
  // (dxcalc; Fox's 27 live attacks on an NPC 8 agree to within a few percent), so a wiped-out NPC is whole again
  // within an hour; stores grow back evenly over rules.npcRecoverHours. A Historic City's defenses come back far
  // slower, about 10% an hour (Fox; rules.npcFortRegen.historicPerHour).
  state(db, tile, now){
    db.npc = db.npc || {};
    const full = { ...this.full(tile, now), loyalty: this.topLoyalty(tile) }, s = db.npc[tile.id];
    if (!s) return { ...full, fresh: true };
    // Everything is full again after the daily reset (the wiki: NPCs refill after server maintenance).
    if (this.day(s.hitAt) < this.day(now)){ delete db.npc[tile.id]; return { ...full, fresh: true }; }
    const secs = Math.max(0, (now - s.hitAt) / 1000 * this.speed), slow = Math.min(1, secs / (this.rules.npcRecoverHours * 3600));
    const grow = (cur, max, rate) => {
      const out = {};
      for (const k of new Set([...Object.keys(max || {}), ...Object.keys(cur || {})])){
        const c = cur?.[k] || 0, m = max?.[k] || 0;
        out[k] = c >= m ? c : Math.min(m, Math.floor(rate(c, m)));
      }
      return out;
    };
    const troops = grow(s.troops, full.troops, (c, m) => c + m * secs / 3600);
    const fr = this.rules.npcFortRegen || {}, perHour = tile.historic ? fr.historicPerHour ?? 0.1 : fr.perHour ?? 1;
    const forts = grow(s.forts, full.forts, (c, m) => c + m * perHour * secs / 3600);
    const res = full.res ? grow(s.res, full.res, (c, m) => c + (m - c) * slow) : null;
    // Loyalty climbs back a point every rules.npcConquest.recoverSeconds.
    const loyalty = full.loyalty == null ? null : Math.min(full.loyalty, (s.loyalty ?? full.loyalty) + secs / (this.rules.npcConquest?.recoverSeconds || 180));
    const whole = obj => Object.entries(obj.max || {}).every(([k, m]) => (obj.cur[k] || 0) >= m);
    if (whole({ cur: troops, max: full.troops }) && whole({ cur: forts, max: full.forts }) && (!res || whole({ cur: res, max: full.res })) && (loyalty == null || loyalty >= full.loyalty)){
      delete db.npc[tile.id];
      return { ...full, fresh: true };
    }
    return { troops, forts, res, ruler: full.ruler, loyalty };
  }
  // An NPC or Historic City's loyalty when untouched (its survey's), or null for a valley.
  topLoyalty(tile){ return tile.type === world.T.NPC ? this.survey(tile).support : null; }
  // What Scouts see besides the garrison (rules.npcSurvey; Fox's live scout reports, Oct 22 2026).
  survey(tile){
    const i = this.techLevel(tile) - 1, s = this.rules.npcSurvey || {};
    return { population: s.population?.[i] ?? 0, support: s.loyalty?.[i] ?? 90 };
  }
  // Live: 20 Cottages, a Barracks, a Sawmill, a Quarry, an Ironmine, 7 + 3 x level Farms and one each of
  // buildings 20-30, all at the city's level. A Historic City is built like a level 10 NPC city, but its four
  // resource buildings are at its own level (12 or 14).
  buildings(tile){
    const L = this.techLevel(tile), F = tile.historic ? tile.historic.level : L, at = (n, l) => Array(n).fill(l).join(',');
    return [{ type: 1, levels: at(20, L) }, { type: 2, levels: at(1, L) }, { type: 4, levels: at(1, F) }, { type: 5, levels: at(1, F) }, { type: 6, levels: at(1, F) },
      { type: 7, levels: at(7 + 3 * L, F) }, ...[20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(type => ({ type, levels: at(1, L) }))];
  }
  // A conquered NPC city's buildings, as createCastle's start.buildings (rules.npcConquest.layout): every
  // building at the city's level, plus a Town Hall and Walls. Outside, the Town Hall allows 13 + 3 x (level - 1)
  // plots (the client's CityView): Farms first, then the Sawmill, Quarry and Ironmine on the last three.
  // A Historic City has only its Town Hall and Walls (10) and one of each resource building at its own level.
  cityLayout(tile){
    const L = this.techLevel(tile), F = tile.historic ? tile.historic.level : L, lay = this.rules.npcConquest?.layout || {};
    const out = { '-1': [31, L], '-2': [32, L] };
    // A Historic City: Town Hall and Walls 10 and one of each resource field at the city's own level (12, 14, 16,
    // Atlantis 18) on plots 1001-1004, and nothing else; the fields can be built up to that level. Fox's live
    // capture of an account with nine level 14 cities (Oct 26 2026), two of them newly taken, shows exactly that:
    // a Farm, Sawmill, Quarry and Ironmine at 14 on 1001-1004, and every Rally Spot one its lord built, at 10.
    // (rules.npcConquest.historicRallySpot: true also gives a Rally Spot at the city's level on plot 11, as Fox
    // first remembered it.)
    if (tile.historic){
      const rally = this.rules.npcConquest?.historicRallySpot ? { 11: [29, F] } : {};
      return { ...out, ...rally, 1001: [7, F], 1002: [4, F], 1003: [5, F], 1004: [6, F] };
    }
    for (const [pos, type] of Object.entries(lay.inside || {})) out[pos] = [type, L];
    const [from, to] = lay.cottages || [12, 31];
    for (let pos = from; pos <= to; pos++) out[pos] = [1, L];
    const n = 13 + 3 * (L - 1);
    for (let i = 1; i <= n - 3; i++) out[1000 + i] = [7, F];
    out[1000 + n - 2] = [4, F]; out[1000 + n - 1] = [5, F]; out[1000 + n] = [6, F];
    return out;
  }
  // An NPC city's or valley's own hero: an ordinary name and a level from 1 to rules.npcHeroMaxLevel (live: NPC
  // city heroes are men; a level 1 grassland had Una, level 9). An NPC city's is picked again at every daily
  // reset (Fox: "unless there is a historic hero in a barbarian city, the city's hero is randomized daily";
  // live, NPC 1 had Jonathan 16 one day and Baird 15 the next). A valley's stays the same (UNVERIFIED).
  hero(tile, now = Date.now()){
    const { MALE, FEMALE } = require('./heroes'), npc = tile.type === world.T.NPC, names = npc ? MALE : [...MALE, ...FEMALE], day = npc ? this.day(now) : 0;
    return { name: names[this.pickOf(names.length, tile.id, day, 21)], level: 1 + this.pickOf(this.rules.npcHeroMaxLevel || 50, tile.id, day, 22) };
  }
  // Research level an NPC or Historic City fights with (all military research at this level, per dxcalc).
  techLevel(tile){ return tile.historic ? 10 : Math.max(1, Math.min(10, tile.level || 1)); }
  // Battle bonuses (%) for an NPC city or Historic City, from its research, its Walls (the same level) and its hero or ruler.
  mods(tile, techs, ruler){
    const L = this.techLevel(tile), e = id => techs[id]?.levels[L - 1]?.effect || 0;
    const h = ruler || { attack: this.rules.npcHero[L] || 0, intelligence: this.rules.npcHero[L] || 0 };
    return { attack: e(9) + h.attack * this.rules.heroAttackPerPoint, defence: e(10) + h.intelligence * this.rules.heroDefencePerIntelligence,
      life: e(16), range: e(14) + L * (this.rules.battle?.wallRangePerLevel || 0), wall: L * (this.rules.battle?.wallRangePerLevel || 0), fortLife: e(18), speedFoot: e(12), speedHorse: e(13) };
  }
  // Rebuild part of what was destroyed right after a battle: (level + 1) x npcRepair of it (dxcalc; live at an NPC 8:
  // 27% of the Archer Towers, 45% of the Traps, 63% of the Rolling Logs and 72% of the Trebuchets). A Historic City
  // rebuilds nothing right away (Fox; rules.npcFortRegen.historicRepair).
  repair(tile, before, after){
    if (tile.historic && !this.rules.npcFortRegen?.historicRepair) return { ...after };
    const m = this.techLevel(tile), out = { ...after };
    for (const [k, rate] of Object.entries(this.rules.npcRepair)){
      const lost = (before[k] || 0) - (after[k] || 0);
      if (lost > 0) out[k] = Math.min(before[k], (after[k] || 0) + Math.floor(lost * (m + 1) * rate));
    }
    return out;
  }
  save(db, tile, state, now){
    db.npc = db.npc || {};
    db.npc[tile.id] = { troops: state.troops, forts: state.forts, res: state.res, ruler: state.ruler, loyalty: state.loyalty, hitAt: now };
  }
}

module.exports = { NpcLogic };
