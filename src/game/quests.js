'use strict';
// Routine quests (Quests > Routine Quests), including the rank and title promotions.
//
// Sources, in order of weight:
//   - the Evony wiki's Routine Quest page (Fox's saved copy, Oct 2026): the categories in order, every quest's
//     name, target and award. Where the wiki and the client disagree on an award, the wiki wins, except where
//     the wiki is plainly incomplete or garbled (noted below);
//   - Fox's screenshots of the live Quests window: the live category names (Queen, Consolation, Resources
//     Levy), which are the wiki's categories in the wiki's order, and the first Queen quest's texts;
//   - the client's sharing texts (FbData): quest ids 1-222 and the awards the wiki leaves out.
// The client's tutorial expects Rebuild to be typeId 66; the other typeIds and the ids above 222 are this
// server's own. Quests that need systems this server doesn't have yet (alliances, mail and chat, the market's
// trades, injured troops, stratagems, achievements, uprisings, commissions) are defined but not offered.
// A category shows the first unfinished quest of each of its chains; a quest with `show` targets is offered
// only once those are met (a technology's quest once the Academy can research it, and so on).

const world = require('./world');
const B = { COTTAGE: 1, BARRACKS: 2, WAREHOUSE: 3, SAWMILL: 4, QUARRY: 5, IRONMINE: 6, FARM: 7, STABLE: 20, INN: 21, FORGE: 22, MARKET: 23, RELIEF: 24,
  ACADEMY: 25, WORKSHOP: 26, FEAST: 27, EMBASSY: 28, RALLY: 29, BEACON: 30, TOWN_HALL: 31, WALLS: 32 };
const MEDALS = ['hero.loyalty.1', 'hero.loyalty.2', 'hero.loyalty.3', 'hero.loyalty.4', 'hero.loyalty.5', 'hero.loyalty.6', 'hero.loyalty.7', 'hero.loyalty.8', 'hero.loyalty.9'];
const MEDAL_NAMES = ['Cross', 'Rose', 'Lion', 'Honor', 'Courage', 'Wisdom', 'Freedom', 'Justice', 'Nation'];
const RANK_NAMES = ['Civilian', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'General'];
const TITLE_NAMES = ['Civilian', 'Knight', 'Baronet', 'Baron', 'Viscount', 'Earl', 'Marquis', 'Duke', 'Furstin', 'Prinzessin'];
// Ranks: gold (used up), Town Hall level, medals (used up). The wiki's Promotion table.
const RANKS = [
  null,
  { gold: 10000, townHall: 2, medals: {} },
  { gold: 20000, townHall: 4, medals: { 'hero.loyalty.1': 5 } },
  { gold: 30000, townHall: 6, medals: { 'hero.loyalty.2': 5 } },
  { gold: 40000, townHall: 8, medals: { 'hero.loyalty.3': 5 } },
  { gold: 50000, townHall: 10, medals: { 'hero.loyalty.4': 5 } },
];
// Titles: gold and medals (used up), the rank and prestige needed. Each title rules one more city.
const TITLES = [
  null,
  { gold: 20000, rank: 1, prestige: 1000, medals: { 'hero.loyalty.1': 10, 'hero.loyalty.2': 5 } },
  { gold: 40000, rank: 2, prestige: 2000, medals: { 'hero.loyalty.2': 10, 'hero.loyalty.3': 5 } },
  { gold: 60000, rank: 3, prestige: 4000, medals: { 'hero.loyalty.3': 10, 'hero.loyalty.4': 5 } },
  { gold: 80000, rank: 4, prestige: 8000, medals: { 'hero.loyalty.4': 10, 'hero.loyalty.5': 5 } },
  { gold: 100000, rank: 5, prestige: 16000, medals: { 'hero.loyalty.5': 10, 'hero.loyalty.6': 5 } },
  { gold: 200000, rank: 5, prestige: 32000, medals: { 'hero.loyalty.6': 10, 'hero.loyalty.7': 5 } },
  { gold: 300000, rank: 5, prestige: 64000, medals: { 'hero.loyalty.7': 10, 'hero.loyalty.8': 5 } },
  { gold: 400000, rank: 5, prestige: 128000, medals: { 'hero.loyalty.8': 10, 'hero.loyalty.9': 5 } },
  { gold: 500000, rank: 5, prestige: 256000, medals: { 'hero.loyalty.8': 30, 'hero.loyalty.9': 15 } },
];
const RES_NAME = { food: 'Food', wood: 'Lumber', stone: 'Stone', iron: 'Iron', gold: 'Gold' };
const DAILY = 1001, NEWBIE = 535, LORDS = 536, AMULET = 223, EVONIAN = 226;
const QUEEN_FIRST = 601;
const KING_HELM = 'player.box.hero.king', QUEEN_HELM = 'player.box.hero.queen';
const PLURALS = { Pikeman: 'Pikemen', Swordsman: 'Swordsmen', Cavalry: 'Cavalry', Ballista: 'Ballistae', Abatis: 'Abatises', 'Rolling log': 'Rolling Logs' };
const plural = (w, n) => n === 1 ? w : PLURALS[w] || (/s$/.test(w) ? w : w + 's');
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------- targets ----------
const bld = (type, level = 1) => ({ kind: 'building', type, level });
const flag = (key, text) => ({ kind: 'flag', key, text });
const kind = (k, extra = {}) => ({ kind: k, ...extra });
const res4 = (f, w, s, i) => [['Food', f], ['Lumber', w], ['Stone', s], ['Iron', i]].filter(([, n]) => n > 0).map(([k, n]) => `${k}*${n}`).join(', ');
// One quest: id, name, targets, award (parsed by parseReward; "#id" names an item by its id), options:
// show (targets that must be met before it is offered), needs (a system this server lacks), text (live texts).
const q = (id, name, targets, reward, o = {}) => ({ id, name, targets, reward, ...o });

