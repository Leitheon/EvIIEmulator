'use strict';
// Using items: chests and packages, the Wheel of Fortune (Amulets), lockboxes and keys, hero helms,
// city tokens, timed bonuses and items used on a city. Hero items (medals, experience books, Excalibur...)
// are in useOnHero; teleporters, the National Flag, New ID and the Truce Agreement have their own client
// windows and commands (handlers/city.js).
const world = require('./world');
const { ChestReader } = require('./chests');
const { STATUS: BSTATUS, POS_TOWN_HALL, POS_WALLS } = require('./castle');
const { HERO_STATUS, HERO_BUFF_OF } = require('./heroes');
const { DAY } = require('./items');

const rint = (a, b, rnd = Math.random) => a + Math.floor(rnd() * (b - a + 1));
const fmt = n => Math.round(n).toLocaleString('en-US');
// Shown in the award window in place of resources and cents (the client can only show items there).
const RES_PROXY = { food: 'player.reward.bonus.food', wood: 'player.reward.bonus.wood', stone: 'player.reward.bonus.stone', iron: 'player.reward.bonus.iron', gold: 'player.reward.bonus.gold' };
const RES_NAME = { food: 'food', wood: 'lumber', stone: 'stone', iron: 'iron', gold: 'gold' };
const MEDALS = ['hero.loyalty.1', 'hero.loyalty.2', 'hero.loyalty.3', 'hero.loyalty.4', 'hero.loyalty.5', 'hero.loyalty.6', 'hero.loyalty.7', 'hero.loyalty.8', 'hero.loyalty.9'];
const MEDAL_LOYALTY = { 'hero.loyalty.1': 5, 'hero.loyalty.2': 10, 'hero.loyalty.3': 15, 'hero.loyalty.4': 20, 'hero.loyalty.5': 25, 'hero.loyalty.6': 30, 'hero.loyalty.7': 40, 'hero.loyalty.8': 50, 'hero.loyalty.9': 60 };
// Experience books: max(fixed, share of the experience the hero needs for his next level).
const EXP_BOOKS = { 'player.experience.1.a': [1000, 0.08], 'player.experience.1.b': [10000, 0.3], 'player.experience.1.c': [100000, 1] };
const STRENGTH_ITEMS = new Set(['hero.item.Tea', 'hero.item.Lugui_Wine', 'hero.item.Panax_ginseng', 'hero.item.Essential_Oil']);
const LOCKBOX = { 'player.box.1': ['consume.key.1', [3, 4]], 'player.box.2': ['consume.key.2', [2, 3]], 'player.box.3': ['consume.key.3', [1, 2]] };
const CITY_TOKENS = { 'player.gen.castle.1': 11, 'player.gen.castle.2': 12, 'player.gen.castle.3': 14 };
// Hero helms: [min level, max level, special attribute range or null, all attributes].
const HELMS = {
  'player.box.hero.a': [10, 15], 'player.box.hero.b': [16, 25], 'player.box.hero.c': [26, 35, [70, 80]], 'player.box.hero.d': [36, 50, [81, 90]],
  'player.box.hero.e': [51, 70, [101, 110]], 'player.box.hero.f': [5, 10, [115, 125]],
  'player.box.hero.rg': [1, 1, null, 70], 'player.box.hero.king': [1, 1, null, 85, 'king'], 'player.box.hero.queen': [1, 1, null, 85, 'queen'],
};
const MEDAL_BOXES = { 'player.box.special.1': MEDALS.slice(0, 3), 'player.box.special.2': MEDALS.slice(3, 6), 'player.box.special.3': MEDALS.slice(6, 9) };
// Prize tiers for the Wheel of Fortune, lockboxes and chests that only promise "a random prize".
// Tier 1 is the grand prize. [item id, min, max]
const PRIZES = {
  1: [['hero.loyalty.9', 1, 1], ['hero.loyalty.8', 1, 1], ['player.experience.1.c', 1, 1], ['consume.2.d', 1, 1], ['player.more.castle.1.a', 1, 1], ['player.box.hero.d', 1, 1], ['player.speedup.1', 1, 1], ['player.gold.1.b', 1, 1]],
  2: [['hero.loyalty.7', 1, 1], ['hero.loyalty.6', 1, 1], ['hero.power.1', 1, 1], ['hero.intelligence.1', 1, 1], ['hero.management.1', 1, 1], ['player.relive.1', 1, 1],
      ['consume.2.c', 1, 1], ['consume.2.c.1', 1, 1], ['player.experience.1.b', 1, 1], ['consume.blueprint.1', 1, 1], ['consume.move.1', 1, 1], ['player.box.hero.c', 1, 1],
      ['player.attackinc.1.b', 1, 1], ['player.defendinc.1.b', 1, 1], ['hero.reset.1.a', 1, 1], ['enhanced.star.2', 2, 4]],
  3: [['hero.loyalty.5', 1, 1], ['hero.loyalty.4', 1, 1], ['consume.2.b.1', 1, 1], ['player.attackinc.1', 1, 1], ['player.defendinc.1', 1, 1], ['player.troop.1.a', 1, 1],
      ['player.troop.1.b', 1, 1], ['player.fort.1.c', 1, 1], ['player.peace.1', 1, 1], ['hero.reset.1', 1, 1], ['player.gold.1.a', 1, 1], ['player.pop.1.a', 1, 1],
      ['consume.transaction.1', 1, 1], ['player.destroy.1.a', 1, 1], ['player.box.hero.b', 1, 1], ['player.experience.1.a', 1, 2], ['equipment.tech.upgrade.book1', 1, 1], ['enhanced.star.1', 3, 6]],
  4: [['hero.loyalty.1', 1, 2], ['hero.loyalty.2', 1, 2], ['hero.loyalty.3', 1, 1], ['consume.2.a', 1, 3], ['consume.2.b', 1, 2], ['player.resinc.1', 1, 1], ['player.resinc.2', 1, 1],
      ['player.resinc.3', 1, 1], ['player.resinc.4', 1, 1], ['consume.refreshtavern.1', 1, 2], ['consume.1.a', 3, 10], ['enhanced.star.1', 1, 3], ['equipment.tech.upgrade.1', 1, 3],
      ['equipment.tech.upgrade.2', 1, 3], ['equipment.tech.upgrade.3', 1, 3], ['equipment.tech.upgrade.4', 1, 2], ['equipment.tech.upgrade.5', 1, 3], ['player.box.gambling.3', 1, 1],
      ['player.box.hero.a', 1, 1], ['consume.key.1', 1, 1]],
};
const TIER_ODDS = [[1, 0.02], [2, 0.08], [3, 0.30], [4, 0.60]];
// The Wheel of Fortune's own prizes, as on the live boards: the client's wheel items for 1,000,000 of a
// resource (paid to the city) and for cents ("Cent game coin(s)"), plus gear materials by 5. Amounts in
// rules.wheel; resources and 100 cents sit with tier 3, the rest with tier 4.
const WHEEL_RES = { 'player.box.gambling.food': 'food', 'player.box.gambling.wood': 'wood', 'player.box.gambling.stone': 'stone', 'player.box.gambling.iron': 'iron', 'player.box.gambling.gold': 'gold' };
const WHEEL_CENTS = 'player.box.gambling.medal.10';
const MATERIALS = ['equipment.tech.upgrade.1', 'equipment.tech.upgrade.2', 'equipment.tech.upgrade.3', 'equipment.tech.upgrade.4', 'equipment.tech.upgrade.5'];

