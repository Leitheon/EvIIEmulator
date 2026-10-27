'use strict';
// Heroes: the Inn's offers, hiring, the Feasting Hall, the mayor, attribute points and levels.
// From the client: hiring costs level x 1,000 gold, salary is level x 20 gold an hour, an Inn of level N
// shows N heroes and a Feasting Hall of level N holds N heroes.
const INN = 21, FEASTING_HALL = 27;
const STATUS = { FREE: 0, CHIEF: 1, GUARD: 2, SENT: 3, SEIZED: 4, BACK: 5 };

// Ordinary heroes have a single name and one of the client's generic portraits (the same ones lords pick
// from). Two-part names and the numbered images/icon/hero/N.png portraits belong to historic heroes.
// Jonathan to Aaron (and Theobald) are NPC city heroes from Fox's live scout and battle reports (Oct 2026).
const MALE = ['Jonathan', 'Chapman', 'Matt', 'Griffith', 'Harry', 'Cleveland', 'Norman', 'Adrian', 'Alfred', 'Aaron', 'Jeffrey', 'Aldric', 'Alaric', 'Anselm', 'Arnulf', 'Baldric', 'Baldwin', 'Bertram', 'Bram', 'Cedric', 'Conrad', 'Corwin', 'Dietrich',
  'Dorran', 'Edgar', 'Edmund', 'Egbert', 'Emeric', 'Everard', 'Fenwick', 'Florian', 'Gareth', 'Garret', 'Gerald', 'Gilbert', 'Godric',
  'Gunther', 'Hadrian', 'Hamon', 'Harald', 'Henrik', 'Hubert', 'Ingram', 'Ivo', 'Jasper', 'Jorund', 'Konrad', 'Lambert', 'Leofric',
  'Leopold', 'Lothar', 'Lucan', 'Magnus', 'Mathias', 'Merrick', 'Niall', 'Norbert', 'Odo', 'Osbert', 'Osric', 'Oswald', 'Otto',
  'Percival', 'Perrin', 'Quentin', 'Raban', 'Randolf', 'Reinhold', 'Ranulf', 'Roderick', 'Roland', 'Rowan', 'Rupert', 'Sigmund',
  'Stellan', 'Talbot', 'Theobald', 'Thorald', 'Tristan', 'Ulric', 'Urban', 'Valerian', 'Viktor', 'Walter', 'Warin', 'Wendel',
  'Wilfred', 'Wolfram', 'Wystan', 'Yorick', 'Zoran', 'Ansgar', 'Bardolf', 'Casimir', 'Dunstan', 'Eustace', 'Folkert', 'Gerhard',
  'Humbert', 'Isembard', 'Jocelyn', 'Kenric', 'Lorcan', 'Meinhard', 'Nevil', 'Orrin', 'Piers', 'Radulf', 'Sebald', 'Tancred', 'Wido'];
const FEMALE = ['Una', 'Adela', 'Agnes', 'Alys', 'Amabel', 'Ava', 'Beatrix', 'Brienne', 'Cecily', 'Clemence', 'Edda', 'Edith', 'Elke',
  'Emmeline', 'Ermengarde', 'Gisela', 'Gunilla', 'Helga', 'Hesper', 'Hildegund', 'Ida', 'Ilse', 'Irmgard', 'Isolde', 'Jutta',
  'Kestrel', 'Liesel', 'Linnea', 'Maren', 'Mathilde', 'Odila', 'Orla', 'Petronel', 'Richenza', 'Rosamund', 'Sabine', 'Sibylla',
  'Tamsin', 'Tilde', 'Ursel', 'Vessa', 'Wilhelmina', 'Wren', 'Yara', 'Ysolde'];
const OLD_LAST = /^(\S+) (Ashdown|Blackmere|Coldwell|Dunmore|Elsworth|Fairholt|Greaves|Hollin|Ironside|Kettering|Lowe|Marchbank|Northam|Oakhurst|Pell|Redfern|Stroud|Thorne|Underhill|Vane|Westlake|Yarrow|Brack|Coombe|de Vere|of Aachen|von Hesse|Montfort)$/;
const pick = list => list[Math.floor(Math.random() * list.length)];
// Hero item buffs, keyed by the item that gives them.
const HERO_BUFF_OF = { atk: 'hero.power.1', int: 'hero.intelligence.1', pol: 'hero.management.1' };
const HERO_BUFF_NAMES = { 'hero.power.1': 'Excalibur: attack +25%', 'hero.intelligence.1': 'The Art of War: intelligence +25%', 'hero.management.1': 'The Wealth of Nations: politics +25%' };
// The portrait URL the client loads. Older saves stored a historic portrait number.
const portraitUrl = face => face == null ? undefined : typeof face === 'number' ? `images/icon/hero/${face}.png` : face;

