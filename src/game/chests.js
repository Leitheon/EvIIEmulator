'use strict';
// What a chest gives when it is opened. The client's item table has no contents list, only each chest's
// description ("Includes: Adv City Teleporter*1, War Horn*1, 500,000 Food"), so the contents are read
// from that text: item names are matched against the item table, and resources, cents, troops and
// ranges ("50 to 100 Ballistas") are recognised. A description offering a choice ("Chest A (...) or
// Chest B (...)") gives one of the sets at random. Chests that only say "one random prize" draw from
// the Amulet prize table instead.

const RES_WORDS = { food: 'food', lumber: 'wood', wood: 'wood', woods: 'wood', stone: 'stone', stones: 'stone', iron: 'iron', gold: 'gold' };
const CENT_WORDS = /^(cents?|coins?)( game coins?)?$|^game coins?$/i;
// Names used in descriptions that differ from the item table's own names.
const ALIASES = {
  'amulet': 'player.box.gambling.3', 'amulets': 'player.box.gambling.3', 'aries amulet': 'player.box.gambling.3', 'daily amulet': 'player.box.gambling.3',
  'adv city teleporter': 'player.more.castle.1.a', 'advanced teleporter': 'player.more.castle.1.a', 'adv. city teleport': 'player.more.castle.1.a', 'adv city teleport': 'player.more.castle.1.a',
  'advanced city teleporter': 'player.more.castle.1.a', 'adv teleporter': 'player.more.castle.1.a',
  'city teleporter': 'consume.move.1', 'random city teleporter': 'consume.move.1', 'city teleport': 'consume.move.1', 'random teleporter': 'consume.move.1',
  'war teleporter': 'player.more.castle.1.c', 'war teleport': 'player.more.castle.1.c', 'warteleporter': 'player.more.castle.1.c',
  'plowshare': 'player.resinc.1', 'plowshares': 'player.resinc.1', 'arch saw': 'player.resinc.2', 'quarrying tools': 'player.resinc.3', 'blower': 'player.resinc.4',
  'speaker': 'consume.1.a', 'speakers': 'consume.1.a', 'gemstone': 'equipment.tech.upgrade.3', 'gemstones': 'equipment.tech.upgrade.3', 'iron ore': 'equipment.tech.upgrade.1',
  'iron ores': 'equipment.tech.upgrade.1', 'thoroughbreds': 'equipment.tech.upgrade.4', 'the lost armor script': 'equipment.tech.upgrade.book1',
  'the lost armor scripts': 'equipment.tech.upgrade.book1', 'lost armor script': 'equipment.tech.upgrade.book1',
  'honore medals': 'hero.loyalty.4', 'honor medals': 'hero.loyalty.4', 'courage medals': 'hero.loyalty.5', 'wisdom medals': 'hero.loyalty.6',
  'masterwork of the stonecutter': 'player.speedup.1', 'masterwork of the stone mason': 'player.speedup.1', 'master work of the stonecutter': 'player.speedup.1',
  'beginner guildelines': 'consume.2.a', 'beginners guidelines': 'consume.2.a', 'archimede\'s note': 'player.fort.1.c', 'archimedes note': 'player.fort.1.c',
  'wealth of nations': 'hero.management.1', 'the wealth of nation': 'hero.management.1', 'art of war': 'hero.intelligence.1', 'epitome of military science': 'player.experience.1.b',
  'truce': 'player.peace.1', 'truce agreements': 'player.peace.1', 'merchant fleets': 'consume.transaction.1', 'hero huntings': 'consume.refreshtavern.1',
  'holy waters': 'hero.reset.1', 'war ensigns': 'player.troop.1.a', 'war horns': 'player.attackinc.1', 'corselets': 'player.defendinc.1', 'napoleons diary': 'player.troop.1.b',
  'michelangelo script': 'consume.blueprint.1', 'michelangelos script': 'consume.blueprint.1', 'delicate gems': 'enhanced.star.1', 'flawless gems': 'enhanced.star.2',
  'natinal flag': 'consume.changeflag.1', 'mechant fleet': 'consume.transaction.1', 'warr horn': 'player.attackinc.1', "vesta' blessing": 'player.reduce.troops.upkeep.1',
  "vesta's blessing": 'player.reduce.troops.upkeep.1', 'vesta': 'player.reduce.troops.upkeep.1', 'adv cityteleporter': 'player.more.castle.1.a', 'fabrics': 'equipment.tech.upgrade.5',
  'holy war 5 piece package': 'hero.reset.1.a', 'holy water 5 piece package': 'hero.reset.1.a', 'advteleporter': 'player.more.castle.1.a',
  'royal guard': 'player.box.hero.rg', 'royal guards': 'player.box.hero.rg', 'special christmas chest key': 'player.key.santa',
  // Spellings and slips in chest descriptions (Fox: every chest's description says what it holds).
  'mechanic battalion': 'player.box.troop.d', 'mechanics battallion': 'player.box.troop.d', 'mechanic battallion': 'player.box.troop.d',
  "warmonger's package": 'player.item.warmongerspack', 'warmongers package': 'player.item.warmongerspack', "warmonger's pack": 'player.item.warmongerspack',
  "stygandr's banner": 'player.item.stygandrsbannerofthehorde', "stygandr's banners": 'player.item.stygandrsbannerofthehorde',
  "stygandr's banners of the horde": 'player.item.stygandrsbannerofthehorde',
  'holy helm of mar': 'player.box.hero.d', 'on wa': 'player.experience.1.c', 'on wars': 'player.experience.1.c', 'holy war 5 piece packag': 'hero.reset.1.a',
  '50 upkeep item': 'player.reduce.troops.upkeep.1', 'querrying tools': 'player.resinc.3', 'ctiy teleporter': 'consume.move.1',
  'stone of findingm': 'player.item.stoneoffinding', "gundalf's compass": 'player.queue.building.luban', 'ancient ring': 'hero.gen.npc2',
  'key of winnter': 'player.key.special.chest.keyofwinter', 'special new year chest key': 'player.key.newyear', 'halloween skeleton key': 'player.key.halloween',
  'adv teleporter': 'player.more.castle.1.a', 'angel/devil token': 'player.box.present.money.99', 'angel devil token': 'player.box.present.money.99',
  "rabbit's foot": 'player.box.present.rabbitsfoot', 'angel': 'player.box.present.money.143',
};
// Chests whose descriptions don't read as a list.
const OVERRIDES = {
  'player.builders.tools': [[{ kind: 'item', id: 'player.queue.building.luban', min: 1, max: 1 }]],   // "Gundalf's Compass (125 Cent value)"
  // Angel / Devil token (no description; its twin .141 says "one angel or devil token randomly").
  'player.box.present.money.99': [[{ kind: 'item', id: 'player.box.present.money.143', min: 1, max: 1 }], [{ kind: 'item', id: 'player.box.present.money.142', min: 1, max: 1 }]],
  // Devil's Pact: "one of the following ... randomly": Opportunist's Plague x2, Lost in the Wastes x3, Poisoned Feast x3,
  // Broken Gates x3 (its description lists them with their effects, which the reader can't follow).
  'player.box.present.money.73': [74, 75, 76, 77].map((n, i) => [{ kind: 'item', id: `player.box.present.money.${n}`, min: i ? 3 : 2, max: i ? 3 : 2 }]),
  // The Devil token and the Angel token: one of those items, picked at random.
  'player.box.present.money.142': [77, 74, 75, 76].map(n => [{ kind: 'item', id: `player.box.present.money.${n}`, min: 1, max: 1 }]),
  'player.box.present.money.143': [70, 71, 72].map(n => [{ kind: 'item', id: `player.box.present.money.${n}`, min: 1, max: 1 }]),
};
// Troop names as descriptions write them (singular and plural).
const TROOP_WORDS = {
  worker: 'peasants', workers: 'peasants', peasant: 'peasants', peasants: 'peasants', warrior: 'militia', warriors: 'militia', militia: 'militia',
  scout: 'scouter', scouts: 'scouter', pikeman: 'pikemen', pikemen: 'pikemen', swordsman: 'swordsmen', swordsmen: 'swordsmen', archer: 'archer', archers: 'archer',
  transporter: 'carriage', transporters: 'carriage', cavalry: 'lightCavalry', cavalries: 'lightCavalry', cataphract: 'heavyCavalry', cataphracts: 'heavyCavalry',
  cataphractes: 'heavyCavalry', ballista: 'ballista', ballistas: 'ballista', ballistae: 'ballista', 'battering ram': 'batteringRam', 'battering rams': 'batteringRam',
  catapult: 'catapult', catapults: 'catapult',
};
const RANDOM_HINT = /random|one of the following|randomly|grant you one|may contain|chance|\bor\b/i;
const LISTY = /includ(?:ed|es|e)|contains?|following items|offers?|awards?|give you the following|will give you|will receive|you will get|will grant you|you will gain/i;
const LEAD = /^.*?(includ(?:ed|es|e)|contains?|following items|offers?|awards?|give you the following benefits|will give you|will receive|you will get|will grant you(?: the following)?|you will gain one of the following[^!:]*[!:]?)\s*:?/i;

