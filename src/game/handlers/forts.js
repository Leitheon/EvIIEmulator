'use strict';
// Wall defenses (the Walls window).
module.exports = (game, H) => {
  const F = game.forts;
  const pushForts = c => game.push(c.playerId, 'server.FortificationsUpdate', { castleId: c.id, fortification: game.beans.forts(c) });
  H['fortifications.getFortificationsProduceList'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { fortList: F.list(c, conn.player) }); };
  H['fortifications.getProduceQueue'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { allProduceQueue: F.queueBeans(c) }); };
  H['fortifications.produceWallProtect'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = F.produce(c, conn.player, d.wallProtectType, d.num, game.now());
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
  H['fortifications.cancelFortificationProduce'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = F.cancel(c, d.queueId, game.now());
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushResources(c);
  };
  H['fortifications.destructWallProtect'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = F.demolish(c, d.typeId, d.num);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {}); pushForts(c); game.pushResources(c);
  };
  H['fortifications.accTroopProduce'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), item = F.queue(c)[0], left = item ? Math.max(0, item.endTime - now) : 0;
    const s = d.itemId === 'player.fort.1.c' ? (game.items.take(p, d.itemId) ? { reduce: r => r * 0.7, item: d.itemId, taken: true } : { err: "You don't have Archimedes' Note." })
      : game.items.speedup(p, d.itemId, left, game.items.coinsFor(left));
    if (s.err) return game.fail(conn, cmd, -44, s.err);
    const err = F.speedUp(c, d.queueId, s.reduce, now);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    if (s.item && !s.taken) game.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    game.store.touch(); game.reply(conn, cmd, {});
    if (s.item) game.pushItems(p, [s.item]);
    if (s.coins) game.pushPlayerInfo(p);
    game.completeDue(c, true);
  };
};