class ItemUse {
  constructor(game){
    this.g = game;
    const items = game.data.items;
    this.chests = new ChestReader(items);
    this.prizes = {};
    for (const [tier, list] of Object.entries(PRIZES)) this.prizes[tier] = list.filter(([id]) => items[id]);
    // Which keys open which chests: a key whose description names a chest ("This key fits the 5th
    // Anniversary Chest"), or a chest whose description names its key ("They require a Saxony Chest Key").
    this.keysFor = new Map();
    const chests = Object.values(items).filter(i => i.type === '宝箱');
    const keys = Object.values(items).filter(i => /\bkey\b/i.test(i.name) && !/^consume\.key\./.test(i.id) && i.id !== 'player.key.silver');
    const norm = s => String(s).toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
    for (const ch of chests){
      const n = norm(ch.name); if (n.length < 8 || /^consume\.key\./.test(ch.id)) continue;
      const fit = keys.filter(k => norm(k.desc).includes(n) || (norm(ch.desc).includes(norm(k.name)) && /require|need|open(ed)? (it )?with|key to open/i.test(ch.desc)));
      if (fit.length) this.keysFor.set(ch.id, fit.map(k => k.id));
    }
    for (const [box, [key]] of Object.entries(LOCKBOX)) this.keysFor.set(box, [key]);
  }
  get items(){ return this.g.items; }
  name(id){ return this.items.name(id); }

