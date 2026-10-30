'use strict';
// Angel and Devil items (UseGoodWin: shop.useAngelItem on a lord by name, shop.useDevilItem on a city by x and y).
// Their own descriptions:
//   Fleet Feet (money.70): "increase the marching speed of their troops by 35% for 4 hours, this item can be stacked
//     a total of 2 times";
//   Endurance of the Immortals (71): "increase their troops' hit points by 5% for 12 hours ... stacked 3 times";
//   Alchemist's Amplifier (72): "increase the stats of all their heroes by 10% for 2 hour ... stacked 3 times";
//   Opportunist's Plague (74): "instantly kill the total population of the targeted city, and reduce their
//     repopulation rate by 10% for 4 hours, this item can be used once every 24 hours per city";
//   Lost in the Wastes (75): "increase the march time of all troops by 20% for 4 hours ... stacked 3 times";
//   Poisoned Feast (76): "decrease the stats of all their heroes by 20% for 2 hours ... stacked 3 times";
//   Broken Gates (77): "Players can apply the item to another player to lock gates open for 1 hour, players can apply
//     item on themselves to unlock gates, this can be used on a city a maximum of 5 times per day"; the window asks
//     Open or Close (paramdata "1" or "0"). The gates are the Rally Spot's "Open gate to fight": closed, a city's
//     troops (and allies stationed there) stay inside and only its defenses fight (armies.gateOpen).
// Angel items go on another lord (all his cities and heroes); Devil items on another lord's city (Broken Gates also
// on your own), not on a lord under Beginner's Protection, a Truce or on vacation. The hero effects reach the heroes
// there when the item is used.
const world = require('./world');
const { REPORT_TYPE } = require('./reports');
const HOUR = 3600000, DAY = 24 * HOUR;
const ANGEL = {
  'player.box.present.money.70': { key: 'fleet', hours: 4, max: 2, label: 'Fleet Feet', what: 'their troops march 35% faster' },
  'player.box.present.money.71': { key: 'endurance', hours: 12, max: 3, label: 'Endurance of the Immortals', what: 'their troops have 5% more hit points' },
  'player.box.present.money.72': { key: 'amplifier', hours: 2, max: 3, label: "Alchemist's Amplifier", what: 'all their heroes are 10% stronger' },
};
const DEVIL = {
  'player.box.present.money.74': { key: 'plague', hours: 4, label: "Opportunist's Plague" },
  'player.box.present.money.75': { key: 'wastes', hours: 4, max: 3, label: 'Lost in the Wastes' },
  'player.box.present.money.76': { key: 'poison', hours: 2, max: 3, label: 'Poisoned Feast' },
  'player.box.present.money.77': { key: 'gates', hours: 1, perDay: 5, label: 'Broken Gates' },
};
const live = (list, now) => (list || []).filter(t => t > now);

class Charms {
  constructor(game){ this.g = game; }
  isAngel(id){ return !!ANGEL[id]; }
  isDevil(id){ return !!DEVIL[id]; }
  ms(hours){ return hours * HOUR / this.g.logic.speed; }
  // Active stacks of an effect on a lord (p.charms) or a hero/city (o.charms).
  stacks(o, key, now = this.g.now()){ return live(o?.charms?.[key], now).length; }
  add(o, key, until){ o.charms = o.charms || {}; o.charms[key] = [...live(o.charms[key], this.g.now()), until]; }
  // ---------- what other code asks ----------
  marchFactor(p, c, now = this.g.now()){ return (1 + 0.2 * this.stacks(c, 'wastes', now)) / (1 + 0.35 * this.stacks(p, 'fleet', now)); }
  lifeBonus(p, now = this.g.now()){ return 5 * this.stacks(p, 'endurance', now); }
  heroFactor(h, now = this.g.now()){ return Math.max(0, 1 + 0.1 * this.stacks(h, 'amplifier', now) - 0.2 * this.stacks(h, 'poison', now)); }
  plagued(c, now = this.g.now()){ return (c?.charms?.plagueUntil || 0) > now; }

  protectedWhy(q, now){
    const w = this.g.war;
    if (w.beginner(q, now)) return `${q.name} is under Beginner's Protection.`;
    if (w.truce(q, now)) return `${q.name} is under a Truce Agreement.`;
    if (w.vacation(q, now)) return `${q.name} is on vacation.`;
    return null;
  }
  report(q, title, content){ this.g.reports.add(q, { type: REPORT_TYPE.OTHER, title, content }); }

