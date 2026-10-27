'use strict';
// Building queues (Bernini's Hammer, the client's Queue Upgrade button and its queue offers):
//   "Allows the queuing of 1 or more buildings for construction per Title, up to a maximum of 10. For example,
//   Barons may queue up to 4 buildings for construction. Each building added to the queue consumes 1 Bernini's
//   Hammer." Fox (live): the limit is per city, queuing pays the building's cost there and then (a building you
//   can't afford can't be queued), and a cancelled queue entry's hammer is used up.
// While the builders are busy, a building (a new one, the next level of one, or demolishing a level) joins the city's
// queue; when a builder is free the first entry starts. An entry whose requirements still aren't met then is dropped
// ("building queue canceled for requirement not met!"). The client offers a queue when a build is refused with -48
// (builders busy, or the Town Hall too low) or -8 (another requirement), and asks to buy a hammer when there's none.
const { STATUS, TYPE } = require('./castle');
const DEMOLISH = 0, UPGRADE = 1;
const EV = { ADD: 1, UPDATE: 2, REMOVE: 3, DROPPED: 4 };   // BuildingConstants.STATUS_QUEUE_*
const HAMMER = 'player.queue.building', ERR_QUEUE = -201, NONE = Object.freeze([]);

class BuildQueue {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.buildQueue || {}; }
  get logic(){ return this.g.logic; }
  enabled(){ return this.rules.enabled !== false; }
  list(c){ return c.buildQ || NONE; }   // (a city gets its list when something is first queued)
  // 1 a city for a Civilian, one more for each title, at most 10.
  limit(p){ return Math.min(this.rules.max ?? 10, (p?.title || 0) + 1); }

  // ---------- beans ----------
  seconds(c, p, q){
    const L = this.logic;
    const full = q.kind === DEMOLISH ? L.destructCondition(c, p, q.typeId, q.level + 1).destructTime : L.buildSeconds(p, q.typeId, q.level, c);
    return Math.max(0, Math.round(full - (q.saved || 0)));
  }
  bean(c, q, status = EV.ADD){
    const p = this.g.playerOf(c);
    return { id: q.id, positionId: q.pos, typeId: q.typeId, level: q.level, queueType: q.kind, costTime: this.seconds(c, p, q), name: this.logic.typeName(q.typeId), status };
  }
  beans(c){ return this.list(c).map(q => this.bean(c, q)); }
  push(c, q, ev){ this.g.push(c.playerId, 'server.BuildingQueueUpdate', { castleId: c.id, buildingQueueBean: this.bean(c, q, ev) }); }

  // What a plot will hold once the work on it and its queue entries are done.
  projected(c, pos){
    const b = c.buildings[pos];
    let typeId = b ? b.typeId : null, level = b ? b.level : 0;
    if (b?.status === STATUS.UPGRADING) level += 1;
    if (b?.status === STATUS.DESTRUCTING) level -= 1;
    for (const q of this.list(c)) if (q.pos === pos){ typeId = q.typeId; level = q.level; }
    return { typeId: level > 0 || b?.status ? typeId : null, level };
  }
  // A building or research it still needs, or null (resources and items were paid when it was queued).
  missing(c, p, typeId, L){
    if (L > this.logic.maxLevelOf(c, typeId)) return `${this.logic.typeName(typeId)} is already at the highest level.`;
    const cond = this.logic.condition(c, p, typeId, L);
    const b = cond.buildings.find(x => !x.successFlag); if (b) return `Requires ${this.logic.typeName(b.typeId)} level ${b.level}.`;
    const t = (cond.techs || []).find(x => !x.successFlag); if (t) return `Requires ${this.g.data.techs[t.id]?.name?.trim() || 'research'} level ${t.level}.`;
    return null;
  }

  // ---------- queueing ----------
  // kind UPGRADE: build typeId on an empty plot, or the next level of what's there; DEMOLISH: take one level off.
  add(c, p, kind, typeId, pos, now){
    if (!this.enabled()) return [ERR_QUEUE, 'Building queues are turned off on this server.'];
    const L = this.logic, list = this.list(c);
    pos = Number(pos); typeId = Number(typeId);
    if (!L.busy(c, p)) return [ERR_QUEUE, 'Your builders are free, so there is nothing to queue behind: build it now.'];
    const max = this.limit(p);
    if (list.length >= max) return [ERR_QUEUE, `Your title lets each city queue ${max} building${max === 1 ? '' : 's'}, and this one's queue is full.`];
    const cur = this.projected(c, pos);
    let level, cond = null;
    if (kind === DEMOLISH){
      if (!cur.typeId || cur.level <= 0) return [ERR_QUEUE, 'Cant queue for this building anymore.'];
      if (cur.typeId === TYPE.TOWN_HALL || cur.typeId === TYPE.WALLS) return [-45, `The ${cur.typeId === TYPE.WALLS ? 'Walls' : 'Town Hall'} cannot be demolished.`];
      typeId = cur.typeId; level = cur.level - 1;
    } else {
      if (cur.typeId == null){
        if (!this.g.data.buildings[typeId]) return [-30, 'Unknown building type.'];
        const err = L.placeError(c, pos, typeId); if (err) return [-4, err];
        const planned = t => Object.values(c.buildings).some(b => b.typeId === t && (b.level > 0 || b.status)) || list.some(q => q.typeId === t);
        if (this.g.rules.uniqueTypes.includes(typeId) && planned(typeId)) return [-3, `You can only have one ${L.typeName(typeId)}.`];
        level = 1;
      } else { typeId = cur.typeId; level = cur.level + 1; }
      if (level > this.logic.maxLevelOf(c, typeId)) return [-57, 'Cant queue for this building anymore.'];
      cond = L.condition(c, p, typeId, level);
      for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k} to queue ${L.typeName(typeId)} level ${level}.`];
      if (cond.population && c.pop < cond.population) return [-10, 'Not enough idle population.'];
      const item = (cond.items || []).find(i => !i.successFlag); if (item) return [-8, `Level ${level} needs ${item.num} ${item.name || item.id}.`];
    }
    // The hammer: the lord's own, or one bought for its price ("Do you want to buy and use one?").
    const items = this.g.items, price = this.g.data.items[HAMMER]?.price || 5;
    let bought = 0;
    if (!items.has(p, HAMMER)){
      if ((p.coins || 0) < price) return [-28, `You need a Bernini's Hammer to queue this building (${price} cents); you have ${p.coins || 0} cents.`];
      p.coins -= price; bought = price;
    } else items.take(p, HAMMER);
    if (cond) L.pay(c, cond, -1, 1, p);
    c.buildQSeq = (c.buildQSeq || 0) + 1;
    const q = { id: c.buildQSeq, pos, typeId, level, kind, cost: cond ? { food: cond.food, wood: cond.wood, stone: cond.stone, iron: cond.iron } : null, saved: 0, at: now };
    (c.buildQ = c.buildQ || []).push(q);
    this.g.store.touch();
    return { q, bought, items: [HAMMER, ...((cond?.items || []).map(i => i.id))] };
  }
  find(c, id){ return this.list(c).find(q => q.id === Number(id)) || null; }
  // Called off before it starts: the cost comes back as a cancelled construction's does; the hammer doesn't.
  cancel(c, id){
    const q = this.find(c, id); if (!q) return [ERR_QUEUE, 'That building is no longer queued.'];
    this.drop(c, q, EV.REMOVE);
    return {};
  }
  drop(c, q, ev){
    const list = this.list(c), i = list.indexOf(q); if (i >= 0) list.splice(i, 1);
    if (q.cost) this.logic.pay(c, q.cost, 1, this.g.rules.cancelRefundRate ?? 1);
    this.push(c, q, ev);
    this.g.store.touch();
  }
  // Speed-ups and Instant Build on a queued building take the time off before it starts.
  speedup(c, p, id, itemId){
    const q = this.find(c, id); if (!q) return [ERR_QUEUE, 'That building is no longer queued.'];
    const left = this.seconds(c, p, q) * 1000;
    const s = this.g.items.speedup(p, String(itemId || ''), left, this.g.items.coinsFor(left));
    if (s.err) return [-44, s.err];
    if (s.item) this.g.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    q.saved = (q.saved || 0) + (left - Math.max(0, s.reduce(left))) / 1000;
    this.g.store.touch();
    this.push(c, q, EV.UPDATE);
    return { item: s.item, coins: s.coins };
  }
  coinsNeed(c, p, id){ const q = this.find(c, id); return q ? this.g.items.coinsFor(this.seconds(c, p, q) * 1000) : 0; }

  // ---------- running the queue ----------
  // 0 when a builder is free and something is queued (the tick then starts it), else Infinity.
  due(c){ return this.list(c).length && !this.logic.busy(c, this.g.playerOf(c)) ? 0 : Infinity; }
  // Start (or drop) queued buildings while a builder is free. Returns how many entries left the queue.
  advance(c, p, now, notify = true){
    const list = this.list(c); let n = 0;
    while (list.length && !this.logic.busy(c, p) && n < 20){
      const q = list[0];
      // It starts when a builder came free: when a building finished after it was queued (catching up after time
      // away, that can be a while ago), else now (a cancelled build, Gundulf's Compass).
      const at = (c.freeAt || 0) > (q.at || 0) ? Math.min(now, c.freeAt) : now;
      const why = this.start(c, p, q, at);
      n++;
      if (why){
        this.drop(c, q, EV.DROPPED);
        this.g.log.info(`${c.name}: queued ${this.logic.typeName(q.typeId)} level ${q.level} dropped (${why})`);
        continue;
      }
      list.shift();
      this.g.store.touch();
      if (notify){ this.g.pushBuilding(c, q.pos); this.push(c, q, EV.REMOVE); }
    }
    return n;
  }
  // Put the entry to work; returns why it can't start, or null.
  start(c, p, q, at){
    const L = this.logic, b = c.buildings[q.pos];
    if (q.kind === DEMOLISH){
      if (!b || b.typeId !== q.typeId || b.status !== STATUS.NORMAL || b.level !== q.level + 1) return 'the building changed';
      const dc = L.destructCondition(c, p, b.typeId, b.level);
      Object.assign(b, { status: STATUS.DESTRUCTING, startTime: at, endTime: at + Math.max(0, dc.destructTime - (q.saved || 0)) * 1000, cost: null });
      return null;
    }
    const fresh = q.level === 1 && (!b || (b.level === 0 && b.status === STATUS.NORMAL));
    if (fresh){
      if (L.placeError(c, q.pos, q.typeId)) return 'the plot can\'t take it';
      if (this.g.rules.uniqueTypes.includes(q.typeId) && Object.entries(c.buildings).some(([pos, x]) => Number(pos) !== q.pos && x.typeId === q.typeId && (x.level > 0 || x.status))) return 'one is already built';
    } else if (!b || b.typeId !== q.typeId || b.status !== STATUS.NORMAL || b.level !== q.level - 1) return 'the building changed';
    const miss = this.missing(c, p, q.typeId, q.level); if (miss) return miss;
    const secs = Math.max(0, L.buildSeconds(p, q.typeId, q.level, c) - (q.saved || 0));
    const work = { status: STATUS.UPGRADING, startTime: at, endTime: at + secs * 1000, cost: q.cost ? { ...q.cost, items: [] } : null };
    if (fresh) c.buildings[q.pos] = { typeId: q.typeId, level: 0, ...work };
    else Object.assign(b, work);
    return null;
  }
}

module.exports = { BuildQueue, QUEUE: { DEMOLISH, UPGRADE, EV, HAMMER } };
