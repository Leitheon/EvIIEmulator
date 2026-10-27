'use strict';
// Wall defenses. Costs, build time per unit and space per unit come from the client's fortification table;
// the Walls' space is level-1,000 / 3,000 / 6,000 ... 55,000 (its "limit" / 100, as the Walls description says).
// Construction speeds them up ("constructing speed of buildings and fortified units").
const WALLS = 32, POS_WALLS = -2, TECH_CONSTRUCTION = 17;

class FortLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  queue(c){ return c.fortQ || (c.fortQ = []); }
  space(c){ const L = this.castle.level(c, WALLS); return L ? this.castle.levelData(WALLS, L).limit / 100 : 0; }
  used(c){
    let s = 0;
    for (const f of Object.values(this.data.forts)) s += (c.forts?.[f.field] || 0) * f.space;
    for (const q of this.queue(c)) s += q.num * this.data.forts[q.type].space;
    return s;
  }
  unitSeconds(p, typeId){ return this.data.forts[typeId].time / this.speed * Math.pow(this.rules.constructionStep ?? 0.9, this.castle.techLevel(p, TECH_CONSTRUCTION)); }
  condition(c, p, typeId, num = 1){
    const f = this.data.forts[typeId], buildings = [], techs = [];
    for (const [kind, id, level] of this.rules.fortUnlock[typeId] || []){
      if (kind === 'b'){ const cur = this.castle.level(c, id); buildings.push({ typeId: id, level, curLevel: cur, successFlag: cur >= level }); }
      else { const cur = this.castle.techLevel(p, id); techs.push({ id, level, curLevel: cur, successFlag: cur >= level }); }
    }
    return { buildings, techs, items: [], food: f.food * num, wood: f.wood * num, stone: f.stone * num, iron: f.iron * num, gold: 0, population: 0,
      time: Math.max(1, Math.round(this.unitSeconds(p, typeId) * num)), destructTime: 0 };
  }
  list(c, p){
    return Object.keys(this.data.forts).map(Number).sort((a, b) => a - b).map(typeId => {
      const cond = this.condition(c, p, typeId);
      return { typeId, permition: cond.buildings.every(b => b.successFlag) && cond.techs.every(t => t.successFlag), conditionBean: cond };
    });
  }
  produce(c, p, typeId, num, now){
    const f = this.data.forts[typeId]; num = Math.floor(Number(num));
    if (!f) return [-1, 'Unknown defense.'];
    if (!(num > 0)) return [-27, 'Choose how many to build.'];
    if (!this.castle.level(c, WALLS)) return [-30, 'Build Walls first.'];
    const wallsLevel = this.castle.level(c, WALLS);
    if (this.queue(c).length >= wallsLevel) return [-51, `Your level ${wallsLevel} Walls can queue ${wallsLevel} batch${wallsLevel > 1 ? 'es' : ''}.`];
    const cond = this.condition(c, p, typeId, num);
    const miss = cond.buildings.find(x => !x.successFlag) || cond.techs.find(x => !x.successFlag);
    if (miss) return [-8, miss.typeId ? `Requires ${this.castle.typeName(miss.typeId)} level ${miss.level}.` : `Requires ${this.data.techs[miss.id]?.name} level ${miss.level}.`];
    const free = this.space(c) - this.used(c);
    if (num * f.space > free) return [-1, `Not enough room on the Walls: ${free.toLocaleString('en-US')} space left, ${(num * f.space).toLocaleString('en-US')} needed.`];
    for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    this.castle.pay(c, cond);
    c.fortSeq = (c.fortSeq || 0) + 1;
    const q = this.queue(c), item = { queueId: c.fortSeq, type: typeId, num, costTime: cond.time, startTime: 0, endTime: 0, cost: cond };
    q.push(item);
    if (q.length === 1){ item.startTime = now; item.endTime = now + item.costTime * 1000; }
    return null;
  }
  cancel(c, queueId, now){
    const q = this.queue(c), i = q.findIndex(x => x.queueId === queueId);
    if (i < 0) return [-23, 'That batch is already finished.'];
    const [item] = q.splice(i, 1);
    this.castle.pay(c, item.cost, 1, this.rules.fortCancelRefundRate);
    if (i === 0 && q.length){ q[0].startTime = now; q[0].endTime = now + q[0].costTime * 1000; }
    return null;
  }
  demolish(c, typeId, num){
    const f = this.data.forts[typeId]; num = Math.floor(Number(num));
    if (!f || !(num > 0)) return [-27, 'Choose how many to tear down.'];
    if ((c.forts?.[f.field] || 0) < num) return [-29, `You only have ${c.forts?.[f.field] || 0} ${f.name}.`];
    c.forts[f.field] -= num;
    for (const k of ['food', 'wood', 'stone', 'iron']) c.res[k] += Math.floor(f[k] * num * this.rules.fortDemolishRefundRate);
    return null;
  }
  speedUp(c, queueId, reduce, now){
    const item = this.queue(c)[0];
    if (!item || item.queueId !== queueId) return [-23, 'Only the batch now being built can be sped up.'];
    item.endTime = Math.max(now, now + reduce(item.endTime - now));
    return null;
  }
  completeDue(c, now){
    const q = this.queue(c); let changed = false;
    while (q.length && q[0].endTime && q[0].endTime <= now){
      const done = q.shift(), field = this.data.forts[done.type].field;
      c.forts[field] = (c.forts[field] || 0) + done.num; changed = true; this.onDone?.(c, done.type, done.num);
      if (q.length){ q[0].startTime = done.endTime; q[0].endTime = done.endTime + q[0].costTime * 1000; }
    }
    return changed;
  }
  nextDue(c){ const q = this.queue(c); return q[0]?.endTime || Infinity; }
  // The Walls window always reads the first entry, so there is always one.
  queueBeans(c){ return [{ positionId: POS_WALLS, allProduceQueue: this.queue(c).map(x => ({ queueId: x.queueId, type: x.type, num: x.num, costTime: x.costTime, endTime: x.endTime || 0 })) }]; }
}

module.exports = { FortLogic };
