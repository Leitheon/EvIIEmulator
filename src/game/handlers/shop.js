'use strict';
// Shop: buying with coins, using items (chests, the Wheel of Fortune, buffs, city items), gift packages.
const { REPORT_TYPE } = require('../reports');

module.exports = (game, H) => {
  H['common.getItemDefXml'] = (conn, d, cmd) => game.reply(conn, cmd, { itemXml: '<itemDef><items/><special/><special2/></itemDef>' });
  H['common.getPackageNumber'] = (conn, d, cmd) => game.reply(conn, cmd, { number: 0 });
  H['common.getPackageList'] = (conn, d, cmd) => game.reply(conn, cmd, { packages: [] });
  H['shop.buy'] = (conn, d, cmd) => {
    const p = conn.player, err = game.items.buy(p, d.itemId, d.amount);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushItems(p, [d.itemId]);
    game.pushPlayerInfo(p);
  };
  // After an item is used: tell the client everything that changed.
  const after = (conn, c, out, had, itemId) => {
    const p = conn.player;
    if (out.items.size) game.pushItems(p, [...out.items]);
    if (out.buffs) game.pushBuffs(p, had);
    if (out.coins || out.player) game.pushPlayerInfo(p);
    if (out.troops) game.pushTroops(c);
    for (const h of out.heroes) game.pushHero(c, h, 0);
    // A new city: the client asks for its name when an ordinary city (power level 4, as an amulet city is) arrives.
    if (out.newCastle){ game.push(p.id, 'server.CastleUpdate', { updateType: 0, castleBean: game.beans.castle(out.newCastle, p) }); game.pushPlayerInfo(p); }
    game.pushResources(c);
    // The award window can't show troops, heroes or new cities, so those get a report.
    if (out.troopText.length || out.note){
      const name = game.data.items[itemId]?.name || itemId;
      const lines = [out.note, out.troopText.length ? `${out.troopText.join(', ')} joined the army in ${c.name}.` : ''].filter(Boolean);
      game.reports.add(p, { type: REPORT_TYPE.OTHER, title: `${name}: ${out.text.length ? out.text.join(', ') : 'opened'}`.slice(0, 120), content: lines.join(' ') });
    }
    if (out.text.length) game.log.info(`${p.name} used ${game.data.items[itemId]?.name || itemId}: ${out.text.join(', ')}`);
  };
  H['shop.useGoods'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), had = game.activeBuffs(p, now);
    const out = game.itemUse.use(p, c, d.itemId, now);
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.store.touch();
    game.reply(conn, cmd, { itemBeans: game.itemUse.replyBeans(p, d.itemId, out), gamblingItemsBeans: out.wheel || [] });
    after(conn, c, out, had, d.itemId);
  };
  H['shop.useCastleGoods'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), had = game.activeBuffs(p, now);
    const out = game.itemUse.useOnCastle(p, c, d.itemId, now);
    if (Array.isArray(out)) return game.fail(conn, cmd, out[0], out[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    after(conn, c, out, had, d.itemId);
  };
  // Wheel of Fortune billboard: spins per lord today / yesterday.
  const board = day => Object.values(game.db.players).map(p => ({ p, n: p.spins?.[day] || 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 20)
    .map((x, i) => ({ rank: i + 1, playerName: x.p.name, count: x.n, isReward: 0, itemsBeans: [] }));
  const day = off => new Date(game.now() - off * 86400000).toISOString().slice(0, 10);
  H['gamblingranking.getGamblingRankingToday'] = (conn, d, cmd) => game.reply(conn, cmd, { gamblingRankingBeans: board(day(0)), pageNo: 1, totalPage: 1 });
  H['gamblingranking.getGamblingRankingYesterday'] = (conn, d, cmd) => game.reply(conn, cmd, { gamblingRankingBeans: board(day(1)), pageNo: 1, totalPage: 1 });
  H['gamblingranking.getGamblingRankingReward'] = (conn, d, cmd) => game.fail(conn, cmd, -1, 'There are no billboard rewards on this server.');
};
