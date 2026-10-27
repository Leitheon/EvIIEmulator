'use strict';
// Chat commands (chat.js has the rules). A refused message's reply makes the client take the sender's line back
// out and show why.
module.exports = (game, H) => {
  const C = game.chat;
  const answer = (conn, cmd, r) => Array.isArray(r) ? game.fail(conn, cmd, r[0], r[1]) : game.reply(conn, cmd, {});
  H['common.worldChat'] = (conn, d, cmd) => answer(conn, cmd, C.world(conn.player, d.msg, d.languageType, game.now()));
  H['common.channelChat'] = (conn, d, cmd) => answer(conn, cmd, C.channel(conn.player, d.channel, d.sendMsg, d.languageType, game.now()));
  H['common.privateChat'] = (conn, d, cmd) => answer(conn, cmd, C.whisper(conn.player, d.targetName, d.msg, game.now()));
  H['common.allianceChat'] = (conn, d, cmd) => answer(conn, cmd, C.alliance(conn.player, d.msg, d.languageType, game.now()));
  H['common.denyPlayerSpeak'] = (conn, d, cmd) => answer(conn, cmd, C.mute(conn.player, d.playername, d.time, game.now()));
};