// Technologies in the wiki's order, with the Academy level that lets you research each and the gold award.
// Quest ids follow the client (45-63); the client's texts name 60-62 in another order than their awards,
// so the wiki's pairing of name and award is used.
const TECH_QUESTS = [
  ['Agriculture', 1, 2000], ['Lumbering', 1, 2400], ['Masonry', 2, 3000], ['Mining', 2, 4000], ['Metal Casting', 3, 10000], ['Informatics', 3, 4000],
  ['Military Science', 1, 5000], ['Military Tradition', 2, 6000], ['Iron Working', 3, 7000], ['Logistics', 4, 6000], ['Compass', 4, 6000],
  ['Horseback Riding', 5, 8000], ['Archery', 4, 10000], ['Stockpile', 6, 4000], ['Medicine', 6, 7200], ['Construction', 5, 10000],
  ['Engineering', 8, 12000], ['Machinery', 9, 11000], ['Privateering', 10, 20000],
];
// Troops in quest id order (97-108), the Barracks level that trains them (the wiki's "Trains" column) and the award.
const TROOP_QUESTS = [
  [97, 'Worker', 'peasants', 1, res4(500, 1500, 0, 100)], [98, 'Warrior', 'militia', 1, res4(800, 1000, 0, 500)], [99, 'Scout', 'scouter', 2, res4(1200, 2000, 0, 1500)],
  [100, 'Pikeman', 'pikemen', 2, res4(1500, 5000, 0, 1000)], [101, 'Swordsman', 'swordsmen', 3, res4(2000, 1500, 0, 4000)], [102, 'Archer', 'archer', 4, res4(3000, 3500, 0, 3000)],
  [103, 'Cavalry', 'lightCavalry', 5, res4(10000, 6000, 0, 5000)], [104, 'Cataphract', 'heavyCavalry', 7, res4(20000, 5000, 0, 25000)],
  [105, 'Transporter', 'carriage', 6, res4(6000, 15000, 0, 3500)], [106, 'Ballista', 'ballista', 9, res4(25000, 30000, 0, 18000)],
  [107, 'Battering Ram', 'batteringRam', 9, res4(40000, 60000, 0, 15000)], [108, 'Catapult', 'catapult', 10, res4(50000, 50000, 80000, 12000)],
];
// Defenses (123-127): how many, the Walls level that allows them, the award.
const FORT_QUESTS = [
  [123, 'Traps', 'trap', 10, 1, 'Traps*90, Lumber*5000, Stone*1000'], [124, 'Abatis', 'abatis', 10, 2, 'Abatis*90, Lumber*10000, Iron*2000'],
  [125, "Archer's Towers", 'arrowTower', 100, 3, "Archer's Towers*40, Lumber*20000, Iron*10000"], [126, 'Rolling Logs', 'rollingLogs', 10, 5, 'Rolling Logs*10, Lumber*50000'],
  [127, 'Defensive Trebuchet', 'rockfall', 10, 7, 'Defensive Trebuchet*10, Lumber*50000'],
];
// Hero Gear (Age II): the 14 gear technologies at level 1, by the client's gear type, with the materials awarded.
const ORE = '#equipment.tech.upgrade.1', WOOD = '#equipment.tech.upgrade.2', GEM = '#equipment.tech.upgrade.3', HORSE = '#equipment.tech.upgrade.4', FABRIC = '#equipment.tech.upgrade.5';
const GEAR_QUESTS = [
  ['Forging Weapons', `${ORE}*1, ${WOOD}*1`], ['Forging Shields', `${ORE}*1, ${HORSE}*1`], ['Training Mounts', `${ORE}*1, ${GEM}*1`], ['Forging Necklaces', `${ORE}*1, ${GEM}*1`],
  ['Forging Jewelry', `${GEM}*2`], ['Forging Rings', `${ORE}*1, ${FABRIC}*1`], ['Forging Helmets', `${ORE}*1, ${FABRIC}*1`], ['Forging Pauldrons', `${ORE}*1, ${FABRIC}*1`],
  ['Forging Breastplates', `${FABRIC}*2`], ['Forging Cloaks', `${FABRIC}*2`], ['Forging Gauntlets', `${FABRIC}*2`], ['Forging Belts', `${FABRIC}*2`],
  ['Forging Legguards', `${FABRIC}*2`], ['Forging Greaves', `${FABRIC}*2`],
];
const rankQuest = r => { const req = RANKS[r];
  return q(193 + r, RANK_NAMES[r], [kind('gold', { n: req.gold }), bld(B.TOWN_HALL, req.townHall), ...Object.entries(req.medals).map(([id, n]) => kind('item', { id, n }))],
    r === 5 ? 'Primary Guidelines*2, Beginner Guidelines*2, Prestige*500' : `Primary Guidelines*1, Beginner Guidelines*1, Prestige*${r * 100}`, { promo: 'rank', level: r }); };
const TITLE_PRESTIGE = [0, 100, 200, 400, 800, 1000, 2000, 2000, 5000, 5000];   // the wiki leaves the Duke's blank; the client says 2000
const titleQuest = t => { const req = TITLES[t];
  return q(198 + t, TITLE_NAMES[t], [kind('gold', { n: req.gold }), kind('rank', { n: req.rank }), kind('prestige', { n: req.prestige }), ...Object.entries(req.medals).map(([id, n]) => kind('item', { id, n }))],
    `${t <= 5 ? 'Primary Guidelines*1, Beginner Guidelines*1' : 'Intermediate Guidelines*1, Senior Guidelines*1'}, Prestige*${TITLE_PRESTIGE[t]}`, { promo: 'title', level: t }); };

