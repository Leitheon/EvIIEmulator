'use strict';
// Town Hall: Comfort and Levy, and items used on a city.
module.exports = (game, H) => {
  const cooldown = (c, key, minutes) => {
    const now = game.now(), until = (c.cooldowns || {})[key] || 0;
    if (until > now) return Math.ceil((until - now) / 60000);
    (c.cooldowns = c.cooldowns || {})[key] = now + minutes * 60000 / game.logic.speed;
    return 0;
  };
  // Comfort, as the client describes it: 1 Disaster Relief (+5 loyalty, -15 grievance), 2 Praying (+25, -5),
  // 3 Blessing (food = population limit, gold = 10% of it), 4 Population Raising (food = half the limit, +5% of the limit as people).
  H['interior.pacifyPeople'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, max = game.logic.popMax(c), t = Number(d.typeId);
    const reliefFood = Math.min(10000000, Math.round((p.prestige || 0) / 10 * game.castlesOf(p).length));
    const cost = { 1: { food: reliefFood }, 2: { food: reliefFood }, 3: { food: max, gold: Math.ceil(max * 0.1) }, 4: { food: Math.round(max * 0.5) } }[t];
    if (!cost) return game.fail(conn, cmd, -1, 'Unknown comfort action.');
    for (const [k, v] of Object.entries(cost)) if (c.res[k] < v) return game.fail(conn, cmd, -1, `Not enough ${k}: ${v.toLocaleString('en-US')} needed.`);
    const wait = cooldown(c, 'pacify', game.rules.pacifyCooldownMinutes);
    if (wait) return game.fail(conn, cmd, -34, `Your people were comforted recently. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`);
    for (const [k, v] of Object.entries(cost)) c.res[k] -= v;
    if (t === 1){ c.loyalty = Math.min(100, (c.loyalty ?? 80) + 5); c.complaint = Math.max(0, (c.complaint || 0) - 15); }
    if (t === 2){ c.loyalty = Math.min(100, (c.loyalty ?? 80) + 25); c.complaint = Math.max(0, (c.complaint || 0) - 5); }
    if (t === 4) c.pop = Math.min(max, c.pop + Math.floor(max * 0.05));
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
  // Levy: 1 gold (10% of population), 2 food (population), 3 lumber (population), 4 stone (half), 5 iron (40%). Loyalty -20.
  H['interior.taxation'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const pop = Math.floor(c.pop), t = Number(d.typeId);
    const what = { 1: ['gold', 0.1], 2: ['food', 1], 3: ['wood', 1], 4: ['stone', 0.5], 5: ['iron', 0.4] }[t];
    if (!what) return game.fail(conn, cmd, -1, 'Unknown levy.');
    const wait = cooldown(c, 'levy', game.rules.levyCooldownMinutes);
    if (wait) return game.fail(conn, cmd, -34, `You levied recently. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`);
    c.res[what[0]] += Math.floor(pop * what[1]);
    c.loyalty = Math.max(0, (c.loyalty ?? 80) - game.rules.levyLoyaltyCost);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
};
