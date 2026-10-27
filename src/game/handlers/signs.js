'use strict';
// The Coordinates List (map signs): "Add to CL" on another lord's city keeps it in the list under the map, from
// which the map jumps there (the Drill Grounds' target list reads it too).
const world = require('../world');
module.exports = (game, H) => {
  const answer = (conn, cmd) => game.reply(conn, cmd, { castleSignInfoArr: game.signs(conn.player) });
  H['castle.saveCastleSignList'] = (conn, d, cmd) => {
    const p = conn.player, list = p.signs || (p.signs = []), c = game.db.castles[Number(d.id)];
    if (!c) return game.fail(conn, cmd, -51, 'There is no city there any more.');
    if (c.playerId === p.id) return game.fail(conn, cmd, -1, 'That city is your own.');
    if (!list.some(s => s.castleId === c.id)){
      const max = game.rules.coordinates?.max ?? 50;
      if (list.length >= max) return game.fail(conn, cmd, -1, 'Coordinates List is full. Please clear out the old ones before you add the new.');
      const { x, y } = world.xy(c.fieldId);
      p.signSeq = (p.signSeq || 0) + 1;
      list.push({ id: p.signSeq, castleId: c.id, name: c.name, x, y });
      game.store.touch();
    }
    answer(conn, cmd);
  };
  H['castle.deleteCastleSign'] = (conn, d, cmd) => {
    const p = conn.player, id = Number(d.id);
    p.signs = (p.signs || []).filter(s => s.id !== id); game.store.touch();
    answer(conn, cmd);
  };
};
