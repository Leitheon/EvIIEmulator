'use strict';
// Declaring war on another lord, and what the client asks about it (war.js has the rules).
module.exports = (game, H) => {
  const W = game.war;
  const lord = d => game.db.players[Number(d.playerId)] || null;
  H['common.declaredWarAgainstPlayer'] = (conn, d, cmd) => {
    const r = W.declare(conn.player, lord(d), game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
  };
  H['common.getCanDeclaredWarAgainstPlayer'] = (conn, d, cmd) => game.reply(conn, cmd, { isCanDeclaredWar: !W.cantDeclare(conn.player, lord(d), game.now()) });
  H['common.getPlayerDeclaredWarStatus'] = (conn, d, cmd) => game.reply(conn, cmd, { status: W.status(conn.player, lord(d), game.now()) });
  // The lord's profile: war status, Beginner's Protection, alliance relation (2: none between them).
  H['common.getRelationship'] = (conn, d, cmd) => {
    const q = lord(d), now = game.now();
    game.reply(conn, cmd, { declaredWarStatus: W.status(conn.player, q, now), freshman: W.beginner(q, now), allianceRelation: 2, canDeclaredWar: !W.cantDeclare(conn.player, q, now) });
  };
  // The profile's "receive incoming attack" setting (mail warnings on the live game; kept, nothing is mailed).
  H['common.setReceiveIncomingAttack'] = (conn, d, cmd) => { conn.player.receiveIncomingAttack = d.isAccept !== false && d.isAccept !== 'false'; game.store.touch(); game.reply(conn, cmd, {}); };
};
