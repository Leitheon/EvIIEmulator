'use strict';
// The alliance windows (alliances.js has the rules). Each reply carries what its window draws.
module.exports = (game, H) => {
  const A = game.alliances;
  const ok = (conn, cmd, r, data = {}) => Array.isArray(r) ? game.fail(conn, cmd, r[0], r[1]) : game.reply(conn, cmd, typeof data === 'function' ? data(r) : data);
  const page = (list, pageNo, pageSize = 10) => {
    const size = Math.max(1, Math.min(50, Number(pageSize) || 10)), total = Math.max(1, Math.ceil(list.length / size));
    const n = Math.min(total, Math.max(1, Number(pageNo) || 1));
    return { items: list.slice((n - 1) * size, n * size), pageNo: n, totalPage: total };
  };
  const mine = conn => A.of(conn.player);

  // ---------- reading ----------
  H['alliance.isHasAlliance'] = (conn, d, cmd) => {
    const a = mine(conn); if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    game.reply(conn, cmd, { indexAllianceInfoBean: A.index(a), ...A.relations(a), serialVersionUID: 1 });
  };
  H['alliance.getAllianceMembers'] = (conn, d, cmd) => {
    const a = mine(conn); if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    game.reply(conn, cmd, { members: A.memberBeans(a, conn.player) });
  };
  H['alliance.getAllianceInfo'] = (conn, d, cmd) => {
    const a = A.byName(d.allianceName); if (!a) return game.fail(conn, cmd, -1, `There is no alliance called ${String(d.allianceName ?? '').trim()}.`);
    game.reply(conn, cmd, A.info(a));
  };
  H['alliance.getAllianceList'] = (conn, d, cmd) => {
    const key = String(d.name ?? '').trim().toLowerCase();
    const list = A.ranked().map(x => x.a).filter(a => !key || a.name.toLowerCase().includes(key)).map(a => A.query(a));
    const pg = page(list, d.pageNum, d.pageSize);
    game.reply(conn, cmd, { alliances: pg.items, pageNo: pg.pageNo, totalPage: pg.totalPage });
  };
  H['rank.getAllianceRank'] = (conn, d, cmd) => {
    const key = String(d.key ?? '').trim().toLowerCase();
    const list = A.ranked().map((x, i) => A.rankBean(x, i)).filter(b => !key || b.name.toLowerCase().includes(key));
    const pg = page(list, d.pageNo, d.pageSize);
    game.reply(conn, cmd, { beans: pg.items, pageNo: pg.pageNo, pageSize: Math.max(1, Number(d.pageSize) || 10), totalPage: pg.totalPage });
  };
  H['alliance.getAllianceEventList'] = (conn, d, cmd) => {
    const a = mine(conn); if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    const pg = page(a.events || [], d.pageNo, 10);
    game.reply(conn, cmd, { events: pg.items, pageNo: pg.pageNo, totalPage: pg.totalPage });
  };
  H['alliance.getMilitarySituationList'] = (conn, d, cmd) => {
    const a = mine(conn); if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    const pg = page(A.situations(a), d.pageNo, d.pageSize);
    game.reply(conn, cmd, { situations: pg.items, pageNo: pg.pageNo, totalPage: pg.totalPage });
  };
  H['alliance.getAllianceArmyReport'] = (conn, d, cmd) => game.fail(conn, cmd, -1, 'That report is no longer available.');
  H['alliance.getPowerFromAlliance'] = (conn, d, cmd) => game.reply(conn, cmd, { level: A.rank(conn.player) });
  H['alliance.getAllianceFriendshipList'] = (conn, d, cmd) => {
    const a = mine(conn); if (!a) return game.fail(conn, cmd, -1, 'You are not in an alliance.');
    game.reply(conn, cmd, A.relations(a));
  };

  // ---------- founding, applying, invitations ----------
  H['alliance.createAlliance'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    ok(conn, cmd, A.create(conn.player, c, d.allianceName, game.now()));
  };
  H['alliance.userWantInAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.apply(conn.player, d.allianceName, game.now()), r => ({ waitIntoAllianceName: r.waitIntoAllianceName }));
  H['alliance.getAllianceWanted'] = (conn, d, cmd) => { const a = A.wanted(conn.player); game.reply(conn, cmd, a ? { allianceName: a.name } : {}); };
  H['alliance.cancelUserWantInAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.cancelApply(conn.player, d.allianceName));
  H['alliance.agreeComeinAllianceList'] = (conn, d, cmd) => game.reply(conn, cmd, { allianceAddPlayerByUserInfoBeanList: A.applicants(mine(conn)) });
  H['alliance.agreeComeinAllianceByLeader'] = (conn, d, cmd) => ok(conn, cmd, A.approve(conn.player, d.userName, game.now()));
  H['alliance.cancelagreeComeinAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.refuse(conn.player, d.userName), r => ({ allianceAddPlayerByUserInfoBeanList: A.applicants(r.alliance) }));
  H['alliance.addUsertoAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.invite(conn.player, d.userName, game.now()));
  H['alliance.addUsertoAllianceList'] = (conn, d, cmd) => game.reply(conn, cmd, { allianceAddPlayerInfoBeanList: A.invited(mine(conn)) });
  H['alliance.canceladdUsertoAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.cancelInvite(conn.player, d.userName), r => ({ allianceAddPlayerInfoBeanList: A.invited(r.alliance) }));
  H['alliance.leaderWantUserInAllianceList'] = (conn, d, cmd) => game.reply(conn, cmd, { allianceAddPlayerByLeaderInfoBeanList: A.invitesFor(conn.player) });
  H['alliance.agreeComeinAllianceByUser'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    ok(conn, cmd, A.accept(conn.player, c, d.allianceName, game.now()), () => ({ allianceAddPlayerByUserInfoBeanList: [] }));
  };
  H['alliance.rejectComeinAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.decline(conn.player, d.allianceName), () => ({ allianceAddPlayerByUserInfoBeanList: [] }));

  // ---------- members ----------
  H['alliance.setPowerForUserByAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.setRank(conn.player, d.userName, d.typeId, game.now()));
  H['alliance.resetTopPowerForAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.passHost(conn.player, d.userName, game.now()));
  H['alliance.resignForAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.resign(conn.player, game.now()));
  H['alliance.kickOutMemberfromAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.kick(conn.player, d.userName, game.now()));
  H['alliance.sayByetoAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.quit(conn.player, game.now()));
  H['alliance.setAllInfoForAlliance'] = (conn, d, cmd) => ok(conn, cmd, A.setInfo(conn.player, d.infoText, d.noteText));
  H['alliance.messagesForAllianceMember'] = (conn, d, cmd) => ok(conn, cmd, A.mailAll(conn.player, d.title, d.message, game.now()));

  // ---------- diplomacy ----------
  H['alliance.setAllianceFriendship'] = (conn, d, cmd) => ok(conn, cmd, A.setRelation(conn.player, d.targetAllianceName, d.type, game.now()));
  H['alliance.dropAllianceFriendshipRelation'] = (conn, d, cmd) => ok(conn, cmd, A.dropRelation(conn.player, d.targetAllianceName, game.now()), r => A.relations(r.alliance));
};