  // ---------- picking prizes ----------
  tierPick(rnd = Math.random, tiers = [1, 2, 3, 4]){
    const odds = TIER_ODDS.filter(([t]) => tiers.includes(t)), total = odds.reduce((a, [, w]) => a + w, 0);
    let r = rnd() * total;
    for (const [t, w] of odds){ if ((r -= w) < 0) return t; }
    return odds[odds.length - 1][0];
  }
  prize(tier, rnd = Math.random){
    const list = this.prizes[tier]; const [id, a, b] = list[Math.floor(rnd() * list.length)];
    return { kind: 'item', id, min: a, max: b };
  }

  // ---------- giving things ----------
  // Add one entry to the lord and record it in out.
  give(p, c, e, out, rnd = Math.random, depth = 0){
    const n = rint(e.min, Math.max(e.min, e.max), rnd);
    if (n <= 0) return;
    if (e.kind === 'item'){ this.items.add(p, e.id, n); out.items.add(e.id); out.awards.push({ id: e.id, count: n }); out.text.push(`${fmt(n)} ${this.name(e.id)}`); }
    else if (e.kind === 'res' || e.kind === 'anyres'){
      const key = e.kind === 'res' ? e.key : ['food', 'wood', 'stone', 'iron'][Math.floor(rnd() * 4)];
      c.res[key] = (c.res[key] || 0) + n; out.res = true; out.awards.push({ id: RES_PROXY[key], count: n }); out.text.push(`${fmt(n)} ${RES_NAME[key]}`);
    }
    else if (e.kind === 'cents'){ p.coins = (p.coins || 0) + n; out.coins = true; out.awards.push({ id: 'money', count: n }); out.text.push(`${fmt(n)} cents`); }
    else if (e.kind === 'eachres'){ for (const k of ['food', 'wood', 'stone', 'iron']) this.give(p, c, { kind: 'res', key: k, min: e.min, max: e.max }, out, rnd, depth); }
    else if (e.kind === 'troop'){ c.troops[e.key] = (c.troops[e.key] || 0) + n; out.troops = true; out.troopText.push(`${fmt(n)} ${this.troopName(e.key)}`); out.text.push(`${fmt(n)} ${this.troopName(e.key)}`); }
    else if (e.kind === 'medal'){ for (let i = 0; i < n; i++) this.give(p, c, { kind: 'item', id: MEDALS[Math.min(8, Math.floor(Math.pow(rnd(), 1.6) * 9))], min: 1, max: 1 }, out, rnd); }
    else if (e.kind === 'open' && depth < 3){ this.openContents(p, c, e.id, out, rnd, depth + 1); }
  }
  troopName(field){ const t = Object.values(this.g.data.troops).find(x => x.field === field); return t ? t.name : field; }
  newOut(){ return { awards: [], items: new Set(), text: [], troopText: [], res: false, coins: false, troops: false, buffs: false, heroes: [], newCastle: null, wheel: null, note: '' }; }

