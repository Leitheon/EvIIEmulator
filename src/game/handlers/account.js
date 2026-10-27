'use strict';
// Version handshake, login, registration.
module.exports = (game, H) => {
  H['gameClient.version'] = (conn, data) => {
    const v = typeof data === 'string' ? data : data?.version;
    if (v !== game.clientVersion) game.log.warn(`Client version ${JSON.stringify(data)} differs from ${game.clientVersion}; continuing anyway.`);
  };
  H['login'] = (conn, d) => game.login(conn, d.user, d.pwd);
  H['register'] = (conn, d) => {
    const name = String(d.user || '').trim();
    if (!name) return game.fail(conn, 'server.RegisterResponse', -11, 'Enter an account name.');
    if (game.db.accounts[name.toLowerCase()]) return game.fail(conn, 'server.RegisterResponse', -11, 'That account name is taken.');
    game.db.accounts[name.toLowerCase()] = { name, pwd: game.pwdHash(d.pwd), createdAt: game.now(), playerId: null };
    game.store.touch();
    game.reply(conn, 'server.RegisterResponse', {});
  };
  // Lords are created automatically at first login, so this only re-sends the existing one.
  H['common.createNewPlayer'] = (conn, d, cmd) => game.reply(conn, cmd, { player: game.beans.player(conn.player, game.castlesOf(conn.player), game.now()) });
};
