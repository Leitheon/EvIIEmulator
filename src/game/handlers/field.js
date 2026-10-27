'use strict';
// Valleys you hold, and the info popup for any map tile.
const world = require('../world');
module.exports = (game, H) => {
  H['field.getCastleFieldInfo'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, { fields: (c.valleys || []).map(id => game.armies.fieldBean(world.tileAt(game.store, id))) });
  };
  H['field.giveUpField'] = (conn, d, cmd) => {
    const p = conn.player, id = Number(d.fieldId);
    const c = game.castlesOf(p).find(x => (x.valleys || []).includes(id));
    if (!c) return game.fail(conn, cmd, -18, 'That valley is not yours.');
    const r = game.armies.giveUp(c, id);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch(); game.reply(conn, cmd, {});
    game.push(p.id, 'server.CastleFieldUpdate', { castleId: c.id, updateType: 1, bean: r.bean });
    game.pushResources(c);
  };
  H['field.getOtherFieldInfo'] = (conn, d, cmd) => {
    const id = Number(d.fieldId);
    if (!(id >= 0 && id < world.SIZE * world.SIZE)) return game.fail(conn, cmd, -18, 'That map location does not exist.');
    game.reply(conn, cmd, { bean: game.mapBean(conn, world.tileAt(game.store, id)) });
  };
};