  // What a chest gives, read from its description; flavour-text chests give a random prize.
  openContents(p, c, id, out, rnd = Math.random, depth = 0){
    if (MEDAL_BOXES[id]){
      const total = rint(6, 12, rnd), kinds = MEDAL_BOXES[id], counts = kinds.map(() => 2);
      for (let left = total - 6; left > 0; left--){ const i = Math.floor(rnd() * 3); if (counts[i] < 4) counts[i]++; }
      kinds.forEach((m, i) => this.give(p, c, { kind: 'item', id: m, min: counts[i], max: counts[i] }, out, rnd));
      return;
    }
    if (id === 'player.box.present.money.174'){ this.give(p, c, { kind: 'item', id: 'player.box.gambling.3', min: 45, max: 60 }, out, rnd); return; }   // Gambler's Charm
    const prestige = String(this.g.data.items[id]?.desc || '').match(/add (\d[\d,]*) prestige/i);
    if (prestige){ const n = Number(prestige[1].replace(/,/g, '')); p.prestige = (p.prestige || 0) + n; out.text.push(`${fmt(n)} prestige`); out.player = true; return; }
    const sets = this.chests.sets(id);
    if (sets.length){
      const set = sets[Math.floor(rnd() * sets.length)];
      for (const e of set) this.give(p, c, e, out, rnd, depth);
      // "...and a chance of awarding an Aries Amulet."
      if (/chance of awarding an? (aries )?amulet/i.test(this.g.data.items[id]?.desc || '') && rnd() < 0.25) this.give(p, c, { kind: 'item', id: 'player.box.gambling.3', min: 1, max: 1 }, out, rnd);
      return;
    }
    // Nothing listed: one random prize ("Rabbits foot": five).
    const spins = /5 chances|five chances/i.test(this.g.data.items[id]?.desc || '') ? 5 : 1;
    for (let i = 0; i < spins; i++) this.give(p, c, this.prize(this.tierPick(rnd), rnd), out, rnd);
  }

  // ---------- the Wheel of Fortune ----------
  // What can land on the board for each tier: the shared prizes plus the wheel's own, leaving out items whose
  // icon the client couldn't load (http.js), which would show as a blank tile.
  wheelPool(tier){
    const cfg = this.g.rules.wheel || {}, items = this.g.data.items;
    const res = cfg.resources ?? 1000000, [c1, c2, c3] = cfg.cents || [10, 30, 100], mat = cfg.materials ?? 5;
    let pool = this.prizes[tier].filter(([id]) => !MATERIALS.includes(id));
    if (tier === 3){ if (res > 0) pool.push(...Object.keys(WHEEL_RES).map(id => [id, res, res])); if (c3 > 0) pool.push([WHEEL_CENTS, c3, c3]); }
    if (tier === 4){ if (c1 > 0) pool.push([WHEEL_CENTS, c1, c1]); if (c2 > 0) pool.push([WHEEL_CENTS, c2, c2], [WHEEL_CENTS, c2, c2]); if (mat > 0) pool.push(...MATERIALS.map(id => [id, mat, mat])); }
    return pool.filter(([id]) => items[id] && !this.g.art?.has(items[id].icon));
  }
  // A board of prizes (GamblingItemBean: id, count, kind 1-4) and the one won, which is always on the board.
  spin(rnd = Math.random){
    const cfg = this.g.rules.wheel || {}, slots = cfg.slots || 24;
    const per = { 1: 1, 2: Math.round(slots * 0.15), 3: Math.round(slots * 0.3) };
    per[4] = Math.max(1, slots - per[1] - per[2] - per[3]);
    const board = [];
    for (const tier of [1, 2, 3, 4]){
      const pool = this.wheelPool(tier);
      for (let i = 0; i < per[tier] && pool.length; i++){
        const [id, a, b] = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        board.push({ id, count: rint(a, b, rnd), kind: tier });
      }
    }
    // The client's wheel has 24 tiles and shows a placeholder in any tile left without a prize, so fill
    // every slot (repeats are fine: the live boards repeat cents and resources too).
    const spare = [...this.wheelPool(4).map(e => [e, 4]), ...this.wheelPool(3).map(e => [e, 3])];
    while (board.length < slots && spare.length){
      const [[id, a, b], kind] = spare[Math.floor(rnd() * spare.length)];
      board.push({ id, count: rint(a, b, rnd), kind });
    }
    for (let i = board.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [board[i], board[j]] = [board[j], board[i]]; }
    const tier = this.tierPick(rnd, [...new Set(board.map(s => s.kind))]);
    const options = board.filter(s => s.kind === tier);
    return { board, won: options[Math.floor(rnd() * options.length)] };
  }

