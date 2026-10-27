'use strict';
// Achievements (the client's 成就 window: quest.getEffortList, quest.getEffortListByTargeTypeid).
// Where it comes from:
//   - The achievements, their ids, requirements and points: the client's own share texts (FbData, type
//     "achievement": "You have completed the Achievement <Kill 1,000 Workers> and got <25 Achievement Points>").
//   - The categories and their sizes: an Age II players' guide (2010): Scouting 5, Troops Training 53, Enemy Killing
//     53, Conquering 5, The Hero 24, Medal Acquisition 50, Civilization 5, Resource Production 35, Marching 5, The
//     Captive 5, Domain 9, Territory 5, Booty 5.
//   - The rewards: each achievement's points, and 12 bonuses of 5 levels (the client's accomplishBuffDefine: +5%
//     gold, food, lumber, stone or iron production; -5% infantry, cavalry, mechanics or construction cost; 5% less
//     public grievance; +2% treasure drops; +1% wounded). Each level comes with one achievement; the client's table
//     lists their points ("10:25:50:100:200"), which picks out which achievements they are.
// My estimates: Booty is left out (nothing says what it asks); the 5 medal types the share texts don't cover
// (Courage to Nation) follow the 4 they do, and Medal Acquisition gets 5 "complete N" steps like the other big
// categories; The Hero has the 22 the share texts list; where the share texts repeat a number by mistake
// ("Complete 10 ..." four times) the steps are 10/20/30/40/48 (5/10/15/25/30 for Resource Production).
const { TROOP_FIELD } = require('../gamedata');
const { HERO_STATUS } = require('./heroes');
const N = n => n.toLocaleString('en-US');
const BUFF = {
  gold: 'IncGoldProduceEffortBuff', food: 'IncFoodProduceEffortBuff', wood: 'IncWoodProduceEffortBuff', stone: 'IncStoneProduceEffortBuff', iron: 'IncIronProduceEffortBuff',
  infantry: 'DecProduceMilitiaEffortBuff', cavalry: 'DecProcduceCavalryEffortBuf', machine: 'DecProduceMachineEffortBuff', build: 'DecProduceBuildEffortBuff',
  grievance: 'IncCastleSupportEffortBuff', drops: 'IncGetItemRateAfterWarEffortBuff', wounded: 'IncHurtedSoliderEffortBuff',
};
const CATS = [[1, 'Scouting'], [2, 'Troops Training'], [3, 'Enemy Killing'], [4, 'Conquering'], [5, 'The Hero'], [6, 'Medal Acquisition'], [7, 'Civilization'],
  [8, 'Resource Production'], [9, 'Marching'], [10, 'The Captive'], [11, 'Domain'], [12, 'Territory']];
// Troops in the share texts' order, with their names and whether the steps run 1,000/100,000/1M/10M or 1,000/10,000/100,000/1M.
const TROOPS = [['peasants', 'Workers'], ['militia', 'Warriors'], ['scouter', 'Scouts'], ['pikemen', 'Pikemen'], ['swordsmen', 'Swordsmen'], ['archer', 'Archers'],
  ['lightCavalry', 'Cavalries'], ['heavyCavalry', 'Cataphracts'], ['carriage', 'Transporters', true], ['ballista', 'Ballistae', true], ['batteringRam', 'Battering Rams', true], ['catapult', 'Catapults', true]];
const MEDALS = ['Cross', 'Rose', 'Lion', 'Honor', 'Courage', 'Wisdom', 'Freedom', 'Justice', 'Nation'];
const RES = [['food', 'Food'], ['wood', 'Lumber'], ['stone', 'Stone'], ['iron', 'Iron'], ['gold', 'Gold']];

