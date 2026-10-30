'use strict';
// Building menu, construction, demolition, speed-ups and taxes.
const { TYPE, STATUS } = require('../castle');

module.exports = (game, H) => {
  const { logic } = game;
  const listFor = (c, p, types) => types.filter(t => !(game.rules.uniqueTypes.includes(t) && Object.values(c.buildings).some(b => b.typeId === t && (b.level > 0 || b.status))))
    .map(t => ({ typeId: t, conditionBean: logic.condition(c, p, t, 1) }));

  H['castle.getAvailableBuildingListInside'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { builingList: listFor(c, conn.player, game.rules.insideTypes) }); };
  H['castle.getAvailableBuildingListOutside'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { builingList: listFor(c, conn.player, game.rules.outsideTypes) }); };
  H['castle.getAvailableBuildingBean'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const existing = Object.values(c.buildings).filter(b => b.typeId === d.typeId).reduce((m, b) => Math.max(m, b.level), 0);
    const L = d.typeId === TYPE.WALLS || d.typeId === TYPE.TOWN_HALL ? Math.min(existing + 1, game.rules.maxLevel) : 1;
    game.reply(conn, cmd, { builingList: [{ typeId: d.typeId, conditionBean: logic.condition(c, conn.player, d.typeId, L) }] });
  };
  H['castle.checkOutUpgrade'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const b = c.buildings[d.positionId];
    if (!b) return game.fail(conn, cmd, -30, 'There is no building there.');
    game.reply(conn, cmd, logic.checkOut(c, conn.player, b));
  };
  H['castle.getDestructBuildBean'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const b = c.buildings[d.positionId]; if (!b) return game.fail(conn, cmd, -30, 'There is no building there.');
    game.reply(conn, cmd, { builingList: [{ typeId: b.typeId, conditionBean: logic.destructCondition(c, conn.player, b.typeId, Math.max(1, b.level)) }] });
  };
  const act = fn => (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = fn(c, conn.player, d);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushBuilding(c, d.positionId);
    logic.removeEmpty(c, d.positionId);
    game.pushResources(c);
  };
  H['castle.newBuilding'] = act((c, p, d) => logic.newBuilding(c, p, d.positionId, d.buildingType, game.now()));
  H['castle.upgradeBuilding'] = act((c, p, d) => logic.upgrade(c, p, d.positionId, game.now()));
  H['castle.destructBuilding'] = act((c, p, d) => logic.destruct(c, p, d.positionId, game.now()));
  H['castle.cancleBuildCommand'] = (conn, d, cmd) => { act((c, p, x) => logic.cancel(c, x.positionId))(conn, d, cmd); const c = game.castleFor(conn, d.castleId); if (c) game.completeDue(c, true); };

  // ---------- building queues (buildQueue.js) ----------
  const Q = game.buildQueue;
  const queue = kind => (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const r = Q.add(c, conn.player, kind, d.type, d.positionId, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    Q.push(c, r.q, 1);
    game.pushResources(c);
  };
  H['castle.newBuildingQueue'] = queue(1);
  H['castle.demolishBuildingQueue'] = queue(0);
  H['castle.cancelBuildingQueue'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const r = Q.cancel(c, d.queueId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {}); game.pushResources(c);
  };
  H['castle.getBuildingQueueCoinsNeed'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) game.reply(conn, cmd, { coinsNeed: Q.coinsNeed(c, conn.player, d.queueId) }); };
  H['castle.speedupBuildingQueue'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const r = Q.speedup(c, conn.player, d.queueId, d.itemId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
  };

  H['castle.getCoinsNeed'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const b = c.buildings[d.positionId], left = b && b.status ? Math.max(0, b.endTime - game.now()) : 0;
    game.reply(conn, cmd, { coinsNeed: left ? game.items.coinsFor(left) : 0 });
  };
  H['castle.speedUpBuildCommand'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const b = c.buildings[d.positionId], p = conn.player, now = game.now();
    if (!b || !b.status) return game.fail(conn, cmd, -45, 'Nothing is being built there.');
    const left = Math.max(0, b.endTime - now);
    // Dynamite: "Demolish building immediately. But acquire no resource."
    const s = d.itemId === 'player.destroy.1.a'
      ? (b.status !== STATUS.DESTRUCTING ? { err: 'Dynamite only finishes a demolition.' } : game.items.ensure(p, d.itemId) ? { reduce: () => 0, item: d.itemId, dynamite: true } : { err: "You don't have any Dynamite." })
      : game.items.speedup(p, d.itemId, left, game.items.coinsFor(left));
    if (s.dynamite) b.noRefund = true;
    if (s.err) return game.fail(conn, cmd, -44, s.err);
    if (s.item) game.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    b.endTime = now + Math.max(0, s.reduce(left));
    game.store.touch();
    game.reply(conn, cmd, {});
    if (s.item) game.pushItems(p, [s.item]);
    if (s.coins) game.pushPlayerInfo(p);
    game.pushBuilding(c, d.positionId);
    game.completeDue(c, true);
  };
  H['castle.UpdateCastleResources'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c){ game.reply(conn, cmd, { builingList: [] }); game.pushResources(c); } };

  H['interior.modifyTaxRate'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const t = Math.round(Number(d.tax));
    if (!(t >= 0 && t <= 100)) return game.fail(conn, cmd, -35, 'The tax rate must be between 0 and 100.');
    const locked = game.account.guard(conn, 16); if (locked) return game.fail(conn, cmd, locked[0], locked[1]);   // the Security Code
    c.taxRate = t; game.store.touch();
    game.reply(conn, cmd, {}); game.pushResources(c);
  };
  // (a bad rate is -99, OK_INVALID_REQUEST: the one error ResourceProduce shows)
  H['interior.modifyCommenceRate'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const rates = { food: d.foodrate, wood: d.woodrate, stone: d.stonerate, iron: d.ironrate };
    for (const k of Object.keys(rates)){ const v = Math.round(Number(rates[k])); if (!(v >= 0 && v <= 100)) return game.fail(conn, cmd, -99, 'Labour rates must be between 0 and 100.'); rates[k] = v; }
    c.commence = rates; game.store.touch();
    game.reply(conn, cmd, {}); game.pushResources(c);
  };
};
