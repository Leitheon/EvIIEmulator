'use strict';
// City economy and construction. All costs and times come from the client's own building table.
const POS_TOWN_HALL = -1, POS_WALLS = -2;
const TYPE = { COTTAGE: 1, BARRACKS: 2, WAREHOUSE: 3, SAWMILL: 4, QUARRY: 5, IRONMINE: 6, FARM: 7, ACADEMY: 25, TOWN_HALL: 31, WALLS: 32 };
const STATUS = { NORMAL: 0, UPGRADING: 1, DESTRUCTING: 2 };
const FIELD_RES = { 7: 'food', 4: 'wood', 5: 'stone', 6: 'iron' };
const RES_TECH = { food: 1, wood: 2, stone: 3, iron: 4 };   // Agriculture, Lumbering, Masonry, Mining
const TECH_CONSTRUCTION = 17, TECH_STOCKPILE = 15;
const ERR = { RESOURCE: -1, UNIQUE: -3, POSITION: -4, BUSY: -5, DEPEND: -8, PEOPLE: -10, NO_BUILDING: -30, STATUS: -45, TOWNHALL: -48, MAX_LEVEL: -57 };
const MAX_LEVEL_MSG = 'The building has already reached maximum level.';   // the live server's words (Fox's capture)

// A number as a Java int: the low 32 bits, signed (2^31 becomes -2^31).
function int32(n){ const m = ((Math.trunc(n) % 4294967296) + 4294967296) % 4294967296; return m >= 2147483648 ? m - 4294967296 : m; }
// The most of one troop type a city can hold: a Java int's largest (Fox: past it the original's count turned negative
// and broke the city; here it stops there).
const TROOP_MAX = 2147483647;
// A city's count of one troop type with n more added, no more than TROOP_MAX.
const addTroops = (have, n) => Math.min(TROOP_MAX, (have || 0) + n);

class CastleLogic {
  constructor(data, rules, speed){
    this.data = data; this.rules = rules; this.speed = speed > 0 ? speed : 1;
    // Set by Game once heroes and armies exist: mayor bonuses (%), valley bonuses (%) and hero salaries (gold/h).
    this.hooks = { mayor: () => 0, valleys: () => ({ food: 0, wood: 0, stone: 0, iron: 0 }), salary: () => 0,
      upkeepRate: () => 1, themeBonus: () => 0, buildSlots: () => 1, items: () => ({}) };
  }

  level(c, typeId){ let m = 0; for (const b of Object.values(c.buildings)) if (b.typeId === typeId && b.level > m) m = b.level; return m; }
  townHall(c){ return c.buildings[POS_TOWN_HALL]?.level || 0; }
  techLevel(p, id){ return p.techs?.[id] || 0; }
  techEffect(p, id){ const L = this.techLevel(p, id); return L ? this.data.techs[id].levels[L - 1].effect : 0; }
  levelData(typeId, L){ const b = this.data.buildings[typeId]; return b && b.levels[L - 1] ? b.levels[L - 1] : null; }
  typeName(typeId){ return this.data.buildings[typeId]?.name || 'Building'; }