// The categories in the wiki's order, under the live game's names.
function catalog(){
  const academy = range(1, 10).map(L => q(34 + L, L === 1 ? 'Academy' : 'Academy Upgrade', [bld(B.ACADEMY, L)],
    L === 1 ? 'Primary Guidelines*1, ' + res4(150, 2500, 1500, 200) : L === 2 ? res4(300, 5000, 3000, 400) : L === 3 ? res4(1000, 10000, 5000, 1000) : res4(2000, 20000, 10000, 2000)));
  const townHall = range(2, 10).map(L => q(24 + L, 'Town Hall Upgrade', [bld(B.TOWN_HALL, L)],
    L === 2 ? 'Primary Guidelines*1, ' + res4(2500, 6500, 5500, 2500) : L === 3 ? res4(5000, 13000, 11000, 5000) : L === 4 ? res4(10000, 26000, 22000, 10000) : res4(20000, 50000, 50000, 20000)));
  const barracks = range(1, 10).map(L => q(86 + L, L === 1 ? 'Barracks' : 'Barracks Upgrade', [bld(B.BARRACKS, L)],
    L === 1 ? res4(1000, 1200, 1500, 1000) : L === 2 ? res4(2000, 2400, 3000, 2000) : L === 3 ? res4(4000, 4800, 6000, 4000) : res4(8000, 10000, 10000, 8000)));
  const walls = [q(113, 'Walls', [bld(B.QUARRY, 2), bld(B.WALLS, 1)], res4(3000, 2000, 10000, 2000)),
    ...range(2, 10).map(L => q(112 + L, 'Walls Reinforcement', [bld(B.WALLS, L)], L === 2 ? res4(5000, 5000, 20000, 5000) : res4(10000, 10000, 50000, 10000)))];
  const beacon = range(1, 10).map(L => q(144 + L, 'Beacon Tower', [bld(B.BEACON, L)], L === 1 ? res4(150, 1000, 3000, 300) : L === 2 ? res4(300, 2000, 6000, 600) : res4(1000, 10000, 20000, 5000)));
  const valleys = range(1, 10).map(L => q(127 + L, 'Valleys Conquer', [kind('valley', { level: L })],
    [['War Horn*1, Food*1000'], ['Corselet*1, Food*2000'], ['Penicillin*1, Food*3000'], ['Food*4000'], ['Food*5000'], ['Food*10000'], ['Food*20000'], ['Food*50000'], ['Food*100000'], ['Food*200000']][L - 1][0]));
  // The wiki's population awards: prestige and population P, gold 10 P (its gold for the 200-2000 steps is garbled).
  const pop = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].map((n, i) => { const P = n / 10; return q(155 + i, 'Population Increase', [kind('pop', { n })], `Prestige*${P}, Population*${P}, Gold*${P * 10}`); });
  const prod = (res, name, first, base) => [1000, 5000, 10000, 50000].map((n, i) => q(base + i, name, [kind('prod', { res, n })], `${i === 0 ? first + '*1, ' : ''}${RES_NAME[res]}*${n}`));
  const tax = [[500, 'Gold*1000'], [1000, 'Gold*5000'], [5000, 'Food*10000'], [10000, 'Food*50000']].map(([n, r], i) => q(180 + i, 'Tax Revenue', [kind('tax', { n })], r));
  const prestige = range(0, 9).map(i => q(184 + i, 'Prestige Building', [kind('prestige', { n: 1000 * Math.pow(2, i) })], `Gold*${(i + 1) * 10000}`));
  const members = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n, i) => q(67 + i, 'Member Enrichment', [flag(`allianceMembers${n}`, `Your alliance reaches ${n} members`)], 'Prestige*100, Gold*1000', { needs: 'alliance' }));
  const ACQUIRE = 'Successfully capture and persuade a hero';
  const QUEEN_PRESTIGE = [100, 100, 200, 300, 500];   // the wiki's first five Queen awards read 1-5; the live game shows 100 for the second
  const queen = [
    [kind('prestige', { n: 1000 })], [bld(B.TOWN_HALL, 3)], [bld(B.TOWN_HALL, 4), bld(B.FEAST, 4)], [bld(B.TOWN_HALL, 5)], [kind('valley', { level: 6 }), bld(B.BARRACKS, 5)],
    [kind('title', { n: 3 })], [kind('cities', { n: 3 })], [bld(B.TOWN_HALL, 9)], [kind('valley', { level: 8 })], [kind('valley', { level: 10 })],
    [kind('npcCity', { level: 8 })], [kind('npcCity', { level: 10 })],
  ].map((t, i) => q(QUEEN_FIRST + i, 'Queen', t, i < 5 ? `Prestige*${QUEEN_PRESTIGE[i]}` : i < 11 ? `Prestige*${[800, 1200, 2000, 2500, 3500, 4500][i - 5]}` : `#${KING_HELM}*1`));

  return [
    { typeId: 90, name: 'Queen', version: 2, description: 'Grow your realm until the Queen takes notice. Each step asks for more than the last.', chains: [queen] },
    { typeId: 66, name: 'Rebuild', description: 'Build Cottages so that more people settle in your city.', chains: [
      [q(1, 'Cottage Building', [bld(B.COTTAGE)], 'Beginner Guidelines*1, Aries Amulet*1, Population*30, ' + res4(200, 1000, 200, 200)),
        q(2, 'Upgrade Cottage', [bld(B.COTTAGE, 2)], 'Population*50, ' + res4(500, 2000, 500, 500))],
      [q(AMULET, 'Amulet', [flag('amulet', 'Use an Aries Amulet (Items: spin the Wheel of Fortune)')], 'Beginner Guidelines*1, Aries Amulet*1, Population*20, ' + res4(300, 1500, 300, 150))],
      [q(3, 'Continuous Development', [kind('popMax', { n: 1000 })], 'Population*100, ' + res4(1000, 4000, 1000, 1000)),
        q(4, 'Continuous Development', [kind('popMax', { n: 10000 })], 'Population*500, ' + res4(5000, 10000, 5000, 5000)),
        q(5, 'Continuous Development', [kind('popMax', { n: 50000 })], 'Population*2000, ' + res4(10000, 20000, 10000, 10000))],   // iron from the client; the wiki omits it
    ] },
    { typeId: 67, name: 'Commodity Gathering', description: 'Start producing food, lumber, stone and iron from the fields around your city.', chains: [
      [q(15, 'Farming', [bld(B.FARM)], 'Beginner Guidelines*1, ' + res4(100, 500, 500, 300))], [q(16, 'Lumbering', [bld(B.SAWMILL)], 'Beginner Guidelines*1, ' + res4(200, 200, 500, 500))],
      [q(17, 'Quarrying', [bld(B.QUARRY)], 'Beginner Guidelines*1, ' + res4(300, 750, 300, 500))], [q(18, 'Forging', [bld(B.IRONMINE)], 'Beginner Guidelines*1, ' + res4(500, 800, 750, 500))],
    ] },
    { typeId: 68, name: 'Consolation', description: 'Look after your people from the Town Hall.', chains: [
      [q(6, 'Disaster Relief', [flag('pacify1', 'Disaster Relief')], 'Food*1000')], [q(7, 'Pray for Your People', [flag('pacify2', 'Praying')], 'Gold*1000')],
      [q(8, 'Bless for luck', [flag('pacify3', 'Blessing')], 'Gold*1000, Food*1000')], [q(9, 'Population Raising', [flag('pacify4', 'Population Raising')], 'Food*1000')],
    ] },
    { typeId: 69, name: 'Resources Levy', description: 'Levy resources from your people at the Town Hall.', chains:
      ['Gold', 'Food', 'Lumber', 'Stone', 'Iron'].map((r, i) => [q(10 + i, `${r} Levy`, [flag(`levy${i + 1}`, `${r} Levy (Town Hall)`)], `${r}*1000`)]) },
    { typeId: 70, name: 'Administration', description: 'Run your city from the Town Hall: labour, taxes, its name and your flag.', chains: [
      [q(19, 'Assign labor force', [kind('labor')], res4(1000, 1000, 1000, 1000))], [q(20, 'Assign tax rate', [kind('taxRate', { n: 20 })], 'Gold*1000')],
      [q(21, 'Rename city', [flag('rename', 'Rename a city (Town Hall)')], 'National Flag*1, Prestige*50, Gold*500')],
      [q(22, 'National Flag', [flag('flag', 'Change your flag (a National Flag item)')], 'National Flag*1, Gold*1000')],
    ] },
    { typeId: 71, name: 'Trading', description: 'Build a Marketplace and trade resources.', chains: [
      [q(23, 'Marketplace', [bld(B.MARKET)], 'Cents*5, ' + res4(1500, 1500, 1500, 1500))],
      [q(24, 'Sell Resources', [flag('sell', 'Sell resources at the Marketplace')], 'Gold*1000', { needs: 'market' })],
      [q(25, 'Buy Resources', [flag('buyRes', 'Buy resources at the Marketplace')], 'Gold*1000', { needs: 'market' })],
    ] },
    { typeId: 72, name: 'Domain Expansion', description: 'Open your starter packages and upgrade the Town Hall: each level lets you hold one more valley.', chains: [
      [q(NEWBIE, 'Get a jump start', [flag('newbiePack', 'Open the Newbies Package (Items, Chests)')], 'Prestige*100, Gold*10000')],
      [q(LORDS, 'Package for Lords', [bld(B.TOWN_HALL, 3), flag('lordsPack', 'Open the Package for Lords (Items, Chests)')], 'Prestige*3000, Gold*100000')],
      townHall,
    ] },
    { typeId: 73, name: 'Scientific Research', description: 'Build up the Academy and research technologies. A technology\'s quest opens once your Academy can research it.', chains: [
      academy, ...TECH_QUESTS.map(([name, L, gold], i) => [q(45 + i, name, [kind('tech', { name, level: 1 })], `Gold*${gold}`, { show: [bld(B.ACADEMY, L)] })]),
    ] },
    { typeId: 74, name: 'Alliance', description: 'Build an Embassy and join an alliance.', chains: [
      [q(64, 'Alliance', [bld(B.EMBASSY)], res4(500, 2000, 1000, 500)), q(65, 'Join Alliance', [flag('joinAlliance', 'Join an alliance')], 'Gold*5000', { needs: 'alliance' })],
      [q(66, 'Chatting', [flag('allianceChat', 'Chat in the Alliance channel')], 'Prestige*100, Gold*1000', { needs: 'alliance' })], members,
    ] },
    { typeId: 75, name: 'Correspondence', description: 'Write to other lords and talk in the chat.', chains: [
      [q(78, 'Correspondence', [flag('mail', 'Write to a player')], 'Speaker*5, Prestige*100, Gold*1000', { needs: 'mail' })],
      [q(79, 'Chat Box', [flag('worldChat', 'Chat in the World channel')], 'Cents*10, Prestige*100, Gold*1000', { needs: 'chat' })],
    ] },
    { typeId: 76, name: 'Hero Recruitment', description: 'Build an Inn to find heroes and a Feasting Hall to keep them, then go after the historic heroes.', chains: [
      [q(80, 'Inn', [bld(B.INN)], res4(500, 2000, 1000, 500)), q(81, 'Feasting Hall', [bld(B.FEAST)], 'Gold*1000, ' + res4(1000, 3000, 1500, 1000)),
        q(82, 'Recruitment', [flag('hire', 'Recruit a hero at the Inn')], 'Gold*1000'),
        q(83, 'Assignment', [kind('mayor')], 'The Wealth of Nations*1, Cross Medal*1, Gold*1000'),
        q(84, 'Hero Upgrade', [flag('heroPoints', 'Upgrade a hero: level up and spend the attribute points')], 'Holy Water*1, Gold*1000'),
        q(85, 'Hero Recruitment', [flag('refreshInn', 'Use Hero Hunting to refresh the heroes in the Inn')], 'Holy Water*1, Hero Hunting*2, Prestige*100, Gold*5000')],
      [q(630, 'Acquire Enemy\'s Hero', [flag('captureHero', ACQUIRE)], 'Aries Amulet*1, Holy Water*1', { show: [bld(B.INN)] }),
        q(635, 'Acquire Enemy\'s Hero', [flag('captureFamous', `${ACQUIRE} who is famous (a historic hero)`)], 'Aries Amulet*1, Holy Water*1')],
      [q(631, 'Enquire Details', [flag('enquire', 'Enquire details of a specific hero (Inn, Hearsay)')], 'Holy Water*1, Cents*10', { show: [bld(B.INN)] })],
      [q(632, 'Folk Hearsay', [flag('hearsay', 'Accept the task of capturing a hero (Inn, Hearsay)')], 'Gold*2000', { show: [bld(B.INN)] })],
      [q(633, 'More Hearsay', [flag('moreHearsay', 'Refresh the list of heroes you can enquire about (More Hearsay)')], 'Gold*2000', { show: [bld(B.INN)] })],
      [q(634, 'Specific Hero Information', [flag('heroSearch', 'Search the details of a specific hero (Hero Search)')], 'Gold*5000', { show: [bld(B.INN)] })],
    ] },
    { typeId: 77, name: 'Military Service', description: 'Build a Rally Spot and Barracks and raise an army. A troop\'s quest opens once your Barracks can train it.', chains: [
      [q(86, 'Rally Spot', [bld(B.RALLY)], res4(500, 1000, 2000, 500))], barracks,
      ...TROOP_QUESTS.map(([id, name, field, L, r]) => [q(id, name, [kind('troops', { field, n: 10 })], r, { show: [bld(B.BARRACKS, L)] })]),
    ] },
    { typeId: 78, name: 'Scouting', description: 'Send Scouts to learn what you are up against before you attack.', chains: [
      [q(109, 'Scouting', [flag('scoutValley', 'Scout a valley')], 'Food*500, Lumber*500, Iron*500')], [q(110, 'Scouting', [flag('scoutCity', 'Scout a city')], 'Gold*1000')],
      ...[12, 14, 16, 18].map((L, i) => [q(621 + i, 'Scouting', [flag(`scoutHC${L}`, `Scout a level ${L} Historic City`)], 'Prestige*50')]),
    ] },
    { typeId: 79, name: 'Fortification', description: 'Build a Forge, a Workshop and Walls, and fill the Walls with defenses.', chains: [
      [q(111, 'Forge', [bld(B.FORGE)], res4(500, 1500, 2000, 1500))], [q(112, 'Workshop', [bld(B.WORKSHOP), bld(B.FORGE, 2)], res4(1500, 5000, 5000, 5000))], walls,
      ...FORT_QUESTS.map(([id, name, field, n, L, r]) => [q(id, name, [kind('forts', { field, n })], r, { show: [bld(B.WALLS, L)] })]),
    ] },
    { typeId: 80, name: 'Colony', description: 'Conquer the valleys around your city for extra production. Each Town Hall level lets you hold one more.', chains: [valleys] },
    { typeId: 81, name: 'City Expansion', description: 'Conquer a flat and found a second city.', chains: [
      [q(143, 'Conquering', [kind('flat')], 'Prestige*100, Gold*5000, ' + res4(5000, 5000, 5000, 5000))],
      [q(144, 'Satellite City', [kind('cities', { n: 2 })], 'Prestige*100, Gold*50000')],
      // Live (Fox's capture, Oct 26 2026): "Conquer one capital city", its award as the live quest window shows it.
      [q(547, 'Acquire Capital City', [kind('npcCity', { level: 1, text: 'Conquer one city.' })], 'Intermediate Guidelines*5, Senior Guidelines*5, Aries Amulet*5, Prestige*100000')],
      [q(625, 'Scout the capital city', [flag('scoutCapital', 'Scout the capital at 0,0')], 'Prestige*50')],
    ] },
    { typeId: 82, name: 'Rich Store', description: 'Raise lumber production and build a Warehouse.', chains: [
      [q(138, 'Sawmill Upgrade', [bld(B.SAWMILL, 2)], res4(1000, 1000, 1000, 1000))], [q(139, 'Warehouse', [bld(B.WAREHOUSE)], res4(500, 2000, 1500, 500))],
    ] },
    { typeId: 83, name: 'Transportation', description: 'Farms, a Stable and a Relief Station keep your armies fed and moving.', chains: [
      [q(140, 'Farm Upgrade', [bld(B.FARM, 5)], res4(1000, 5000, 3000, 2500))], [q(141, 'Stable', [bld(B.STABLE)], res4(1500, 2000, 1000, 1000))],
      [q(142, 'Relief Station', [bld(B.RELIEF)], res4(2000, 5000, 5000, 1000))],
    ] },
    { typeId: 84, name: 'Alarming', description: 'A Beacon Tower warns you of armies on their way.', chains: [beacon] },
    { typeId: 85, name: 'Population Increase', description: 'Grow your population.', chains: [pop] },
    { typeId: 86, name: 'Wealthy Society', description: 'Raise production and tax revenue.', chains: [
      prod('food', 'Great Harvest', 'Plowshares', 164), prod('wood', 'Logging', 'Arch Saw', 168), prod('stone', 'Quarrying', 'Quarrying Tools', 172), prod('iron', 'Forging', 'Blower', 176), tax,
    ] },
    { typeId: 87, name: 'Prestige Building', description: 'Build your prestige: it decides your titles and how other lords see you.', chains: [prestige] },
    { typeId: 88, name: 'Item Purchase', description: 'Buy an item in the shop.', chains: [[q(212, 'Items Purchase', [flag('buy', 'Buy an item in the shop')], 'Senior Guidelines*1, Intermediate Guidelines*1, Cents*10')]] },
    { typeId: 89, name: 'Promotion', description: 'Rise through the ranks and earn noble titles. Each title lets you rule one more city.', chains: [range(1, 5).map(rankQuest), range(1, 9).map(titleQuest)] },
    { typeId: 91, name: 'Battlefield', description: 'Get ready for war.', chains: [
      [q(208, 'Fortified Units', [kind('forts', { field: 'arrowTower', n: 100 })], "Archer's Towers*100")],
      [q(209, 'Wars Begin', [bld(B.TOWN_HALL, 5)], 'Truce Agreement*1, City Teleporter*1, Prestige*500')],
    ] },
    { typeId: 92, name: 'Guidelines', description: 'Speed things up with Guidelines.', chains: [
      [q(210, 'Speedup', [flag('guideBuild', 'Speed up a building with Beginner Guidelines')], 'Beginner Guidelines*2')],
      [q(211, 'Magical Help', [flag('guideResearch', 'Speed up research with Primary Guidelines')], 'Primary Guidelines*2')],
    ] },
    { typeId: 93, name: 'Military Operation', description: 'Heal your wounded troops.', chains: [[q(213, 'Heal the Wounded', [flag('cure', 'Cure wounded troops')], 'Gold*2000', { needs: 'injured' })]] },
    { typeId: 94, name: 'The Medals', description: 'Medals are needed for ranks and titles. Win them in battle, then contribute your first of each kind for two more.', chains:
      MEDALS.map((id, i) => [q(214 + i, `${MEDAL_NAMES[i]} Medal`, [kind('item', { id, n: 1 })], `#${id}*2, Prestige*100, Food*10000`)]) },
    { typeId: 95, name: 'Be an Evonian', description: 'Add Evony to your favourites.', chains: [[q(EVONIAN, 'Add to Favorites', [kind('always', { text: 'Add Evony to your browser\'s favourites (counted as done on this server)' })],
      'Aries Amulet*1, Beginner Guidelines*1, Population*30, ' + res4(200, 1000, 200, 100))]] },
    { typeId: 96, name: 'Stratagem', description: 'Use a stratagem.', chains: [
      [q(660, 'Stratagem', [flag('stratagemOwn', 'Use a stratagem on your own city')], 'Cents*10', { needs: 'stratagem' })],
      [q(661, 'Stratagem', [flag('stratagemOther', 'Use a stratagem on another lord\'s city')], 'Cents*20', { needs: 'stratagem' })],
    ] },
    { typeId: 97, name: 'Achievement', description: 'Earn achievement points.', chains: [
      [[100, 500, 5000], [500, 1000, 10000], [1000, 2000, 15000], [5000, 4000, 25000], [20000, 8000, 50000]].map(([n, pr, gold], i) =>
        q(670 + i, 'Attain Achievement', [flag(`achievement${n}`, `${n.toLocaleString('en-US')} achievement points`)], `Prestige*${pr}, Gold*${gold}`, { needs: 'achievement' }))] },
    { typeId: 98, name: 'Uprising', description: 'Uprisings and commissions.', chains: [
      [q(680, 'Uprising', [flag('uprising', 'Perform an uprising')], 'War Horn*1, Corselet*1', { needs: 'uprising' })],
      [q(681, 'Issuing Commission', [flag('commission', 'Issue a commission quest')], 'Cents*15', { needs: 'commission' })],
    ] },
    { typeId: 99, name: 'Hero Gear', version: 2, description: 'Research hero gear in the Workshop and equip your heroes.', chains: [
      [q(640, 'Gear Stars', [kind('gearStarred', { text: 'Add a star to a gear technology with gems (Workshop, Advanced Blacksmithing)' })], 'Gold*500', { show: [bld(B.WORKSHOP)] })],
      ...GEAR_QUESTS.map(([name, r], i) => [q(641 + i, name, [kind('gearTech', { type: i + 1, level: 1 })], r, { show: [bld(B.WORKSHOP)] })]),
      [q(655, 'One click change', [flag('wearAll', 'Use One Click Change to put all of a hero\'s gear on (hero window)')], 'Gold*500', { show: [bld(B.WORKSHOP)] })],
    ] },
    // Not a live category: a free Amulet a day (rules.quests.dailyAmulet turns it off).
    { typeId: 100, name: 'Daily Amulet', description: 'One free Aries Amulet every day.', optional: 'dailyAmulet', chains: [[q(DAILY, 'Daily Amulet', [kind('daily')], 'Aries Amulet*1', { daily: true })]] },
  ];
}

