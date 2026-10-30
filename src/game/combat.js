'use strict';
// Battle simulation. Evony never published its formula; this follows what players documented (the Age I
// combat formula and Age II battle guides), with the unknown constants (rules.battle) fitted to dxcalc:
//   - The attacker starts (longest base range of anything taking part + fieldPad) away from the defender. Traps,
//     abatis and defensive trebuchets have range 5000, so most city fights start 5200 apart.
//   - Each round every stack acts once, fastest first (ties: defender first; scouts last). A stack with an enemy
//     in range attacks one enemy stack; otherwise it moves its speed toward the nearest enemy. Defending troops
//     march out too.
//   - Melee stacks hit the fastest enemy in range; ranged stacks (archers, ballistae, catapults, archer's towers)
//     hit the closest enemy ranged stack in range, else the closest (rules.battle.rangedFirst). Damage beyond
//     what kills the target stack is lost.
//   - Kills = count x attack x bonus x (1 - defence/1000) x damageScale x (rangedScale or towerScale) / life,
//     rounded up (players' Age I formula; bonus from rules.counters, e.g. pikemen x1.8 against horsemen;
//     defence counts as at least defenceFloor).
//   - After both sides have acted, the walls act: archer's towers shoot; trapRatePercent of the traps fire each
//     round at foot or horse; abatis hit horsemen once; rolling logs hit foot soldiers once; defensive
//     trebuchets fire once, siege engines first.
const CLASS = { 2: 'foot', 3: 'foot', 4: 'foot', 5: 'foot', 6: 'foot', 7: 'foot',
  8: 'siege', 9: 'mounted', 10: 'mounted', 11: 'siege', 12: 'siege', 13: 'siege', 16: 'fort' };
const RANGED = new Set([7, 11, 13, 16]);
const SCOUT = 4, BALLISTA = 11;
const FORT = { trap: 14, abatis: 15, arrowTower: 16, rollingLogs: 17, rockfall: 18 };
const TECH = { ATTACK: 9, DEFENCE: 10, COMPASS: 12, HORSEBACK: 13, ARCHERY: 14, MEDICINE: 16, ENGINEERING: 18 };

class Combat {
  constructor(data, rules){ this.data = data; this.rules = rules; }

  get cfg(){ return this.rules.battle; }

  // side: { troops: {field: n}, forts: {field: n}, mods: { attack, defence, life, range, fortLife, speedFoot, speedHorse } in % }
  stacks(side, who, x){
    const out = [], m = side.mods || {};
    for (const t of Object.values(this.data.troops)){
      const n = Math.floor(side.troops?.[t.field] || 0); if (n <= 0) continue;
      const cls = CLASS[t.id], ranged = RANGED.has(t.id);
      out.push({ who, typeId: t.id, field: t.field, cls, ranged, start: n, count: n, x,
        atk: t.attack * (1 + (m.attack || 0) / 100), def: t.defence * (1 + (m.defence || 0) / 100), life: t.life * (1 + (m.life || 0) / 100),
        baseRange: t.range, range: t.range * (ranged ? 1 + ((m.range || 0) - (this.cfg.wallRangeTowersOnly ? m.wall || 0 : 0)) / 100 : 1),
        speed: t.speed * (1 + ((cls === 'foot' ? m.speedFoot : m.speedHorse) || 0) / 100) });
    }
    const towers = Math.floor(side.forts?.arrowTower || 0), tw = this.data.forts[FORT.arrowTower];
    if (towers > 0) out.push({ who, typeId: FORT.arrowTower, field: 'arrowTower', cls: 'fort', ranged: true, tower: true, start: towers, count: towers, x,
      atk: tw.attack * (1 + (m.attack || 0) / 100), def: tw.defence, life: tw.life * (1 + (this.cfg.towerLifeFromEngineering ? m.fortLife || 0 : 0) / 100),
      baseRange: tw.range, range: (tw.range + (this.cfg.towerRangePad || 0)) * (1 + (m.range || 0) / 100), speed: 0 });
    return out;
  }
  counter(a, d){
    const c = this.rules.counters?.[a.typeId]; if (!c) return 1;
    return c[d.typeId] ?? c[d.cls] ?? 1;
  }
  damage(a, d, count = a.count, atk = a.atk){
    const cfg = this.cfg;
    const f = Math.max(cfg.minDefenceFactor ?? 0, 1 - Math.max(cfg.defenceFloor ?? 0, d.def) / 1000);
    let scale = a.tower ? cfg.towerScale ?? 1 : a.ranged ? cfg.rangedScale ?? 1 : 1;
    if (cfg.distMod && a.ranged && a.x !== undefined && d.x !== undefined){
      const dist = Math.abs(a.x - d.x);
      scale *= (dist < 1e-9 ? 0.25 : dist > a.range / 2 + 1e-9 ? 0.5 : 1) / 0.5;
    }
    return count * atk * (cfg.damageScale ?? 1) * scale * f * this.counter(a, d);
  }
  hit(target, dmg){
    const k = Math.min(target.count, Math.max(0, Math.ceil(dmg / target.life - 1e-9)));
    target.count -= k;
    return k;
  }
  // Who a stack attacks among the enemies in its range, or null.
  pick(s, enemies){
    const d = e => Math.abs(e.x - s.x), total = e => e.count * e.atk;
    const inRange = enemies.filter(e => d(e) <= s.range + 1e-9);
    if (!inRange.length) return null;
    if (s.ranged){
      const pool = this.cfg.rangedFirst && inRange.some(e => e.ranged) ? inRange.filter(e => e.ranged) : inRange;
      return pool.sort((a, b) => d(a) - d(b) || total(b) - total(a))[0];
    }
    return inRange.sort((a, b) => b.speed - a.speed || total(b) - total(a))[0];
  }

