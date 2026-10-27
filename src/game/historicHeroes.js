'use strict';
// Historic heroes (Fox, Oct 2026). Each one waits in an NPC city somewhere on the map. At the Inn a lord hears
// rumours about them ("Hearsay"), can pay 100 gold for more rumours or 1,000 gold to search by name, and can pay
// 10 cents to "Enquire Details": the exact location, a report, and the hero's portrait, which is needed to
// recruit the hero. Every won attack on that NPC city lowers the city's loyalty; at 0 the attacker conquers it
// (Fox's live reports, Oct 23 2026), and with the quest accepted and the portrait in hand captures the hero, who
// waits in the Feasting Hall to be persuaded. Otherwise the hero gets away to another NPC city.
//
// Names, biographies and portraits come from the client (its hero.taskitem.N items; portrait
// images/icon/hero/N.png). Base stats (level 1) come from Fox's sheet, src/data/historic-heroes.csv; a
// data/historic-heroes.csv next to world.json replaces it. Heroes the sheet doesn't cover yet get estimated stats.
const fs = require('fs');
const path = require('path');
const world = require('./world');

const QUEST_BASE = 2000000;           // quest ids: QUEST_BASE + hero id; QUEST_BASE itself is the "Heros" quest type
// Live (Fox's screenshot, Oct 2026): every historic hero's quest pays this once the hero is captured.
const QUEST_AWARD = 'Aries Amulet*1, Beginner Guidelines*1, Population*30, Food*200, Lumber*1000, Stone*200, Iron*100';
const FEMALE = /^(Hildegard|Joan|Hypatia|Alix|Amy|Anna|Anne|Ann |Antonia|Arbella|Atia|Aurelia|Bess|Brunhilde|Catherine|Diane|Dhuoda|Edith|Eleanor|Elizabeth|Emma|Empress|Fredegund|Isabella|Jane|Jeanne|Kassia|Louise|Lucre|Margaret|Marguerite|Mary|Olga|Paulina|Petronilla|Philaenis|Queen|Theodora|Zorayda|Alfgifu|Elfthryth|Christina|Nancy|Punyaslok|Cuhtuhlatah|Sybil|Manuela|Deborah|Angelique|Wang Cong|Granuaile|Chand Bibi|Gao Guiying|Hannah|Charlotte|Rani)/;

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b){
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function parseCsv(text){
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (q){ if (ch === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ','){ row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r'){ if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row);
  return rows;
}
// A stable pseudo-random number in [0, 1) for estimated stats.
const hash = (id, salt) => { let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35); h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

// The roster: { id, name, bio, portrait, pol, int, atk, ldr, female, estimated }
function loadRoster(data, csvFiles){
  const roster = new Map();
  for (const it of Object.values(data.items)){
    const m = /^hero\.taskitem\.(\d+)$/.exec(it.id); if (!m) continue;
    const id = Number(m[1]), name = it.name.trim();
    roster.set(id, { id, name, bio: it.desc.trim(), portrait: `images/icon/hero/${id}.png`, female: FEMALE.test(name), estimated: true });
  }
  const file = csvFiles.find(f => fs.existsSync(f));
  const unmatched = [];
  if (file){
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const head = rows.shift().map(h => fold(h));
    const col = k => head.findIndex(h => h.startsWith(k));
    const iName = col('heroname') >= 0 ? col('heroname') : 0, iPol = col('politic'), iInt = col('intel'), iAtk = col('attack'), iLdr = col('leader'), iImg = col('image');
    const byFold = new Map([...roster.values()].map(h => [fold(h.name), h]));
    const taken = new Set();
    const num = v => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
    for (const r of rows){
      const name = (r[iName] || '').trim(); if (!name) continue;
      let h = null; const img = num(r[iImg]);
      if (img != null && roster.has(img) && !taken.has(img)) h = roster.get(img);
      if (!h){ const f = byFold.get(fold(name)); if (f && !taken.has(f.id)) h = f; }
      if (!h){
        let best = null, bd = 4; const fn = fold(name);
        for (const c of roster.values()){ if (taken.has(c.id)) continue; const d = lev(fn, fold(c.name)); if (d < bd){ bd = d; best = c; } }
        h = best;
      }
      if (!h){
        // A shortened name: "Diego Sarmiento de Acuna." for "Diego Sarmiento de Acuna. Conde de Gondomar".
        const fn = fold(name.replace(/\(.*\)/, ''));
        if (fn.length >= 8) h = [...roster.values()].find(c => !taken.has(c.id) && (fold(c.name).startsWith(fn) || fold(c.name.replace(/\(.*\)/, '')) === fn)) || null;
      }
      if (!h){ unmatched.push(name); continue; }
      taken.add(h.id); h.sheetName = name;
      const vals = { pol: num(r[iPol]), int: num(r[iInt]), atk: num(r[iAtk]), ldr: num(r[iLdr]) };
      for (const [k, v] of Object.entries(vals)) if (v != null) h[k] = v;
      h.estimated = Object.values(vals).some(v => v == null);
    }
  }
  // The client lists a few heroes twice (Ibn Khaldun, Meister Eckhart); the copy without a row gets the other's stats.
  for (const h of roster.values()){
    if (h.sheetName) continue;
    const twin = [...roster.values()].find(o => o !== h && o.sheetName && fold(o.name) === fold(h.name));
    if (twin){ for (const k of ['pol', 'int', 'atk', 'ldr']) if (twin[k] != null) h[k] = twin[k]; h.estimated = twin.estimated; h.sheetName = twin.sheetName; }
  }
  // Estimated stats for whatever the sheet doesn't give: 23-99 in each attribute, leadership 48-133, the
  // ranges the sheet shows.
  for (const h of roster.values()){
    h.pol ??= 23 + Math.floor(hash(h.id, 1) * 77);
    h.int ??= 23 + Math.floor(hash(h.id, 2) * 77);
    h.atk ??= 23 + Math.floor(hash(h.id, 3) * 77);
    h.ldr ??= 48 + Math.floor(hash(h.id, 4) * 86);
  }
  return { roster, file, unmatched };
}

class HistoricHeroLogic {
  constructor(game, dataDir){
    this.g = game;
    const { roster, file, unmatched } = loadRoster(game.data, [path.join(dataDir || '', 'historic-heroes.csv'), path.join(__dirname, '..', 'data', 'historic-heroes.csv')]);
    this.roster = roster;
    this.source = file;
    this.unmatched = unmatched;
    this.byField = new Map();
  }
  get rules(){ return this.g.rules.historicHeroes; }
  get db(){ return this.g.store.db; }
  state(id){ return this.db.hh[id]; }
  // Put every hero that isn't hired or waiting at an Inn into an NPC city. Run at startup.
  seed(){
    this.db.hh = this.db.hh || {};
    this.byField.clear();
    for (const [id, s] of Object.entries(this.db.hh)) if (s.status === 'free' && s.fieldId != null) this.byField.set(s.fieldId, Number(id));
    let placed = 0;
    for (const h of this.roster.values()){
      const s = this.db.hh[h.id];
      if (s && s.status !== 'free') continue;
      if (s && s.fieldId != null && this.isNpcCity(s.fieldId)) continue;
      this.place(h.id); placed++;
    }
    if (placed) this.g.store.touch?.();
    return placed;
  }
  isNpcCity(fieldId){
    const t = world.tileAt(this.g.store, fieldId);
    return t.type === world.T.NPC && !t.historic && !t.ownerCastle && (this.rules.npcLevels || []).includes(t.level);
  }
  place(id){
    const old = this.db.hh[id];
    if (old?.fieldId != null && this.byField.get(old.fieldId) === id) this.byField.delete(old.fieldId);
    for (let i = 0; i < 100000; i++){
      const fid = Math.floor(Math.random() * world.SIZE * world.SIZE);
      if (this.byField.has(fid) || !this.isNpcCity(fid)) continue;
      this.db.hh[id] = { status: 'free', fieldId: fid, alloc: this.randomAlloc() };
      this.byField.set(fid, id);
      return fid;
    }
    this.db.hh[id] = { status: 'free', fieldId: null };
    return null;
  }
  // A wild hero is level 30 (Fox), with 2 points a level counting the first spread at random (live). Holy Water resets
  // them so the owner can place them.
  randomAlloc(){
    const a = { pol: 0, atk: 0, int: 0 }, keys = Object.keys(a);
    // 2 a level, counting the first (live: 300 at level 150), so a level 30 hero comes with 60.
    for (let i = 0; i < (this.rules.level || 1) * (this.rules.pointsPerLevel ?? 2); i++) a[keys[Math.floor(Math.random() * 3)]]++;
    return a;
  }
  alloc(id){ const s = this.state(id); if (s.alloc) this.topUp(s.alloc); return s.alloc || (s.alloc = this.randomAlloc()); }
  // Before 0.3.61 a wild hero came with 1 point a level (30 at level 30); spread the rest at random. True if changed.
  topUp(a){
    const keys = ['pol', 'atk', 'int'], want = (this.rules.level || 1) * (this.rules.pointsPerLevel ?? 2);
    let have = keys.reduce((s, k) => s + (a[k] || 0), 0); if (have >= want) return false;
    for (; have < want; have++){ const k = keys[Math.floor(Math.random() * 3)]; a[k] = (a[k] || 0) + 1; }
    return true;
  }
  // The free hero in this NPC city, or null.
  at(fieldId, now = Date.now()){
    const id = this.byField.get(fieldId); if (id == null) return null;
    const h = this.roster.get(id), s = this.state(id);
    return h && s?.status === 'free' ? h : null;
  }

  // The hero as the NPC city's defending commander: level 30, with his base stats plus his randomly spread points.
  defender(fieldId, now){
    const h = this.at(fieldId, now); if (!h) return null;
    const a = this.alloc(h.id);
    return { name: h.name, level: this.rules.level, face: h.portrait, attack: h.atk + a.atk, intelligence: h.int + a.int, historic: h.id };
  }
  where(fieldId){
    const { x, y } = world.xy(fieldId), t = world.tileAt(this.g.store, fieldId);
    return { x, y, level: t.level, zone: this.g.rules.zones[world.zoneOf(fieldId)] };
  }
  titleCase(z){ return String(z || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
  // ---------- the Inn's "Hearsay" ----------
  simpleBean(h, p){
    const s = this.state(h.id), known = p.hhKnown?.[h.id];
    let where;
    if (s.status !== 'free' || s.fieldId == null) where = `Nobody knows where ${h.name} is right now.`;
    else {
      const w = this.where(s.fieldId);
      where = known ? `According to the innkeeper, ${h.name} is staying in the level ${w.level} NPC city at (${w.x},${w.y}) in ${this.titleCase(w.zone)}.`
        : `Rumour has it ${h.name} was last seen somewhere in ${this.titleCase(w.zone)}.`;
    }
    return { npcid: h.id, name: h.name, logourl: h.portrait, introduce: h.bio, introduce2: where };
  }
  free(){ return [...this.roster.values()].filter(h => this.state(h.id)?.status === 'free' && this.state(h.id).fieldId != null); }
  hearsay(p, now, fresh = false){
    const r = this.rules, keep = (p.hearsay?.ids || []).filter(id => this.state(id)?.status === 'free');
    if (fresh || !p.hearsay || now >= p.hearsay.until || keep.length < Math.min(r.hearsayCount, this.free().length)){
      const pool = this.free(), ids = [];
      while (ids.length < Math.min(r.hearsayCount, pool.length)){ const h = pool[Math.floor(Math.random() * pool.length)]; if (!ids.includes(h.id)) ids.push(h.id); }
      p.hearsay = { ids, until: now + r.hearsayRefreshMinutes * 60000 / this.g.logic.speed };
    }
    return p.hearsay.ids.map(id => this.simpleBean(this.roster.get(id), p));
  }
  search(p, text){
    const f = fold(text);
    return [...this.roster.values()].filter(h => fold(h.name).includes(f) && this.state(h.id)?.status === 'free').slice(0, 30).map(h => this.simpleBean(h, p));
  }
  // "Enquire Details": the exact location, the hero's portrait and a report.
  details(p, id){
    const h = this.roster.get(id), s = h && this.state(id);
    if (!h) return [-1, 'Nobody has heard of that hero.'];
    if (s.status !== 'free' || s.fieldId == null) return [-1, `${h.name} can't be found right now.`];
    p.hhKnown = p.hhKnown || {}; p.hhKnown[id] = true;
    const item = `hero.taskitem.${id}`;
    p.items[item] = Math.max(1, p.items[item] || 0);
    return { bean: this.simpleBean(h, p), item };
  }
  // ---------- quests (Quests > Hero Quests) ----------
  quests(p){ return p.hhQuests || (p.hhQuests = {}); }
  accept(p, c, id){
    const h = this.roster.get(id), s = h && this.state(id), q = this.quests(p);
    if (!h) return [-1, 'Nobody has heard of that hero.'];
    if (q[id]) return [-1, `You are already looking for ${h.name}. See Quests, Hero Quests.`];
    if (s.status !== 'free') return [-1, `${h.name} isn't waiting in an NPC city right now.`];
    if (Object.keys(q).length >= this.rules.maxQuests) return [-1, `You can hunt at most ${this.rules.maxQuests} historic heroes at a time. Abandon one in Quests, Hero Quests first.`];
    q[id] = { at: Date.now(), castleId: c.id, done: false };
    return { msg: `You accepted the quest to recruit ${h.name}. It's under Quests, Hero Quests.` };
  }
  questBean(p, id, now){
    const h = this.roster.get(id), q = this.quests(p)[id], s = this.state(id);
    const portrait = (p.items[`hero.taskitem.${id}`] || 0) > 0;
    // The city's loyalty: each attack won there lowers it, and at 0 the city (and the hero) is yours.
    const tile = s.status === 'free' && s.fieldId != null ? world.tileAt(this.g.store, s.fieldId, now) : null;
    const loyalty = tile ? Math.floor(this.g.npc.state(this.db, tile, now).loyalty ?? 0) : 0;
    const w = tile && p.hhKnown?.[id] ? this.where(s.fieldId) : null;
    const targets = [
      { name: `Get ${h.name}'s portrait (Inn, Hearsay, Enquire Details, 10 cents)`, finished: portrait },
      { name: w ? `Conquer the NPC city at (${w.x},${w.y}): win attacks until its loyalty falls to 0 (now ${loyalty})` : `Find ${h.name} and conquer the NPC city: win attacks until its loyalty falls to 0`, finished: q.done },
    ];
    // The live game's own wording: "Catch Hero quest  William Cecil quest", "Capture and persuade quest ...".
    return { questId: QUEST_BASE + id, name: h.name, description: `Catch Hero quest  ${h.name} quest`, manual: `Capture and persuade quest ${h.name} quest`,
      award: 'Aries Amulet 1, Beginner Guidelines 1, Population 30, Food 200, Lumber 1000, Stone 200, Iron 100.', isFinish: !!q.done, isCard: false, islast: false, recommend: false, version: 0, targets };
  }
  award(){ return this.awardDef || (this.awardDef = this.g.quests.parseReward(QUEST_AWARD)); }
  // Live, all of a lord's hero quests sit in one "Heros" group (Quests, Hero Quests).
  questTypes(p){
    const q = Object.values(this.quests(p));
    return q.length ? [{ typeId: QUEST_BASE, mainId: 4, name: 'Heros', description: 'Heros', isFinish: q.some(x => x.done), recommend: false, version: 0 }] : [];
  }
  questBeans(p, now){ return Object.keys(this.quests(p)).map(id => this.questBean(p, Number(id), now)); }
  questOf(p, questOrType){ const id = Number(questOrType) - QUEST_BASE; return this.quests(p)[id] ? id : null; }
  abandon(p, questId){
    const id = this.questOf(p, questId); if (id == null) return [-1, 'No such quest.'];
    delete this.quests(p)[id];
    return {};
  }
  // ---------- battles ----------
  // The NPC city this hero waits in was conquered by lord p (Fox, Oct 23 2026). With the hero's quest accepted
  // and the portrait in hand the hero is captured: seize(template) puts the hero in a Feasting Hall to be
  // persuaded, which takes the portrait. Otherwise (or with no empty seat) the hero moves to another NPC city.
  conquered(fieldId, p, seize){
    const id = this.byField.get(fieldId); if (id == null) return null;
    const s = this.state(id), h = this.roster.get(id);
    if (!s || s.status !== 'free') return null;
    const q = this.quests(p)[id], item = `hero.taskitem.${id}`, portrait = (p.items[item] || 0) > 0;
    if (q && portrait){
      const held = seize({ ...this.offer(h, this.alloc(id)), persuadeItem: item });
      if (held){
        this.byField.delete(fieldId);
        this.db.hh[id] = { status: 'seized', castleId: held.castle.id, heroId: held.hero.id };
        q.done = true;
        return { hero: h, captive: held.hero, castle: held.castle };
      }
      this.place(id);
      return { hero: h, full: true };
    }
    this.place(id);
    return { hero: h, moved: true, needQuest: !q, needPortrait: !portrait };
  }
  offer(h, alloc = this.randomAlloc()){
    const level = this.rules.level || 1;
    return { name: h.name, level, exp: 0, base: { pol: h.pol, atk: h.atk, int: h.int }, added: { ...alloc }, points: 0,
      loyalty: this.rules.hiredLoyalty, face: h.portrait, sex: h.female, historic: h.id, leadership: h.ldr, infro: h.bio };
  }
  // A hired (or waiting) historic hero's base stats follow the sheet, so a corrected sheet reaches heroes already
  // hired. His own spent points (added) are untouched. True if anything changed.
  sync(hero){
    const h = hero?.historic != null && this.roster.get(hero.historic); if (!h) return false;
    const base = { pol: h.pol, atk: h.atk, int: h.int };
    if (hero.base?.pol === base.pol && hero.base?.atk === base.atk && hero.base?.int === base.int && hero.leadership === h.ldr) return false;
    hero.base = base; hero.leadership = h.ldr;
    return true;
  }
  // A historic hero has 2 points for every level, counting his first 30 (live: 300 at level 150). One hired, captured
  // or persuaded before 0.3.61 came with 1 a level for those 30, so Holy Water gave back 30 (Fox); the missing points
  // are his to spend. True if anything changed.
  owed(hero){
    if (hero?.historic == null || hero.ringHero) return false;
    const want = (hero.level || 1) * (this.rules.pointsPerLevel ?? 2), a = hero.added || {};
    const have = (a.pol || 0) + (a.atk || 0) + (a.int || 0) + (hero.points || 0);
    if (have >= want) return false;
    hero.points = (hero.points || 0) + want - have;
    return true;
  }
  // Hiring the hero settles that hero's quest (it was the reward).
  hired(id, c, heroId, p = null){ this.db.hh[id] = { status: 'hired', castleId: c.id, heroId }; if (p) delete this.quests(p)[id]; }
  // A historic hero who leaves a lord goes back to an NPC city somewhere else.
  release(id){ this.place(id); }
}

module.exports = { HistoricHeroLogic, loadRoster, parseCsv, QUEST_BASE, QUEST_AWARD };