  // ---------- using an item from the inventory (shop.useGoods) ----------
  use(p, c, itemId, now, rnd = Math.random){
    const it = this.g.data.items[itemId];
    if (!it) return [-40, 'Unknown item.'];
    const out = this.newOut();
    // The Pioneer Express Teleport opens the teleport window and also sends this; the move itself uses it.
    if (itemId === 'player.move.castle.1.b') return out;
    if (['consume.move.1', 'player.more.castle.1.a', 'player.more.castle.1.c'].includes(itemId)) return [-40, 'Choose where to go in the teleport window.'];
    if (this.isHeroItem(itemId)) return [-40, `Use ${it.name} from a hero's page in the Feasting Hall.`];
    if (!this.items.has(p, itemId)) return [-44, `You don't have ${it.name}.`];
    if (itemId === 'player.box.present.4' && this.g.logic.townHall(c) <= 2) return [-40, `${it.name} needs a Town Hall above level 2.`];

    // Amulets: spin the wheel.
    if (/^player\.box\.gambling\.\d+$/.test(itemId)){
      this.items.take(p, itemId); out.items.add(itemId);
      const { board, won } = this.spin(rnd);
      const res = WHEEL_RES[won.id];
      if (res){ c.res[res] = (c.res[res] || 0) + won.count; out.res = true; }
      else if (won.id === WHEEL_CENTS){ p.coins = (p.coins || 0) + won.count; out.coins = true; }
      else { this.items.add(p, won.id, won.count); out.items.add(won.id); }
      out.wheel = board; out.awards.push({ id: won.id, count: won.count });
      out.text.push(`${fmt(won.count)} ${res ? RES_NAME[res] : won.id === WHEEL_CENTS ? 'cents' : this.name(won.id)}`);
      p.spins = p.spins || {}; const day = new Date(now).toISOString().slice(0, 10); p.spins[day] = (p.spins[day] || 0) + 1;
      return out;
    }
    if (HELMS[itemId]) return this.helm(p, c, itemId, out, rnd);
    if (itemId === 'player.box.hero.npc') return this.epicHero(p, c, itemId, out, rnd);
    if (CITY_TOKENS[itemId]) return this.cityToken(p, c, itemId, out, now);
    if (itemId === 'consume.hegemony.1' || /^alliance\.ritual_of_pact\./.test(itemId)){
      const r = this.g.alliances.pact(p, itemId, now); if (Array.isArray(r)) return r;
      this.items.take(p, itemId); out.items.add(itemId); out.note = r.note; return out;
    }
    if (MEDAL_LOYALTY[itemId] || STRENGTH_ITEMS.has(itemId)) return [-40, `Use ${it.name} from a hero's page in the Feasting Hall.`];

    // Timed bonuses.
    const buffs = this.items.applyBuffItem(p, itemId, now);
    if (buffs){ this.items.take(p, itemId); out.items.add(itemId); out.buffs = true; return out; }

    // Chests, packages and lockboxes.
    if (it.type === '宝箱'){
      const keys = this.keysFor.get(itemId);
      let key = null;
      if (keys){
        key = keys.find(k => this.items.has(p, k)) || (LOCKBOX[itemId] ? null : this.items.has(p, 'player.key.silver') ? 'player.key.silver' : null);
        if (!key) return [-44, `Opening ${it.name} needs ${keys.map(k => this.name(k)).filter((v, i, a) => a.indexOf(v) === i).join(' or ')}${LOCKBOX[itemId] ? '' : ' (or a Silver Key)'}.`];
      }
      this.items.take(p, itemId); out.items.add(itemId);
      if (key){ this.items.take(p, key); out.items.add(key); }
      if (LOCKBOX[itemId]){ const tiers = LOCKBOX[itemId][1]; this.give(p, c, this.prize(this.tierPick(rnd, tiers), rnd), out, rnd); }
      else this.openContents(p, c, itemId, out, rnd);
      return out;
    }
    // Speaker packages open into that many Speakers (the World channel also opens one by itself when it needs to).
    const pack = { 'consume.1.b': 10, 'consume.1.c': 100 }[itemId];
    if (pack){ this.items.take(p, itemId); this.items.add(p, 'consume.1.a', pack); out.items.add(itemId); out.items.add('consume.1.a'); return out; }
    if (/^(consume\.1\.|player\.speak)/.test(itemId)) return [-40, 'Speakers are used up when you talk in the World channel.'];
    if (itemId === 'consume.blueprint.1') return [-40, "Michelangelo's Script is used automatically when you upgrade a building to level 10."];
    if (itemId === 'player.queue.building') return [-40, "Bernini's Hammer is used when you queue a building: Queue Upgrade in a building's window, or build while your builders are busy."];
    if (itemId === 'player.item.stoneoffinding') return [-40, 'Pick the lost hero in the list that opens: a Stone of Finding brings back a hero another lord captured in the last 24 hours.'];
    if (/^(enhanced\.|equipment\.tech\.)/.test(itemId)) return [-40, `${it.name} is used in the Workshop (gear research and stars).`];
    if (itemId === 'consume.transaction.1') return [-40, "Use the Merchant Fleet on a shipment in your Marketplace's Trading Status."];
    if (/^player\.trick\./.test(itemId)) return [-40, 'Use stratagems with the Stratagem button in a city\'s window (your own or another lord\'s) or an army\'s.'];
    if (itemId === 'player.truce.dream') return [-40, 'Set the Dream Truce in its own window: the Use button in your items opens it.'];
    if (/^(primary|senior)\.truce/.test(itemId)) return [-40, "This client has no window for this truce; use a Truce Agreement from your lord's profile."];
    if (itemId === 'instant.handover') return [-40, 'Instant Handover finishes handing back a colony you are abandoning: use it from the colony\'s bar under your armies.'];
    if (/\bkey\b/i.test(it.name)){
      const opens = [...this.keysFor].filter(([, keys]) => keys.includes(itemId) || itemId === 'player.key.silver').map(([ch]) => this.name(ch));
      return [-40, opens.length && itemId !== 'player.key.silver' ? `${it.name} is used when you open ${[...new Set(opens)].join(' or ')}.` : `${it.name} is used when you open a chest that needs a key.`];
    }
    if (itemId === 'hero.gen.npc2') return [-40, 'The Legendary Ring is used by Recruit Hero (the button at the top of the screen): it makes one hero.'];
    return [-40, `${it.name} is an event token with nothing to use it for on this server.`];
  }

