'use strict';
// Hero gear ("Armor Enhancement"). Gear isn't an item: the lord researches 14 gear technologies in the
// Workshop (levels 1-10, from the client's equipment table: buildings needed and materials used up), and
// every hero can then wear each piece in one of 16 slots, at that level but at most one gear level per 10
// hero levels (rules.gear). A worn piece adds its level in points to the attribute chosen when it is put on
// (politics, attack or intelligence); the mount adds 10 x level % to the hero's marching speed. Star levels
// (enhanced with gems) add points on top (the live server's version of the client's table), up to the stars the
// worn level can hold; the mount's stars add nothing. A lord whose every gear technology has enough stars gets
// extra life for his troops against NPC cities (rules.starSetLife). Numbers come from the client (EquipStarWin,
// AccouterTooltip, HeroProperties, NewArmyWin), except the research times, which the client doesn't carry, the
// star set bonus (Evony Advanced Guide), and the hero-level limits, star points and mount speed (the live game).

// Hero slot (EquipmentTech.EQUIPMENT_SLOT_*) -> gear technology type (EquipmentTech.*_TECH).
const SLOT_TECH = { 1: 7, 2: 9, 3: 1, 4: 2, 5: 13, 6: 5, 7: 6, 8: 3, 9: 4, 10: 8, 11: 10, 12: 11, 13: 12, 14: 5, 15: 6, 16: 14 };
const MOUNT_SLOT = 8, MOUNT_TECH = 3;
const ATTR = { 1: 'pol', 2: 'atk', 3: 'int' };                 // EquipmentTech.POLITICS / ATTACK / INTELLIGENCE
// Points a piece gets for its stars. The client's table (EquipStarWin, the tooltips) is 1.32^(stars - 3) rounded;
// the live server cuts it off at two decimals instead, which is what the hero window shows (Fox, Oct 2026: 15 pieces
// at 7, 8 and 9 stars add 60.45, 90 and 124.2 attack, not 60.6, 90.15 and 124.35).
const STAR_POINTS = [0.4, 0.75, 1, 1.32, 1.74, 2.29, 3.03, 4, 5.28, 6.98, 9.21, 12.16, 16.05, 21.19, 27.98];
const STAR_BASE_RATE = [55, 50, 45, 40, 35, 30, 25, 20, 10, 0, -5, -10, -15, -15, -15];
const GEM_RATE = { 'enhanced.star.1': 10, 'enhanced.star.2': 15 };
// Where a failed upgrade from star s leaves the gear (EquipStarWin's help text).
const STAR_FAIL_TO = [0, 0, 0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 0, 0, 0];
const MAX_STAR = 15;

class EquipmentLogic {
  constructor(game){ this.g = game; }
  get techs(){ return this.g.data.equipTechs || {}; }
  types(){ return Object.keys(this.techs).map(Number).sort((a, b) => a - b); }
  state(p, type){ p.gear = p.gear || {}; return p.gear[type] || (p.gear[type] = { lv: 0, star: 0 }); }
  level(p, type){ return p.gear?.[type]?.lv || 0; }
  star(p, type){ return p.gear?.[type]?.star || 0; }
  maxStar(p, type){ const L = this.level(p, type); return L ? Math.min(MAX_STAR, L + 6) : 0; }
  starPoints(p, type, s = this.star(p, type)){ return s ? STAR_POINTS[s - 1] : 0; }

