'use strict';
// Troop training. Each barracks has its own queue; batches run one after another.
// Costs, population, upkeep and per-unit time come from the client's troop table.
const { TYPE } = require('./castle');
const TECH_MILITARY_SCIENCE = 8, TECH_METAL_CASTING = 5;
// Metal Casting "enhances production speed of mechanics": Transporter, Ballista, Battering Ram, Catapult.
const MECHANICS = new Set([8, 11, 12, 13]);

class TroopLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  deps(c, p, list){
    const buildings = [], techs = [];
    for (const [kind, id, level] of list || []){
      if (kind === 'b'){ const cur = this.castle.level(c, id); buildings.push({ typeId: id, level, curLevel: cur, successFlag: cur >= level }); }
      else { const cur = this.castle.techLevel(p, id); techs.push({ id, level, curLevel: cur, successFlag: cur >= level }); }
    }
    return { buildings, techs };
  }
  unitSeconds(c, p, typeId){
    const t = this.data.troops[typeId];
    const barracks = this.castle.level(c, TYPE.BARRACKS);
    const step = this.rules.militaryScienceStep, ms = this.castle.techLevel(p, TECH_MILITARY_SCIENCE);
    const science = step ? Math.pow(step, ms) : 1 / (1 + this.castle.techEffect(p, TECH_MILITARY_SCIENCE) / 100);
    const barracksBonus = this.rules.trainingSpeedPerBarracksLevel * Math.max(0, barracks - 1);
    const metal = MECHANICS.has(Number(typeId)) ? 1 + this.castle.techEffect(p, TECH_METAL_CASTING) / 100 : 1;
    // The mayor's attack: each whole point takes rules.mayorStepPerPoint off what is left.
    // (0.14% a whole point, as live building takes for politics; the guide's 0.87 a hundred points is the same)
    const atk = Math.floor(this.castle.hooks?.mayor?.(c, 'attack') || 0);
    const mayor = atk > 0 ? Math.pow(this.rules.mayorStepPerPoint ?? 0.9986, atk) : 1;
    return t.time / this.speed * science * mayor / (1 + barracksBonus) / metal;
  }
  condition(c, p, typeId, num = 1){
    const t = this.data.troops[typeId];
    const { buildings, techs } = this.deps(c, p, this.rules.troopUnlock[typeId]);
    const cut = 1 - (this.costCut?.(p, typeId) || 0) / 100;   // the achievements' infantry, cavalry and mechanics bonuses
    return { buildings, techs, items: [], food: Math.round(t.food * cut) * num, wood: Math.round(t.wood * cut) * num, stone: Math.round(t.stone * cut) * num, iron: Math.round(t.iron * cut) * num, gold: 0,
      population: t.population * num, time: Math.max(1, Math.round(this.unitSeconds(c, p, typeId) * num)), destructTime: 0 };
  }
  unlocked(cond){ return cond.buildings.every(b => b.successFlag) && cond.techs.every(t => t.successFlag); }
  produceList(c, p){
    return Object.keys(this.data.troops).map(Number).sort((a, b) => a - b).map(typeId => {
      const cond = this.condition(c, p, typeId, 1);
      return { typeId, permition: this.unlocked(cond), conditionBean: cond };
    });
  }

  queues(c){ return c.trainQ || (c.trainQ = {}); }
  barracks(c){ return Object.entries(c.buildings).filter(([, b]) => b.typeId === TYPE.BARRACKS && b.level > 0).map(([pos, b]) => ({ pos: Number(pos), level: b.level })); }
  queueLimit(c, pos){ const b = c.buildings[pos]; return b ? Math.max(1, this.castle.levelData(b.typeId, b.level)?.limit || b.level) : 0; }

  produce(c, p, pos, typeId, num, now){
    const t = this.data.troops[typeId];
    if (!t) return [-1, 'Unknown troop type.'];
    num = Math.floor(Number(num));
    if (!(num > 0)) return [-27, 'Choose how many to train.'];
    const all = this.barracks(c);
    if (!all.length) return [-30, 'You need a Barracks to train troops.'];
    if (!pos){ // "share": the barracks with the shortest queue
      pos = all.map(b => ({ ...b, n: (this.queues(c)[b.pos] || []).length })).sort((a, b) => a.n - b.n)[0].pos;
    }
    const b = c.buildings[pos];
    if (!b || b.typeId !== TYPE.BARRACKS || b.level === 0) return [-30, 'There is no Barracks there.'];
    const q = this.queues(c)[pos] || (this.queues(c)[pos] = []);
    if (q.length >= this.queueLimit(c, pos)) return [-51, `This Barracks can queue ${this.queueLimit(c, pos)} batch${this.queueLimit(c, pos) > 1 ? 'es' : ''}. Upgrade it to queue more.`];
    const cond = this.condition(c, p, typeId, num);
    const missB = cond.buildings.find(x => !x.successFlag), missT = cond.techs.find(x => !x.successFlag);
    if (missB) return [-8, `Requires ${this.castle.typeName(missB.typeId)} level ${missB.level}.`];
    if (missT) return [-9, `Requires ${this.data.techs[missT.id]?.name || 'research'} level ${missT.level}.`];
    for (const k of ['food', 'wood', 'stone', 'iron']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    if (Math.floor(c.pop) < cond.population) return [-10, `Not enough idle population (${cond.population} needed).`];
    this.castle.pay(c, cond);
    c.pop -= cond.population;
    c.trainSeq = (c.trainSeq || 0) + 1;
    const item = { queueId: c.trainSeq, type: typeId, num, costTime: cond.time, startTime: 0, endTime: 0, cost: cond };
    q.push(item);
    if (q.length === 1){ item.startTime = now; item.endTime = now + item.costTime * 1000; }
    return null;
  }
  cancel(c, pos, queueId, now){
    const q = this.queues(c)[pos]; const i = q ? q.findIndex(x => x.queueId === queueId) : -1;
    if (i < 0) return [-23, 'That training batch is already finished.'];
    const [item] = q.splice(i, 1);
    this.castle.pay(c, item.cost, 1, this.rules.troopCancelRefundRate);
    c.pop += item.cost.population;
    if (i === 0 && q.length){ q[0].startTime = now; q[0].endTime = now + q[0].costTime * 1000; }
    return null;
  }
  // Shorten the batch now in training. Returns an error or null.
  speedUp(c, pos, queueId, reduce, now){
    const q = this.queues(c)[pos]; const item = q && q[0];
    if (!item || item.queueId !== queueId) return [-23, 'Only the batch now in training can be sped up.'];
    item.endTime = Math.max(now, reduce(item.endTime - now) + now);
    return null;
  }
  // Finish every batch that is due; returns true if troops changed.
  completeDue(c, now){
    let changed = false;
    for (const q of Object.values(this.queues(c))){
      while (q.length && q[0].endTime && q[0].endTime <= now){
        const done = q.shift(), field = this.data.troops[done.type].field;
        c.troops[field] = (c.troops[field] || 0) + done.num;
        changed = true; this.onDone?.(c, done.type, done.num);
        if (q.length){ q[0].startTime = done.endTime; q[0].endTime = done.endTime + q[0].costTime * 1000; }
      }
    }
    return changed;
  }
  nextDue(c){ let t = Infinity; for (const q of Object.values(this.queues(c))) if (q[0]?.endTime) t = Math.min(t, q[0].endTime); return t; }
  queueBeans(c){
    return this.barracks(c).map(({ pos }) => ({
      positionId: pos,
      allProduceQueue: (this.queues(c)[pos] || []).map(x => ({ queueId: x.queueId, type: x.type, num: x.num, costTime: x.costTime, endTime: x.endTime || 0 })),
    }));
  }
}

module.exports = { TroopLogic };
