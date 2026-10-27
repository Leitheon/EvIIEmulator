'use strict';
// Shop contents, the inventory, timed bonuses (buffs) and speed-ups. Prices and names come from the
// client's item table; the effects follow each item's own description in that table. What happens when
// an item is used lives in itemUse.js.
const SHOP_CATEGORIES = ['宝物', '加速', '生产', '宝箱', '计谋', '材料'];  // the client's category keys
const HOT_ITEMS = ['consume.2.a', 'consume.2.b', 'player.resinc.1', 'player.gold.1.a'];

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
// Speed-ups: fixed time off the remaining time, or a share of what remains.
const SPEEDUP = {
  'consume.2.a': { ms: 15 * 60 * 1000 }, 'consume.2.b': { ms: HOUR }, 'consume.2.b.1': { ms: 2.5 * HOUR }, 'consume.2.c': { ms: 8 * HOUR },
  'consume.2.c.1': { msMin: 10 * HOUR, msMax: 30 * HOUR }, 'consume.2.d': { share: 0.3 }, 'player.speedup.1': { share: 0.5 },
};
const TROOP_SPEEDUP = { 'player.troop.1.b': { share: 0.3 } };

// Items that start a timed bonus for the lord: [buff id the client knows, duration].
const BUFF_ITEMS = {
  'player.resinc.1': ['IncFoodProduceBuff', DAY], 'player.resinc.1.b': ['IncFoodProduceBuff', 7 * DAY],
  'player.resinc.2': ['IncWoodProduceBuff', DAY], 'player.resinc.2.b': ['IncWoodProduceBuff', 7 * DAY],
  'player.resinc.3': ['IncStoneProduceBuff', DAY], 'player.resinc.3.b': ['IncStoneProduceBuff', 7 * DAY],
  'player.resinc.4': ['IncIronProduceBuff', DAY], 'player.resinc.4.b': ['IncIronProduceBuff', 7 * DAY],
  'player.gold.1.a': ['IncGoldProduceBuff', DAY], 'player.gold.1.b': ['IncGoldProduceBuff', 7 * DAY],
  'player.attackinc.1': ['PlayerIncArmyAttachBuff', DAY], 'player.attackinc.1.b': ['PlayerIncArmyAttachBuff', 7 * DAY],    // War Horn, Ivory Horn
  'player.defendinc.1': ['PlayerIncArmyDefenceBuff', DAY], 'player.defendinc.1.b': ['PlayerIncArmyDefenceBuff', 7 * DAY], // Corselet, Ultra Corselet
  'player.relive.1': ['TroopReliveBuff', 7 * DAY],                    // Penicillin
  'player.reduce.troops.upkeep.1': ['ReduceTroopsUpkeepBuff', DAY],   // Vesta's Blessing
  'player.queue.building.luban': ['doubleBuilding', 3 * DAY],         // Gundulf's Compass: two buildings at once
  'player.emcard.1': ['EMCardBuff', 30 * DAY],
  'player.halloween.castle': ['HauntedCastleBuf', 15 * DAY], 'player.halloween.castle.adv': ['HauntedCastleAdvBuf', 15 * DAY],
  'player.haunted.castle': ['HauntedCastleBuf', 15 * DAY], 'player.haunted.castle.adv': ['HauntedCastleAdvBuf', 15 * DAY],
  'player.speak.bronze_publicity_ambassador.permanent': ['PlayerSpeakerBuf_BPAP', 3650 * DAY], 'player.speak.bronze_publicity_ambassador.permanent.15': ['PlayerSpeakerBuf_BPAP_15', 15 * DAY],
  'player.speak.silver_publicity_ambassador.permanent': ['PlayerSpeakerBuf_SPAP', 3650 * DAY], 'player.speak.silver_publicity_ambassador.15': ['PlayerSpeakerBuf_SPAP_15', 15 * DAY],
  'player.speak.gold_publicity_ambassador.permanent': ['PlayerSpeakerBuf_GPAP', 3650 * DAY], 'player.speak.gold_publicity_ambassador.15': ['PlayerSpeakerBuf_GPAP_15', 15 * DAY],
};
// "+15% to Heal, +25% to Resource Production for 24 hours" - the production part.
const MULTI_BUFF_ITEMS = { 'player.christmas.gift': [['IncFoodProduceBuff', DAY], ['IncWoodProduceBuff', DAY], ['IncStoneProduceBuff', DAY], ['IncIronProduceBuff', DAY]] };
const BUFF_NAMES = {
  IncFoodProduceBuff: 'Food production +25%', IncWoodProduceBuff: 'Lumber production +25%', IncStoneProduceBuff: 'Stone production +25%', IncIronProduceBuff: 'Iron production +25%',
  IncGoldProduceBuff: 'Tax revenue +100%', PlayerIncArmyAttachBuff: 'Troop attack +20%', PlayerIncArmyDefenceBuff: 'Troop defence +20%', TroopReliveBuff: 'Battle losses -30%',
  ReduceTroopsUpkeepBuff: 'Troop upkeep -50%', StopTroopsUpkeepBuff: 'No troop upkeep', doubleBuilding: 'Two buildings at once', EMCardBuff: 'Evony membership',
  HauntedCastleBuf: 'Resource production +10%, Rally Spot limit +25%', HauntedCastleAdvBuf: 'Resource production +10%, Rally Spot limit +25%',
  PlayerPeaceBuff: 'Truce', TopeVotesPrivilegeBuf: 'Governor', PlayerSpeakerBuf_BPAP: 'Publicity Ambassador', PlayerSpeakerBuf_BPAP_15: 'Publicity Ambassador', PlayerSpeakerBuf_SPAP: 'Publicity Ambassador', PlayerSpeakerBuf_SPAP_15: 'Publicity Ambassador', PlayerSpeakerBuf_GPAP: 'Publicity Ambassador', PlayerSpeakerBuf_GPAP_15: 'Publicity Ambassador',
};
const STOP_UPKEEP = /\bno upkeep\b|consume no food|100% free upkeep|no troops? upkeep/i;
const HALF_UPKEEP = /50% upkeep|50% less food|50% free upkeep|upkeep by 50%|half as hungry|eat less|feelings of hunger/i;