  // ---------- economy ----------
  workNeeded(c){ let w = 0; for (const b of Object.values(c.buildings)) if (b.level > 0){ const d = this.levelData(b.typeId, b.level); if (d) w += d.workPeople; } return w; }
  // Where the population settles: the limit times (100 - tax rate)% (rules.populationCapByTax).
  popTarget(c){ const max = this.popMax(c); return this.rules.populationCapByTax === false ? max : max * (1 - Math.min(100, Math.max(0, c.taxRate || 0)) / 100); }
  // 50 plus what the Cottages hold (live: 20 level 8 Cottages, 3,600 each, show a limit of 72,050).
  popMax(c){ let m = 0; for (const b of Object.values(c.buildings)) if (b.typeId === TYPE.COTTAGE && b.level > 0) m += this.levelData(b.typeId, b.level).limit; return (this.rules.populationBase ?? 50) + m; }
  // Live (Fox's captures, all 19 cities): 10,000 plus the fields' limits, which Stockpile raises 10% a level ("enhances
  // the capacity of Warehouses and resource stockpiles"), so twice their limits at Stockpile 10.
  capacity(c, p, res){
    if (res === 'gold') return Infinity;
    let fields = 0;
    for (const b of Object.values(c.buildings)) if (FIELD_RES[b.typeId] === res && b.level > 0) fields += this.levelData(b.typeId, b.level).limit;
    return this.rules.baseStorage + Math.round(fields * (1 + (p ? this.techEffect(p, TECH_STOCKPILE) : 0) / 100));
  }
  // The Warehouse window's Store Percent of each resource (they share its capacity; Fox: on live the capacity is
  // split by these percents). 25% each until changed.
  storePercents(c){ return { food: 25, wood: 25, stone: 25, iron: 25, ...(c.storePct || {}) }; }
  // What the Warehouse keeps safe from plunder of one resource: its share of the capacity.
  protectedOf(c, p, k){ return k === 'gold' ? 0 : Math.ceil(this.protectedAmount(c, p) * (this.storePercents(c)[k] || 0) / 100); }
  // The Warehouses' whole capacity. Stockpile raises it 10% a level.
  protectedAmount(c, p){
    let s = 0; for (const b of Object.values(c.buildings)) if (b.typeId === TYPE.WAREHOUSE && b.level > 0) s += this.levelData(b.typeId, b.level).limit;
    const step = this.rules.stockpileStep;
    return Math.round(s * (!p ? 1 : step ? Math.pow(step, this.techLevel(p, TECH_STOCKPILE)) : 1 + this.techEffect(p, TECH_STOCKPILE) / 100));
  }
  // Food the city's troops eat an hour. As on the original server, each troop type's upkeep (how many there are, with
  // the allied troops of that type the city feeds, x the type's upkeep) is a 32-bit integer (Fox): past 2^31 it wraps
  // to negative, so that type feeds the city instead, and back again at each 2^32, a type at a time.
  upkeep(c, guests = null){
    let f = 0;
    for (const t of Object.values(this.data.troops)) f += int32(((c.troops?.[t.field] || 0) + (guests?.[t.field] || 0)) * t.upkeep);
    return f;
  }
  buffActive(p, id, now = Date.now()){ return (p.buffs?.[id] || 0) > now; }
  commence(c){ return c.commence || (c.commence = { food: 100, wood: 100, stone: 100, iron: 100 }); }
  // Workers each resource's fields could use, and the base output of those fields.
  fieldsOf(c){
    const f = { food: { labour: 0, base: 0 }, wood: { labour: 0, base: 0 }, stone: { labour: 0, base: 0 }, iron: { labour: 0, base: 0 } };
    for (const b of Object.values(c.buildings)){
      const res = FIELD_RES[b.typeId];
      if (res && b.level > 0){ const d = this.levelData(b.typeId, b.level); f[res].labour += d.workPeople; f[res].base += d.produce; }
    }
    return f;
  }
  // Production per hour. Workers come from the population, shared out by the labour rates set
  // in the Town Hall (100% each by default); fields without enough workers produce less.
  // As the Town Hall's Production tab adds it up (ResourceProduction): the fields' output and the research, hero,
  // valley and item bonuses on it are scaled by the production rate and staffing, and then the flat 100 an hour
  // ("Providence") is added untouched. Live: a new city with no fields shows Providence 100, Technology Plus 0.
  // `raw`: without colony tribute (colonies.js works out tribute from it).
  rates(c, p, now = Date.now(), raw = false){
    const f = this.fieldsOf(c), rate = this.commence(c);
    const demand = Object.keys(f).reduce((a, k) => a + f[k].labour * rate[k] / 100, 0);
    const staffed = demand ? Math.min(1, c.pop / demand) : 1;
    const r = { food: 0, wood: 0, stone: 0, iron: 0 }, detail = {};
    const BUFF = { food: 'IncFoodProduceBuff', wood: 'IncWoodProduceBuff', stone: 'IncStoneProduceBuff', iron: 'IncIronProduceBuff' };
    // (the mayor's politics in whole points: live, all 12 cities' rates fit 1% a point rounded down)
    const hero = Math.floor(this.hooks.mayor(c, 'production')), valleys = this.hooks.valleys(c);
    for (const k of Object.keys(r)){
      const eff = f[k].labour ? (rate[k] / 100) * staffed : 1;
      // (Achievements: +5% a level of the resource's production bonus, effort.js.)
      const tech = this.techEffect(p, RES_TECH[k]), item = (this.buffActive(p, BUFF[k], now) ? 25 : 0) + this.hooks.themeBonus(p, now) + (this.hooks.effort?.(p, k) || 0), field = valleys[k] || 0;
      const basic = f[k].base * eff;
      r[k] = this.rules.baseProduction + basic * (1 + (tech + item + hero + field) / 100);
      detail[k] = { basic, natural: this.rules.baseProduction, capacity: f[k].base, tech, item, hero, field, labour: f[k].labour, eff, workers: Math.round(f[k].labour * eff) };
    }
    r.salary = this.hooks.salary(c);
    r.gold = c.pop * (c.taxRate / 100) * this.rules.goldPerPopulationAtFullTax * (this.buffActive(p, 'IncGoldProduceBuff', now) ? 2 : 1) * (1 + (this.hooks.effort?.(p, 'gold') || 0) / 100) - r.salary;
    // Colonies: a Protectorate pays a share of what it produces to its suzerain (r.tribute: an hour, negative paid,
    // positive received).
    r.tribute = !raw && this.hooks.tribute ? this.hooks.tribute(c, r, now) : null;
    if (r.tribute) for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) r[k] += r.tribute[k];
    r.foodUpkeep = (this.upkeep(c, this.hooks.guestTroops?.(c)) + (this.hooks.guestUpkeep?.(c) || 0)) * this.hooks.upkeepRate(p, now);   // (and allied troops it feeds)
    r.efficiency = staffed; r.workNeeded = Math.round(demand); r.detail = detail;
    return r;
  }
  // Bring resources and population up to `now`.
  settle(c, p, now){
    // (a count past TROOP_MAX, from a save made before the cap, comes down to it)
    for (const k in c.troops || {}) if (c.troops[k] > TROOP_MAX) c.troops[k] = TROOP_MAX;
    const dt = (now - c.resAt) / 3600000;
    if (dt <= 0) return;
    const r = this.rates(c, p, c.resAt);
    for (const k of ['food', 'wood', 'stone', 'iron']){
      if (r[k] > 0) this.hooks.produced?.(p, k, r[k] * dt * this.speed);   // (achievements count what is produced)
      const gain = (r[k] - (k === 'food' ? r.foodUpkeep : 0)) * dt * this.speed, cap = this.capacity(c, p, k);
      if (gain >= 0) c.res[k] = c.res[k] >= cap ? c.res[k] : Math.min(cap, c.res[k] + gain);
      else c.res[k] = Math.max(0, c.res[k] + gain);
    }
    if (r.gold > 0) this.hooks.produced?.(p, 'gold', r.gold * dt * this.speed);
    c.res.gold = Math.max(0, c.res.gold + r.gold * dt * this.speed);
    // Loyalty drifts toward 100 minus the tax rate, 10 points an hour; grievance fades 10 an hour.
    const target = 100 - c.taxRate, drift = 10 * dt * this.speed;
    c.loyalty = c.loyalty == null ? target : c.loyalty < target ? Math.min(target, c.loyalty + drift) : Math.max(target, c.loyalty - drift);
    c.complaint = Math.max(0, (c.complaint || 0) - drift * (1 + (this.hooks.effort?.(p, 'grievance') || 0) / 100));
    // The population grows (or shrinks) toward where the tax rate lets it settle.
    const settle = this.popTarget(c), k = this.rules.populationGrowthPerHour * this.speed * (this.hooks.plagued?.(c, now) ? 0.9 : 1);   // (Opportunist's Plague)
    c.pop = settle - (settle - c.pop) * Math.exp(-k * dt);
    if (Math.abs(settle - c.pop) < 0.5) c.pop = settle;
    c.resAt = now;
  }

  // ---------- construction ----------
  // Live (Fox's captures, 14 readings over three accounts, Oct 26 2026): each Construction level takes 10% off what
  // is left, and each whole point of the mayor's politics (gear included) 0.14%, rounded down to the second: an
  // Academy going 8 to 9 (122,880 s) took 42,845 s with no mayor, 41,720 with a 19-politics one and 19,606 with
  // the same mayor at 558. (rules.constructionStep, rules.mayorStepPerPoint.)
  buildFactor(p, c = null){
    const L = p ? this.techLevel(p, TECH_CONSTRUCTION) : 0, pol = c ? Math.floor(this.hooks.mayor(c, 'points:pol') || 0) : 0;
    return Math.pow(this.rules.constructionStep ?? 0.9, L) * Math.pow(this.rules.mayorStepPerPoint ?? 0.9986, pol);
  }
  buildSeconds(p, typeId, L, c = null){
    const d = this.levelData(typeId, L); if (!d) return 0;
    return Math.max(1, Math.floor(d.time * this.buildFactor(p, c) / this.speed));
  }
  isInside(pos){ return pos >= 0 && pos <= 31; }
  isOutside(pos){ return pos >= 1001 && pos <= 1041; }
  outsideSlots(c){ return this.rules.outsideStart + this.rules.outsideAdd * Math.max(0, this.townHall(c) - 1); }
  // Builders work on one building at a time (two with Gundulf's Compass).
  busy(c, p = null){ return Object.values(c.buildings).filter(b => b.status !== STATUS.NORMAL).length >= this.hooks.buildSlots(p); }
  // With building queues on, busy builders answer -48, the code on which the client offers to queue the building.
  busyError(){ return [this.rules.buildQueue?.enabled === false ? ERR.BUSY : ERR.TOWNHALL, 'Your builders are already working on another building.']; }

  // ConditionBean for building typeId up to level L, with each requirement marked met or not.
  condition(c, p, typeId, L){
    const d = this.levelData(typeId, L);
    const deps = [];
    if (this.rules.capByTownHall && typeId !== TYPE.TOWN_HALL) deps.push([TYPE.TOWN_HALL, L]);
    if (L === 1) for (const dep of this.rules.unlock[typeId] || []) deps.push(dep);
    // Resource fields go at most one level above the Town Hall (Fox: live), and to the city's own cap once the Town
    // Hall is at 10. Live leaves this out of the upgrade's requirements when it's met (every captured city had a
    // level 10 Town Hall), so it shows only while it holds a field back, as a Town Hall requirement.
    const above = this.rules.fieldsAboveTownHall;
    if (above != null && typeId >= TYPE.SAWMILL && typeId <= TYPE.FARM && !deps.some(([t]) => t === TYPE.TOWN_HALL)){
      const need = Math.min(L - above, this.rules.maxLevel);
      if (this.level(c, TYPE.TOWN_HALL) < need) deps.push([TYPE.TOWN_HALL, need]);
    }
    const techs = [];
    for (const [kind, id, off, from] of this.rules.levelUnlock?.[typeId] || []){
      if (L < (from || 1)) continue;
      const need = L + (off || 0);
      if (kind === 'b') deps.push([id, need]);
      else { const cur = this.techLevel(p, id); techs.push({ id, level: need, curLevel: cur, successFlag: cur >= need }); }
    }
    const buildings = deps.map(([t, lv]) => { const cur = this.level(c, t); return { typeId: t, level: lv, curLevel: cur, successFlag: cur >= lv }; });
    // Michelangelo's Script: "a must for further upgrades for advanced buildings and resource fields" (level 10 and up here).
    const items = [];
    // (live: a Farm going 9 to 10 asks for one; 11 to 12 and 13 to 14 in a Historic City don't)
    if (this.rules.blueprintFromLevel && L === this.rules.blueprintFromLevel){
      const have = this.hooks.items(p)['consume.blueprint.1'] || 0;
      items.push({ id: 'consume.blueprint.1', name: "Michelangelo's Script", num: 1, curNum: have, successFlag: have >= 1 });
    }
    const cut = 1 - (this.hooks.effort?.(p, 'build') || 0) / 100;   // the achievements' construction bonus
    const bean = { buildings, techs, items, food: d ? Math.round(d.food * cut) : 0, wood: d ? Math.round(d.wood * cut) : 0, stone: d ? Math.round(d.stone * cut) : 0, iron: d ? Math.round(d.iron * cut) : 0, gold: 0,
      population: d ? d.buildPeople : 0, time: this.buildSeconds(p, typeId, L, c), destructTime: 0 };
    return bean;
  }
  destructCondition(c, p, typeId, L){
    const d = this.levelData(typeId, L);
    return { buildings: [], techs: [], items: [], food: 0, wood: 0, stone: 0, iron: 0, gold: 0, population: 0, time: 0,
      destructTime: d ? Math.max(1, Math.floor(d.time * this.rules.destructTimeRate * this.buildFactor(p, c) / this.speed)) : 1 };
  }
  // castle.checkOutUpgrade as the live server answers it (Fox's capture): conditionBean is the next level's
  // ConditionBean carrying, as destructTime, how long demolishing the current level takes (the client's demolish
  // tooltip reads it there); desConditionBean is the current level's own cost, of which the tooltip shows the
  // part a demolition gives back. At the top level the reply is -57 with an empty conditionBean that still
  // carries the demolish time.
  checkOut(c, p, b){
    const L = Math.max(1, b.level), d = this.levelData(b.typeId, L);
    const destructTime = this.destructCondition(c, p, b.typeId, L).destructTime;
    const des = { buildings: [], techs: [], items: [], food: d?.food || 0, wood: d?.wood || 0, stone: d?.stone || 0, iron: d?.iron || 0, gold: 0, population: 0, time: 0, destructTime: 0 };
    const top = b.level >= Math.min(this.maxLevelOf(c, b.typeId), this.data.buildings[b.typeId]?.levels.length || this.rules.maxLevel);
    if (top) return { ok: ERR.MAX_LEVEL, errorMsg: MAX_LEVEL_MSG,
      conditionBean: { buildings: [], techs: [], items: [], food: 0, wood: 0, stone: 0, iron: 0, gold: 0, population: 0, time: 0, destructTime }, desConditionBean: des };
    return { ok: 1, conditionBean: { ...this.condition(c, p, b.typeId, b.level + 1), destructTime }, desConditionBean: des };
  }
  // The highest level a building can reach in city c: 10, but resource fields in a Historic City go to its own
  // level (the client's caps by power level: Village 12, Town 14, Fort 16, City 18). Fox's live captures agree:
  // a level 14 city's Farm goes 11 to 12 and 13 to 14 but not past 14, its Rally Spot stops at 10, and an amulet
  // city (power level 4) won't take a Farm from 13 to 14.
  maxLevelOf(c, typeId){
    if (!(typeId >= 4 && typeId <= 7)) return this.rules.maxLevel;
    return { 0: 18, 1: 16, 2: 14, 3: 12 }[c?.powerLevel ?? 4] || this.rules.maxLevel;
  }
  check(c, p, typeId, L, cond){
    if (L > Math.min(this.maxLevelOf(c, typeId), this.data.buildings[typeId]?.levels.length || this.rules.maxLevel)) return [ERR.MAX_LEVEL, MAX_LEVEL_MSG];
    if (this.busy(c, p)) return this.busyError();
    const miss = cond.buildings.find(b => !b.successFlag);
    const item = (cond.items || []).find(i => !i.successFlag);
    if (item) return [ERR.DEPEND, `Level ${L} needs ${item.num} ${item.name || item.id}.`];
    if (miss) return [miss.typeId === TYPE.TOWN_HALL ? ERR.TOWNHALL : ERR.DEPEND, `Requires ${this.typeName(miss.typeId)} level ${miss.level}.`];
    const missTech = (cond.techs || []).find(t => !t.successFlag);
    if (missTech) return [ERR.DEPEND, `Requires ${this.data.techs[missTech.id]?.name?.trim() || 'research'} level ${missTech.level}.`];
    for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [ERR.RESOURCE, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    if (cond.population && c.pop < cond.population) return [ERR.PEOPLE, 'Not enough idle population.'];
    return null;
  }
  pay(c, cond, sign = -1, rate = 1, p = null){
    for (const k of ['food', 'wood', 'stone', 'iron']) c.res[k] += sign * Math.floor(cond[k] * rate);
    if (sign < 0 && p) for (const i of cond.items || []) if (p.items?.[i.id] >= i.num) p.items[i.id] -= i.num;
  }

  placeError(c, pos, typeId){
    if (pos === POS_TOWN_HALL) return typeId === TYPE.TOWN_HALL ? null : 'Only the Town Hall goes there.';
    if (pos === POS_WALLS) return typeId === TYPE.WALLS ? null : 'Only the Walls go there.';
    if (this.isInside(pos)) return this.rules.insideTypes.includes(typeId) ? null : 'That building goes outside the city.';
    if (this.isOutside(pos)){
      if (!this.rules.outsideTypes.includes(typeId)) return 'That building goes inside the city.';
      if (pos - 1000 > this.outsideSlots(c)) return `Raise the Town Hall to open more land outside the walls (${this.outsideSlots(c)} plots now).`;
      return null;
    }
    return 'That is not a building plot.';
  }

  newBuilding(c, p, pos, typeId, now){
    if (!this.data.buildings[typeId]) return [ERR.NO_BUILDING, 'Unknown building type.'];
    const err = this.placeError(c, pos, typeId); if (err) return [ERR.POSITION, err];
    const at = c.buildings[pos];
    if (at && (at.level > 0 || at.status !== STATUS.NORMAL)) return [ERR.POSITION, 'That plot is already in use.'];
    if (this.rules.uniqueTypes.includes(typeId) && Object.values(c.buildings).some(b => b.typeId === typeId && (b.level > 0 || b.status))) return [ERR.UNIQUE, `You can only have one ${this.typeName(typeId)}.`];
    const cond = this.condition(c, p, typeId, 1);
    const fail = this.check(c, p, typeId, 1, cond); if (fail) return fail;
    this.pay(c, cond, -1, 1, p);
    c.buildings[pos] = { typeId, level: 0, status: STATUS.UPGRADING, startTime: now, endTime: now + cond.time * 1000, cost: cond };
    return null;
  }
  upgrade(c, p, pos, now){
    const b = c.buildings[pos]; if (!b || (b.level === 0 && b.status === STATUS.NORMAL)) return [ERR.NO_BUILDING, 'There is no building there.'];
    if (b.status !== STATUS.NORMAL) return [ERR.STATUS, 'That building is already being worked on.'];
    const cond = this.condition(c, p, b.typeId, b.level + 1);
    const fail = this.check(c, p, b.typeId, b.level + 1, cond); if (fail) return fail;
    this.pay(c, cond, -1, 1, p);
    Object.assign(b, { status: STATUS.UPGRADING, startTime: now, endTime: now + cond.time * 1000, cost: cond });
    return null;
  }
  destruct(c, p, pos, now){
    const b = c.buildings[pos]; if (!b || b.level === 0) return [ERR.NO_BUILDING, 'There is no building there.'];
    if (b.status !== STATUS.NORMAL) return [ERR.STATUS, 'That building is already being worked on.'];
    // (the client shows no Demolish for either; Fox: live never lowers them)
    if (b.typeId === TYPE.TOWN_HALL || b.typeId === TYPE.WALLS) return [ERR.STATUS, `The ${b.typeId === TYPE.WALLS ? 'Walls' : 'Town Hall'} cannot be demolished.`];
    if (this.busy(c, p)) return this.busyError();
    const dc = this.destructCondition(c, p, b.typeId, b.level);
    Object.assign(b, { status: STATUS.DESTRUCTING, startTime: now, endTime: now + dc.destructTime * 1000, cost: null });
    return null;
  }
  cancel(c, pos){
    const b = c.buildings[pos]; if (!b || b.status === STATUS.NORMAL) return [ERR.STATUS, 'Nothing is being built there.'];
    if (b.status === STATUS.UPGRADING && b.cost) this.pay(c, b.cost, 1, this.rules.cancelRefundRate);
    Object.assign(b, { status: STATUS.NORMAL, startTime: 0, endTime: 0, cost: null });
    return null;
  }
  // Finish whatever is due; returns the positions that changed.
  completeDue(c, p, now){
    const changed = [];
    for (const [pos, b] of Object.entries(c.buildings)){
      if (b.status === STATUS.NORMAL || b.endTime > now) continue;
      this.settle(c, p, b.endTime);
      if (b.status === STATUS.UPGRADING){ b.level += 1; this.hooks.built?.(c, p, b.typeId, b.level); }
      else if (b.status === STATUS.DESTRUCTING){
        const d = this.levelData(b.typeId, b.level);
        if (d && !b.noRefund) for (const k of ['food', 'wood', 'stone', 'iron']) c.res[k] += Math.floor(d[k] * this.rules.destructRefundRate);
        b.level -= 1;
      }
      c.freeAt = Math.max(c.freeAt || 0, b.endTime);   // when a builder came free (building queues: buildQueue.js)
      Object.assign(b, { status: STATUS.NORMAL, startTime: 0, endTime: 0, cost: null }); delete b.noRefund;
      changed.push(Number(pos));
    }
    return changed;
  }
  nextDue(c){ let t = Infinity; for (const b of Object.values(c.buildings)) if (b.status !== STATUS.NORMAL) t = Math.min(t, b.endTime); return t; }
  removeEmpty(c, pos){ const b = c.buildings[pos]; if (b && b.level === 0 && b.status === STATUS.NORMAL) delete c.buildings[pos]; }
}

module.exports = { int32, TROOP_MAX, addTroops, CastleLogic, TYPE, STATUS, POS_TOWN_HALL, POS_WALLS, ERR, FIELD_RES };
