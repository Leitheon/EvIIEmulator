'use strict';
// Colonies (ColonyCommands): the colony lists, overview, policies, Sow Discord, the suppression army, Uprise and
// Abandon. The rules are in colonies.js.
module.exports = (game, H) => {
  const C = game.colonies;
  const inCity = fn => (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) fn(c, conn.player, d, cmd, conn); };
  const answer = (conn, cmd, r, extra = {}) => Array.isArray(r) ? game.fail(conn, cmd, r[0], r[1]) : game.reply(conn, cmd, { ...extra, ...r });
  H['colony.getColonialCastlesInfo'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, { colonyBeans: C.beans(c) }));
  // The suzerain of this city, as a one-entry list (or none).
  H['colony.getSuzerainColonialCastlesInfo'] = inCity((c, p, d, cmd, conn) => { const r = C.ofColony(c), b = r && C.bean(r, 'colony'); game.reply(conn, cmd, { colonyBeans: b ? [b] : [] }); });
  H['colony.getColonialArmyInfo'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, C.armyInfo(c, p, d.targetCastleId)));
  H['colony.overviewColonialCastle'] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, C.overview(c, p, d.targetCastleId)));
  for (const [name, kind] of [['levyTaxes', 'tax'], ['levyFood', 'food'], ['levyPopulation', 'population'], ['levyArmy', 'draft'], ['reduceArmaments', 'disarm']]){
    H['colony.' + name] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, C.levy(c, p, d.targetCastleId, kind, game.now())));
  }
  H['colony.sowDiscord'] = inCity((c, p, d, cmd, conn) => { const r = C.sowDiscord(c, p, d.targetCastleId, game.now()); answer(conn, cmd, Array.isArray(r) ? r : {}); });
  H['colony.getDeployTroopsInfo'] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, C.deployInfo(c, p, d.targetCastleId, game.now())));
  H['colony.setDeployTroops'] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, C.setDeploy(c, p, d.targetCastleId, d.troopBean, game.now())));
  H['colony.uprise'] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, C.uprise(c, p, game.now())));
  // (Abandoning colonies can be guarded by the Security Code: account.js.)
  H['colony.abandonColony'] = inCity((c, p, d, cmd, conn) => answer(conn, cmd, game.account.guard(conn, 1) || C.abandon(c, p, d.targetCastleId, game.now())));
  H['colony.speedUpAbandonColony'] = inCity((c, p, d, cmd, conn) => {
    const r = C.speedUpAbandon(c, p, d.targetCastleId, String(d.itemId || ''), game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushItems(p, [r.usedItem]);
  });
};
