'use strict';
// Stratagems: the 22 "player.trick" items, used from a city's window (the Stratagem button) or an army's
// (ArmyInfoWin), with shop.useTrickItem. The client offers:
//   - on your own city: Regard Bushes and Trees as Soldiers, Empty City, Cast A Brick to Attract A Gem, Solid Walls
//     and Empty Fields (scouts see troops or resources 5-10 times or 10-20% of what's there, 24 hours, longer with
//     more), Advance by A Hidden Path (lifts Ambush from All Sides);
//   - on another lord's city, at any time (Fox): Inundate with Rumors, Alienating and Instigating, Ambush from All
//     Sides, Wage War without Declaration, Loot a Burning House, Sow Spies in Enemy's Camp, Besiege Enemy's Fort
//     to Rescue Ally's City, Burn the Warehouses, Beauty Trap, Ears and Eyes in Enemy's City;
//   - on your own army: Cicada Sheds Its Skin, Thunder Raid, Bluffing, Cover up Army Maneuvers;
//   - on an army coming at you: Entrapping, Bolt the Door to Catch the Thief, Entice Enemy into Compromising Position.
// The effects, limits and cooldowns are the item texts. Fox: stratagems never fail, and the lord they are used on
// gets a report in Others ("Player StarKiller has applied Wage War without Declaration to you. You are at war with
// him now. Wartime ends at ... You can apply Truce Agreement to counteract this stratagem.").
// A stratagem you don't hold is bought for its price in cents, as the client's list (Price, Use) suggests.
const { REPORT_TYPE, scoutXml } = require('./reports');
const world = require('./world');
const pad = n => String(n).padStart(2, '0');
// Report times as live writes them ("Wartime ends at 2026-10-24 16:26:49").
const full = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const HOUR = 3600000, DAY = 24 * HOUR;
const OWN_CITY = new Set(['cmjb', 'kcj', 'pzyy', 'jbqy', 'adcc']);
const OTHER_CITY = new Set(['yyhz', 'tblj', 'smmf', 'bxez', 'chdj', 'zsmj', 'wwjz', 'fslc', 'mrj', 'lywh']);
const OWN_ARMY = new Set(['jctq', 'qlbx', 'xzxs', 'yqxg']);
const OTHER_ARMY = new Set(['bmjs', 'gmdg', 'ydsr']);
const rnd = (a, b, r = Math.random) => a + r() * (b - a);