  // ---------- research in the Workshop ----------
  seconds(L){
    const t = this.g.rules.gear?.researchMinutes || [];
    return Math.max(1, Math.round((t[L - 1] ?? 60 * L) * 60 / this.g.logic.speed));
  }
  condition(c, p, type, L){
    const d = this.techs[type]?.levels[Math.min(L, 10) - 1];
    const buildings = (d?.builds || []).map(b => { const cur = this.g.logic.level(c, b.typeId); return { typeId: b.typeId, level: b.level, curLevel: cur, successFlag: cur >= b.level }; });
    const items = (d?.items || []).map(i => { const cur = p.items?.[i.id] || 0; return { id: i.id, num: i.count, curNum: cur, successFlag: cur >= i.count }; });
    return { buildings, techs: [], items, food: 0, wood: 0, stone: 0, iron: 0, gold: 0, population: 0, time: this.seconds(Math.min(L, 10)), destructTime: 0 };
  }
  bean(c, p, type){
    const L = this.level(p, type), r = p.gearResearch, mine = r && r.type === type;
    const cond = this.condition(c, p, type, Math.min(L + 1, 10));
    const met = cond.buildings.every(b => b.successFlag) && cond.items.every(i => i.successFlag);
    return { typeId: type, level: L, avalevel: 10, castleId: mine ? r.castleId : c.id, permition: met && !r && L < 10, conditionBean: cond,
      upgradeing: !!mine, startTime: mine ? r.startTime : 0, endTime: mine ? r.endTime : 0, help: 0, enhancedstarlv: this.star(p, type) };
  }
  list(c, p){ return this.types().map(t => this.bean(c, p, t)); }
  start(c, p, type, now){
    const tech = this.techs[type]; if (!tech) return [-1, 'Unknown gear technology.'];
    if (p.gearResearch) return [-17, 'Your Workshop is already researching gear.'];
    const L = this.level(p, type) + 1;
    if (L > 10) return [-36, `${tech.name} is already at level 10.`];
    const cond = this.condition(c, p, type, L);
    const b = cond.buildings.find(x => !x.successFlag);
    if (b) return [-8, `${tech.name} level ${L} needs ${this.g.logic.typeName(b.typeId)} level ${b.level} in this city.`];
    const i = cond.items.find(x => !x.successFlag);
    if (i) return [-44, `${tech.name} level ${L} needs ${i.num} ${this.g.data.items[i.id]?.name || i.id} (you have ${i.curNum}).`];
    for (const x of cond.items) p.items[x.id] -= x.num;
    p.gearResearch = { type, level: L, castleId: c.id, startTime: now, endTime: now + cond.time * 1000, items: cond.items.map(x => ({ id: x.id, num: x.num })) };
    return { items: cond.items.map(x => x.id) };
  }
  // Cancelling gives the materials back.
  cancel(p){
    const r = p.gearResearch; if (!r) return [-26, 'Nothing is being researched in the Workshop.'];
    for (const x of r.items || []) p.items[x.id] = (p.items[x.id] || 0) + x.num;
    p.gearResearch = null;
    return { type: r.type, items: (r.items || []).map(x => x.id) };
  }
  completeDue(p, now){
    const r = p.gearResearch; if (!r || r.endTime > now) return null;
    const s = this.state(p, r.type);
    s.lv = r.level;
    if (s.star > 0) s.star -= 1;                       // "The current star level will be downgraded by one when gear technology is upgraded"
    p.gearResearch = null;
    return r;
  }

  // ---------- stars ----------
  // Up to four gems of one kind; success = base rate for the current star + 10% (Delicate) or 15% (Flawless) a gem.
  enhanceStar(p, type, gemId, count, rnd = Math.random){
    const tech = this.techs[type]; if (!tech) return [-1, 'Unknown gear technology.'];
    const L = this.level(p, type); if (!L) return [-1, `Research ${tech.name} before adding stars to it.`];
    const s = this.state(p, type);
    if (s.star >= this.maxStar(p, type)) return [-1, s.star >= MAX_STAR ? `${tech.name} already has 15 stars.` : `${tech.name} level ${L} can hold at most ${this.maxStar(p, type)} stars; research the next level for more.`];
    if (!GEM_RATE[gemId]) return [-1, 'Stars need Delicate or Flawless gems.'];
    count = Math.max(1, Math.min(4, Math.floor(Number(count) || 1)));
    if ((p.items?.[gemId] || 0) < count) return [-44, `You need ${count} ${this.g.data.items[gemId]?.name || gemId}.`];
    p.items[gemId] -= count;
    const rate = Math.min(100, STAR_BASE_RATE[s.star] + count * GEM_RATE[gemId]);
    const ok = rnd() * 100 < rate;
    const from = s.star;
    s.star = ok ? s.star + 1 : STAR_FAIL_TO[s.star];
    return { ok, rate, from, star: s.star, gemId };
  }

