'use strict';
// Barracks: what can be trained, recruiting, the training queue and speed-ups.
module.exports = (game, H) => {
  const { troops } = game;
  H['troop.getTroopProduceList'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { troopList: troops.produceList(c, conn.player) }); };
  H['troop.getProduceQueue'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { allProduceQueue: troops.queueBeans(c) }); };
  H['troop.produceTroop'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = troops.produce(c, conn.player, d.isShare ? 0 : d.positionId, d.troopType, d.num, game.now());
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
  H['troop.cancelTroopProduce'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = troops.cancel(c, d.positionId, d.queueId, game.now());
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
  H['troop.accTroopProduce'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), q = troops.queues(c)[d.positionId], item = q && q[0];
    const left = item ? Math.max(0, item.endTime - now) : 0;
    const s = game.items.troopSpeedup(p, d.itemId, left, game.items.coinsFor(left));
    if (s.err) return game.fail(conn, cmd, -44, s.err);
    const err = troops.speedUp(c, d.positionId, d.queueId, s.reduce, now);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    if (s.item) game.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    game.store.touch(); game.reply(conn, cmd, {});
    if (s.item) game.pushItems(p, [s.item]);
    if (s.coins) game.pushPlayerInfo(p);
    game.completeDue(c, true);
  };
  // Dismiss: the client shows 30% of the troops' training food, lumber, stone and iron coming back
  // (ProduceBuildingResourceData.reCalcDataArrayForDisband). The Security Code can guard it (account.js, bit 4).
  H['troop.disbandTroop'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const locked = game.account.guard(conn, 4); if (locked) return game.fail(conn, cmd, locked[0], locked[1]);
    const t = game.data.troops[Number(d.troopType)], n = Math.floor(Number(d.num));
    if (!t) return game.fail(conn, cmd, -46, 'Unknown troop type.');
    if (!(n > 0) || n > (c.troops?.[t.field] || 0)) return game.fail(conn, cmd, -29, `You don't have that many ${t.name || 'troops'} in this city.`);
    c.troops[t.field] -= n;
    const share = game.rules.disbandRefundRate ?? 0.3;
    for (const k of ['food', 'wood', 'stone', 'iron']) c.res[k] += Math.floor(n * (t[k] || 0) * share);
    game.store.touch(); game.reply(conn, cmd, {});
    game.pushTroops(c); game.pushResources(c);
  };
  // The march window's saved troop settings ("Settings 1" to "Settings 3").
  H['common.setTroopConfig'] = (conn, d, cmd) => {
    const p = conn.player, name = String(d.name || '').trim().slice(0, 30);
    if (!name) return game.fail(conn, cmd, -1, 'Choose a setting to save.');
    const t = {}; for (const x of Object.values(game.data.troops)) { const n = Math.max(0, Math.floor(Number(d.config?.[x.field]) || 0)); if (n) t[x.field] = n; }
    p.troopConfigs = p.troopConfigs || {};
    if (!p.troopConfigs[name] && Object.keys(p.troopConfigs).length >= 10) return game.fail(conn, cmd, -1, 'You have too many saved settings.');
    p.troopConfigs[name] = { troop: t, time: game.now() };
    game.store.touch();
    game.reply(conn, cmd, { troopConfigBeans: game.beans.player(p, game.castlesOf(p), game.now()).troopConfigBeans });
  };
  H['troop.checkIdleBarrack'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const idle = troops.barracks(c).some(b => !(troops.queues(c)[b.pos] || []).length);
    idle ? game.reply(conn, cmd, {}) : game.fail(conn, cmd, -1, 'Every Barracks is busy.');
  };
  // March bonuses the client folds into its travel-time estimate, in %: Compass for foot troops, Horseback Riding
  // for horses, siege and transporters, Logistics for load. The Relief Station multiplies speed between your own cities.
  H['army.getTroopParam'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player;
    game.reply(conn, cmd, { marchSkillParam: game.logic.techEffect(p, 12), driveSkillParam: game.logic.techEffect(p, 13), loadSkillParam: game.logic.techEffect(p, 11),
      transportStationParam: game.armies.stationParam(c) });
  };
  H['army.IsDropItemInCastle'] = (conn, d, cmd) => game.reply(conn, cmd, {});
};
