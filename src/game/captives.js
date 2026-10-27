'use strict';
// Lords' heroes taken by other lords (Fox, live): an attacking hero whose loyalty is 0 is captured by the city
// that beats it; when a city is conquered, every hero still in it becomes the new lord's prisoner; Sow Discord
// may capture one. A captured hero waits in the captor's Feasting Hall (Persuade or Release, as with NPC
// heroes); a released one goes home to its lord. Its lord counts it lost: for 24 hours a Stone of Finding
// ("choose a single hero to return to you if they have been lost within the last 24 hours") brings it back,
// wherever it is, unless it is out leading an army.
const { HERO_STATUS } = require('./heroes');
const { REPORT_TYPE } = require('./reports');
const DAY = 86400000, STONE = 'player.item.stoneoffinding';
const pad = n => String(n).padStart(2, '0');
const dateTime = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

class Captives {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  start(){ return this.g.rules.heroStartLoyalty ?? 70; }
  // Where a hero is now: { c, h }, or null.
  locate(id){
    for (const c of Object.values(this.db.castles)){ const h = (c.heroes || []).find(x => x.id === Number(id)); if (h) return { c, h }; }
    return null;
  }
  // Hero h of lord `owner` is taken from city `from` into city `to` (the same city when it is the city that
  // changed hands).
  capture(h, from, to, owner, now = this.g.now()){
    const g = this.g;
    if (from !== to){ from.heroes = g.heroes.list(from).filter(x => x !== h); g.heroes.list(to).push(h); }
    g.equipment.takeOffAll(h);
    Object.assign(h, { status: HERO_STATUS.SEIZED, loyaltyBefore: h.loyalty ?? this.start(), loyaltyAfter: this.start(), loyalty: 0, seizedAt: now,
      capturedFrom: { playerId: owner.id, castleId: from.id, at: now } });
    owner.lostHeroes = [...(owner.lostHeroes || []).filter(e => now - e.at < DAY && e.id !== h.id), { id: h.id, at: now, by: to.playerId }];
    if (from !== to){ g.pushHero(from, h, 1); g.pushHero(to, h, 0); }
    g.store.touch();
    return h;
  }
  // The client's lost-hero list (Stone of Finding): heroes lost in the last 24 hours that are still somewhere.
  lost(p, now = this.g.now()){
    const out = [];
    for (const e of p.lostHeroes || []){
      if (now - e.at >= DAY) continue;
      const at = this.locate(e.id); if (!at || at.c.playerId === p.id && at.h.status !== HERO_STATUS.SEIZED) continue;
      const h = at.h, t = k => this.g.heroes.total(h, k);
      out.push({ id: String(h.id), name: h.name, level: h.level, management: t('pol'), power: t('atk'), stratagem: t('int'), disppeartime: dateTime(e.at) });
    }
    return out;
  }
  // Stone of Finding: hero `id`, lost by lord p in the last 24 hours, comes back to his city c.
  recover(p, c, id, now = this.g.now()){
    const g = this.g, e = (p.lostHeroes || []).find(x => x.id === Number(id) && now - x.at < DAY);
    if (!e) return [-1, 'That hero was not lost in the last 24 hours. A Stone of Finding only brings back a hero captured by another lord.'];
    if (!g.items.has(p, STONE)) return [-44, 'Bringing a lost hero back takes a Stone of Finding.'];
    const at = this.locate(e.id);
    if (!at) return [-1, 'That hero is gone.'];
    const { h } = at, from = at.c;
    if (h.status === HERO_STATUS.SENT) return [-1, `${h.name} is out leading an army. Try again when the army is back.`];
    if (from !== c && !g.heroes.vacancies(c)) return [-1, `The Feasting Hall in ${c.name} has no free seat for ${h.name}.`];
    g.items.take(p, STONE);
    if (from !== c){ from.heroes = g.heroes.list(from).filter(x => x !== h); g.heroes.list(c).push(h); }
    Object.assign(h, { status: HERO_STATUS.FREE, loyalty: h.loyaltyBefore ?? this.start() });
    for (const k of ['seizedAt', 'loyaltyAfter', 'loyaltyBefore', 'capturedFrom']) delete h[k];
    p.lostHeroes = (p.lostHeroes || []).filter(x => x !== e);
    if (from !== c){
      g.pushHero(from, h, 1);
      const cp = this.db.players[from.playerId];
      if (cp && cp.id !== p.id) g.reports.add(cp, { type: REPORT_TYPE.OTHER, title: `${h.name} went back to ${p.name}`, content: `${p.name} used a Stone of Finding: ${h.name} left ${from.name} and went back to ${c.name}.` });
    }
    g.pushHero(c, h, from !== c ? 0 : 2);
    g.store.touch();
    g.log.info(`${p.name} used a Stone of Finding: ${h.name} came back to ${c.name}`);
    return { hero: h, items: [STONE] };
  }
  // A captor releases another lord's hero: it goes home to its city if that city is still its lord's and has a
  // seat (then it counts as found again); otherwise it is gone. Returns the city it went to, or null.
  releaseHome(h, now = this.g.now()){
    const g = this.g, f = h.capturedFrom, home = f && this.db.castles[f.castleId], owner = f && this.db.players[f.playerId];
    if (!home || !owner || home.playerId !== owner.id || !g.heroes.vacancies(home)) return null;
    Object.assign(h, { status: HERO_STATUS.FREE, loyalty: h.loyaltyBefore ?? this.start() });
    for (const k of ['seizedAt', 'loyaltyAfter', 'loyaltyBefore', 'capturedFrom']) delete h[k];
    g.heroes.list(home).push(h);
    owner.lostHeroes = (owner.lostHeroes || []).filter(x => x.id !== h.id);
    g.pushHero(home, h, 0);
    g.reports.add(owner, { type: REPORT_TYPE.OTHER, title: `${h.name} was released`, content: `${h.name} was released and has come back to ${home.name}.` });
    g.store.touch();
    return home;
  }
}

module.exports = { Captives, STONE_OF_FINDING: STONE };