class HeroLogic {
  constructor(data, rules, castleLogic){ this.data = data; this.rules = rules; this.castle = castleLogic; this.speed = castleLogic.speed; }

  list(c){ return c.heroes || (c.heroes = []); }
  find(c, id){ return this.list(c).find(h => h.id === id) || null; }
  chief(c){ return this.list(c).find(h => h.status === STATUS.CHIEF) || null; }
  innLevel(c){ return this.castle.level(c, INN); }
  hallSize(c){ return this.castle.level(c, FEASTING_HALL); }
  vacancies(c){ return Math.max(0, this.hallSize(c) - this.list(c).length); }
  expToNext(level){ return Math.round(this.rules.heroExpBase * level * level); }
  // Captives draw no salary (UNVERIFIED).
  salary(c){ return this.list(c).reduce((a, h) => a + (h.status === STATUS.SEIZED ? 0 : h.level * this.rules.heroSalaryPerLevel), 0); }
  total(h, k){ return h.base[k] + h.added[k]; }
  // Hero item buffs (Excalibur, The Art of War, The Wealth of Nations): +25% of base + added points.
  buffPct(h, k, now = Date.now()){ const b = HERO_BUFF_OF[k]; return b && (h.buffs?.[b] || 0) > now ? this.rules.heroItemBuffPercent ?? 25 : 0; }
  // Attribute points that count in battle and as mayor: base + added, item buffs, then worn gear.
  // ownerOf/gearOf are set by Game (gear depends on the lord's Workshop research).
  gear(h){ return this.gearOf ? this.gearOf(h) : { pol: 0, atk: 0, int: 0, speed: 0 }; }
  // (Beauty Trap, a stratagem: the hero's attack is 30-80% lower for a while.)
  effective(h, k, now = Date.now()){
    const trap = k === 'atk' && (h.beautyTrap?.until || 0) > now ? 1 - h.beautyTrap.pct : 1;
    return (this.total(h, k) * (1 + this.buffPct(h, k, now) / 100) + (this.gear(h)[k] || 0)) * trap;
  }
  // An ordinary hero's leadership is his level, 1 to 100 (Fox). A historic hero's is his own base (the historic
  // heroes sheet) plus 1 for every level after the first (Fox). He leads (leadership x 10 + level) x leadership
  // troops in full (rules.leadership); see Combat.ledShare.
  leadership(h){
    const lv = Math.max(1, Math.min(this.maxLevel(h), h.level || 1));
    return h.leadership != null ? h.leadership + (h.historic ? lv - 1 : 0) : lv;
  }
  // Bonuses, in %, that a city's mayor gives.
  mayorBonus(c, kind){
    const m = this.chief(c); if (!m) return 0;
    if (kind.startsWith('points:')) return this.effective(m, kind.slice(7));   // the attribute itself (build, research speed)
    if (kind === 'production') return this.effective(m, 'pol') * this.rules.mayorProductionPerPolitics;
    if (kind === 'attack') return this.effective(m, 'atk');   // points: training speed (TroopLogic.unitSeconds)
    return 0;
  }

  // ---------- the Inn ----------
  face(female){
    const p = this.data.portraits || {}, list = (female ? p.female : p.male) || [];
    return list.length ? pick(list) : female ? 'images/icon/player/faceB1.jpg' : 'images/icon/player/faceA1.jpg';
  }
  freshName(female, taken){
    const list = female ? FEMALE : MALE;
    for (let i = 0; i < 50; i++){ const n = pick(list); if (!taken.has(n)){ taken.add(n); return n; } }
    const n = pick(list) + ' ' + (2 + Math.floor(Math.random() * 8)); taken.add(n); return n;
  }
  makeHero(innLevel, faces, taken){
    const maxL = Math.max(1, innLevel * this.rules.innMaxLevelPerInnLevel);
    const level = Math.max(1, Math.round(1 + Math.pow(Math.random(), 1.8) * (maxL - 1)));
    const sex = Math.random() < (this.rules.heroFemaleChance ?? 0.25);
    return { name: this.freshName(sex, taken), level, exp: 0, base: this.baseStats(level), added: { pol: 0, atk: 0, int: 0 }, points: 0,
      loyalty: this.rules.heroStartLoyalty, face: this.face(sex), sex };
  }
  // A total of roughly 60 + 1.5 x level points, spread unevenly so most heroes have a speciality.
  baseStats(level){
    const total = Math.round(60 + level * 1.5 + (Math.random() - 0.5) * 20);
    const w = [Math.random() + 0.3, Math.random() + 0.3, Math.random() + 0.3], s = w[0] + w[1] + w[2];
    const pol = Math.max(5, Math.round(total * w[0] / s)), atk = Math.max(5, Math.round(total * w[1] / s)), int = Math.max(5, total - pol - atk);
    return { pol, atk, int };
  }

