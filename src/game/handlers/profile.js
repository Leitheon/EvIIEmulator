'use strict';
// The profile window: Security Code, Vacation, Dream Truce, portrait, membership options (account.js has the rules).
module.exports = (game, H) => {
  const A = game.account;
  const answer = (conn, cmd, r, extra = {}) => Array.isArray(r) ? game.fail(conn, cmd, r[0], r[1]) : game.reply(conn, cmd, { ...extra, ...(r || {}) });
  // Security Code.
  H['common.setSecurityCode'] = (conn, d, cmd) => answer(conn, cmd, A.setCode(conn.player, d.code, game.now()));
  H['common.authSecurityCode'] = (conn, d, cmd) => answer(conn, cmd, A.auth(conn, d.code, game.now()));
  H['common.changeSecurityCode'] = (conn, d, cmd) => answer(conn, cmd, A.change(conn, d.curCode, d.newCode, game.now()));
  H['common.getIsSecurityCodeSetted'] = (conn, d, cmd) => game.reply(conn, cmd, { isSetSecurityCode: A.isSet(conn.player, game.now()) });
  H['common.removeSecurityCode'] = (conn, d, cmd) => { const p = conn.player, had = game.activeBuffs(p), r = A.remove(p, game.now()); answer(conn, cmd, r); if (!Array.isArray(r)) game.pushBuffs(p, had); };
  H['common.cancelRemovingSecurityCodeProcess'] = (conn, d, cmd) => {
    const p = conn.player, r = A.cancelRemoval(p, game.now()); answer(conn, cmd, r);
    if (!Array.isArray(r)) game.push(p.id, 'server.PlayerBuffUpdate', { buffBean: { typeId: 'RemovingSecurityCodeBuff', endTime: 0, descName: '' }, updateType: 1 });
  };
  H['common.setUnlockOption'] = (conn, d, cmd) => answer(conn, cmd, A.unlock(conn, d.option, game.now()));
  H['common.getProtectOption'] = (conn, d, cmd) => game.reply(conn, cmd, { option: A.options(conn.player, game.now()) });
  H['common.setProtectOption'] = (conn, d, cmd) => answer(conn, cmd, A.setOptions(conn, d.option, game.now()));
  // Vacation. Calling it off comes from the login screen's Holiday window, before the lord is logged in.
  H['furlough.isFurlought'] = (conn, d, cmd) => {
    const p = conn.player, r = A.startVacation(p, d.day, d.password, d.isAutoFurlough === true || d.isAutoFurlough === 'true', game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, { playerBean: game.beans.player(p, game.castlesOf(p), game.now()) });
  };
  H['furlough.cancelFurlought'] = (conn, d, cmd) => {
    const p = conn.player || conn.holidayPlayer; if (!p) return game.fail(conn, cmd, -1, 'Please log in first.');
    const r = A.endVacation(p, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, { playerBean: game.beans.player(p, game.castlesOf(p), game.now()) });
  };
  // Dream Truce (the client sends SHA1 of the account password).
  const dream = fn => (conn, d, cmd) => {
    const p = conn.player, had = game.activeBuffs(p), r = fn(p, d, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    if (r.items) game.pushItems(p, r.items);
    game.pushBuffs(p, had);
    if (!p.buffs?.DreamTruceBuff) game.push(p.id, 'server.PlayerBuffUpdate', { buffBean: { typeId: 'DreamTruceBuff', endTime: 0, descName: '' }, updateType: 1 });
  };
  H['truce.setDreamTruce'] = dream((p, d, now) => A.setDream(p, d.hour, d.minute, d.second, d.password, now));
  H['truce.changeDreamTruceTime'] = dream((p, d, now) => A.changeDream(p, d.hour, d.minute, d.second, d.password, now));
  H['truce.cancelDreamTruce'] = dream((p, d) => A.cancelDream(p, d.password));
  // The portrait (once), the window title, and the client's membership and mail options (kept; nothing is mailed).
  H['common.changeUserFace'] = (conn, d, cmd) => { const r = A.changeFace(conn.player, d.faceUrl, d.sex); answer(conn, cmd, r); if (!Array.isArray(r)) game.pushPlayerInfo(conn.player); };
  H['common.changeHeadline'] = (conn, d, cmd) => { conn.player.headline = String(d.headline || '').slice(0, 100); game.store.touch(); game.reply(conn, cmd, {}); };
  H['common.setEovnyMember'] = (conn, d, cmd) => { conn.player.evonyMember = true; game.store.touch(); game.reply(conn, cmd, {}); };
  H['common.setEvonyMemberEMail'] = (conn, d, cmd) => {
    const email = String(d.email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return game.fail(conn, cmd, -1, 'That is not an e-mail address.');
    conn.player.email = email; conn.player.evonyMember = true; game.store.touch(); game.reply(conn, cmd, {});
  };
};
