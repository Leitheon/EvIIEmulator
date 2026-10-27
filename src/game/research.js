'use strict';
// Academy research. Research is shared by all of a lord's cities and runs one topic at a time.
// Costs, times and effects come from the client's research table.
const { TYPE } = require('./castle');

class ResearchLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  // The mayor's intelligence: 0.14% off a whole point, as his politics does for building (live) and his attack for
  // training (the guide's 0.87 a hundred points); inferred for research.
  seconds(p, techId, L, mayorInt = 0){ const d = this.data.techs[techId]?.levels[L - 1]; return d ? Math.max(1, Math.floor(d.time / this.speed * Math.pow(this.rules.mayorStepPerPoint ?? 0.9986, Math.floor(mayorInt)))) : 0; }
  condition(c, p, techId, L){
    const d = this.data.techs[techId].levels[Math.min(L, 10) - 1];
    const buildings = [], techs = [];
    const academy = this.castle.level(c, TYPE.ACADEMY);
    const need = Math.max(L, this.rules.techAcademy?.[techId] || 1);
    buildings.push({ typeId: TYPE.ACADEMY, level: need, curLevel: academy, successFlag: academy >= need });
    const perLevel = this.rules.techBuildingPerLevel?.[techId];
    if (perLevel){ const cur = this.castle.level(c, perLevel); buildings.push({ typeId: perLevel, level: L, curLevel: cur, successFlag: cur >= L }); }
    if (L === 1) for (const [kind, id, level] of this.rules.techUnlock[techId] || []){
      if (kind === 'b'){ const cur = this.castle.level(c, id); buildings.push({ typeId: id, level, curLevel: cur, successFlag: cur >= level }); }
      else { const cur = this.castle.techLevel(p, id); techs.push({ id, level, curLevel: cur, successFlag: cur >= level }); }
    }
    return { buildings, techs, items: [], food: d.food, wood: d.wood, stone: d.stone, iron: d.iron, gold: d.gold, population: 0, time: this.seconds(p, techId, Math.min(L, 10), this.mayorBonus ? this.mayorBonus(c) : 0), destructTime: 0 };
  }
  bean(c, p, techId){
    const L = this.castle.techLevel(p, techId), r = p.research, busy = !!r;
    const cond = this.condition(c, p, techId, Math.min(L + 1, 10));
    const met = cond.buildings.every(b => b.successFlag) && cond.techs.every(t => t.successFlag);
    const mine = r && r.techId === techId;
    return { typeId: techId, level: L, avalevel: this.castle.level(c, TYPE.ACADEMY), castleId: mine ? r.castleId : c.id, permition: met && !busy && L < 10,
      conditionBean: cond, upgradeing: !!mine, startTime: mine ? r.startTime : 0, endTime: mine ? r.endTime : 0, help: 0, enhancedstarlv: 0 };
  }
  list(c, p){ return Object.keys(this.data.techs).map(Number).sort((a, b) => a - b).map(id => this.bean(c, p, id)); }

  start(c, p, techId, now){
    if (!this.data.techs[techId]) return [-1, 'Unknown research.'];
    if (p.research) return [-17, 'Your scholars are already researching something.'];
    const L = this.castle.techLevel(p, techId) + 1;
    if (L > 10) return [-36, 'That research is complete.'];
    const cond = this.condition(c, p, techId, L);
    const miss = cond.buildings.find(b => !b.successFlag) || cond.techs.find(t => !t.successFlag);
    if (miss) return [-8, miss.typeId ? `Requires ${this.castle.typeName(miss.typeId)} level ${miss.level}.` : `Requires ${this.data.techs[miss.id].name} level ${miss.level}.`];
    for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) if (c.res[k] < cond[k]) return [-1, `Not enough ${k === 'wood' ? 'lumber' : k}.`];
    for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) c.res[k] -= cond[k];
    p.research = { techId, level: L, castleId: c.id, startTime: now, endTime: now + cond.time * 1000, cost: cond };
    return null;
  }
  cancel(p, castlesById){
    const r = p.research; if (!r) return [-26, 'Nothing is being researched.'];
    const c = castlesById[r.castleId];
    if (c) for (const k of ['food', 'wood', 'stone', 'iron', 'gold']) c.res[k] += Math.floor(r.cost[k] * this.rules.researchCancelRefundRate);
    p.research = null;
    return null;
  }
  completeDue(p, now){
    const r = p.research; if (!r || r.endTime > now) return null;
    p.techs[r.techId] = r.level; p.research = null;
    return r;
  }
}

module.exports = { ResearchLogic };