  // ---------- captured heroes ----------
  // An NPC city's hero captured by this city's lord: held in the Feasting Hall (status 4, the client's
  // HERO_SEIZED_STATU) until persuaded or released. Needs an empty seat there (the client's text for the
  // capture policy). Its points are an Inn hero's of that level (UNVERIFIED).
  // tmpl: an NPC hero ({ name, level }) or a historic hero's full template (HistoricHeroLogic.offer, with
  // persuadeItem: the portrait persuading takes).
  seize(c, tmpl, nextId){
    if (!this.vacancies(c)) return null;
    const taken = new Set(this.list(c).map(h => h.name));
    let name = tmpl.name;
    if (!tmpl.historic) for (let i = 2; taken.has(name); i++) name = `${tmpl.name} ${i}`;
    // Live, a captive's loyalty is 0 (Fox's screenshot of William Cecil, Captive).
    const h = { exp: 0, base: this.baseStats(tmpl.level), added: { pol: 0, atk: 0, int: 0 }, points: 0, face: this.face(false), sex: false,
      ...tmpl, loyaltyAfter: tmpl.loyalty ?? this.rules.heroStartLoyalty, loyalty: 0, id: nextId(), name, status: STATUS.SEIZED, seizedAt: Date.now() };
    this.list(c).push(h);
    return h;
  }
  seized(h){ return !!h && h.status === STATUS.SEIZED; }
  // Persuading costs level x 1,000 gold (the client: "The persuasion of this hero {0} costs {1} gold"; it
  // always works here, UNVERIFIED).
  // A historic hero also takes the hero's portrait (persuadeItem; the client shows "needs {n} {item}").
  persuade(c, id, items = {}){
    const h = this.find(c, id); if (!this.seized(h)) return [-1, 'That hero isn\'t a captive.'];
    const cost = h.level * (this.rules.persuadeGoldPerLevel ?? 1000);
    if (h.persuadeItem && !((items[h.persuadeItem] || 0) > 0)) return [-1, `Persuading ${h.name} takes ${h.name}'s portrait (Enquire Details at the Inn).`];
    const [medal, medals] = h.persuadeItem ? ['', 0] : this.persuadeNeed(h);
    if (medal && (items[medal] || 0) < medals) return [-1, `Persuading ${h.name} takes ${medals} ${this.data?.items?.[medal]?.name || medal}${medals > 1 ? 's' : ''}.`];
    if (c.res.gold < cost) return [-1, `Persuading ${h.name} costs ${cost.toLocaleString('en-US')} gold.`];
    c.res.gold -= cost; h.status = STATUS.FREE; h.hiredAt = Date.now(); h.loyalty = h.loyaltyAfter ?? this.rules.heroStartLoyalty; delete h.seizedAt; delete h.loyaltyAfter;
    const item = h.persuadeItem; delete h.persuadeItem;
    return { hero: h, item, medal, medals };
  }
  release(c, id){
    const h = this.find(c, id); if (!this.seized(h)) return [-1, 'That hero isn\'t a captive.'];
    c.heroes = this.list(c).filter(x => x !== h);
    return { hero: h };
  }
  // Heroes from saves before 0.3.5 got a historic portrait and an invented two-part name: give them a
  // generic portrait, and drop the surname I made up (a name the player chose is kept).
  migrate(c){
    let changed = false;
    const taken = new Set(this.list(c).map(h => h.name));
    for (const h of this.list(c)){
      if (typeof h.face !== 'number') continue;
      h.face = this.face(!!h.sex); changed = true;
      const m = OLD_LAST.exec(h.name);
      if (m && !taken.has(m[1])){ taken.delete(h.name); h.name = m[1]; taken.add(h.name); }
    }
    if (c.inn && c.inn.offers?.some(o => typeof o.face === 'number')){ delete c.inn; changed = true; }
    return changed;
  }
  refreshInn(c, now, faces){
    const L = this.innLevel(c);
    const taken = new Set(this.list(c).map(h => h.name));
    c.inn = { offers: L ? Array.from({ length: L }, () => this.makeHero(L, faces, taken)) : [], refreshAt: now + this.rules.innRefreshMinutes * 60000 / this.speed };
    return c.inn;
  }
  innOffers(c, now, faces){
    if (!c.inn || c.inn.refreshAt <= now || c.inn.offers.length !== this.innLevel(c) && !c.inn.hired) this.refreshInn(c, now, faces);
    return c.inn.offers;
  }
  // Ordinary offers, then historic heroes who came to this city's Inn (they stay until hired).
  innList(c, now, faces){ return [...this.innOffers(c, now, faces), ...(c.innHistoric || [])]; }
  hire(c, name, nextId){
    let offers = c.inn?.offers || [];
    let i = offers.findIndex(o => o.name === name);
    if (i < 0 && c.innHistoric){ offers = c.innHistoric; i = offers.findIndex(o => o.name === name); }
    if (i < 0) return [-1, 'That hero has already left the Inn.'];
    if (!this.vacancies(c)) return [-1, this.hallSize(c) ? 'Your Feasting Hall is full. Upgrade it or dismiss a hero first.' : 'Build a Feasting Hall to house heroes.'];
    const o = offers[i], cost = o.level * this.rules.heroHireCostPerLevel;
    if (c.res.gold < cost) return [-1, `Hiring ${o.name} costs ${cost.toLocaleString('en-US')} gold.`];
    c.res.gold -= cost;
    offers.splice(i, 1); if (offers === c.inn?.offers) c.inn.hired = true;
    const h = { id: nextId(), ...o, status: STATUS.FREE, hiredAt: Date.now() };
    this.list(c).push(h);
    return { hero: h };
  }

