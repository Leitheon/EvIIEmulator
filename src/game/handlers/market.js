'use strict';
// The Marketplace (Market window): posting bids and offers, Pending Orders, Trading Status, the five best
// bids and offers, and the Merchant Fleet.
module.exports = (game, H) => {
  const M = game.market;
  const inCity = fn => (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) fn(c, conn.player, d, cmd, conn); };
  H['trade.newTrade'] = inCity((c, p, d, cmd, conn) => {
    const r = M.post(c, p, d.resType, d.tradeType, d.amount, d.price);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    game.pushResources(c);
    game.questNotice(p, c);
    game.log.info(`${p.name} posted: ${r.order.tradeType ? 'sell' : 'buy'} ${r.order.amount} of resource ${r.order.resType} at ${r.order.price}`);
  });
  H['trade.cancelTrade'] = inCity((c, p, d, cmd, conn) => {
    const r = M.cancel(c, p, d.tradeId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {}); game.pushResources(c);
  });
  H['trade.getMyTradeList'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, { trades: M.ordersOf(c).map(o => M.tradeBean(o)) }));
  H['trade.getTransingTradeList'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, { transingTrades: M.shipsOf(c).map(s => M.shipBean(s)) }));
  H['trade.searchTrades'] = (conn, d, cmd) => game.reply(conn, cmd, M.search(d.resType));
  H['trade.speedUpTrans'] = inCity((c, p, d, cmd, conn) => {
    const r = M.speedUp(c, p, d.transingTradeId, d.itemId);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {});
    if (r.items.length) game.pushItems(p, r.items);
  });
};
