'use strict';
// Battle, scouting and transport reports. The client renders each report from an XML document in
// ReportBean.content (PublicReportDetail -> BattleReportDetail / ScoutReportDetail / TroopMovementDetail).
const TYPE = { TRADE: 0, ARMY: 1, OTHER: 2, SCOUT: 3 };
const MAX_REPORTS = 300;

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const attrs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
const el = (name, a, kids) => kids && kids.length ? `<${name}${attrs(a || {})}>${kids.join('')}</${name}>` : `<${name}${attrs(a || {})}/>`;
const pad = n => String(n).padStart(2, '0');
// Report times as the live server writes them: "10/22 18:58:27" (Fox's live reports, Oct 2026).
const stamp = ms => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

const { portraitUrl } = require('./heroes');
function heroAttrs(h){ return h ? { heroName: h.name, heroLevel: h.level, heroUrl: portraitUrl(h.face) } : {}; }
function res(r){ r = r || {}; return { food: Math.floor(r.food || 0), wood: Math.floor(r.wood || 0), stone: Math.floor(r.stone || 0), iron: Math.floor(r.iron || 0), gold: Math.floor(r.gold || 0) }; }

// b: { isAttack, won, round, heroExp, attacker: { king, hero, pos, units }, defender: { king, hero, pos, units },
//      loot, back: { hero, units: [{typeId, preCount, remain}], loot } }
function battleXml(b){
  const side = (name, s) => s ? el(name, { king: s.king, castlePos: s.pos, ...heroAttrs(s.hero), heroExp: s.heroExp },
    (s.units || []).filter(u => u.count > 0).map(u => el('troopUnit', { typeId: u.typeId, count: u.count, lose: u.lose }))) : '';
  const kids = [side('attackTroop', b.attacker), side('defendTroop', b.defender)];
  if (b.loot) kids.push(el('lootResource', res(b.loot)));
  if (b.back) kids.push(el('backTroop', { isBack: true }, [el('troops', { ...heroAttrs(b.back.hero), isBack: true, isHeroBeSeized: !!b.back.seized },
    [...b.back.units.map(u => el('troopInfo', { typeId: u.typeId, preCount: u.preCount, remain: u.remain, injured: 0 })), ...(b.back.loot ? [el('resource', res(b.back.loot))] : [])])]));
  // An NPC or Historic City's loyalty (live: support="-4" complaint="4" seizeProblem="The Loyalty of this city
  // is 83." isSeize="false"; isSeize="true" when the attack conquered it).
  const q = b.conquest, cq = q ? { support: -q.drop, complaint: q.drop, isSeize: !!q.city, seizeProblem: q.city ? undefined : q.problem || `The Loyalty of this city is ${q.loyalty}.` } : {};
  // Wounded (live: injuredPer="10", and an autoHeal part when Auto Heal cured them).
  if (b.autoHeal) kids.push(el('autoHeal', { des: b.autoHeal.des, gold: b.autoHeal.gold }, b.autoHeal.units.map(u => el('troopUnit', { typeId: u.typeId, count: u.count }))));
  // Colonies (BattleReportDetail): isColonial with colonialStartTime/colonialEndTime on a won Colonize attack,
  // isSuppress on the Stabilization battle, isUprising on the uprising war.
  // Honor (live: honor="100237" on a battle between lords, from that lord's side; none against NPCs).
  return el('reportData', {}, [el('battleReport', { isAttack: !!b.isAttack, isAttackSuccess: !!b.won, round: b.round, heroExp: b.heroExp, injuredPer: b.injuredPer, prestige: b.prestige, honor: b.honor, ...cq, ...(b.colony || {}) }, kids)]);
}
// A scouting report (ScoutReportDetail). r: the outcome line, { isAttack, isFound, isSuccess } (ScoutResults picks one
// of six messages from these). s: what the scouts saw, or null for nothing ("Level of Informatics is too low to
// spy for any intelligence"). Each part of s is optional and the client only shows the parts that are there:
// { resource, gold, population, support, hero: {name, level, face}, troops: {typeId: n or word}, forts: {typeId: n or word},
//   buildings: [{type, levels}], techs: [{type, level}] }.
// battle: { unNomal, back: [{ typeId, remain }] } adds the battleInfo the live server sends when the Scouts met
// no Scouts ("No defending troops found.", and the Scouts that came back).
function scoutXml(s, r = {}, battle = null){
  const kids = [];
  if (battle) kids.push(el('battleInfo', { isAttack: r.isAttack !== false, unNomal: battle.unNomal },
    battle.back ? [el('backTroop', {}, [el('troops', {}, battle.back.map(t => el('troopInfo', { typeId: t.typeId, remain: t.remain })))])] : []));
  // Live, a report that sees nothing still has an (empty) scoutInfo; the client reads both as "too low".
  if (!s && r.isAttack !== false && r.isSuccess && battle) kids.push(el('scoutInfo', {}));
  if (s){
    const list = (name, item, o) => el(name, {}, Object.entries(o).filter(([, n]) => typeof n === 'string' || n >= 0).map(([t, n]) => el(item, { typeId: t, count: n })));
    const parts = [];
    // Live, the resource element holds the four resources; gold is scoutInfo's own attribute.
    if (s.resource){ const { gold, ...four } = res(s.resource); parts.push(el('resource', four)); }
    if (s.troops) parts.push(list('troops', 'troopStrType', s.troops));
    if (s.buildings) parts.push(el('buildings', {}, s.buildings.map(b => el('buildingType', { type: b.type, levels: b.levels }))));
    if (s.forts) parts.push(list('fortifications', 'fortificationsType', s.forts));
    if (s.techs) parts.push(el('techs', {}, s.techs.map(t => el('techType', { type: t.type, level: t.level }))));
    // An NPC city's hero has no portrait: live, heroUrl="".
    const hero = s.hero ? { ...heroAttrs(s.hero), heroUrl: portraitUrl(s.hero.face) ?? '' } : {};
    kids.push(el('scoutInfo', { gold: s.gold != null ? Math.floor(s.gold) : undefined, population: s.population, support: s.support, ...hero }, parts));
  }
  return el('reportData', {}, [el('scoutReport', r, kids)]);
}

