'use strict';
// Commission Quests (CommissionQuestCommands): the Quest window's Commission tab. The rules are in commission.js.
module.exports = (game, H) => {
  const Q = game.commission;
  const list = (conn, cmd, beans) => game.reply(conn, cmd, { commissionQuestBean: beans });
  H['commission.getAllCommissionQuest'] = (conn, d, cmd) => list(conn, cmd, Q.all(conn.player));
  H['commission.getMyCommissionQuest'] = (conn, d, cmd) => list(conn, cmd, Q.mine(conn.player, game.now()));
  H['commission.getMyAcceptedCommissionQuest'] = (conn, d, cmd) => list(conn, cmd, Q.accepted(conn.player));
  H['commission.issueCommissionQuest'] = (conn, d, cmd) => {
    const p = conn.player, r = Q.issue(p, d.type, d.targetX, d.targetY, d.reward, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
  };
  const bid = more => (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = Q.bid(p, c, d.questId, d.newArmyBean, game.now(), more);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    if (r.hero) game.pushHero(c, r.hero, 2);
    game.pushTroops(c); game.pushResources(c);
    game.reply(conn, cmd, {});
    game.pushArmies(p);
    if (r.usedItems?.length) game.pushItems(p, r.usedItems);
  };
  H['commission.acceptCommissionQuest'] = bid(false);
  H['commission.addCommissionQuestArmy'] = bid(true);
  H['commission.declineCommissionQuest'] = (conn, d, cmd) => {
    const r = Q.decline(conn.player, d.questId, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
  };
  H['commission.getCommissionQuestArmyRanking'] = (conn, d, cmd) => {
    const q = Q.list()[Number(d.questId)];
    if (!q) return game.fail(conn, cmd, -1, 'That commission quest is over.');
    game.reply(conn, cmd, { armyRankBean: Q.ranking(q) });
  };
  H['commission.getCommissionQuestArmyInfo'] = (conn, d, cmd) => {
    const r = Q.armyInfo(conn.player, d.playerId, d.questId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, r);
  };
};
