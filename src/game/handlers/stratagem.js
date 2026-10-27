'use strict';
// Stratagems (stratagems.js): the Stratagem button of a city's or an army's window.
module.exports = (game, H) => {
  H['shop.useTrickItem'] = (conn, d, cmd) => {
    const p = conn.player, r = game.stratagems.use(p, d.castleId, d.armyid, d.itemId, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    game.pushItems(p, [r.item]);
  };
};