// Texts copied from the live game (Fox's screenshots); other quests use their category's description.
const LIVE_TEXT = {
  [QUEEN_FIRST + 1]: { description: 'Lords and ladies across the realm now speak your name in court as your prestige grows. Many believe your star is on the rise and courtesans across the realm have begun to watch your career with interest. However, they also speak of how small and insignificant your town is. If you wish to gain the Queen\'s attention, you will need to grow your town into a thriving community. An upgraded Town Hall is a good start.',
    manual: 'Click your Town Hall and hit Upgrade.' },
  6: { description: 'It takes time for your people to settle, and everybody is discussing the new lord, wondering what are your policies on domestic affairs. During this doubtful moment, you need to reassure your people that they are your top priority. Natural disasters are plaguing your people. Now is the perfect opportunity for you to establish your prestige by soothing the victims.',
    manual: 'Click Town Hall, and then select tab "Comforting", scroll to and hit "Disaster Relief". (Comforting has a cooldown of 15 minutes.)' },
};
const FORT_WORDS = { trap: 'trap', traps: 'trap', abatis: 'abatis', abatises: 'abatis', "archer's tower": 'arrowTower', "archer's towers": 'arrowTower', 'rolling logs': 'rollingLogs', 'rolling log': 'rollingLogs',
  'defensive trebuchet': 'rockfall', 'defensive trebuchets': 'rockfall', rockfall: 'rockfall' };