  // ---------- items used on a city (shop.useCastleGoods) ----------
  useOnCastle(p, c, itemId, now){
    const it = this.g.data.items[itemId]; if (!it) return [-40, 'Unknown item.'];
    if (!this.items.has(p, itemId)) return [-44, `You don't have ${it.name}.`];
    const out = this.newOut(), max = this.g.logic.popMax(c);
    if (itemId === 'player.pop.1.a'){                                  // Civil Code
      if (c.pop >= max) return [-40, 'Your population is already at its limit.'];
      c.pop = Math.min(max, c.pop + Math.max(100, Math.floor(max * 0.2)));
    } else if (itemId === 'player.heart.1.a'){ c.loyalty = 100; c.complaint = 0; }   // Speech Text
    else if (this.items.applyBuffItem(p, itemId, now)){ out.buffs = true; }          // Haunted / Christmas Castle
    else return [-40, `${it.name} isn't used on a city.`];
    this.items.take(p, itemId); out.items.add(itemId); out.res = true;
    return out;
  }

  // ---------- hero items (hero.useItem) ----------
  isHeroItem(id){ return !!(MEDAL_LOYALTY[id] || EXP_BOOKS[id] || STRENGTH_ITEMS.has(id) || Object.values(HERO_BUFF_OF).includes(id)); }
  useOnHero(p, c, h, itemId, now){
    const it = this.g.data.items[itemId]; if (!it) return [-40, 'Unknown item.'];
    if (!this.items.has(p, itemId)) return [-44, `You don't have ${it.name}.`];
    if (MEDAL_LOYALTY[itemId]){
      if (h.loyalty >= 100) return [-1, `${h.name} is already completely loyal.`];
      h.loyalty = Math.min(100, h.loyalty + MEDAL_LOYALTY[itemId]);
    } else if (EXP_BOOKS[itemId]){
      if (!h.ringHero && !h.historic && h.level >= this.g.heroes.maxLevel(h)) return [-1, `${h.name} is at the highest level and gains no more experience.`];
      const [fixed, share] = EXP_BOOKS[itemId];
      this.g.heroes.gainExp(h, Math.max(fixed, Math.round(this.g.heroes.expToNext(h.level) * share)));
    } else if (Object.values(HERO_BUFF_OF).includes(itemId)){
      h.buffs = h.buffs || {};
      h.buffs[itemId] = Math.max(h.buffs[itemId] || 0, now) + 7 * DAY;
    } else if (STRENGTH_ITEMS.has(itemId)) return [-1, `${h.name} is already at full strength.`];
    else return [-40, `${it.name} can't be used on a hero.`];
    this.items.take(p, itemId);
    return { hero: h, items: [itemId] };
  }