  fight(attacker, defender){
    const cfg = this.cfg, F = this.data.forts, md = defender.mods || {};
    const forts = {};
    for (const k of ['trap', 'abatis', 'rollingLogs', 'rockfall']) forts[k] = Math.max(0, Math.floor(defender.forts?.[k] || 0));
    let longest = 0;
    const att0 = this.stacks(attacker, 'A', 0), def0 = this.stacks(defender, 'D', 0);
    for (const s of [...att0, ...def0]) longest = Math.max(longest, s.baseRange);
    for (const [k, n] of Object.entries(forts)) if (n > 0) longest = Math.max(longest, F[FORT[k]].range);
    const field = longest + (cfg.fieldPad || 0);
    for (const s of def0) s.x = field;
    const all = [...att0, ...def0];
    const alive = who => all.filter(s => s.who === who && s.count > 0);
    const used = { trap: 0, abatis: 0, rollingLogs: 0, rockfall: 0 };
    const fortAtk = base => base * (1 + (md.attack || 0) / 100);
    const largest = list => list.sort((a, b) => b.count - a.count)[0];
    let round = 0;
    while (round < (cfg.maxRounds || 100) && alive('A').length && alive('D').length){
      round++;
      if (this.onRound) this.onRound(round, all);
      const order = all.filter(s => s.count > 0 && !s.tower).sort((a, b) =>
        (a.typeId === SCOUT) - (b.typeId === SCOUT) || b.speed - a.speed || (a.who === 'D' ? -1 : 1) - (b.who === 'D' ? -1 : 1));
      for (const s of order){
        if (s.count <= 0) continue;
        const enemies = alive(s.who === 'A' ? 'D' : 'A');
        if (!enemies.length) break;
        const target = this.pick(s, enemies);
        if (target){
          this.hit(target, this.damage(s, target));
          // Ballistae creep forward while they shoot, until the walls are in range (Age I guides).
          if (s.typeId === BALLISTA && (cfg.ballistaCreep === 'both' || cfg.ballistaCreep === s.who)){
            if (s.who === 'A'){ if (field - s.x > s.range + 1e-9) s.x = Math.min(field, s.x + s.speed); }
            else { const foes = alive('A'); if (foes.length){ const near = foes.reduce((a, b) => Math.abs(b.x - s.x) < Math.abs(a.x - s.x) ? b : a);
              s.x += Math.sign(near.x - s.x) * Math.min(s.speed, Math.abs(near.x - s.x)); } }
          }
          continue;
        }
        if (s.who === 'D' && (cfg.defendersStay === 'all' || (cfg.defendersStay === 'ranged' && s.ranged))) continue;
        const near = enemies.reduce((a, b) => Math.abs(b.x - s.x) < Math.abs(a.x - s.x) ? b : a);
        s.x += Math.sign(near.x - s.x) * Math.min(s.speed, Math.abs(near.x - s.x));
      }
      // The walls.
      const tower = def0.find(s => s.tower && s.count > 0);
      if (tower){ const t = this.pick(tower, alive('A')); if (t) this.hit(t, this.damage(tower, t)); }
      const foes = () => alive('A');
      if (forts.trap - used.trap > 0){
        // trapRatePercent of the starting traps fire each round (small numbers carry over between rounds).
        const n = Math.min(forts.trap, Math.floor(forts.trap * (cfg.trapRatePercent || 100) / 100 * round + 1e-9)) - used.trap;
        used.trap += n;
        const t = largest(foes().filter(s => s.cls === 'foot' || s.cls === 'mounted'));
        if (t) t.count -= Math.min(t.count, Math.floor(n * cfg.trapPower * (cfg.trapKill?.[t.cls] || 0)));
      }
      if (forts.abatis - used.abatis > 0){
        const t = largest(foes().filter(s => s.cls === 'mounted'));
        if (t){ const n = forts.abatis - used.abatis; used.abatis += n; t.count -= Math.min(t.count, Math.floor(n * (cfg.abatisKill || 0))); }
      }
      if (forts.rollingLogs - used.rollingLogs > 0){
        const t = largest(foes().filter(s => s.cls === 'foot'));
        if (t){ const n = forts.rollingLogs - used.rollingLogs; used.rollingLogs += n;
          this.hit(t, this.damage({ typeId: FORT.rollingLogs }, t, n, fortAtk(F[FORT.rollingLogs].attack)) * (cfg.logPower || 1)); }
      }
      if (forts.rockfall - used.rockfall > 0){
        const list = foes(), siege = list.filter(s => s.cls === 'siege'), t = largest(siege.length ? siege : list);
        if (t){ const n = forts.rockfall - used.rockfall; used.rockfall += n;
          this.hit(t, this.damage({ typeId: FORT.rockfall }, t, n, fortAtk(F[FORT.rockfall].attack)) * (cfg.trebuchetPower || 1) * (siege.length ? cfg.trebuchetSiegeBonus || 1 : 1)); }
      }
    }
    const attackerWon = alive('A').length > 0 && alive('D').length === 0;
    const towerStack = def0.find(s => s.tower);
    const report = list => list.map(s => ({ typeId: s.typeId, field: s.field, count: s.start, lose: s.start - s.count }));
    const fortRows = Object.entries(used).filter(([k]) => forts[k] > 0).map(([k, n]) => ({ typeId: FORT[k], field: k, count: forts[k], lose: n, fort: true }));
    const left = list => { const o = {}; for (const s of list) if (s.count > 0 && !s.tower) o[s.field] = s.count; return o; };
    const pop = list => list.reduce((a, s) => a + (s.start - s.count) * (s.tower ? 3 : this.data.troops[s.typeId].population), 0);
    const attRows = report(att0), defRows = [...report(def0.filter(s => !s.tower)), ...(towerStack ? report([towerStack]) : []), ...fortRows]
      .sort((a, b) => a.typeId - b.typeId);
    return { round: Math.max(1, round), attackerWon, att: attRows, def: defRows, attLeft: left(att0), defLeft: left(def0),
      fortsUsed: Object.fromEntries(Object.entries(used).filter(([, n]) => n > 0)), towersLeft: towerStack ? towerStack.count : Math.floor(defender.forts?.arrowTower || 0),
      killedByAttacker: pop(def0), killedByDefender: pop(att0), field,
      expAttacker: this.exp(defRows, attackerWon), expDefender: this.exp(attRows, !attackerWon) };
  }