const REWARD_ALIASES = { 'penicillin': 'player.relive.1', 'the wealth of nations': 'hero.management.1', 'speaker': 'consume.1.a', 'national flag': 'consume.changeflag.1',
  'city teleporter': 'consume.move.1', 'hero hunting': 'consume.refreshtavern.1', 'holy water': 'hero.reset.1', 'beginner guidelines': 'consume.2.a', 'primary guidelines': 'consume.2.b',
  'intermediate guidelines': 'consume.2.b.1', 'senior guidelines': 'consume.2.c', 'war horn': 'player.attackinc.1' };
// Quest ids whose meaning changed in 0.3.15 (state version 2): the old Queen quest (Town Hall 3) is now 602,
// the old Walls quest 300 is the client's 113, and the old gear quests 610-612 are gone (610-612 are Queen steps).
const STATE_VERSION = 2;

class QuestLogic {
  constructor(game){
    this.g = game;
    this.defs = new Map();
    this.categories = catalog().map(cat => ({ ...cat, chains: cat.chains.map(ch => ch.map(raw => {
      const def = this.define(raw, cat);
      if (this.defs.has(def.id)) throw new Error(`Quest id ${def.id} is defined twice`);
      this.defs.set(def.id, def); return def;
    })) }));
  }
  get rules(){ return this.g.rules; }

