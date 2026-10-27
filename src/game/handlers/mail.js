'use strict';
// Mail (MailWin): writing, the Inbox, System and Sent boxes, reading, marking read and deleting. Bug and player
// reports go to player-reports.log next to world.json for whoever runs the server.
const fs = require('fs');
const path = require('path');

module.exports = (game, H) => {
  const M = game.mail;
  H['mail.sendMail'] = (conn, d, cmd) => {
    const p = conn.player, r = M.send(p, d.username, d.title, d.content);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    if (game.quests.flag(p, 'mail')) game.questNotice(p);
    game.log.info(`${p.name} mailed ${r.to.name}: ${String(d.title).slice(0, 60)}`);
  };
  H['mail.receiveMailList'] = (conn, d, cmd) => game.reply(conn, cmd, M.page(conn.player, d.type, d.pageNo, d.pageSize));
  H['mail.readMail'] = (conn, d, cmd) => {
    const p = conn.player, m = M.find(p, d.mailId);
    if (!m) return game.fail(conn, cmd, -1, 'That mail has been deleted.');
    if (!m.isRead){ m.isRead = 1; game.store.touch(); M.pushCounts(p); }
    game.reply(conn, cmd, M.detail(m));
  };
  H['mail.readOverMailList'] = (conn, d, cmd) => {
    const p = conn.player;
    if (M.markRead(p, M.ids(d.mailIds))) M.pushCounts(p);
    game.reply(conn, cmd, {});
  };
  // The client sends the ids to delete as str_mailid ("3,7,9").
  H['mail.deleteMail'] = (conn, d, cmd) => {
    const p = conn.player;
    M.remove(p, M.ids(d.str_mailid ?? d.mailIds ?? d.mailId));
    game.reply(conn, cmd, {});
    M.pushCounts(p);
  };
  const note = kind => (conn, d, cmd) => {
    const p = conn.player, line = JSON.stringify({ at: new Date(game.now()).toISOString(), kind, from: p.name, subject: String(d.subject ?? '').slice(0, 200), content: String(d.content ?? '').slice(0, 2000) });
    try { fs.appendFileSync(path.join(game.dataDir, 'player-reports.log'), line + '\n'); } catch (e){ game.log.error(`player report: ${e.message}`); }
    game.log.info(`${p.name} sent a ${kind} report: ${String(d.subject ?? '').slice(0, 80)}`);
    game.reply(conn, cmd, {});
  };
  H['mail.reportBug'] = note('bug');
  H['mail.reportPlayer'] = note('player');
};