// Every achievement: { id, cat, text, stat, n, pts, buff: [buffType, level] }.
function defs(){
  const out = [], add = (id, cat, text, stat, n, pts, buff = null) => out.push({ id, cat, text, stat, n, pts, buff });
  const P4 = [25, 50, 100, 200], P5 = [10, 25, 50, 100, 200], META = [25, 50, 100, 200, 400];
  // Scouting
  [1, 10, 100, 1000, 10000].forEach((n, i) => add(309 + i, 1, `${N(n)} successful scouting${n > 1 ? 's' : ''}`, 'scout', n, P5[i]));
  // Troops Training and Enemy Killing
  TROOPS.forEach(([f, name, small], t) => {
    const steps = small ? [1e3, 1e4, 1e5, 1e6] : [1e3, 1e5, 1e6, 1e7];
    steps.forEach((n, i) => { add(314 + t * 4 + i, 2, `Train ${N(n)} ${name}`, `train:${f}`, n, P4[i]); add(252 + t * 4 + i, 3, `Kill ${N(n)} ${name}`, `kill:${f}`, n, P4[i]); });
  });
  [10, 20, 30, 40, 48].forEach((n, i) => add(362 + i, 2, `Complete ${n} Troops Training Achievements`, 'meta:2', n, META[i]));
  [10, 20, 30, 40, 48].forEach((n, i) => add(300 + i, 3, `Complete ${n} Enemy Killing Achievements`, 'meta:3', n, META[i], [BUFF.wounded, i + 1]));
  // Conquering
  [[305, 1], [306, 10], [307, 100], [308, 250], [514, 400]].forEach(([id, n], i) => add(id, 4, `Seize ${N(n)} cit${n > 1 ? 'ies' : 'y'}`, 'seize', n, META[i], [BUFF.drops, i + 1]));
  // The Hero
  [10, 25, 50, 75, 100].forEach((n, i) => add(428 + i, 5, `Accommodate ${n} Heroes`, 'heroes', n, P5[i]));
  [1, 5, 15, 30, 50].forEach((n, i) => add(518 + i, 5, `Accommodate ${n} Historic Hero${n > 1 ? 'es' : ''}`, 'historic', n, P5[i]));
  [[523, 1], [524, 5], [537, 10], [525, 15], [526, 20], [527, 30]].forEach(([id, n], i) => add(id, 5, `Accommodate ${n} Lv100 Ordinary Hero${n > 1 ? 'es' : ''}`, 'lv100', n, [...P5, 300][i]));
  [[529, 1], [530, 5], [538, 10], [531, 15], [532, 20], [533, 30]].forEach(([id, n], i) => add(id, 5, `Accommodate ${n} Lv100 Historic Hero${n > 1 ? 'es' : ''}`, 'lv100historic', n, [...P5, 300][i]));
  // Medal Acquisition
  MEDALS.forEach((m, k) => [1, 10, 25, 50, 100].forEach((n, i) => add(k < 4 ? 433 + k * 5 + i : 600 + (k - 4) * 5 + i, 6, `Acquire ${n} ${m} Medal${n > 1 ? 's' : ''}`, `medal:hero.loyalty.${k + 1}`, n, P5[i])));
  [10, 20, 30, 40, 45].forEach((n, i) => add(625 + i, 6, `Complete ${n} Medal Acquisition Achievements`, 'meta:6', n, META[i]));
  // Civilization
  [1, 5, 10, 15, 19].forEach((n, i) => add(390 + i, 7, `Develop ${n} Lv10 technolog${n > 1 ? 'ies' : 'y'}`, 'tech10', n, P5[i], [BUFF.machine, i + 1]));
  // Resource Production
  RES.forEach(([k, name], r) => [1e4, 1e5, 1e6, 1e8, 1e9, 1e10].forEach((n, i) => add(395 + r * 6 + i, 8, `Produce ${N(n)} ${name}`, `produce:${k}`, n, [...P5, 400][i], i < 5 ? [BUFF[k], i + 1] : null)));
  [[516, 5, 5], [425, 10, 10], [426, 15, 25], [517, 25, 50], [427, 30, 100]].forEach(([id, n, pts], i) => add(id, 8, `Complete ${n} Resource Production Achievements`, 'meta:8', n, pts, [BUFF.grievance, i + 1]));
  // Marching
  [[381, 100], [382, 1000], [383, 1e4], [384, 1e5], [385, 1e6]].forEach(([id, n], i) => add(id, 9, `A total mileage of ${N(n)} miles`, 'miles', n, P5[i], [BUFF.cavalry, i + 1]));
  // The Captive
  [[386, 1], [387, 10], [388, 50], [515, 75], [389, 100]].forEach(([id, n], i) => add(id, 10, `Capture ${n} Hero${n > 1 ? 'es' : ''}`, 'captive', n, [10, 25, 50, 75, 100][i], [BUFF.infantry, i + 1]));
  // Domain: the construction bonus comes with 2, 4, 6, 8 and 10 cities (10:50:100:300:500).
  [10, 25, 50, 75, 100, 200, 300, 400, 500].forEach((pts, i) => add(367 + i, 11, `Own ${i + 2} cities`, 'cities', i + 2, pts, i % 2 === 0 ? [BUFF.build, i / 2 + 1] : null));
  // Territory
  add(376, 12, 'Seize a Lv10 Barbarian City', 'barbarian10', 1, 50);
  [['1to3', 'Lv1 to Lv3', 5], ['4to6', 'Lv4 to Lv6', 10], ['7to9', 'Lv7 to Lv9', 20], ['10', 'Lv10', 40]].forEach(([band, text, pts], i) => add(377 + i, 12, `Occupy a ${text} Valley`, `valley:${band}`, 1, pts));
  return out;
}