const fold = s => String(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/\(.*?\)/g, ' ').replace(/guildlines?/g, 'guidelines').replace(/[^a-z0-9' .-]/g, ' ').replace(/\s+/g, ' ').trim();
const num = s => Number(String(s).replace(/[, ]/g, ''));

class ChestReader {
  constructor(items){
    this.items = items;
    this.byName = new Map();
    // Prefer purchasable, non-event versions when several items share a name.
    const sorted = Object.values(items).sort((a, b) => (b.price > 0) - (a.price > 0) || a.id.length - b.id.length);
    for (const it of sorted){
      const k = fold(it.name);
      if (k && !this.byName.has(k)) this.byName.set(k, it.id);
    }
    for (const [k, id] of Object.entries(ALIASES)) if (items[id]) this.byName.set(k, id);
    this.cache = new Map();
  }

  // An item id for a name as written in a description, or null.
  itemFor(name){
    let k = fold(name).replace(/^(a|an|the|x)\s+/, '').replace(/\s+(x|pcs|pieces)$/, '');
    if (!k) return null;
    const tries = [k, k.replace(/^the /, ''), k.replace(/s$/, ''), k.replace(/es$/, ''), 'the ' + k, k.replace(/ (pack|package)$/, '')];
    for (const t of tries) if (this.byName.has(t)) return this.byName.get(t);
    return null;
  }

  // One "thing" in a list: "War Horn*2", "2 x War Horn", "500,000 Food", "Food 250000", "10 - 100 Ballistas", "100 cents".
  entry(text){
    let s = String(text).trim().replace(/[.;:!]+$/, '').replace(/^.*:\s*(?=\S)/, '').replace(/^\s*(and|or|includ(?:ed|es|e)|awards?|offers?|you will receive|x)\s+/i, '')
      .replace(/\s+(once applied|once opened|at random|randomly)\b.*$/i, '').replace(/\.\s+[A-Z][a-z]+\s+[a-z].*$/, '').replace(/[.;:!]+$/, '').trim();
    if (!s) return null;
    s = s.replace(/^one\s+/i, '1 ');
    let min = 1, max = 1, name = s, m;
    const N = '(\\d[\\d,]*)';
    if ((m = s.match(new RegExp(`^${N}\\s*(?:-|to|~)\\s*${N}\\s+(.+)$`, 'i')))){ min = num(m[1]); max = num(m[2]); name = m[3]; }
    else if ((m = s.match(new RegExp(`^(.+?)\\s+${N}\\s*(?:-|to|~)\\s*${N}$`, 'i')))){ name = m[1]; min = num(m[2]); max = num(m[3]); }
    else if ((m = s.match(new RegExp(`^(.+?)\\s*[*×]\\s*${N}$`, 'i'))) || (m = s.match(new RegExp(`^(.+?)\\s+x\\s*${N}$`, 'i')))){ name = m[1]; min = max = num(m[2]); }
    else if ((m = s.match(new RegExp(`^${N}\\s*(?:x|×|\\*)\\s*(.+)$`, 'i')))){ min = max = num(m[1]); name = m[2]; }
    else if ((m = s.match(new RegExp(`^${N}\\s*([A-Za-z].*)$`, 'i')))){ min = max = num(m[1]); name = m[2]; }
    else if ((m = s.match(new RegExp(`^(.+?[A-Za-z'’.)])\\s*${N}$`, 'i')))){ name = m[1]; min = max = num(m[2]); }
    // "50 Million of each resource", "1 Billion Food", "5 Mil of Each Resource", "500K Gold".
    const mult = name.match(/^(billion|million|mil|thousand|k|m)\b\.?\s*(.*)$/i);
    if (mult){ const f = /^billion$/i.test(mult[1]) ? 1e9 : /^(million|mil|m)$/i.test(mult[1]) ? 1e6 : 1e3; min *= f; max *= f; name = mult[2]; }
    if (/^(of\s+)?eachresource$/i.test(name.trim())) return { kind: 'eachres', min, max };
    if (/^units? of (a|one) resources?$/i.test(name.trim())) return { kind: 'anyres', min, max };
    name = name.replace(/^(of|x)\s+/i, '').trim();
    const k = fold(name);
    if (/^each (resource|kind of resource)s?$|^all (four )?resources$|^every resource$/.test(k)) return { kind: 'eachres', min, max };
    if (RES_WORDS[k]) return { kind: 'res', key: RES_WORDS[k], min, max };
    if (CENT_WORDS.test(k)) return { kind: 'cents', min, max };
    if (TROOP_WORDS[k]) return { kind: 'troop', key: TROOP_WORDS[k], min, max };
    if (/^random medals?$/.test(k)) return { kind: 'medal', min, max };
    if (/^resources?$/.test(k)) return { kind: 'anyres', min: min > 1 ? min : 50000, max: max > 1 ? max : 200000 };
    const id = this.itemFor(name);
    return id ? { kind: 'item', id, min, max } : null;
  }

  // A comma/plus separated list, read into entries; anything unrecognised is left out.
  list(text){
    const clean = String(text).replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/\s*\bof each (kind of )?resources?\b/gi, ' EACHRESOURCE').replace(/(\d\s*x)\s{2,}/gi, '$1 ')
      .replace(/\brespectively\b|\beach\b/gi, '').replace(/\band\b|\bor\b/gi, ',');
    // "Mars1 x On War2x War Teleporter", "2 x Amulets 1 x Adv City Teleporter" - entries run together.
    // Double spaces split entries only where the whole part doesn't read ("Food 10000  Lumber 10000", but not
    // "Primary  Guidelines").
    const parts = clean.split(/[,+\n;•]|(?<=[A-Za-z.)'’])\s*(?=\d+\s*x\s*[A-Z])/)
      .flatMap(p => /\S\s{2,}\S/.test(p) && !this.entry(p.replace(/\s+/g, ' ')) ? p.split(/\s{2,}/) : [p.replace(/\s+/g, ' ')]);
    const out = [];
    for (const p of parts){
      let e = this.entry(p);
      // "Adv City TeleporterNapoleon's Diary": two names run together.
      if (!e && /[a-z][A-Z]/.test(p)){
        const bits = p.split(/(?<=[a-z])(?=[A-Z][a-z])/).map(b => this.entry(b));
        if (bits.every(Boolean)){ out.push(...bits); continue; }
      }
      if (e) out.push(e); else if (p.trim() && this.unread) this.unread.push(p.trim());
    }
    // "Food, Lumber, Stone and Iron 10,000 respectively": the last amount applies to the bare ones before it.
    for (let i = out.length - 1, amount = 0; i >= 0; i--){
      const e = out[i];
      if (e.kind !== 'res'){ amount = 0; continue; }
      if (e.min > 1) amount = e.min; else if (amount){ e.min = e.max = amount; }
    }
    // "Wood*6" next to Iron Ore and Fabric is the gear material, not lumber.
    for (const e of out) if (e.kind === 'res' && e.key === 'wood' && e.max < 1000 && this.items['equipment.tech.upgrade.2']) Object.assign(e, { kind: 'item', id: 'equipment.tech.upgrade.2' });
    return out;
  }

  // The possible sets of contents, read once per chest. [] means no description lists anything, and the chest
  // gives a random prize instead. The client shows a chest's itemDesc when it has one (Fox: "Includes:10 x
  // Stygandr's Banner of the Horde,3 x War Teleporter,...") and its desc otherwise, so itemDesc is read first.
  sets(id){
    if (this.cache.has(id)) return this.cache.get(id);
    const it = this.items[id] || {};
    let sets = OVERRIDES[id] || [];
    // Each text read in full is preferred to one read only in part (the Thanksgiving War Chest's itemDesc names its
    // three sets, its desc lists what is in them).
    if (!sets.length){
      const reads = [[it.itemDesc, false], [it.desc, true]].map(([text, strict]) => {
        const missed = this.unread, left = []; this.unread = left;
        const got = this.setsFrom(String(text || '').replace(/\r/g, ''), strict);
        this.unread = missed; if (missed) missed.push(...left);
        return { got, whole: !left.length };
      }).filter(r => r.got.length);
      sets = (reads.find(r => r.whole) || reads[0])?.got || [];
    }
    this.cache.set(id, sets);
    return sets;
  }
  // strict: only a text that reads like a list ("Includes:", "2 x", "*2"); otherwise also a bare list that reads
  // through with nothing left over ("Food 640,000", "Amulet 1").
  setsFrom(desc, strict = true){
    if (!desc.trim()) return [];
    let sets = [];
    // "you will receive the contents of Saxon Beer Chest A, B, C, D or E at random": open one of those chests.
    const ref = desc.match(/contents of (.+?)\s([A-E])((?:\s*,?\s*(?:or\s+)?[A-E]\b)+)/i);
    if (ref){
      const letters = [ref[2], ...ref[3].match(/[A-E]/g)];
      sets = letters.map(L => this.itemFor(`${ref[1]} ${L}`)).filter(Boolean).map(sub => [{ kind: 'open', id: sub, min: 1, max: 1 }]);
    }
    // "gives one of. Chest A 1 x War Ensign,5 x Amulet. Chest B 2 x ...": a choice of the lettered sets.
    const lettered = desc.split(/\bChest [A-E]\b\s*:?/);
    if (!sets.length && lettered.length >= 3) sets = lettered.slice(1).map(g => this.list(g.replace(/^\s*\([^)]*\)\s*/, '').replace(/\.\s*$/, ''))).filter(x => x.length);
    // "Chest A (x, y) or Chest B (z)" / "Name: (x, y) Name2: (z)" - a choice of groups.
    const groups = [...desc.matchAll(/\(([^()]{6,})\)/g)].map(m => m[1]).filter(g => /[,*]|\d/.test(g));
    if (!sets.length && groups.length >= 2) sets = groups.map(g => this.list(g)).filter(s => s.length);
    // Otherwise a single list, but only when the text reads like one; flavour text gives a random prize.
    const listy = LISTY.test(desc) || /\d\s*x\s|\*\s*\d/i.test(desc);
    if (!sets.length && listy){
      const body = desc.replace(LEAD, '');
      const one = this.list(body.replace(/\([^)]*\)/g, ''));
      if (one.length) sets = RANDOM_HINT.test(desc) && one.length > 1 && !/includ(?:ed|es|e)\s*:?|will grant you(?! one)|following:/i.test(desc) ? one.map(e => [e]) : [one];
    }
    if (!sets.length && !strict){
      const missed = this.unread, left = []; this.unread = left;
      const one = this.list(desc);
      this.unread = missed;
      if (one.length && !left.length) sets = [one];
    }
    return sets;
  }
}

module.exports = { ChestReader, TROOP_WORDS };