class Stratagems {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.stratagems || {}; }
  enabled(){ return this.rules.enabled !== false; }
  tricks(c){ return c.tricks || (c.tricks = {}); }
  // ---------- effects other code asks about ----------
  live(c, k, now){ const t = c?.tricks?.[k]; return t && t.until > now ? t : null; }
  // What a scout (or Ears and Eyes) sees of a city's troops and resources.
  shownTroops(c, now = this.g.now()){
    const t = this.live(c, 'cmjb', now) || this.live(c, 'kcj', now); if (!t) return c.troops;
    return Object.fromEntries(Object.entries(c.troops || {}).map(([k, n]) => [k, Math.round(n * t.factor)]));
  }
  shownRes(c, now = this.g.now()){
    const t = this.live(c, 'pzyy', now) || this.live(c, 'jbqy', now); if (!t) return c.res;
    return Object.fromEntries(Object.entries(c.res || {}).map(([k, n]) => [k, Math.floor(n * t.factor)]));
  }
  armyShown(a, now = this.g.now()){ return (a.shown?.until || 0) > now ? a.shown.factor : 1; }
  ambushed(c, now = this.g.now()){ return !!this.live(c, 'smmf', now); }
  warehouseShare(c, now = this.g.now()){ return this.live(c, 'chdj', now) ? 0.5 : 1; }
  // Cooldowns: a stratagem that "cannot be applied again" to the same city (or hero) for a while.
  cooling(o, k, now){ return (o.trickCd?.[k] || 0) > now ? o.trickCd[k] : 0; }
  cool(o, k, until){ o.trickCd = o.trickCd || {}; o.trickCd[k] = until; }

  // ---------- using one ----------
  // castleId: despite its name, a map field: the city's, from the field window (FieldInfoWin sends its MapCastleBean's
  // id, the tile), or from the army window the army's starting field (ignored); armyId: 0 or the army.
  use(p, castleId, armyId, itemId, now = this.g.now()){
    if (!this.enabled()) return [-40, 'Stratagems are turned off on this server.'];
    const g = this.g, id = String(itemId || ''), key = id.replace(/^player\.trick\./, ''), it = g.data.items[id];
    if (!it || !/^player\.trick\./.test(id)) return [-44, 'That is not a stratagem.'];
    let r;
    if (Number(armyId) > 0){
      const a = g.armies.list()[Number(armyId)];
      if (!a) return [-23, 'That army has already returned.'];
      if (a.playerId === p.id){ if (!OWN_ARMY.has(key)) return [-40, `${it.name} is not used on your own army.`]; r = this.ownArmy(p, a, key, it, now); }
      else {
        if (!OTHER_ARMY.has(key)) return [-40, `${it.name} is not used on another lord's army.`];
        if (!this.comingAtMe(p, a)) return [-40, `${it.name} is used on an army marching to one of your cities or valleys.`];
        r = this.otherArmy(p, a, key, it, now);
      }
    } else {
      const t = world.tileAt(g.store, Number(castleId)), c = t.type === world.T.CASTLE ? g.db.castles[t.castleId] : null;
      if (!c) return t.type === world.T.NPC ? [-41, 'Stratagems are used on lords\' cities.'] : [-51, 'There is no city there.'];
      const q = g.db.players[c.playerId];
      if (!q) return [-41, 'Stratagems are used on lords\' cities.'];
      if (q.id === p.id){ if (!OWN_CITY.has(key)) return [-40, `${it.name} is used on another lord's city.`]; r = this.ownCity(p, c, key, it, now); }
      else { if (!OTHER_CITY.has(key)) return [-40, `${it.name} is used on your own city.`]; r = this.otherCity(p, c, q, key, it, now); }
    }
    if (Array.isArray(r)) return r;
    // Pay: the item, or its price in cents.
    let bought = 0;
    if (!g.items.take(p, id)){
      const price = it.price || 0;
      if (!(price > 0) || (p.coins || 0) < price){ r.undo?.(); return [-28, `You need ${it.name} (${price} cents); you have ${p.coins || 0} cents.`]; }
      p.coins -= price; bought = price;
    }
    r.apply?.();
    g.quests.flag(p, r.own ? 'stratagemOwn' : 'stratagemOther');
    g.store.touch();
    g.log.info(`${p.name} used ${it.name}${r.on ? ` on ${r.on}` : ''}`);
    return { bought, item: id };
  }
  report(q, title, content){ this.g.reports.add(q, { type: REPORT_TYPE.OTHER, attack: false, title, content }); }
  victim(q, p, it, more){ this.report(q, `Victim of ${it.name}`, `Player ${p.name} has applied ${it.name} to you.${more ? ' ' + more : ''}`); }

  // ---------- your own city ----------
  ownCity(p, c, key, it, now){
    const t = this.tricks(c);
    if (key === 'adcc'){
      if (!this.live(c, 'smmf', now)) return [-40, 'Your city is not under Ambush from All Sides.'];
      return { own: true, on: c.name, apply: () => { delete t.smmf; } };
    }
    // Bigger (5-10x) or smaller (10-20%) to scouts, for 24 hours; another application adds 24 hours. A city shows
    // one kind at a time, so one cancels its opposite.
    const big = key === 'cmjb' || key === 'pzyy', opposite = { cmjb: 'kcj', kcj: 'cmjb', pzyy: 'jbqy', jbqy: 'pzyy' }[key];
    return { own: true, on: c.name, apply: () => {
      const cur = this.live(c, key, now);
      t[key] = { until: (cur ? cur.until : now) + (this.rules.disguiseHours ?? 24) * HOUR, factor: cur ? cur.factor : big ? rnd(5, 10) : rnd(0.1, 0.2) };
      delete t[opposite];
    } };
  }

  // ---------- another lord's city ----------
  otherCity(p, c, q, key, it, now){
    const g = this.g, t = this.tricks(c);
    const cd = (k, hours) => { const until = this.cooling(c, k, now); return until ? [-40, `${it.name} can't be used on ${c.name} again until ${full(until)}.`] : null; };
    const heroes = () => g.heroes.list(c).filter(h => h.status !== 4 /* captive */);
    switch (key){
      case 'yyhz': {   // Inundate with Rumors: +15 grievance, once a day a city
        const bad = cd(key); if (bad) return bad;
        return { on: c.name, apply: () => {
          g.logic.settle(c, q, now); c.complaint = (c.complaint || 0) + (this.rules.rumors ?? 15); this.cool(c, key, now + DAY);
          this.victim(q, p, it, `The public grievance in ${c.name} rose by ${this.rules.rumors ?? 15}.`); g.pushResources(c);
        } };
      }
      case 'tblj': {   // Alienating and Instigating: one hero loses 10-50 loyalty, once a day a hero
        const h = heroes().filter(x => !this.cooling(x, key, now)).sort(() => Math.random() - 0.5)[0];
        if (!h) return [-40, `None of ${c.name}'s heroes can be alienated again today.`];
        return { on: c.name, apply: () => {
          const drop = Math.round(rnd(10, 50)), start = g.rules.heroStartLoyalty ?? 70;
          h.loyalty = Math.max(0, (h.loyalty ?? start) - drop); this.cool(h, key, now + DAY);
          this.victim(q, p, it, `${h.name}'s loyalty fell by ${drop} to ${h.loyalty}.`); g.pushHero(c, h, 2);
        } };
      }
      case 'smmf': {   // Ambush from All Sides: troops can't be deployed for 2 hours; not again within 6 hours
        const bad = cd(key); if (bad) return bad;
        return { on: c.name, apply: () => {
          t.smmf = { until: now + 2 * HOUR }; this.cool(c, key, now + 6 * HOUR);
          this.victim(q, p, it, `The troops in ${c.name} cannot be deployed until ${full(now + 2 * HOUR)}. You can apply Advance by A Hidden Path to counteract this stratagem.`);
        } };
      }
      case 'bxez': return this.wageWar(p, q, it, now);
      case 'chdj': {   // Loot a Burning House: half Warehouse protection for 30 minutes; once a day a city
        const bad = cd(key); if (bad) return bad;
        return { on: c.name, apply: () => {
          t.chdj = { until: now + 30 * 60000 }; this.cool(c, key, now + DAY);
          this.victim(q, p, it, `The Warehouses of ${c.name} protect only half as much until ${full(now + 30 * 60000)}.`);
        } };
      }
      case 'zsmj':     // Sow Spies in Enemy's Camp: a report of the armies marching to or from the city
        return { on: c.name, apply: () => this.spies(p, c, now) };
      case 'wwjz': {   // Besiege Enemy's Fort to Rescue Ally's City: the city's armies are called back
        const out = g.armies.fromCastle(c).filter(a => a.direction !== 2);
        if (!out.length) return [-40, `None of ${c.name}'s armies are out.`];
        return { on: c.name, apply: () => {
          for (const a of out) g.armies.recall(q, a.id, now, true);
          g.pushArmies(q); for (const a of out){ const foe = g.targetLord(a); if (foe) g.pushEnemies(foe); }
          this.victim(q, p, it, `${out.length} of ${c.name}'s armies ${out.length === 1 ? 'was' : 'were'} recalled.`);
        } };
      }
      case 'fslc': {   // Burn the Warehouses: 10-50% of the food; not again within 6 hours
        const bad = cd(key); if (bad) return bad;
        return { on: c.name, apply: () => {
          g.logic.settle(c, q, now);
          const burnt = Math.floor((c.res.food || 0) * rnd(0.1, 0.5)); c.res.food -= burnt; this.cool(c, key, now + 6 * HOUR);
          this.victim(q, p, it, `${burnt.toLocaleString('en-US')} food burnt in ${c.name}.`); g.pushResources(c);
          this.report(p, `${it.name} on ${c.name}`, `You burnt ${burnt.toLocaleString('en-US')} food in ${c.name}.`);
        } };
      }
      case 'mrj': {    // Beauty Trap: one hero's attack 30-80% lower; once in 24 hours a hero
        const h = heroes().filter(x => !this.cooling(x, key, now)).sort(() => Math.random() - 0.5)[0];
        if (!h) return [-40, `None of ${c.name}'s heroes can be trapped again today.`];
        return { on: c.name, apply: () => {
          const pct = rnd(0.3, 0.8); h.beautyTrap = { until: now + (this.rules.beautyTrapHours ?? 24) * HOUR, pct }; this.cool(h, key, now + DAY);
          this.victim(q, p, it, `${h.name}'s attack is ${Math.round(pct * 100)}% lower until ${full(h.beautyTrap.until)}.`); g.pushHero(c, h, 2);
        } };
      }
      case 'lywh':     // Ears and Eyes in Enemy's City: a full scout report, no scouts needed
        return { on: c.name, apply: () => this.eyes(p, c, q, now) };
    }
    return [-40, `${it.name} can't be used here.`];
  }
  // Wage War without Declaration (Fox): for the next 15 minutes a war declared on that lord starts at once,
  // skipping the 30 minutes of preparation; the war then lasts its usual 48 hours. The user loses 10% of his
  // honor, and can't apply it again within 6 hours. (war.js asks instant() when war is declared.)
  wageWar(p, q, it, now){
    const g = this.g, W = g.war;
    if (this.cooling(p, 'bxez', now)) return [-40, `You can't apply ${it.name} again until ${full(p.trickCd.bxez)}.`];
    const bad = W.cantDeclare(p, q, now); if (bad) return bad;
    const end = now + (this.rules.wageWarMinutes ?? 15) * 60000;
    return { on: q.name, apply: () => {
      p.instantWar = { ...(p.instantWar || {}), [q.id]: end };
      p.honor = Math.floor((p.honor || 0) * 0.9); this.cool(p, 'bxez', now + 6 * HOUR);
      // The live report's own words.
      this.report(q, `Victim of ${it.name}`, `Player ${p.name} has applied ${it.name} to you. You are at war with him now.Wartime ends at ${full(end)}.You can apply Truce Agreement to counteract this stratagem.`);
      this.report(p, `${it.name} on ${q.name}`, `Until ${full(end)} a war you declare on ${q.name} begins at once, without the 30 minutes of preparation. It lasts the usual 48 hours.`);
      g.store.touch();
    } };
  }
  // Whether p's war on q starts at once (Wage War without Declaration's window).
  instant(p, q, now = this.g.now()){ return (p?.instantWar?.[q?.id] || 0) > now; }
  spies(p, c, now){
    const g = this.g, A = g.armies, list = Object.values(A.list()).filter(a => a.castleId === c.id || a.target === c.fieldId);
    const line = a => {
      const who = g.db.players[a.playerId]?.name || '?', dir = a.castleId === c.id ? `from ${c.name} to ${A.placeName(a.target)}` : `from ${A.placeName(a.from)} to ${c.name}`;
      const troops = Object.entries(a.troops).filter(([, n]) => n > 0).map(([k, n]) => `${n.toLocaleString('en-US')} ${g.data.troops[A.typeOf(k)]?.name || k}`).join(', ') || 'no troops';
      return `${who}'s army ${dir}${a.direction === 2 ? ' (returning)' : ''}: ${troops}.`;
    };
    this.report(p, `Spies in ${c.name}`, list.length ? list.map(line).join(' ') : `No troops are marching to or from ${c.name}.`);
  }
  eyes(p, c, q, now){
    const g = this.g, A = g.armies;
    const view = A.scoutView(99, A.cityPlace(c, q, now), true, { ...(g.rules.scouting?.reveal || {}) });
    g.reports.add(p, { type: REPORT_TYPE.SCOUT, startPos: c.name, targetPos: A.placeName(c.fieldId), title: 'Scout Reports', content: scoutXml(view, { isAttack: true, isFound: false, isSuccess: true }, null) });
    this.victim(q, p, g.data.items['player.trick.lywh'], `Detailed information about ${c.name} has leaked out.`);
  }

  // ---------- armies ----------
  // An army marching to one of p's cities or valleys.
  comingAtMe(p, a){
    if (a.direction === 2) return false;
    const t = this.g.db.tiles[a.target] || {};
    const owner = t.castleId ? this.g.db.castles[t.castleId] : t.ownerCastle ? this.g.db.castles[t.ownerCastle] : null;
    return !!owner && owner.playerId === p.id;
  }
  retime(a, factor, now){ const left = Math.max(0, a.reachTime - now); a.reachTime = now + Math.max(1000, Math.round(left * factor)); }
  ownArmy(p, a, key, it, now){
    const g = this.g;
    const push = () => { g.pushArmies(p); const foe = g.targetLord(a); if (foe) g.pushEnemies(foe); };
    switch (key){
      case 'jctq':     // Cicada Sheds Its Skin: home 30% faster; lifts Bolt the Door
        return { own: true, apply: () => { const sp = 1 + (this.rules.cicadaSpeed ?? 0.3); if (a.direction === 2) this.retime(a, 1 / sp, now); else a.fastHome = true; delete a.bolted; push(); } };
      case 'qlbx':     // Thunder Raid: 30% less march time
        if (a.direction !== 1) return [-40, `${it.name} is used on an army on its way to its target.`];
        return { own: true, apply: () => { this.retime(a, 0.7, now); push(); } };
      case 'xzxs': case 'yqxg': {   // Bluffing / Cover up Army Maneuvers: shown 5-10x or 10-20%, 12 hours (longer with more)
        const big = key === 'xzxs';
        return { own: true, apply: () => {
          const cur = (a.shown?.until || 0) > now && a.shown.big === big ? a.shown : null;
          a.shown = { big, until: (cur ? cur.until : now) + 12 * HOUR, factor: cur ? cur.factor : big ? rnd(5, 10) : rnd(0.1, 0.2) };
          push();
        } };
      }
    }
    return [-40, `${it.name} can't be used here.`];
  }
  otherArmy(p, a, key, it, now){
    const g = this.g, q = g.db.players[a.playerId];
    const push = () => { g.pushEnemies(p); if (q) g.pushArmies(q); };
    const tell = more => q && this.victim(q, p, it, more);
    switch (key){
      case 'bmjs': return { apply: () => { this.retime(a, 1.3, now); push(); tell('Your army will take 30% longer to arrive.'); } };   // Entrapping
      case 'gmdg': return { apply: () => { a.bolted = true; push(); tell('Your troops cannot be recalled until they finish the attack. You can apply Cicada Sheds Its Skin to counteract this stratagem.'); } };
      case 'ydsr': return { apply: () => { this.retime(a, 1 / 1.5, now); push(); tell('Your army marches 50% faster and will arrive earlier than planned.'); } };   // Entice Enemy
    }
    return [-40, `${it.name} can't be used here.`];
  }
}

module.exports = { Stratagems };