  // ---------- the Feasting Hall ----------
  fire(c, id){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    if (h.status === STATUS.SENT) return [-1, 'That hero is leading an army. Recall the army first.'];
    c.heroes = this.list(c).filter(x => x !== h);
    return { hero: h };
  }
  promote(c, id){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    if (h.status === STATUS.SENT) return [-1, 'That hero is away leading an army.'];
    const old = this.chief(c), changed = [];
    if (old && old !== h){ old.status = STATUS.FREE; changed.push(old); }
    h.status = STATUS.CHIEF; changed.push(h);
    return { changed };
  }
  discharge(c){ const m = this.chief(c); if (!m) return [-1, 'This city has no mayor.']; m.status = STATUS.FREE; return { changed: [m] }; }
  addPoints(c, id, pol, atk, int){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    const v = [pol, atk, int].map(x => Math.max(0, Math.floor(Number(x) || 0)));
    const sum = v[0] + v[1] + v[2];
    if (!sum) return [-1, 'Choose where to put the points.'];
    if (sum > h.points) return [-1, `${h.name} has only ${h.points} point${h.points === 1 ? '' : 's'} to spend.`];
    h.added.pol += v[0]; h.added.atk += v[1]; h.added.int += v[2]; h.points -= sum;
    return { hero: h };
  }
  // The highest level: 100, 120 for a hero from a Legendary Ring, 150 for a historic hero (Fox's live captures: eight
  // Ring heroes at 120, 109 ordinary heroes at 100; the live hero ranking's top 594 are historic heroes at 150).
  maxLevel(h){
    if (h?.ringHero) return this.rules.ringHero?.maxLevel ?? 120;
    if (h?.historic) return this.rules.historicHeroes?.maxLevel ?? 150;
    return this.rules.heroMaxLevel ?? 100;
  }
  // Points a level: 2 for Ring and historic heroes (live: a historic hero at 150 holds 300 more than his sheet base),
  // rules.heroPointsPerLevel for the rest.
  pointsPerLevel(h){
    if (h?.ringHero) return this.rules.ringHero?.pointsPerLevel ?? 2;
    if (h?.historic) return this.rules.historicHeroes?.pointsPerLevel ?? 2;
    return this.rules.heroPointsPerLevel;
  }
  // Levelling up spends the experience the level needs (live: 150 x level^2). A Ring hero gets 2 points a level
  // (Fox's capture: Jessica went 1 to 13 with 24 points), any other hero rules.heroPointsPerLevel. An ordinary hero
  // at 100 keeps no experience (all 109 of Fox's show 0); a Ring hero at 120 goes on gathering it (8.5 million).
  levelUp(c, id){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    if (h.level >= this.maxLevel(h)) return [-99, `${h.name} is already at the highest level, ${this.maxLevel(h)}.`];
    const need = this.expToNext(h.level);
    if (h.exp < need) return [-99, 'You have insufficient experience points to upgrade.'];
    h.exp -= need; h.level += 1; h.points += this.pointsPerLevel(h);
    if (h.level >= this.maxLevel(h) && !h.ringHero && !h.historic) h.exp = 0;
    return { hero: h };
  }
  // What persuading a captive takes besides gold, as the HeroBean's itemId and itemAmount (live, Fox's captures):
  // a historic hero his portrait; any other hero above level 50 one medal tier for every 10 levels past 50, as many
  // medals as the tier (54: 1 Cross Medal, 100: 5 Courage Medals, 120: 7 Freedom Medals); nothing at 50 and below.
  persuadeNeed(h){
    if (h.persuadeItem) return [h.persuadeItem, 1];
    const n = Math.min(9, Math.ceil(((h.level || 1) - 50) / 10));
    return n > 0 ? [`hero.loyalty.${n}`, n] : ['', 0];
  }
  award(c, id){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    if (h.loyalty >= 100) return [-1, `${h.name} is already completely loyal.`];
    const cost = h.level * this.rules.heroAwardGoldPerLevel;
    if (c.res.gold < cost) return [-1, `A reward for ${h.name} costs ${cost.toLocaleString('en-US')} gold.`];
    c.res.gold -= cost; h.loyalty = Math.min(100, h.loyalty + this.rules.heroAwardLoyalty);
    return { hero: h };
  }
  resetPoints(c, id, items){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    const need = Math.max(1, Math.ceil(h.level / 10));   // "One more consumed every 10 levels"
    if ((items['hero.reset.1'] || 0) < need) return [-44, `Resetting ${h.name} takes ${need} Holy Water.`];
    items['hero.reset.1'] -= need;
    h.points += h.added.pol + h.added.atk + h.added.int; h.added = { pol: 0, atk: 0, int: 0 };
    return { hero: h, used: need };
  }
  rename(c, id, name){
    const h = this.find(c, id); if (!h) return [-1, 'No such hero.'];
    if (h.historic) return [-1, 'A historic hero keeps his own name.'];
    name = String(name || '').trim();
    if (!name || name.length > 20) return [-1, 'Hero names must be 1 to 20 characters.'];
    h.name = name; return { hero: h };
  }
  gainExp(h, xp){ if (h.ringHero || h.historic || h.level < this.maxLevel(h)) h.exp += Math.max(0, Math.round(xp)); }