  useAngel(p, itemId, name, now = this.g.now()){
    const g = this.g, a = ANGEL[itemId]; if (!a) return [-40, "That item isn't an angel item."];
    if (!g.items.ensure(p, itemId)) return [-44, `You don't have ${a.label}.`];
    const q = g.chat.byName(name);
    if (!q) return [-3, `There is no lord called ${String(name || '').trim()}.`];
    if (q.id === p.id) return [-1, `${a.label} is used on another lord.`];
    if (this.stacks(q, a.key, now) >= a.max) return [-1, `${q.name} already has ${a.label} ${a.max} times over.`];
    const until = now + this.ms(a.hours);
    this.add(q, a.key, until);
    if (a.key === 'amplifier') for (const c of g.castlesOf(q)) for (const h of g.heroes.list(c)) this.add(h, a.key, until);
    g.items.take(p, itemId);
    this.report(q, `${p.name} used ${a.label} on you`, `${p.name} used ${a.label} on you: ${a.what} for ${a.hours} hour${a.hours > 1 ? 's' : ''}.`);
    if (a.key === 'amplifier') for (const c of g.castlesOf(q)) for (const h of g.heroes.list(c)) g.pushHero(c, h, 2);
    g.store.touch();
    g.log.info(`${p.name} used ${a.label} on ${q.name}`);
    return { items: [itemId], target: q };
  }

  // param: Broken Gates' "1" (open) or "0" (closed); the window asks.
  useDevil(p, itemId, x, y, param, now = this.g.now()){
    const g = this.g, d = DEVIL[itemId]; if (!d) return [-40, "That item isn't a devil item."];
    if (!g.items.ensure(p, itemId)) return [-44, `You don't have ${d.label}.`];
    const fx = Math.floor(Number(x)), fy = Math.floor(Number(y));
    const tile = fx >= 0 && fy >= 0 && fx < world.SIZE && fy < world.SIZE ? world.tileAt(g.store, world.idOf(fx, fy), now) : null;
    const c = tile && tile.type === world.T.CASTLE ? g.db.castles[tile.castleId] : null, q = c && g.db.players[c.playerId];
    if (!c || !q) return [-1, `There is no lord's city at (${fx},${fy}).`];
    const own = q.id === p.id;
    if (own && d.key !== 'gates') return [-1, `${d.label} is used on another lord's city.`];
    if (!own){ const why = this.protectedWhy(q, now); if (why) return [-1, why]; }
    const until = now + this.ms(d.hours), here = `${c.name} (${fx},${fy})`;
    c.charms = c.charms || {};
    let note;
    if (d.key === 'plague'){
      if ((c.charms.plagueReady || 0) > now) return [-1, `${d.label} was used on ${c.name} in the last 24 hours.`];
      g.logic.settle(c, q, now);
      const dead = Math.floor(c.pop || 0);
      c.pop = 0; c.charms.plagueUntil = until; c.charms.plagueReady = now + this.ms(24);
      note = `${dead.toLocaleString('en-US')} people died, and the city repopulates 10% slower for 4 hours.`;
      g.pushResources(c);
    } else if (d.key === 'wastes' || d.key === 'poison'){
      if (this.stacks(c, d.key, now) >= d.max) return [-1, `${c.name} already has ${d.label} ${d.max} times over.`];
      this.add(c, d.key, until);
      if (d.key === 'poison') for (const h of g.heroes.list(c)) { this.add(h, 'poison', until); g.pushHero(c, h, 2); }
      note = d.key === 'wastes' ? 'Its troops march 20% slower for 4 hours.' : "All of its heroes' stats are 20% lower for 2 hours.";
    } else {
      const day = g.npc.day(now), uses = c.charms.gateDay === day ? c.charms.gateUses || 0 : 0;
      if (uses >= d.perDay) return [-1, `${d.label} has been used on ${c.name} ${d.perDay} times today.`];
      const open = !own || String(param) !== '0';
      if (own && String(param) === '0') delete c.charms.gateLock;   // (your own city: unjam the gates)
      else c.charms.gateLock = { open, until };
      c.charms.gateDay = day; c.charms.gateUses = uses + 1;
      note = own ? (open ? 'Your gates are held open for 1 hour.' : 'Your gates work again.') : 'Its gates are locked open for 1 hour: its troops must come out to fight.';
      g.pushCastle(c, 2);
    }
    g.items.take(p, itemId);
    if (!own) this.report(q, `${p.name} used ${d.label} on ${c.name}`, `${p.name} used ${d.label} on ${here}. ${note}`);
    g.store.touch();
    g.log.info(`${p.name} used ${d.label} on ${here}`);
    return { items: [itemId], target: q, castle: c, note };
  }
}

module.exports = { Charms, ANGEL, DEVIL };
