'use strict';
// The Marketplace (the client's Market window and its own texts). One order book for the whole server, per
// resource: lords post bids (buy) and offers (sell) of food, lumber, stone or iron at a unit price in gold
// (at most 150). Posting costs 0.5% of the total as a trading fee ("0.5% of Total Price will be charged for every
// Post as Trading Fee"). A bid reserves its gold and an offer its resources. "The system will find a matching
// offer for you and finish the transaction automatically": a new order trades with the best waiting orders on
// the other side, at their price, and what's left waits in Pending Orders. The seller is paid at once; what the
// buyer bought takes 30 minutes to reach his city (Trading Status), or no time with a Merchant Fleet. A
// Marketplace of level L holds L pending orders (its level data). Cancelling returns what wasn't traded; the fee
// is gone.
const { REPORT_TYPE } = require('./reports');

const RES = ['food', 'wood', 'stone', 'iron'];
const RES_NAME = ['Food', 'Lumber', 'Stone', 'Iron'];
const BUY = 0, SELL = 1;
const MARKETPLACE = 23;
const UPD = { ADD: 0, DELETE: 1, UPDATE: 2 };
const FLEET = 'consume.transaction.1';

const xmlAttr = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const round2 = n => Math.round(n * 100) / 100;

class Market {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.market || {}; }
  db(){ const db = this.g.db; return db.market || (db.market = { seq: 0, orders: {}, ships: {} }); }
  nextId(){ const m = this.db(); return ++m.seq; }
  level(c){ return this.g.logic.level(c, MARKETPLACE); }
  ordersOf(c){ return Object.values(this.db().orders).filter(o => o.castleId === c.id).sort((a, b) => a.id - b.id); }
  shipsOf(c){ return Object.values(this.db().ships).filter(s => s.castleId === c.id).sort((a, b) => a.endTime - b.endTime); }
  fee(total){ return round2(total * (this.rules.feeRate ?? 0.005)); }

  tradeBean(o){
    return { id: o.id, resType: o.resType, resourceName: RES_NAME[o.resType], tradeType: o.tradeType, tradeTypeName: o.tradeType === BUY ? 'Buy' : 'Sell',
      amount: o.amount, dealedAmount: o.dealed || 0, dealedTotal: round2(o.dealedTotal || 0), price: o.price };
  }
  shipBean(s){ return { id: s.id, resType: s.resType, resourceName: RES_NAME[s.resType], amount: s.amount, price: s.price, total: Math.round(s.total), endTime: s.endTime }; }
  push(o, type){ this.g.push(o.playerId, 'server.TradesUpdate', { castleId: o.castleId, updateType: type, tradeBean: this.tradeBean(o) }); }
  pushShip(s, type){ this.g.push(s.playerId, 'server.TransingTradeUpdate', { castleId: s.castleId, updateType: type, bean: this.shipBean(s) }); }

  // The five best bids (highest first) and offers (lowest first), amounts added up per price.
  search(resType){
    const t = Number(resType), side = type => {
      const m = new Map();
      for (const o of Object.values(this.db().orders)) if (o.resType === t && o.tradeType === type) m.set(o.price, (m.get(o.price) || 0) + o.amount - (o.dealed || 0));
      return [...m.entries()].sort((a, b) => type === BUY ? b[0] - a[0] : a[0] - b[0]).slice(0, 5).map(([price, amount]) => ({ price, amount }));
    };
    return { buyers: side(BUY), sellers: side(SELL) };
  }

  post(c, p, resType, tradeType, amount, priceText, now = this.g.now()){
    const g = this.g, L = this.level(c), t = Number(resType), type = Number(tradeType), n = Math.floor(Number(amount)), price = Math.round(Number(priceText) * 1000) / 1000;
    if (!L) return [-1, 'Build a Marketplace to trade.'];
    if (!(t >= 0 && t < 4) || ![BUY, SELL].includes(type)) return [-1, 'Choose a resource and whether to buy or sell.'];
    if (!(n > 0)) return [-1, 'Enter how much to trade.'];
    const max = this.rules.maxPrice ?? 150;
    if (!(price > 0) || price > max) return [-1, `The unit price must be above 0 and at most ${max} gold.`];
    if (this.ordersOf(c).length >= L * (this.rules.ordersPerLevel ?? 1)) return [-1, `Your level ${L} Marketplace can hold ${L * (this.rules.ordersPerLevel ?? 1)} pending order${L > 1 ? 's' : ''}. Wait for one to finish or cancel one.`];
    g.logic.settle(c, p, now);
    const total = round2(n * price), fee = this.fee(total), k = RES[t];
    if (type === BUY){
      if (c.res.gold < total + fee) return [-1, `Buying ${n.toLocaleString('en-US')} ${RES_NAME[t].toLowerCase()} at ${price} takes ${(total + fee).toLocaleString('en-US')} gold with the fee.`];
      c.res.gold -= total + fee;
    } else {
      if ((c.res[k] || 0) < n) return [-1, `This city has only ${Math.floor(c.res[k] || 0).toLocaleString('en-US')} ${RES_NAME[t].toLowerCase()}.`];
      if (c.res.gold < fee) return [-1, `The trading fee is ${fee.toLocaleString('en-US')} gold.`];
      c.res[k] -= n; c.res.gold -= fee;
    }
    const o = { id: this.nextId(), castleId: c.id, playerId: p.id, resType: t, tradeType: type, amount: n, price, dealed: 0, dealedTotal: 0, at: now };
    this.db().orders[o.id] = o;
    g.quests.flag(p, type === SELL ? 'sell' : 'buyRes');
    this.push(o, UPD.ADD);
    this.match(o, now);
    g.store.touch();
    return { order: o };
  }

  // Trade a new order against the best waiting orders on the other side, at their prices.
  match(o, now){
    const book = () => Object.values(this.db().orders).filter(x => x !== o && x.resType === o.resType && x.tradeType !== o.tradeType && x.amount > (x.dealed || 0)
      && (o.tradeType === BUY ? x.price <= o.price : x.price >= o.price))
      .sort((a, b) => (o.tradeType === BUY ? a.price - b.price : b.price - a.price) || a.id - b.id);
    for (const x of book()){
      const left = o.amount - o.dealed; if (left <= 0) break;
      const q = Math.min(left, x.amount - x.dealed), price = x.price;
      const [buy, sell] = o.tradeType === BUY ? [o, x] : [x, o];
      this.fill(buy, sell, q, price, buy === o ? o.price : price, now);
    }
  }
  // q units change hands at `price`; the buyer had reserved `reserved` a unit.
  fill(buy, sell, q, price, reserved, now){
    const g = this.g, total = round2(q * price);
    for (const o of [buy, sell]){ o.dealed += q; o.dealedTotal = round2((o.dealedTotal || 0) + total); }
    const bc = g.db.castles[buy.castleId], sc = g.db.castles[sell.castleId];
    if (sc){ sc.res.gold += total; g.pushResources(sc); }
    if (bc && reserved > price){ bc.res.gold += round2(q * (reserved - price)); g.pushResources(bc); }
    if (bc){
      const minutes = this.rules.transportMinutes ?? 30;
      const s = { id: this.nextId(), castleId: bc.id, playerId: buy.playerId, resType: buy.resType, amount: q, price, total, endTime: now + minutes * 60000 / this.g.logic.speed };
      this.db().ships[s.id] = s;
      this.pushShip(s, UPD.ADD);
    }
    for (const o of [buy, sell]){
      const p = g.db.players[o.playerId], done = o.dealed >= o.amount;
      if (done) delete this.db().orders[o.id];
      this.push(o, done ? UPD.DELETE : UPD.UPDATE);
      if (p) this.report(p, o, q, total);
    }
    g.store.touch();
  }
  report(p, o, q, total){
    const what = `${o.tradeType === BUY ? 'Bought' : 'Sold'} ${q.toLocaleString('en-US')} ${RES_NAME[o.resType].toLowerCase()} for ${Math.round(total).toLocaleString('en-US')} gold`;
    this.g.reports.add(p, { type: REPORT_TYPE.TRADE, title: what,
      content: `<reportData><tradeReport tradeType="${o.tradeType === BUY ? 'Buy' : 'Sell'}" dealedAmount="${q}" resName="${xmlAttr(RES_NAME[o.resType])}" gold="${Math.round(total)}"/></reportData>` });
  }

  cancel(c, p, tradeId){
    const o = this.db().orders[Number(tradeId)];
    if (!o || o.castleId !== c.id) return [-1, 'That order has already been traded or cancelled.'];
    const left = o.amount - (o.dealed || 0);
    if (o.tradeType === BUY) c.res.gold += round2(left * o.price); else c.res[RES[o.resType]] = (c.res[RES[o.resType]] || 0) + left;
    delete this.db().orders[o.id];
    this.push(o, UPD.DELETE);
    this.g.store.touch();
    return { order: o };
  }

  // Shipments that have arrived.
  tick(now){
    for (const s of Object.values(this.db().ships)) if (s.endTime <= now) this.deliver(s);
  }
  deliver(s){
    const g = this.g, c = g.db.castles[s.castleId];
    delete this.db().ships[s.id];
    if (c){ c.res[RES[s.resType]] = (c.res[RES[s.resType]] || 0) + s.amount; g.pushResources(c); }
    this.pushShip(s, UPD.DELETE);
    g.store.touch();
  }
  // A Merchant Fleet finishes a shipment at once. Without one, its shop price in cents is charged.
  speedUp(c, p, shipId, itemId = FLEET){
    const g = this.g, s = this.db().ships[Number(shipId)];
    if (!s || s.castleId !== c.id) return [-1, 'That shipment has already arrived.'];
    const id = itemId || FLEET, price = g.data.items[id]?.price || 0, items = [];
    if (g.items.take(p, id)) items.push(id);
    else if (price && (p.coins || 0) >= price){ p.coins -= price; g.pushPlayerInfo(p); }
    else return [-1, `Speeding up a shipment takes a ${g.items.name(id)}${price ? ` (${price} cents)` : ''}.`];
    this.deliver(s);
    return { items };
  }
}

module.exports = { Market, MARKET_BUY: BUY, MARKET_SELL: SELL, MARKET_RES: RES };