class Effort {
  constructor(game){
    this.g = game; this.list = defs(); this.byId = new Map(this.list.map(a => [a.id, a]));
    this.byCat = new Map(CATS.map(([id]) => [id, this.list.filter(a => a.cat === id)]));
  }
  get rules(){ return this.g.rules.achievements || {}; }
  enabled(){ return this.rules.enabled !== false; }
  state(p){ return p.effort || (p.effort = { stats: {}, done: {}, points: 0 }); }
  // ---------- counting ----------
  note(p, key, n = 1){
    if (!p || !this.enabled() || !(n > 0)) return;
    const s = this.state(p).stats; s[key] = (s[key] || 0) + n;
  }
  // Losses one side inflicted (battle report rows: { field, lose }), troops only.
  kills(p, rows){ for (const r of rows || []) if (!r.fort && TROOP_FIELD[r.typeId] && r.lose > 0) this.note(p, `kill:${TROOP_FIELD[r.typeId]}`, r.lose); }
  valley(p, level){ this.note(p, `valley:${level >= 10 ? '10' : level >= 7 ? '7to9' : level >= 4 ? '4to6' : '1to3'}`); }
  // What an achievement's counter stands at now.
  value(p, a){
    const g = this.g, s = this.state(p), heroes = () => g.castlesOf(p).flatMap(c => g.heroes.list(c)).filter(h => h.status !== HERO_STATUS.SEIZED);   // (not prisoners)
    switch (a.stat){
      case 'cities': return g.castlesOf(p).length;
      case 'heroes': return heroes().length;
      case 'historic': return heroes().filter(h => h.historic).length;
      case 'lv100': return heroes().filter(h => !h.historic && (h.level || 0) >= 100).length;
      case 'lv100historic': return heroes().filter(h => h.historic && (h.level || 0) >= 100).length;
      case 'tech10': return Object.values(p.techs || {}).filter(l => l >= 10).length;
    }
    if (a.stat.startsWith('meta:')){ const cat = Number(a.stat.slice(5)); return this.byCat.get(cat).filter(x => !x.stat.startsWith('meta:') && s.done[x.id]).length; }
    return Math.floor(s.stats[a.stat] || 0);
  }
  // A bonus's level (0-5): the achievements of that bonus that are done.
  level(p, buff){ const s = p?.effort; if (!s) return 0; let n = 0; for (const a of this.list) if (a.buff?.[0] === buff && s.done[a.id]) n = Math.max(n, a.buff[1]); return n; }
  bonus(p, key){ const lv = this.level(p, BUFF[key]); return lv * (key === 'drops' ? 2 : key === 'wounded' ? 1 : 5); }
  // The bonuses as buffs (descName is the level, as the Summary page reads it); the client keeps them off the buff bar.
  buffs(p, now){ return Object.values(BUFF).map(b => [b, this.level(p, b)]).filter(([, lv]) => lv > 0).map(([typeId, lv]) => ({ typeId, endTime: now + 3650 * 86400000, descName: String(lv) })); }

  // ---------- completing ----------
  // Mark what's newly done (meta achievements after the rest); returns the new ones.
  check(p, now = this.g.now(), notify = true){
    if (!this.enabled() || !p) return [];
    const s = this.state(p), fresh = [];
    for (const pass of [0, 1]) for (const a of this.list){
      if (s.done[a.id] || a.stat.startsWith('meta:') !== !!pass) continue;
      if (this.value(p, a) >= a.n){ s.done[a.id] = now; s.points += a.pts; fresh.push(a); }
    }
    if (!fresh.length) return fresh;
    for (const n of [100, 500, 1000, 5000, 20000]) if (s.points >= n) this.g.quests.flag(p, `achievement${n}`);
    this.g.store.touch();
    if (notify && this.g.online.has(p.id)){
      for (const a of fresh) this.g.push(p.id, 'server.QuestCompleteTipResponse', { questId: a.id, name: a.text, quest: this.bean(p, a) });
      if (fresh.some(a => a.buff)) for (const b of this.buffs(p, now)) this.g.push(p.id, 'server.PlayerBuffUpdate', { buffBean: b, updateType: 2 });
      this.g.pushPlayerInfo(p);
    }
    return fresh;
  }

  // ---------- the window ----------
  // QuestBean as the window reads it: name "done/target" (the progress bar), description "title" or
  // "title:Buff/level" (the bonus icon), manual the requirement, award the points.
  bean(p, a){
    const done = !!this.state(p).done[a.id];
    let cur = done ? a.n : Math.min(this.value(p, a), a.n), tgt = a.n;
    while (tgt > 2e9){ cur = Math.floor(cur / 1000); tgt = Math.floor(tgt / 1000); }   // (the client reads them as 32-bit ints)
    const title = CATS.find(([id]) => id === a.cat)[1];
    return { questId: a.id, name: `${cur}/${tgt}`, description: a.buff ? `${title}:${a.buff[0]}/${a.buff[1]}` : title, manual: a.text, award: String(a.pts),
      isFinish: done, isCard: false, islast: false, recommend: false, version: 1, targets: [{ name: a.text, finished: done }] };
  }
  summary(p){ const s = this.state(p); return { effortpoint: String(s.points), effortcomplete: String(Object.keys(s.done).length), effortlistbean: CATS.map(([id, name]) => ({ effortTypeid: id, effortListInfo: name })) }; }
  category(p, cat){ return (this.byCat.get(Number(cat)) || []).map(a => this.bean(p, a)); }
}

module.exports = { Effort, EFFORT_BUFF: BUFF };