  // ---------- definitions ----------
  define(raw, cat){
    const targets = raw.targets.map(t => t.kind === 'tech' ? { ...t, id: Number(Object.values(this.g.data.techs).find(x => x.name === t.name)?.id) || 0 } : t);
    return { id: raw.id, typeId: cat.typeId, version: cat.version || 0, name: raw.name, targets, show: raw.show || [], needs: raw.needs || null,
      promo: raw.promo || null, level: raw.level || 0, daily: !!raw.daily, repeat: false, reward: this.parseReward(raw.reward) };
  }
  parseReward(text){
    const r = { res: {}, pop: 0, prestige: 0, cents: 0, items: {}, forts: {} };
    for (let part of String(text).split(/,\s*/)){
      part = part.trim(); if (!part) continue;
      const m = part.match(/^(.*?)\s*\*\s*(\d[\d,]*)$/) || [null, part, '1'];
      const name = m[1].trim(), n = Number(m[2].replace(/,/g, '')), k = name.toLowerCase();
      if (name.startsWith('#')) r.items[name.slice(1)] = (r.items[name.slice(1)] || 0) + n;
      else if (RES_NAME[k] || k === 'lumber' || k === 'wood') r.res[k === 'lumber' ? 'wood' : k] = (r.res[k === 'lumber' ? 'wood' : k] || 0) + n;
      else if (k === 'population') r.pop += n;
      else if (k === 'prestige') r.prestige += n;
      else if (k === 'cents' || k === 'game coins') r.cents += n;
      else if (FORT_WORDS[k]) r.forts[FORT_WORDS[k]] = (r.forts[FORT_WORDS[k]] || 0) + n;
      else {
        const id = REWARD_ALIASES[k] || this.g.itemUse.chests.itemFor(name);
        if (!id) throw new Error(`Quest award "${part}" names no item`);
        r.items[id] = (r.items[id] || 0) + n;
      }
    }
    return r;
  }
  // A Gold Helm of King for a lord, of Queen for a lady.
  helmFor(p, id){ return id === KING_HELM && p?.sex ? QUEEN_HELM : id; }
  // Like the live game: "Food 1000, Wood 2000, Beginner Guidelines 1."
  rewardText(r, p){
    const parts = [];
    for (const [k, v] of Object.entries(r.res)) parts.push(`${k === 'wood' ? 'Wood' : RES_NAME[k]} ${v}`);
    if (r.pop) parts.push(`Population ${r.pop}`);
    if (r.prestige) parts.push(`Prestige ${r.prestige}`);
    if (r.cents) parts.push(`Cents ${r.cents}`);
    for (const [id, n] of Object.entries(r.items)) parts.push(`${this.g.items.name(this.helmFor(p, id))} ${n}`);
    for (const [k, n] of Object.entries(r.forts)) parts.push(`${plural(Object.values(this.g.data.forts).find(f => f.field === k)?.name || k, n)} ${n}`);
    return parts.length ? parts.join(', ') + '.' : '';
  }

  // ---------- state ----------
  state(p){ return p.quest || (p.quest = { done: {}, flags: {}, max: {}, daily: '', notified: {}, v: STATE_VERSION }); }
  // Saves from before 0.3.15: move quests whose ids changed. Returns true when something was moved.
  upgrade(p){
    const s = this.state(p); if ((s.v || 0) >= STATE_VERSION) return false;
    if (s.done[600]) s.done[QUEEN_FIRST + 1] = s.done[600];
    if (s.done[300] && !s.done[113]) s.done[113] = s.done[300];
    for (const id of [300, 600, 610, 611, 612]) delete s.done[id];
    s.notified = {}; s.v = STATE_VERSION;
    return true;
  }
  today(now = Date.now()){ return new Date(now).toISOString().slice(0, 10); }
  flag(p, key){ const s = this.state(p); if (s.flags[key]) return false; s.flags[key] = true; return true; }
  record(p, key, value){ const s = this.state(p); if ((s.max[key] || 0) < value){ s.max[key] = value; return true; } return false; }
  rank(p){ return p.rank || 0; }
  title(p){ return p.title || 0; }
  rankName(p){ return RANK_NAMES[this.rank(p)] || RANK_NAMES[0]; }
  titleName(p){ return TITLE_NAMES[this.title(p)] || TITLE_NAMES[0]; }
  maxCities(p){ return Math.min(this.rules.maxCities || 10, this.title(p) + 1); }
  // Systems quests can need. None of them exist on this server yet.
  supports(system){ return !!this.rules.quests?.systems?.[system]; }