  // What these units lost are worth (rows with typeId and lose), from rules.heroExp: a hero's experience for
  // killing them is this times winFactor or loseFactor, and honor is worked out from it (honor()).
  value(rows){
    const r = this.rules.heroExp; if (!r) return 0;
    let sum = 0;
    for (const u of rows){
      if (!u.lose) continue;
      let each;
      if (u.typeId >= 14 && u.typeId <= 18) each = (this.data.forts[u.typeId]?.exp || 0) / (r.fortExpDivisor || 50);
      else { const t = this.data.troops[u.typeId]; each = r.troopExp?.[u.typeId] ?? (t ? (t.food + t.wood + t.stone + t.iron) * (r.troopExpPerResource || 0) : 0); }
      sum += u.lose * each;
    }
    return sum;
  }
  // Hero experience for killing these units.
  exp(rows, won){ const r = this.rules.heroExp; return r ? Math.floor(this.value(rows) * (won ? r.winFactor : r.loseFactor)) : 0; }
  // Honor from a battle between two lords (Fox's live reports, Oct 2026): what you killed is worth less what you
  // lost, divided by 8 for the winner and by 2 for the loser (rules.honor). Losing hurts four times as much.
  honor(killed, lost, won){
    const h = this.rules.honor || {}; if (h.enabled === false) return 0;
    return Math.round((this.value(killed) - this.value(lost)) / (won ? h.winDivisor ?? 8 : h.loseDivisor ?? 2));
  }