class Items {
  constructor(data, rules){
    this.data = data; this.rules = rules;
    // Holiday treats that lower troop upkeep for a day, found by their descriptions (date limits are ignored here).
    this.buffItems = { ...BUFF_ITEMS };
    for (const it of Object.values(data.items || {})){
      if (this.buffItems[it.id] || it.type !== '宝物' || !/^player\./.test(it.id)) continue;
      if (STOP_UPKEEP.test(it.desc)) this.buffItems[it.id] = ['StopTroopsUpkeepBuff', DAY];
      else if (HALF_UPKEEP.test(it.desc)) this.buffItems[it.id] = ['ReduceTroopsUpkeepBuff', DAY];
    }
  }
  saleTypes(){
    return SHOP_CATEGORIES.map(cat => ({ typeName: cat, items: Object.values(this.data.items).filter(i => i.type === cat && i.price > 0).map(i => i.id).join('#') }));
  }
  saleItems(){ return HOT_ITEMS.filter(id => this.data.items[id]).map(id => ({ saleType: 1, items: id })); }
  itemBeans(p){ return Object.entries(p.items || {}).filter(([, n]) => n > 0).map(([id, count]) => ({ id, name: this.data.items[id]?.name || id, count, minCount: 0, maxCount: 0 })); }
  itemBean(p, id){ return { id, name: this.data.items[id]?.name || id, count: p.items?.[id] || 0, minCount: 0, maxCount: 0 }; }
  buffBeans(p, now){
    const list = Object.entries(p.buffs || {}).filter(([, end]) => end > now).map(([typeId, endTime]) => ({ typeId, endTime, descName: BUFF_NAMES[typeId] || typeId }));
    return this.extraBuffs ? list.concat(this.extraBuffs(p, now)) : list;   // (Game adds states shown as buffs: hunger)
  }
  name(id){ return this.data.items[id]?.name || id; }

  buy(p, itemId, amount){
    const it = this.data.items[itemId]; amount = Math.floor(Number(amount));
    if (!it || !(it.price > 0)) return [-44, 'That item is not for sale.'];
    if (!(amount > 0) || amount > 9999) return [-40, 'Choose how many to buy.'];
    const cost = it.price * amount;
    if ((p.coins || 0) < cost) return [-28, `You need ${cost} coins; you have ${p.coins || 0}.`];
    p.coins -= cost; p.items[itemId] = (p.items[itemId] || 0) + amount;
    return null;
  }
  has(p, itemId, n = 1){ return (p.items?.[itemId] || 0) >= n; }
  take(p, itemId, n = 1){ if (!this.has(p, itemId, n)) return false; p.items[itemId] -= n; return true; }
  add(p, itemId, n = 1){ p.items = p.items || {}; p.items[itemId] = (p.items[itemId] || 0) + n; this.onAdd?.(p, itemId, n); }