class Reports {
  constructor(game){ this.game = game; }
  list(p){ return p.reports || (p.reports = []); }
  unread(p){
    const c = { count: 0, army_count: 0, scout_cout: 0, trade_count: 0, other_count: 0 };
    for (const r of this.list(p)) if (!r.isRead){
      c.count++;
      if (r.type === TYPE.ARMY) c.army_count++; else if (r.type === TYPE.SCOUT) c.scout_cout++; else if (r.type === TYPE.TRADE) c.trade_count++; else c.other_count++;
    }
    return c;
  }
  add(p, r){
    const g = this.game, now = g.now();
    p.reportSeq = (p.reportSeq || 0) + 1;
    const rep = { id: p.reportSeq, type: r.type, armyType: r.armyType || 0, attack: r.attack !== false, back: !!r.back, title: r.title,
      startPos: r.startPos || '', targetPos: r.targetPos || '', eventTime: stamp(now), at: now, isRead: 0, content: r.content || '' };
    const list = this.list(p); list.unshift(rep);
    if (list.length > MAX_REPORTS) list.length = MAX_REPORTS;
    g.store.touch();
    g.push(p.id, 'server.NewReport', this.unread(p));
    return rep;
  }
  bean(r){ return { id: r.id, type: r.type, armyType: r.armyType, attack: r.attack, back: r.back, title: r.title, startPos: r.startPos, targetPos: r.targetPos,
    eventTime: r.eventTime, isRead: r.isRead, content: r.content, selected: false }; }
}

module.exports = { Reports, REPORT_TYPE: TYPE, battleXml, scoutXml, stamp };