  // ---------- heroes from helms ----------
  helm(p, c, itemId, out, rnd){
    const H = this.g.heroes;
    if (!H.vacancies(c)) return [-1, H.hallSize(c) ? 'Your Feasting Hall is full. Upgrade it or dismiss a hero first.' : 'Build a Feasting Hall to house the hero.'];
    const [lo, hi, special, all, royal] = HELMS[itemId];
    const level = rint(lo, hi, rnd);
    const taken = new Set(H.list(c).map(x => x.name));
    const h = H.makeHero(1, null, taken);
    h.level = level; h.exp = 0; h.loyalty = 100;
    if (all) h.base = { pol: all, atk: all, int: all };
    else {
      const total = Math.round(60 + level * 1.5 + (rnd() - 0.5) * 20), w = [rnd() + 0.3, rnd() + 0.3, rnd() + 0.3], s = w[0] + w[1] + w[2];
      h.base = { pol: Math.max(5, Math.round(total * w[0] / s)), atk: Math.max(5, Math.round(total * w[1] / s)), int: 0 };
      h.base.int = Math.max(5, total - h.base.pol - h.base.atk);
      if (special){ const k = ['pol', 'atk', 'int'][Math.floor(rnd() * 3)]; h.base[k] = rint(special[0], special[1], rnd); }
    }
    if (royal){ h.king = royal; h.sex = royal === 'queen'; h.name = royal === 'queen' ? 'Queen' : 'King'; h.face = H.face(h.sex); }
    const hero = { id: this.g.store.id(), ...h, status: HERO_STATUS.FREE, hiredAt: Date.now() };
    H.list(c).push(hero);
    this.items.take(p, itemId); out.items.add(itemId); out.heroes.push(hero);
    out.note = `${hero.name} (level ${hero.level}) has joined you in ${c.name}'s Feasting Hall.`;
    return out;
  }
  epicHero(p, c, itemId, out, rnd){
    const H = this.g.heroes, hh = this.g.hh;
    if (!H.vacancies(c)) return [-1, H.hallSize(c) ? 'Your Feasting Hall is full. Upgrade it or dismiss a hero first.' : 'Build a Feasting Hall to house the hero.'];
    const free = hh.free(); if (!free.length) return [-1, 'Every historic hero already has a lord.'];
    const h = free[Math.floor(rnd() * free.length)], s = hh.state(h.id), alloc = hh.alloc(h.id);
    if (s.fieldId != null) hh.byField.delete(s.fieldId);
    const hero = { id: this.g.store.id(), ...hh.offer(h, alloc), status: HERO_STATUS.FREE, hiredAt: Date.now() };
    H.list(c).push(hero);
    hh.hired(h.id, c, hero.id, p);
    this.items.take(p, itemId); out.items.add(itemId); out.heroes.push(hero);
    out.note = `${hero.name} (level ${hero.level}) has joined you in ${c.name}'s Feasting Hall.`;
    return out;
  }