  // Share of the leading hero's bonus his army gets, on average. He leads (leadership x perPoint + level) x
  // leadership troops (rules.leadership); the rest get attackShare of his bonus when attacking, defenceShare
  // when defending. Spreading it over the whole army gives the same total damage as splitting the stacks.
  ledShare(hero, count, side = 'attack'){
    const r = this.rules.leadership;
    if (!hero || !r || r.enabled === false || !(count > 0)) return 1;
    const ldr = this.heroLeadership ? this.heroLeadership(hero) : hero.leadership ?? Math.max(1, Math.min(100, hero.level || 1));
    const cap = (ldr * (r.perPoint ?? 10) + (hero.level || 0)) * ldr;
    if (count <= cap) return 1;
    const rest = (side === 'defence' ? r.defenceShare : r.attackShare) || 0;
    return (cap + (count - cap) * rest) / count;
  }
  // Range bonus (%) a city's Walls give its defenders' archers, ballistae, catapults and archer's towers.
  wallRange(level){ return Math.max(0, level || 0) * (this.cfg.wallRangePerLevel || 0); }
  // Troops a hero leads in full.
  leads(hero){
    const r = this.rules.leadership; if (!hero || !r || r.enabled === false) return Infinity;
    const ldr = this.heroLeadership ? this.heroLeadership(hero) : hero.leadership ?? Math.max(1, Math.min(100, hero.level || 1));
    return (ldr * (r.perPoint ?? 10) + (hero.level || 0)) * ldr;
  }
  // Attack/defence/life/range/speed bonuses (%) from research and the leading hero.
  // opts.side: 'attack' or 'defence' (for leadership); opts.life: extra life % (the star set life bonus);
  // opts.walls: the defender's Walls level (rules.battle.wallRangePerLevel % more range, added to Archery's).
  mods(castleLogic, p, hero, troops = null, opts = {}){
    const e = id => castleLogic.techEffect(p, id);
    const count = troops ? Object.values(troops).reduce((a, n) => a + Math.max(0, n || 0), 0) : 0;
    const led = this.ledShare(hero, count, opts.side || 'attack');
    const attr = (k) => this.heroAttr ? this.heroAttr(hero, k) : hero.base[k] + hero.added[k];
    const hAtk = hero ? attr('atk') * this.rules.heroAttackPerPoint * led : 0;
    const hDef = hero ? attr('int') * this.rules.heroDefencePerIntelligence * led : 0;
    // War Horn / Corselet: +20% to the troops' attack or defence (player buffs, set by Game).
    const buff = this.playerBuff ? this.playerBuff(p) : { attack: 0, defence: 0 };
    return { attack: e(TECH.ATTACK) + hAtk + buff.attack, defence: e(TECH.DEFENCE) + hDef + buff.defence, life: e(TECH.MEDICINE) + (opts.life || 0) + (buff.life || 0), range: e(TECH.ARCHERY) + this.wallRange(opts.walls), wall: this.wallRange(opts.walls),
      fortLife: e(TECH.ENGINEERING), speedFoot: e(TECH.COMPASS), speedHorse: e(TECH.HORSEBACK) };
  }
}

module.exports = { Combat, CLASS, TECH };