  // ---------- buffs ----------
  active(p, id, now = Date.now()){ return (p?.buffs?.[id] || 0) > now; }
  startBuff(p, id, ms, now){ p.buffs = p.buffs || {}; p.buffs[id] = Math.max(p.buffs[id] || 0, now) + ms; return id; }
  // Start the buff an item gives; returns the buff ids, or null if the item gives none.
  applyBuffItem(p, itemId, now){
    const list = MULTI_BUFF_ITEMS[itemId] || (this.buffItems[itemId] ? [this.buffItems[itemId]] : null);
    if (!list) return null;
    return list.map(([id, ms]) => this.startBuff(p, id, ms, now));
  }
  // +20% troop attack / defence while War Horn or Corselet is running.
  battleBuff(p, now = Date.now()){ return { attack: this.active(p, 'PlayerIncArmyAttachBuff', now) ? 20 : 0, defence: this.active(p, 'PlayerIncArmyDefenceBuff', now) ? 20 : 0 }; }
  reliveShare(p, now = Date.now()){ return this.active(p, 'TroopReliveBuff', now) ? 0.3 : 0; }
  upkeepRate(p, now = Date.now()){ return this.active(p, 'StopTroopsUpkeepBuff', now) ? 0 : this.active(p, 'ReduceTroopsUpkeepBuff', now) ? 0.5 : 1; }
  castleThemeActive(p, now = Date.now()){ return this.active(p, 'HauntedCastleBuf', now) || this.active(p, 'HauntedCastleAdvBuf', now); }
  // Two buildings at once in each city: Gundulf's Compass, and every new lord for his first 72 hours ("Congratulations!
  // All new players can build two buildings at one time in 72 hours." The client shows that buff by itself, from the
  // account's creation time, so the server only has to honour it.)
  buildSlots(p, now = Date.now()){
    const h = this.rules.newPlayerDoubleBuildHours ?? 72;
    const fresh = h > 0 && p?.createdAt > 0 && now - p.createdAt < h * 3600000;
    return fresh || this.active(p, 'doubleBuilding', now) ? 2 : 1;
  }

  // ---------- speed-ups ----------
  // A function that turns remaining ms into new remaining ms for a speed-up item, or an error string.
  speedup(p, itemId, remainingMs, coinsNeeded, table = SPEEDUP){
    if (itemId === 'free.speed'){
      if (remainingMs > this.rules.freeSpeedupSeconds * 1000) return { err: 'The free speed-up is only for the last 5 minutes.' };
      return { reduce: () => 0 };
    }
    if (itemId === 'coins.speed'){
      if ((p.coins || 0) < coinsNeeded) return { err: `You need ${coinsNeeded} coins to finish now.` };
      return { reduce: () => 0, coins: coinsNeeded };
    }
    const s = table[itemId];
    if (!s) return { err: "That item can't speed this up." };
    if (!(p.items?.[itemId] > 0)) return { err: "You don't have that item." };
    if (s.share) return { reduce: r => r * (1 - s.share), item: itemId };
    const ms = s.ms ?? (s.msMin + Math.random() * (s.msMax - s.msMin));
    return { reduce: r => r - ms, item: itemId };
  }
  troopSpeedup(p, itemId, remainingMs, coinsNeeded){ return this.speedup(p, itemId, remainingMs, coinsNeeded, TROOP_SPEEDUP); }
  // The coins "Instant Finish" asks for. Live (Fox's captures, Oct 26 2026): 20 coins with 1.91 hours left, 50 with
  // 4.41 and 85 with 11.02. All three are what the Guidelines would cost: as many of the biggest one that fits
  // (8 h 50, 2.5 h 20, 1 h 10), Beginner Guidelines (15 min, 5) for the rest, unless one Guideline alone covers it
  // for less. Only three readings fit this so far (UNVERIFIED beyond them). rules.coinsPerMinuteOfSpeedup set to a
  // number prices it per minute instead.
  coinsFor(remainingMs){
    if (this.rules.coinsPerMinuteOfSpeedup) return Math.max(1, Math.ceil(remainingMs / 60000 * this.rules.coinsPerMinuteOfSpeedup));
    const price = id => this.data.items?.[id]?.price || { 'consume.2.a': 5, 'consume.2.b': 10, 'consume.2.b.1': 20, 'consume.2.c': 50 }[id];
    const tiers = ['consume.2.c', 'consume.2.b.1', 'consume.2.b'].map(id => [SPEEDUP[id].ms, price(id)]);
    const q = SPEEDUP['consume.2.a'].ms, qPrice = price('consume.2.a');
    let left = Math.max(0, remainingMs), coins = 0;
    for (const [ms, c] of tiers) while (left >= ms){ left -= ms; coins += c; }
    coins += Math.ceil(left / q) * qPrice;
    const single = [[q, qPrice], ...tiers].filter(([ms]) => ms >= remainingMs).map(([, c]) => c);
    return Math.max(1, Math.min(coins, ...single));
  }
}

module.exports = { Items, SPEEDUP, BUFF_ITEMS, BUFF_NAMES, DAY, HOUR };