  // ---------- city tokens (Bronze, Silver and Gold Amulets) ----------
  // "Generate a city in a random location with Rally Spot and all resource buildings to level N."
  cityToken(p, c, itemId, out, now){
    // Each title rules one more city (Civilian 1 ... Prinzessin 10).
    const max = this.g.quests.maxCities(p);
    if (p.castles.length >= max) return [-1, p.castles.length >= (this.g.rules.maxCities || 10) ? `You already rule ${p.castles.length} cities, the most a lord can hold.`
      : `As ${['a', 'an'][/^[AEIOU]/.test(this.g.quests.titleName(p)) ? 1 : 0]} ${this.g.quests.titleName(p)} you can rule ${max} ${max === 1 ? 'city' : 'cities'}. Earn the next title (Quests, Title) to rule another.`];
    // Fox: the amulets were given to lords who lost a Historic City in a server merge. The new city has a level 10
    // Town Hall and Walls, a Rally Spot of level 11 (Bronze), 12 (Silver) or 14 (Gold), and every resource field
    // at that level. Fox's live capture of his Gold Amulet city (Oct 26 2026): an ordinary city to the
    // client (power level 4), its level 14 Rally Spot on plot 31, and nothing in it upgradeable past 10, so its
    // Rally Spot and fields stay at the amulet's level ("The building has already reached maximum level.").
    const L = CITY_TOKENS[itemId];
    const nc = this.g.createCastle(p, { now });
    const B = (typeId, level) => ({ typeId, level, status: BSTATUS.NORMAL, startTime: 0, endTime: 0 });
    // All 40 field plots at that level (the item: "all resource buildings to level N"; Fox: 9 Farms, 15 Sawmills, 15
    // Ironmines and 1 Quarry).
    nc.buildings = { [POS_TOWN_HALL]: B(31, 10), [POS_WALLS]: B(32, 10), 31: B(29, L) };
    const mix = [[7, 9], [4, 15], [6, 15], [5, 1]];
    let plot = 1001; for (const [typeId, n] of mix) for (let i = 0; i < n; i++) nc.buildings[plot++] = B(typeId, L);
    this.items.take(p, itemId); out.items.add(itemId); out.newCastle = nc;
    const { x, y } = world.xy(nc.fieldId);
    out.note = `${nc.name} was founded at (${x},${y}) with a level 10 Town Hall and Walls, a level ${L} Rally Spot and 40 resource fields at level ${L}.`;
    return out;
  }

  // The award window (AwardShowWin) opens when more than one bean comes back, so a lone award gets a
  // zero-count companion that the window leaves out.
  replyBeans(p, itemId, out){
    const shown = out.awards.filter(a => a.id === 'money' || this.g.data.items[a.id]);
    if (!shown.length) return [this.items.itemBean(p, itemId)];
    const beans = shown.map(a => ({ id: a.id, name: a.id === 'money' ? 'Cents' : this.name(a.id), count: a.count, minCount: 0, maxCount: 0 }));
    if (beans.length === 1 && !out.wheel) beans.push({ ...this.items.itemBean(p, itemId), count: 0 });
    return beans;
  }
}

module.exports = { ItemUse, PRIZES, HELMS, CITY_TOKENS, EXP_BOOKS, MEDAL_LOYALTY, LOCKBOX, WHEEL_RES, WHEEL_CENTS };