  // ---------- checking targets ----------
  check(p, c, t, now){
    const g = this.g, L = g.logic, castles = g.castlesOf(p), s = this.state(p);
    const maxOver = f => castles.reduce((m, x) => Math.max(m, f(x)), 0);
    switch (t.kind){
      case 'building': return { cur: maxOver(x => L.level(x, t.type)), need: t.level };
      case 'popMax': return { cur: maxOver(x => L.popMax(x)), need: t.n };
      case 'pop': return { cur: maxOver(x => Math.floor(x.pop)), need: t.n };
      case 'prod': return { cur: maxOver(x => Math.floor(L.rates(x, p, now).detail[t.res].basic)), need: t.n };
      case 'tax': return { cur: maxOver(x => { const r = L.rates(x, p, now, true); return Math.floor(r.gold + r.salary); }), need: t.n };
      case 'prestige': return { cur: Math.floor(p.prestige || 0), need: t.n };
      case 'tech': return { cur: L.techLevel(p, t.id), need: t.level };
      case 'troops': return { cur: maxOver(x => x.troops?.[t.field] || 0), need: t.n };
      case 'forts': return { cur: maxOver(x => x.forts?.[t.field] || 0), need: t.n };
      case 'flag': return { cur: s.flags[t.key] ? 1 : 0, need: 1 };
      case 'valley': return { cur: Math.max(s.max.valley || 0, maxOver(x => (x.valleys || []).reduce((m, v) => { const tl = world.tileAt(g.store, v); return tl.type === world.T.FLAT ? m : Math.max(m, tl.level || 0); }, 0))), need: t.level };
      case 'flat': return { cur: s.flags.flat || castles.some(x => (x.valleys || []).some(v => world.tileAt(g.store, v).type === world.T.FLAT)) ? 1 : 0, need: 1 };
      case 'npcCity': return { cur: s.max.npcCity || 0, need: t.level };
      case 'cities': return { cur: castles.length, need: t.n };
      case 'mayor': return { cur: castles.some(x => g.heroes.chief(x)) ? 1 : 0, need: 1 };
      case 'labor': return { cur: castles.some(x => Object.values(L.commence(x)).every(v => v >= 100)) ? 1 : 0, need: 1 };
      case 'taxRate': return { cur: castles.some(x => x.taxRate === t.n) ? 1 : 0, need: 1 };
      case 'rank': return { cur: this.rank(p), need: t.n };
      case 'title': return { cur: this.title(p), need: t.n };
      case 'gold': return { cur: Math.floor(c?.res.gold || 0), need: t.n };
      case 'item': return { cur: p.items?.[t.id] || 0, need: t.n };
      case 'daily': return { cur: s.daily === this.today(now) ? 0 : 1, need: 1 };
      case 'always': return { cur: 1, need: 1 };
      case 'gearTech': return { cur: p.gear?.[t.type]?.lv || 0, need: t.level };
      case 'gearStarred': return { cur: Object.values(p.gear || {}).some(x => x.star > 0) ? 1 : 0, need: 1 };
    }
    return { cur: 0, need: 1 };
  }
  targetText(t){
    const g = this.g, fmt = n => Number(n).toLocaleString('en-US'), bname = id => g.logic.typeName(id);
    const troop = f => Object.values(g.data.troops).find(x => x.field === f)?.name || f, fort = f => Object.values(g.data.forts).find(x => x.field === f)?.name || f;
    switch (t.kind){
      case 'building': { const the = t.type === B.TOWN_HALL || t.type === B.WALLS, an = /^[AEIOU]/.test(bname(t.type)) ? 'an' : 'a';
        return t.level === 1 ? `Build ${the ? 'the' : an} ${bname(t.type)}` : `${bname(t.type)} reaches Level ${t.level}`; }
      case 'popMax': return `Raise a city's population limit to ${fmt(t.n)}`;
      case 'pop': return `Grow a city's population to ${fmt(t.n)}`;
      case 'prod': return `Basic ${RES_NAME[t.res].toLowerCase()} production of ${fmt(t.n)} an hour in a city`;
      case 'tax': return `Tax revenue of ${fmt(t.n)} gold an hour in a city`;
      case 'prestige': return `Prestige reaches ${fmt(t.n)}`;
      case 'tech': return `Research ${g.data.techs[t.id]?.name?.trim() || t.name} to level ${t.level}`;
      case 'troops': return `Have ${fmt(t.n)} ${plural(troop(t.field), t.n)} in a city`;
      case 'forts': return `Have ${fmt(t.n)} ${plural(fort(t.field), t.n)} on a city's Walls`;
      case 'flag': return t.text;
      case 'valley': return `Conquer a level ${t.level} valley`;
      case 'flat': return 'Conquer a flat';
      case 'npcCity': return t.text || `Conquer a level ${t.level} NPC city`;
      case 'cities': return `Rule ${t.n} cities`;
      case 'mayor': return 'Appoint a hero as mayor in the Feasting Hall';
      case 'labor': return 'Set every resource\'s production rate to 100% (Town Hall, Production)';
      case 'taxRate': return `Set a city's tax rate to ${t.n}%`;
      case 'rank': return `Rank reaches ${RANK_NAMES[t.n]}`;
      case 'title': return `Title reaches ${TITLE_NAMES[t.n]}`;
      case 'gold': return `${fmt(t.n)} gold in this city (used up)`;
      case 'item': return `${fmt(t.n)} ${plural(g.items.name(t.id), t.n)} (used up)`;
      case 'daily': return 'Claim your Amulet for today';
      case 'gearTech': return `Research ${g.data.equipTechs?.[t.type]?.name || 'a gear technology'} to level ${t.level} (Workshop)`;
      case 'always': case 'gearStarred': return t.text;
    }
    return '';
  }
  met(p, c, targets, now){ return targets.every(t => { const x = this.check(p, c, t, now); return x.cur >= x.need; }); }
  status(p, c, def, now){
    const parts = def.targets.map(t => ({ t, ...this.check(p, c, t, now) }));
    return { parts, finished: parts.length > 0 && parts.every(x => x.cur >= x.need) };
  }
  catVisible(cat){ return !cat.optional || this.rules.quests?.[cat.optional] !== false; }
  // The quest a chain offers: its first not yet completed (daily quests stay), if that one can be offered.
  current(p, chain, c, now){
    const s = this.state(p), d = chain.find(x => x.daily || !s.done[x.id]);
    if (!d || (d.needs && !this.supports(d.needs)) || (d.show.length && !this.met(p, c, d.show, now))) return null;
    return d;
  }
  currentOf(p, cat, c, now){ return this.catVisible(cat) ? cat.chains.map(ch => this.current(p, ch, c, now)).filter(Boolean) : []; }