  // The HeroBean the client reads. Shown attributes are management+politics, power+attack, stratagem+intelligence.
  bean(h, rules = this.rules){
    const now = Date.now(), g = this.gear(h), r1 = x => Math.round(x * 100) / 100;
    const buffs = Object.entries(h.buffs || {}).filter(([, end]) => end > now).map(([typeId, endTime]) => ({ typeId, endTime, descName: HERO_BUFF_NAMES[typeId] || typeId }));
    return { id: h.id, name: h.name, level: h.level, experience: h.exp, upgradeExp: this.expToNext(h.level), status: this.statusOf ? this.statusOf(h) : h.status, loyalty: h.loyalty,
      management: this.total(h, 'pol'), power: this.total(h, 'atk'), stratagem: this.total(h, 'int'), politics: r1(g.pol), attack: r1(g.atk), intelligence: r1(g.int),
      managementAdded: h.added.pol, powerAdded: h.added.atk, stratagemAdded: h.added.int,
      managementBuffAdded: this.buffPct(h, 'pol', now), powerBuffAdded: this.buffPct(h, 'atk', now), stratagemBuffAdded: this.buffPct(h, 'int', now),
      remainPoint: h.points, logoUrl: portraitUrl(h.face), isHero: h.king ? 2 : h.historic ? 1 : h.ringHero ? 4 : 0, npc_id: h.historic || 0, sex: !!h.sex, speed: r1(g.speed), stamina: 100, maxStrength: 100, morale: 100,
      leadership: this.leadership(h), leadershipAdded: this.leadership(h) * 10, ability: 0, defence: 0, fieldtype: 1, itemAmount: this.persuadeNeed(h)[1], itemId: this.persuadeNeed(h)[0], infro: h.infro || '', facebook_id: '', fbFriendName: '',
      buffs, equipmentbean: this.gearBeans ? this.gearBeans(h) : [] };
  }
  offerBean(o, i){ return this.bean({ id: -(i + 1), status: STATUS.FREE, ...o }); }
}

module.exports = { HeroLogic, HERO_STATUS: STATUS, INN, FEASTING_HALL, portraitUrl, HERO_BUFF_OF, HERO_BUFF_NAMES, MALE, FEMALE };