  // ---------- heroes ----------
  worn(h){ return h.gear || (h.gear = {}); }
  // The gear level a hero wears: the Workshop's, but at most one level per rules.gear.heroLevelsPerLevel hero
  // levels, and the stars that level can hold (level + 6). Live (Fox): a level 5 hero wears nothing, a level 10
  // hero level 1 gear with 7 stars, level 20 level 2 with 8 stars ... level 100 level 10 with 15 stars.
  heroLevels(){ return this.g.rules.gear?.heroLevelsPerLevel || 0; }
  wornLevel(p, h, type){
    const L = this.level(p, type), per = this.heroLevels();
    return per ? Math.min(L, Math.floor((h?.level || 0) / per)) : L;
  }
  wornStar(p, h, type){ const L = this.wornLevel(p, h, type); return L ? Math.min(this.star(p, type), L + 6, MAX_STAR) : 0; }
  // The bonus one slot gives: points for an attribute, or speed % for the mount (10 a level; its stars add no
  // speed: live, a hero's speed is exactly 10 x his mount's level).
  slotBonus(p, h, pos){
    const type = SLOT_TECH[pos], L = this.wornLevel(p, h, type), attr = this.worn(h)[pos];
    if (!L || !attr) return { attr: null, value: 0 };
    if (pos === MOUNT_SLOT) return { attr: 'speed', value: L * 10 };
    return { attr: ATTR[attr] || null, value: L + this.starPoints(p, type, this.wornStar(p, h, type)) };
  }
  // Totals for a hero: { pol, atk, int, speed }.
  bonus(p, h){
    const out = { pol: 0, atk: 0, int: 0, speed: 0 };
    if (!p || !h?.gear) return out;
    for (const pos of Object.keys(SLOT_TECH).map(Number)){ const b = this.slotBonus(p, h, pos); if (b.attr) out[b.attr] += b.value; }
    return out;
  }
  // The star set: the fewest stars on any of the lord's 14 gear technologies (0 until all are researched).
  // It belongs to the lord, not to what the leading hero wears: live, a level 30 hero with no gear on lost about
  // as few troops at an NPC 5 as one in full gear (Fox, Oct 2026). rules.starSetLife.perHero: true counts
  // only the 16 pieces the hero wears instead, at the stars his level allows.
  setStars(p, h){
    if (!p) return 0;
    let min = MAX_STAR;
    if (this.g.rules.starSetLife?.perHero){
      if (!h?.gear) return 0;
      for (const pos of Object.keys(SLOT_TECH).map(Number)){
        const type = SLOT_TECH[pos];
        if (!this.worn(h)[pos] || !this.wornLevel(p, h, type)) return 0;
        min = Math.min(min, this.wornStar(p, h, type));
      }
      return min;
    }
    for (const type of this.types()){ if (!this.level(p, type)) return 0; min = Math.min(min, this.star(p, type)); }
    return min;
  }
  // Extra life (%) the star set gives the lord's troops (rules.starSetLife).
  setLife(p, h){
    const s = this.setStars(p, h); let v = 0;
    for (const [stars, life] of this.g.rules.starSetLife?.tiers || []) if (s >= stars) v = Math.max(v, life);
    return v;
  }
  // The 16 EquipmentBeans the hero window shows.
  beans(p, h){
    return Object.keys(SLOT_TECH).map(Number).map(pos => {
      const type = SLOT_TECH[pos], L = p ? this.wornLevel(p, h, type) : 0, attr = this.worn(h)[pos] || 0, b = p ? this.slotBonus(p, h, pos) : { value: 0 };
      return { heroPos: pos, equipmenttech: type, lv: L, addAttributeType: L ? attr : 0, addAttribute: L && attr ? (pos === MOUNT_SLOT ? L * 10 : L) : 0,
        // (live: the stars the hero's level allows show on every slot but the mount, worn or not: 6 at level 1)
        euipmenttechStarLv: p && pos !== MOUNT_SLOT ? Math.min(this.star(p, type), L + 6, MAX_STAR) : 0, value: b.value };
    });
  }
  tooLow(h){ return `${h.name || 'This hero'} can wear gear from level ${this.heroLevels()} (one gear level for every ${this.heroLevels()} hero levels).`; }
  wear(p, h, pos, attrType){
    pos = Number(pos); attrType = Number(attrType);
    const type = SLOT_TECH[pos]; if (!type) return [-1, 'That is not a gear slot.'];
    if (!this.level(p, type)) return [-1, `Research ${this.techs[type]?.name || 'that gear'} in the Workshop first.`];
    if (!this.wornLevel(p, h, type)) return [-1, this.tooLow(h)];
    if (pos === MOUNT_SLOT) attrType = attrType || 1;
    if (!ATTR[attrType] && pos !== MOUNT_SLOT) return [-1, 'Choose politics, attack or intelligence for that piece.'];
    this.worn(h)[pos] = attrType;
    return { hero: h };
  }
  wearAll(p, h, attrType){
    attrType = Number(attrType);
    if (!ATTR[attrType]) return [-1, 'Choose politics, attack or intelligence.'];
    let n = 0;
    let researched = 0;
    for (const pos of Object.keys(SLOT_TECH).map(Number)){
      if (this.level(p, SLOT_TECH[pos])) researched++;
      if (this.wornLevel(p, h, SLOT_TECH[pos])){ this.worn(h)[pos] = pos === MOUNT_SLOT ? (this.worn(h)[pos] || 1) : attrType; n++; }
    }
    if (!n) return [-1, researched ? this.tooLow(h) : 'Research gear in the Workshop first.'];
    return { hero: h };
  }
  takeOff(h, pos){ pos = Number(pos); if (!this.worn(h)[pos]) return [-1, 'Nothing is worn there.']; delete this.worn(h)[pos]; return { hero: h }; }
  takeOffAll(h){ h.gear = {}; return { hero: h }; }
}

module.exports = { EquipmentLogic, SLOT_TECH, MOUNT_SLOT, STAR_POINTS, STAR_BASE_RATE, STAR_FAIL_TO };
