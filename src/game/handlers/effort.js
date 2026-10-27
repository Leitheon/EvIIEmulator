'use strict';
// The Achievements window (effort.js has the list and the rules).
module.exports = (game, H) => {
  const E = game.effort;
  H['quest.getEffortList'] = (conn, d, cmd) => { const p = conn.player; E.check(p, game.now()); game.reply(conn, cmd, E.summary(p)); };
  H['quest.getEffortListByTargeTypeid'] = (conn, d, cmd) => game.reply(conn, cmd, { quests: E.category(conn.player, d.TargeTypeid) });
};