  // ---------- beans ----------
  questBean(p, c, def, now){
    const st = this.status(p, c, def, now), fmt = n => Number(n).toLocaleString('en-US');
    const counted = ['popMax', 'pop', 'prod', 'tax', 'prestige', 'troops', 'forts', 'cities'];
    const targets = st.parts.map(x => ({ name: this.targetText(x.t) + (x.need > 1 && counted.includes(x.t.kind) ? ` (${fmt(Math.min(x.cur, x.need))}/${fmt(x.need)})` : ''), finished: x.cur >= x.need }));
    const cat = this.categories.find(x => x.typeId === def.typeId), live = LIVE_TEXT[def.id];
    const isRank = def.promo === 'rank', isTitle = def.promo === 'title', isMedal = def.id >= 214 && def.id <= 222;
    const description = isRank ? `Earn the rank of ${RANK_NAMES[def.level]}.` : isTitle ? `Earn the title of ${TITLE_NAMES[def.level]}, which lets you rule ${def.level + 1} cities.`
      : isMedal ? `Contribute a ${this.g.items.name(def.targets[0].id)} and receive two in return. Medals come from battles with NPC and Historic Cities, chests and the Wheel of Fortune.`
      : def.daily ? 'Collect a free Aries Amulet once a day, then spin the Wheel of Fortune.' : live ? live.description : cat.description;
    const manual = isRank || isTitle ? 'Complete Quest uses up the gold and medals listed. Medals come from the Wheel of Fortune, chests, the medal boxes in the shop and battles against NPC cities.'
      : live ? live.manual : 'When every target is ticked, click Complete Quest to claim the reward.';
    return { questId: def.id, name: def.name, description, manual, award: this.rewardText(def.reward, p) + (isRank ? ` The rank of ${RANK_NAMES[def.level]}.` : isTitle ? ` The title of ${TITLE_NAMES[def.level]}.` : ''),
      isFinish: st.finished, isCard: false, islast: false, recommend: false, version: def.version, targets };
  }
  typeBeans(p, c, now){
    let recommended = false;
    return this.categories.map(cat => {
      const cur = this.currentOf(p, cat, c, now); if (!cur.length) return null;
      const finished = cur.some(d => this.status(p, c, d, now).finished);
      const recommend = !recommended && !cur.every(d => d.daily);
      if (recommend) recommended = true;
      return { typeId: cat.typeId, mainId: 1, name: cat.name, description: cat.description, isFinish: finished, recommend, version: cat.version || 0 };
    }).filter(Boolean);
  }
  listBeans(p, c, typeId, now){
    const cat = this.categories.find(x => x.typeId === Number(typeId)); if (!cat) return null;
    return this.currentOf(p, cat, c, now).map(d => this.questBean(p, c, d, now));
  }
  // Quests finished but not yet claimed: for the "new quest" notice.
  finishedIds(p, c, now){
    const out = [];
    for (const cat of this.categories) for (const d of this.currentOf(p, cat, c, now)) if (this.status(p, c, d, now).finished) out.push(d.id);
    return out;
  }

  // ---------- claiming ----------
  award(p, c, questId, now){
    const def = this.defs.get(Number(questId)); if (!def) return null;
    const cat = this.categories.find(x => x.typeId === def.typeId);
    if (!this.currentOf(p, cat, c, now).includes(def)){
      if (def.needs && !this.supports(def.needs)) return [-1, `${def.name} needs something this server doesn't have yet.`];
      return [-1, `${def.name} isn't open yet. Finish the quest before it first.`];
    }
    const st = this.status(p, c, def, now);
    const miss = st.parts.find(x => x.cur < x.need);
    if (miss) return [-1, `Not finished yet: ${this.targetText(miss.t)}${miss.need > 1 ? ` (${Math.floor(miss.cur).toLocaleString('en-US')}/${miss.need.toLocaleString('en-US')})` : ''}.`];
    const s = this.state(p), changed = { items: [], res: false, coins: false, player: false, forts: false };
    // Costs: gold from this city, items (medals) from the inventory.
    for (const t of def.targets){
      if (t.kind === 'gold'){ c.res.gold -= t.n; changed.res = true; }
      if (t.kind === 'item'){ p.items[t.id] -= t.n; changed.items.push(t.id); }
    }
    const r = def.reward;
    for (const [k, v] of Object.entries(r.res)){ c.res[k] = (c.res[k] || 0) + v; changed.res = true; }
    if (r.pop){ c.pop += r.pop; changed.res = true; }
    if (r.prestige){ p.prestige = (p.prestige || 0) + r.prestige; changed.player = true; }
    if (r.cents){ p.coins = (p.coins || 0) + r.cents; changed.coins = true; }
    for (const [id0, n] of Object.entries(r.items)){ const id = this.helmFor(p, id0); this.g.items.add(p, id, n); changed.items.push(id); }
    for (const [k, n] of Object.entries(r.forts)){ c.forts[k] = (c.forts[k] || 0) + n; changed.forts = true; }
    if (def.promo === 'rank'){ p.rank = def.level; changed.player = true; }
    if (def.promo === 'title'){ p.title = def.level; changed.player = true; }
    if (def.daily) s.daily = this.today(now);
    else s.done[def.id] = now;
    delete s.notified[def.id];
    return { def, changed };
  }

  // ---------- prestige ----------
  // Prestige for resources spent on buildings, research, troops and defenses, at rules.prestige.perResource. With a
  // lord p it is divided by all his Town Hall levels together, the fraction dropped (the wiki: "dividing experience
  // by the total number of town hall levels you have ... always round down"; the guide: one low Town Hall earns far
  // more than ten level 10 ones).
  prestigeFor(cost, n = 1, p = null){
    const per = this.rules.prestige?.perResource ?? 0.01;
    const raw = ['food', 'wood', 'stone', 'iron', 'gold'].reduce((a, k) => a + (cost?.[k] || 0), 0) * n * per;
    return p && this.rules.prestige?.byTownHalls !== false ? Math.floor(raw / this.townHalls(p)) : raw;
  }
  // All of lord p's Town Hall levels together (at least 1).
  townHalls(p){ return Math.max(1, this.g.castlesOf(p).reduce((s, c) => s + this.g.logic.townHall(c), 0)); }
  // Saves from before 0.3.13 never earned prestige: credit what the lord has already built, researched and trained.
  backfill(p){
    if (p.prestigeBackfill) return 0;
    const g = this.g, d = g.data; let total = 0;
    for (const c of g.castlesOf(p)){
      for (const b of Object.values(c.buildings)) for (let L = 1; L <= b.level; L++) total += this.prestigeFor(d.buildings[b.typeId]?.levels[L - 1]);
      for (const t of Object.values(d.troops)) total += this.prestigeFor(t, c.troops?.[t.field] || 0);
      for (const f of Object.values(d.forts)) total += this.prestigeFor(f, c.forts?.[f.field] || 0);
    }
    for (const [id, lv] of Object.entries(p.techs || {})) for (let L = 1; L <= lv; L++) total += this.prestigeFor(d.techs[id]?.levels[L - 1]);
    p.prestigeBackfill = 1;
    p.prestige = (p.prestige || 0) + Math.floor(total);
    return Math.floor(total);
  }
}

module.exports = { QuestLogic, RANKS, TITLES, RANK_NAMES, TITLE_NAMES, DAILY, MEDALS, B };
