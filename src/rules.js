'use strict';
// Game rules that are NOT in the client. The client asks the server for requirements, starting
// state and limits, so these are this server's choices. Override any value in data/rules.json
// (same shape); compare against the live game and correct what differs.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // A new lord's first city, as on the live game (Fox's screenshot of a brand-new account, Oct 2026): a level 1 Town
  // Hall and nothing else (the tutorial starts with "let's build a cottage"), 5,000 food, lumber, stone and iron,
  // 18,771 gold, 10% tax, an 80% production rate, and 45 people (no Cottage: limit 50, x 90% at 10% tax).
  start: {
    resources: { food: 5000, wood: 5000, stone: 5000, iron: 5000, gold: 18771 },
    population: 45,
    taxRate: 10,
    productionRate: 80,
    // positionId -> [typeId, level]. -1 = Town Hall, -2 = Walls, 0..31 inside, 1001.. outside.
    buildings: { '-1': [31, 1] },
  },
  // Building requirements, from the Evony wiki's page for each building (Fox's saved copies, Oct 2026).
  // The pages list no general Town Hall cap; true here would keep every building at or below the Town Hall's level.
  capByTownHall: false,
  // Resource fields go at most this many levels above the Town Hall (Fox: live, Town Hall level + 1); up to 10, or a
  // Historic City's own cap once the Town Hall is at 10. null: no limit.
  fieldsAboveTownHall: 1,
  // typeId -> list of [requiredTypeId, requiredLevel] needed to build level 1.
  unlock: {
    2: [[29, 1]],          // Barracks: Rally Spot 1
    20: [[7, 5]],          // Stable: Farm 5
    21: [[1, 2]],          // Inn: Cottage 2
    22: [[6, 3]],          // Forge: Ironmine 3
    26: [[22, 2]],         // Workshop: Forge 2
    25: [[31, 2]],         // Academy: Town Hall 2
    27: [[21, 1]],         // Feasting Hall: Inn 1
    28: [[31, 2]],         // Embassy: Town Hall 2
    24: [[20, 1]],         // Relief Station: Stable 1 (and Horseback Riding, below)
    30: [[2, 1]],          // Beacon Tower: Barracks 1
    32: [[5, 2], [26, 1]], // Walls: Quarry 2, Workshop 1
  },
  // Requirements for every level from `from` on: [ 'b' building | 't' research, id, level offset, from ].
  // The needed level is the building's new level plus the offset.
  levelUnlock: {
    1: [['b', 31, -1, 3]],    // Cottage 3 needs Town Hall 2, ... Cottage 10 Town Hall 9
    31: [['b', 32, -2, 3]],   // Town Hall 3 needs Walls 1, ... Town Hall 10 Walls 8
    24: [['t', 13, 0, 1]],    // Relief Station level N needs Horseback Riding N
  },
  uniqueTypes: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  insideTypes: [1, 2, 3, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  outsideTypes: [4, 5, 6, 7],
  // Outside plots available = outsideStart + outsideAdd * (Town Hall level - 1). From BuildingConstants.
  outsideStart: 13,
  outsideAdd: 3,
  maxLevel: 10,
  // From BuildingConstants: demolishing takes 50% of the level's build time and returns 30% of its cost.
  destructTimeRate: 0.5,
  destructRefundRate: 0.3,
  cancelRefundRate: 1.0,
  // Building queues (buildQueue.js): Bernini's Hammer lets each city queue 1 building per title, 10 at most.
  // enabled: false turns the client's queue buttons off.
  buildQueue: { enabled: true, max: 10 },
  // New lords build two buildings at once for their first 72 hours, as the client's notice and buff icon say (0: off).
  newPlayerDoubleBuildHours: 72,
  // The Coordinates List under the map ("Add to CL"): how many cities it holds (my estimate).
  coordinates: { max: 50 },
  // Chat (chat.js): speakers false lets everyone talk in the World channel without Speakers; beginnersInWorld true
  // lets lords under beginner's protection talk there too.
  chat: { speakers: true, beginnersInWorld: false, maxLength: 300 },
  // Achievements (effort.js): enabled false hides them and their bonuses.
  achievements: { enabled: true },
  // Stratagems (stratagems.js): the effects are the item texts; wageWarMinutes is how long after Wage War without
  // Declaration a declared war starts at once (Fox: 15), beautyTrapHours how long Beauty Trap weakens a hero (Fox: 8).
  stratagems: { enabled: true, wageWarMinutes: 15, beautyTrapHours: 8, cicadaSpeed: 0.3, rumors: 15, disguiseHours: 24 },
  // Economy
  baseProduction: 100,          // per resource per hour, before fields
  baseStorage: 10000,           // per resource, before fields add their "limit"
  populationGrowthPerHour: 0.5, // share of the gap to the settled population closed per hour (up or down)
  // The population settles at the population limit times (100 - tax rate)%, as on the live game (Fox, Oct 2026: no
  // Cottage gives a limit of 50, and at 10% tax a city holds 45). false lets it grow to the full limit.
  populationCapByTax: true,
  goldPerPopulationAtFullTax: 1,// gold/hour = population * taxRate/100 * this
  coinsPerMinuteOfSpeedup: 0,   // 0: Instant Finish costs what the Guidelines would (items.coinsFor; live); a number: coins a minute
  freeSpeedupSeconds: 300,      // the client offers a free finish under 5 minutes (CommonConstants.FREE_SPEED_TIME_LIMIT)

  // Coins (shown in the client as your coin wallet). The local "Get More Coins" page can add more.
  startCoins: 1000,
  coinsPage: true,

  // Troops. typeId -> [[ 'b', buildingTypeId, level ] | [ 't', techId, level ], ...]
  // UNVERIFIED: best guesses; compare with the live game's barracks requirements.
  troopUnlock: {
    2: [['b', 2, 1]],                                   // Worker: Barracks 1
    3: [['b', 2, 1]],                                   // Warrior: Barracks 1
    4: [['b', 2, 2], ['t', 7, 1]],                      // Scout: Barracks 2, Informatics 1
    5: [['b', 2, 2], ['t', 9, 1]],                      // Pikeman: Barracks 2, Military Tradition 1
    6: [['b', 2, 3], ['t', 10, 1]],                     // Swordsman: Barracks 3, Iron Working 1
    7: [['b', 2, 4], ['t', 14, 1]],                     // Archer: Barracks 4, Archery 1
    8: [['b', 2, 6], ['t', 11, 1]],                     // Transporter: Barracks 6 (the wiki's Barracks page), Logistics 1
    9: [['b', 2, 5], ['t', 13, 1]],                     // Cavalry: Barracks 5, Horseback Riding 1
    10: [['b', 2, 7], ['t', 13, 5]],                    // Cataphract: Barracks 7, Horseback Riding 5
    11: [['b', 2, 9], ['t', 19, 5], ['t', 14, 6]],      // Ballista: Barracks 9, Machinery 5, Archery 6
    12: [['b', 2, 9], ['t', 19, 7]],                    // Battering Ram: Barracks 9, Machinery 7
    13: [['b', 2, 10], ['t', 19, 10], ['t', 14, 10]],   // Catapult: Barracks 10, Machinery 10, Archery 10
  },
  // Military Science (tech 8) speeds training by its effect %. This adds a bonus per barracks level above 1.
  trainingSpeedPerBarracksLevel: 0,
  troopCancelRefundRate: 1.0,

  // Research requirements, from the Evony wiki's page for each topic (Fox's saved copies, Oct 2026).
  // Every tech level needs an Academy of at least that level, and each topic first opens at this Academy
  // level (the same as the client's Academy descriptions):
  //   1 Agriculture, Lumbering, Military Science · 2 Masonry, Mining, Military Tradition ·
  //   3 Metal Casting, Informatics, Iron Working · 4 Logistics, Compass, Archery ·
  //   5 Horseback Riding, Construction · 6 Stockpile, Medicine · 8 Engineering · 9 Machinery · 10 Privateering
  techAcademy: { 1: 1, 2: 1, 8: 1, 3: 2, 4: 2, 9: 2, 5: 3, 7: 3, 10: 3, 11: 4, 12: 4, 14: 4, 13: 5, 17: 5, 15: 6, 16: 6, 18: 8, 19: 9, 20: 10 },
  // Research needed before a topic's first level: techId -> [[ 'b' | 't', id, level ], ...]. Masonry's
  // Lumbering 1 and Iron Working's Military Science 2 are only on the wiki's Routine Quest page.
  techUnlock: {
    3: [['t', 2, 1]],                    // Masonry: Lumbering 1
    4: [['t', 3, 1]],                    // Mining: Masonry 1
    5: [['t', 4, 2]],                    // Metal Casting: Mining 2
    9: [['t', 8, 1]],                    // Military Tradition: Military Science 1
    10: [['t', 8, 2]],                   // Iron Working: Military Science 2
    11: [['t', 8, 2]],                   // Logistics: Military Science 2
    12: [['t', 8, 3]],                   // Compass: Military Science 3
    13: [['t', 8, 5]],                   // Horseback Riding: Military Science 5
    14: [['t', 8, 4]],                   // Archery: Military Science 4
    15: [['t', 2, 3]],                   // Stockpile: Lumbering 3
    16: [['t', 11, 3]],                  // Medicine: Logistics 3
    17: [['t', 2, 5], ['t', 5, 2]],      // Construction: Lumbering 5, Metal Casting 2
    18: [['t', 17, 3]],                  // Engineering: Construction 3
    19: [['t', 5, 4]],                   // Machinery: Metal Casting 4
    20: [['t', 7, 5], ['t', 8, 8]],      // Privateering: Informatics 5, Military Science 8
  },
  // Topics whose every level needs a building of the same level: Agriculture a Farm, Lumbering a Sawmill,
  // Masonry a Quarry, Mining an Ironmine, Metal Casting a Workshop, Military Science a Forge, Horseback
  // Riding a Stable, Stockpile a Warehouse (Agriculture 5 needs a level 5 Farm).
  techBuildingPerLevel: { 1: 7, 2: 4, 3: 5, 4: 6, 5: 26, 8: 22, 13: 20, 15: 3 },
  // Military Science takes this share off the remaining training time per level (the wiki: level 1 is 90%
  // of the base time, level 2 81%, level 10 35%). null: divide by (1 + the client's 10%-a-level effect).
  militaryScienceStep: 0.9,
  // The mayor's attack speeds training (the client's tutorial: with a mayor "troop training will be faster"): see
  // mayorStepPerPoint (0.9986 a point; Evony Advanced Guide's troop pages: 13% per 100).
  // The wiki's Warehouse page: Stockpile multiplies what the Warehouse protects by 1.1 per level (x2.59 at 10) and an
  // attacker's Privateering by 0.97 per level (-26% at 10). null: the client's straight 10% / 3% a level.
  stockpileStep: 1.1,
  privateeringStep: 0.97,
  researchCancelRefundRate: 1.0,

  // ---------- Heroes ----------
  // Historic heroes (see historicHeroes.js). Costs are the client's own texts; the loyalty numbers are UNVERIFIED.
  historicHeroes: {
    npcLevels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],   // NPC city levels a historic hero can wait in
    hearsayCount: 10, hearsayRefreshMinutes: 60,  // rumours the Inn shows, and how often they change on their own
    moreHearsayGold: 100, searchGold: 1000, detailsCents: 10,
    maxQuests: 10,                                // historic hero quests a lord can hold at once
    level: 30,                                    // wild historic heroes are always level 30 (Fox); the sheet's stats
                                                  // are their level 1 base, plus 60 points spread at random
    maxLevel: 150, pointsPerLevel: 2,             // live: the hero ranking's top 594 are historic heroes at 150,
                                                  // most holding exactly 300 points over the sheet (2 a level)
    hiredLoyalty: 70,                             // UNVERIFIED: loyalty right after hiring
  },
  heroFemaleChance: 0.25,          // UNVERIFIED: share of Inn heroes who are women (the client has 25 male and 9 female portraits)
  heroSalaryPerLevel: 20,          // gold an hour per hero level (the client's HeroConstants.SALARY_PRE_LEVEL)
  heroHireCostPerLevel: 1000,      // gold, as the Inn window shows
  persuadeGoldPerLevel: 1000,      // gold to persuade a captured hero, a level (the client's confirm text)
  innRefreshMinutes: 60,           // the Inn offers new heroes on its own this often (game time)
  innMaxLevelPerInnLevel: 8,       // UNVERIFIED: an Inn of level L offers heroes up to level 8 x L
  heroStartLoyalty: 70,            // UNVERIFIED
  heroPointsPerLevel: 1,
  heroExpBase: 150,                // experience to reach the next level = heroExpBase x level^2 (live: all 137 heroes in Fox's captures, 150 at 1 to 2,160,000 at 120)
  heroMaxLevel: 100,               // the highest level a hero reaches (Fox; a Legendary Ring's hero: ringHero.maxLevel)
  heroAwardGoldPerLevel: 100,      // UNVERIFIED: gold for "Reward" = this x hero level, +heroAwardLoyalty
  heroAwardLoyalty: 5,
  // What attributes do, in % per point. UNVERIFIED but in line with how Evony described them.
  mayorProductionPerPolitics: 1,   // the city's mayor raises resource production
  // Building, research and training speed: each whole point of the mayor's politics, intelligence or attack takes
  // this share off what is left (live for building: Fox's captures; training: the guide's 0.87 a hundred points).
  mayorStepPerPoint: 0.9986,
  // Each Construction level takes 10% off a building's (or wall defense's) time, compounding (live: 0.9^10).
  constructionStep: 0.9,
  heroAttackPerPoint: 1,           // a hero leading an army raises its attack by 1% per point
  heroDefencePerIntelligence: 1.01, // ...and its defence (fitted to dxcalc, Oct 2026)
  // How many troops a hero leads (Evony Advanced Guide, "Hero Leadership"): (leadership x perPoint + level) x leadership,
  // 110,000 for a level 100 hero with leadership 100. An ordinary hero's leadership is his level. Troops beyond
  // that get attackShare of his bonus when attacking (none: "never send more than your hero can lead") and
  // defenceShare when defending ("fight at 25% of your hero's bonus"). NPC cities' and Historic Cities' heroes
  // lead everything (dxcalc gives them leadership 9999). enabled: false gives every troop the full bonus.
  leadership: { enabled: true, perPoint: 10, attackShare: 0, defenceShare: 0.25 },
  // The star set life bonus (Evony Advanced Guide, "Star Set Life Bonus" and "Attacking NPC's"): when every one of
  // the lord's 14 gear technologies has at least this many stars, his troops get this much extra life (%, added to
  // Medicine's) when attacking an NPC city or a Historic City, whatever the leading hero wears (Fox's live
  // battles, Oct 2026). 5, 9 and 12 stars are the guide's confirmed 150%, 200% and 250% life; 14 and 15 are its
  // guesses (300% and 350%), and the battle fit puts dxcalc's 15-star value at +220% to +250%. valleys: true
  // also counts valley attacks; perHero: true counts only the pieces the leading hero wears.
  starSetLife: { tiers: [[5, 50], [9, 100], [12, 150], [14, 200], [15, 250]], valleys: false, perHero: false },
  // Battle experience, worked out from dxcalc reports: each enemy killed is worth troopExp (forts: the
  // client's own exp value / fortExpDivisor), times winFactor for the winning side or loseFactor for the loser.
  heroExp: { winFactor: 0.5, loseFactor: 0.25, fortExpDivisor: 50,
    // Live: 18 a Pikeman, 27 an Archer, 57 a Cavalry, 59.5 a Transporter, 175 a Cataphract, 200 a Ballista, about 275
    // a Battering Ram (Fox's reports: hero experience and honor, Oct 2026).
    troopExp: { 3: 6.1, 5: 18, 6: 26.3, 7: 27, 8: 59.5, 9: 57, 10: 175, 11: 200, 12: 275 },   // types not listed: troopExpPerResource x training cost
    troopExpPerResource: 0.027 },
  // Honor, from battles between lords (combat.honor): (worth of what you killed - worth of what you lost) / 8 for
  // the winner, / 2 for the loser. Fits all twelve of Fox's live reports to within a point.
  honor: { enabled: true, winDivisor: 8, loseDivisor: 2 },

  // ---------- Marches and battle ----------
  rallyArmiesPerLevel: 1,          // Rally Spot description: level N sends N armies of up to N x 10,000 troops
  rallyTroopsPerLevel: 10000,
  rallyTroopsPerLevelAbove10: 15000,  // NewArmyWin: levels 11+ add 15,000 each
  // Battle (see combat.js). Rules from players' guides: the field is the longest base range + fieldPad wide;
  // traps fire trapRatePercent of their starting number each round (dxcalc); damage follows players' Age I
  // formula, ranged units at half damage. The numbers marked "fitted" were tuned (Oct 2026) on Fox's seven dxcalc
  // battles (five with 15-star sets, two with none; each matched within about 8% on losses and 3 rounds), the
  // Evony Advanced Guide's live table of NPC 6-9 losses by star level (mostly within 15%) and its 0-loss ballista
  // farming of NPC 1-5, with the star set bonus and the Walls' range bonus counted. On Fox's two live NPC 5
  // battles it loses about 20% more than the live game. (m3.28, without either bonus: damageScale 0.214,
  // rangedScale 1.556, towerScale 0.309, trapKill 0.45/0.31, abatisKill 1.1, logPower and trebuchetPower 1.25,
  // towerRangePad 200, intelligence 0.8.)
  battle: {
    fieldPad: 200, maxRounds: 100,
    damageScale: 0.89,              // fitted
    rangedScale: 0.5,               // Age I: archers, ballistae and catapults do half damage (the fit agrees)
    towerScale: 0.2,                // fitted: archer's towers
    // Archers, ballistae, catapults and archer's towers shoot enemy archers, ballistae, catapults and towers in
    // their range before anything else (the Age I combat guide: "they will always attack enemy ranged units
    // first"). With it the guide's lossless ballista farming of NPC 1-5 comes out lossless (m3.74 refit).
    rangedFirst: true,
    // Experiments, off: distMod (ranged units do 50% beyond half their range, 100% within it, 25% point-blank,
    // the guide's table, instead of rangedScale's flat half), ballistaCreep ('A' or 'both': ballistae keep
    // moving while they shoot), defendersStay ('ranged' or 'all' hold the wall), wallRangeTowersOnly. None
    // fitted Fox's dxcalc runs better (Oct 26 2026).
    defenceFloor: 50,               // Age I: workers and scouts take damage as if their defence were 50
    minDefenceFactor: 0.1,          // UNVERIFIED: very high defence still lets 10% of the damage through
    trapRatePercent: 8, trapPower: 1.25,
    trapKill: { foot: 0.51, mounted: 0.28 },  // fitted: units killed per trap that fires, before trapPower
    abatisKill: 1.27,               // fitted: mounted units killed per abatis
    logPower: 0.72, trebuchetPower: 0.47,  // fitted
    trebuchetSiegeBonus: 3,         // UNVERIFIED: "excellent at destroying enemy siege weapons"
    towerRangePad: 0,               // archer's towers reach (1300 + this) x (1 + Archery + Walls)
    // A city's Walls give its defending archers, ballistae, catapults and archer's towers 4.5% more range per
    // level, added to Archery's (Fox, from the live game: archers 2,340 and towers 2,535 behind level 10 Walls
    // with Archery 10). NPC cities have Walls of their own level, Historic Cities level 10.
    wallRangePerLevel: 4.5,
  },
  // Attack bonuses, attacker typeId -> defender typeId (players' Age I table): swordsmen vs pikemen, cavalry
  // and cataphracts vs archers, pikemen vs horsemen, archers, ballistae and catapults vs cavalry.
  counters: { 6: { 5: 1.1 }, 9: { 7: 1.2 }, 10: { 7: 1.2 }, 5: { 9: 1.8, 10: 1.8 }, 7: { 9: 2 }, 11: { 9: 2 }, 13: { 9: 2 } },
  npcRecoverHours: 8,              // a beaten NPC city or valley regains its stores over this long (game time; the wiki: 8 hours).
                                   // Troops and defenses come back within an hour, and everything is full again after the daily reset.
  // Garrisons.
  // NPC cities 1-10: Evony's real troops, defenses and stores (Fox's tables, Oct 2026; NPC 6 pikemen and NPC 9
  // trebuchets corrected to 1,750 and 1,125, where dxcalc and an Age II guide agree). Every number checked against
  // Fox's live scout reports of NPC 1-10 (Oct 22 2026), which also put NPC 6's abatis at 2,250, as dxcalc does.
  // Columns: [Warrior, Pikeman, Swordsman, Archer, Cavalry] / [Trap, Abatis, Archer's Tower, Rolling log, Defensive Trebuchet]
  //          / [Food, Lumber, Stone, Iron, Gold]
  npcLevels: {
    1:  [[50, 40, 35, 15, 8],                [1000, 0, 0, 0, 0],             [100000, 20000, 20000, 20000, 55000]],
    2:  [[50, 45, 40, 30, 25],               [1850, 550, 0, 0, 0],           [200000, 30000, 30000, 30000, 65000]],
    3:  [[200, 160, 65, 40, 60],             [2000, 1000, 650, 0, 0],        [900000, 75000, 75000, 75000, 75000]],
    4:  [[400, 400, 100, 100, 150],          [4500, 1875, 550, 0, 0],        [1600000, 120000, 120000, 120000, 300000]],
    5:  [[750, 1000, 350, 250, 200],         [3750, 1875, 1250, 750, 0],     [3000000, 180000, 180000, 180000, 450000]],
    6:  [[4000, 1750, 550, 500, 450],        [4250, 2250, 1500, 950, 400],   [4000000, 200000, 200000, 200000, 600000]],
    7:  [[12000, 3000, 750, 800, 750],       [5600, 2800, 1850, 1100, 700],  [4500000, 500000, 500000, 500000, 800000]],
    8:  [[15000, 6750, 4000, 3000, 2000],    [7200, 3600, 2400, 1440, 900],  [8000000, 800000, 800000, 800000, 1000000]],
    9:  [[60000, 18000, 2000, 6750, 2500],   [9000, 4500, 3000, 1800, 1125], [14000000, 550000, 550000, 550000, 1200000]],
    10: [[400000, 0, 0, 0, 0],               [11000, 5500, 3666, 2200, 1375], [19000000, 600000, 600000, 600000, 1500000]],
  },
  // Historic Cities: Evony's real garrisons (Fox's scouting notes, Oct 2026; level 12 cavalry 108,444 as in Evony
  // Advanced Guide, which fits the x2.5 a level every other troop type follows). Where a line lists several troop
  // types, the city has that many of ONE of them, chosen again at every daily reset; a type written [type, n]
  // comes n strong instead (Fox's live scout reports, Oct 22 2026: a level 12 with 108,444 Ballistae and a level
  // 14 with 271,111, as many as their cavalry; that level 14 had 171,228 archers, 4 x the level 12's); at levels 16 and 18 only
  // swordsmen and pikemen change, and the cavalry and siege are always Cataphracts and Catapults (Evony Advanced
  // Guide, "Capturing Level 16/18 Historic Cities"). Defenses are the same at every level. Every Historic City is led by a level 100 King or Queen who can't be captured (attack and
  // intelligence below, from dxcalc).
  historicGarrison: {
    levels: {
      12: [[['militia'], 1120000], [['swordsmen', 'pikemen'], 162666], [['archer'], 42807], [['heavyCavalry', 'lightCavalry'], 108444], [[['ballista', 108444], 'catapult', 'batteringRam'], 14640]],
      14: [[['militia'], 2800000], [['swordsmen', 'pikemen'], 406666], [['archer'], 171228], [['heavyCavalry', 'lightCavalry'], 271111], [[['ballista', 271111], 'catapult', 'batteringRam'], 36600]],
      16: [[['militia'], 7000000], [['swordsmen', 'pikemen'], 1016665], [['archer'], 428070], [['heavyCavalry'], 677777], [['catapult'], 91500]],
      18: [[['militia'], 14000000], [['swordsmen', 'pikemen'], 2033330], [['archer'], 856140], [['heavyCavalry'], 1355555], [['catapult'], 183000]],
    },
    forts: { rollingLogs: 6000, arrowTower: 6666, rockfall: 5000, trap: 22000, abatis: 11000 },
    // The ruler's level, and the attack/intelligence dxcalc's presets use for each level (they model what
    // players actually saw; the in-game estimate was about 300). Historic Cities fight with research 10.
    hero: { level: 100, 12: { attack: 635, intelligence: 335 }, 14: { attack: 735, intelligence: 435 },
            16: { attack: 935, intelligence: 635 }, 18: { attack: 1335, intelligence: 1035 } },
    // Stores are a level 10 NPC city's times this factor: live, levels 12 and 14 both hold exactly an NPC 10's
    // (Fox's scout reports, Oct 22 2026). Levels 16 and 18 are UNVERIFIED.
    storesFactor: { 12: 1, 14: 1, 16: 1, 18: 1 },
  },
  // NPC cities fight with every military research at their own level and a hero of this attack/intelligence
  // (dxcalc's presets: 33 at levels 1-4, 44 from level 5).
  npcHero: { 1: 33, 2: 33, 3: 33, 4: 33, 5: 44, 6: 44, 7: 44, 8: 44, 9: 44, 10: 44 },
  // What Scouts see of an NPC city besides its garrison (Fox's live scout reports, Oct 22 2026): its population and
  // loyalty, by level 1-10 (a Historic City: level 10's), and its buildings (see NpcLogic.buildings). Its hero has
  // an ordinary name and a level from 1 to npcHeroMaxLevel (live: 3 to 50); the battle still uses npcHero above.
  npcSurvey: { population: [1000, 4000, 8000, 16000, 25000, 33000, 38000, 58000, 68000, 78000], loyalty: [80, 80, 90, 90, 90, 90, 90, 90, 90, 90] },
  npcHeroMaxLevel: 50,
  // Conquering NPC cities (Fox's live battle reports, Oct 23 2026: 34 won attacks took a level 8 from loyalty 90
  // to 0, and then the city was his). Each won attack lowers the city's loyalty by a random 1-3 (2-4 above 80;
  // loyaltyDrop below), whatever the battle's length (Fox, Oct 25). Loyalty climbs back a point every
  // recoverSeconds (160-200 fit; game time), and is full again after the daily reset (UNVERIFIED).
  // At 0 the city is the winner's if his title has a free city slot (the client: "Every upgrade of your Title
  // allows you to rule one more city (either by building or conquering one)"): its buildings stay, and the army
  // that took it stays as its garrison (the client shows no troops coming home from a conquest). Its hero is
  // captured (Fox). Historic Cities lose loyalty the same way and can be taken too (historic). lords: a Historic City
  // a lord holds is taken the same way, its loyalty being the city's own (it climbs back toward 100 minus the tax
  // rate, 10 points an hour); every hero still in it becomes the new lord's prisoner (Fox), and a lord keeps at
  // least one city.
  npcConquest: { enabled: true, recoverSeconds: 180, historic: true, lords: true,
    // What a won attack takes (Fox, Oct 25): [amount, chance] above `above` loyalty, and at or below it.
    // (Fox chose 10/40/50% at or below 80 so a level 8 takes about 34 wins, as his run did.)
    loyaltyDrop: { above: 80, high: [[2, 0.2], [3, 0.5], [4, 0.3]], low: [[1, 0.1], [2, 0.4], [3, 0.5]] },
    // A conquered NPC city's layout, the same for every level (Fox, Oct 23 2026: screenshots of a level 8, the
    // plot map, and the building on each plot): Cottages on plots 12-31; 0 Academy, 1 Forge, 2 Embassy, 3 Feasting
    // Hall, 4 Marketplace, 5 Beacon Tower, 6 Stable, 7 Inn, 8 Rally Spot, 9 Relief Station, 10 Workshop, 11
    // Barracks. Outside, Farms from 1001, then a Sawmill, a Quarry and an Ironmine on the last three plots the
    // Town Hall allows (1032-1034 at level 8; Fox: levels 1-10 all work the same, only the number of Farms
    // changes). Every captured city keeps the wall defenses that survived the final battle (Fox).
    // A conquered NPC city is called "New city" (live).
    layout: { inside: { 0: 25, 1: 22, 2: 28, 3: 27, 4: 23, 5: 30, 6: 20, 7: 21, 8: 29, 9: 24, 10: 26, 11: 2 }, cottages: [12, 31] },
    cityName: 'New city',
    // Every conquered city starts at 10% tax with all production rates at 80 (Fox's screenshots).
    taxRate: 10, productionRate: 80,
    // A conquered Historic City (Fox): Town Hall and Walls 10 and nothing else inside; outside, a Farm, Sawmill,
    // Quarry and Ironmine on plots 1001-1004 at the city's own level (12-18); 5,000 of each resource and 50
    // people. It keeps its name, and its power level (Village, Town, Fort, City) gives its Rally Spot 1.25, 1.5,
    // 2 or 3 times the troops (the client's NewArmyWin).
    historicStart: { resources: { food: 5000, wood: 5000, stone: 5000, iron: 5000, gold: 5000 }, population: 50 },
    // true: a conquered Historic City also comes with a Rally Spot at its own level on plot 11 (Fox's first
    // recollection). Off because his live capture shows none: every level 14 city's Rally Spot was built, at 10.
    historicRallySpot: false,
  },
  // Scouting. The detail level is your Informatics minus the target's: a lord's Informatics, a valley's (or
  // flat's) level, an NPC city's level, a Historic City's level (12-18). The Beacon Tower plays no part: it's for
  // warnings of incoming attacks. Checked on the live game (Fox, Oct 2026): with Informatics 6 and one Scout,
  // valleys of level 1-3 show exact troops (level 1 its hero too), levels 4-5 troops as words ("Horde",
  // "Lots"), 6-10 nothing; at a level 4 lake Informatics 1-4 sees nothing and 5 troops as words. With
  // Informatics 7 and one Scout an NPC city shows more the lower its level (cityReveal below), and NPC 8-10
  // and a level 12 Historic City nothing; with Informatics 10 and one Scout, NPC 1, 2, 3 and 10 show
  // everything, and a level 10 desert its troops and hero (informaticsAs below).
  scouting: {
    // Valleys and lords: the detail level at which each part of the report shows. Checked live at valleys: troop
    // words at 1-2, exact troops at 3, the hero at 5, nothing at 0. The rest of the order is mine.
    reveal: { troopWords: 1, fortWords: 2, troops: 3, forts: 3, resources: 3, survey: 4, hero: 5, buildings: 5, techs: 6 },
    // NPC and Historic Cities (Fox's live reports, Informatics 7 and one Scout at NPC 1-10, Oct 23 2026): at 0
    // food, lumber, stone and iron; at 1 the buildings but the resource fields (Sawmill, Quarry, Ironmine,
    // Farms); at 2 gold, population and loyalty; at 3 the fields; at 4 the defenses, exact; at 5 the troops,
    // exact (never as words); below 0 nothing. The hero didn't show even at 6, so 7 is a guess (UNVERIFIED).
    // gold and fields are separate from resources and buildings only where they're listed.
    cityReveal: { resources: 0, buildings: 1, gold: 2, survey: 2, fields: 3, forts: 4, troops: 5, hero: 7 },
    // The Informatics a level counts as against NPC cities, Historic Cities and valleys (not lords); levels not
    // listed count as themselves. Live (Fox, Oct 23 2026), Informatics 10 and ONE Scout saw everything at NPC
    // 10, hero included, where the difference rule gives 0 (Informatics 7 at NPC 7 saw only the four
    // resources), and a level 10 desert's exact troops and hero (Informatics 6 at a level 6 hill: nothing);
    // with 100 Scouts it saw everything at level 12 and 14 Historic Cities too. So 10 counts as enough for
    // anything. Informatics 8 and 9 are UNVERIFIED (as themselves). The two accounts are on different live
    // servers (battlena63 at 7 and 6, battlecc2 at 10), so a server setting is the other explanation.
    informaticsAs: { 10: 99 },
    // Extra detail for sending more Scouts to an NPC or Historic City: [at least this many Scouts, extra
    // levels], the highest that fits. Off: one Scout at Informatics 10 saw as much as 100.
    scoutTiers: [],
    // Exact numbers need this many Scouts per level of the target (a lord's city: its Town Hall level; a Historic
    // City: 10), or the amounts stay words. The wiki says 10, but live one Scout sees a level 3 lake's numbers
    // (Fox, Oct 2026), so this is off (0).
    scoutsPerLevel: 0,
    // Amounts as words, [up to, word]; the last has no limit. The wiki's "Troops Amount" table.
    words: [[24, 'Few'], [49, 'Pack'], [99, 'Lots'], [249, 'Horde'], [499, 'Throng'], [999, 'Swarm'], [2499, 'Zounds'], [4999, 'Legion'], [9999, 'Bulk'], [null, 'Giga']],
    // A lord's city: your Scouts fight its Scouts. Strength = scouts x (1 + Informatics x perInformatics) x
    // (1 + intelligence x perIntelligence), with the leading hero's intelligence for you and the mayor's for
    // them. The weaker side's Scouts die, and the winner loses the same share of strength. UNVERIFIED.
    perInformatics: 0.1, perIntelligence: 0.01,
  },
  // Defenses rebuilt right after a battle (dxcalc). NPC: destroyed x (Machinery + 1) x npcRepair;
  // player cities: destroyed x repairRate x 2^Machinery.
  npcRepair: { arrowTower: 0.03, trap: 0.05, abatis: 0.06, rollingLogs: 0.07, rockfall: 0.08 },
  // How fast NPC and Historic City defenses grow back, as a share of full strength an hour (NPC cities: dxcalc and
  // Fox's NPC 8 reports; Historic Cities: Fox, about 10%), and whether a Historic City rebuilds right after a battle.
  npcFortRegen: { perHour: 1, historicPerHour: 0.1, historicRepair: false },
  repairRate: { arrowTower: 0.33 / 1024, trap: 0.55 / 1024, abatis: 0.66 / 1024, rollingLogs: 0.77 / 1024, rockfall: 0.88 / 1024 },
  dailyResetHourUTC: 0,            // the daily reset: either/or Historic City troops change, NPC cities refill, valleys level up
  // Valleys and flats go up a level at every daily reset, from 10 back to 1 (the wiki's Valley page); a held valley
  // keeps the level it was taken at. false keeps every valley at one level.
  valleyCycle: true,
  // Valleys: UNVERIFIED estimates. Troops: field -> [per level^2, from level].
  // Valley (and flat) garrisons. Levels 1-5: base + perLevel x level troops, split by `mix`. Fox's live scout
  // reports (Oct 2026): level 1 35 warriors and 12 pikemen, level 2 51 and 17, level 3 90 pikemen, level 4 pikemen
  // ("Horde", 100-249), level 5 swordsmen and archers ("Lots" each, 50-99).
  // From level 6 (`random`, npc.js): one to three kinds picked each day share `strength` x growth^(level - 6),
  // varied by up to `vary` either way; a kind's count is its share times its weight. Live (Fox, Oct 25-26 2026):
  // level 6 136 swordsmen, 136 archers, 64 cavalry; 7 1,661 warriors, 562 pikemen, 375 archers; 8 1,058 archers and
  // 501 cavalry; 9 10,231 warriors; 10 2,294 pikemen, 1,529 swordsmen, 724 cavalry, and another 3,236 pikemen,
  // 2,157 archers and 1,022 cavalry. Strength (in cavalry): 193, 533, 1,002, 1,094, 2,174-3,066.
  garrison: {
    valley: { base: 24, perLevel: 22,
      random: { from: 6, strength: 200, growth: 1.92, vary: 0.35, maxTypes: 3, types: ['militia', 'pikemen', 'swordsmen', 'archer', 'lightCavalry'],
        weights: { militia: 9.3, pikemen: 3.16, swordsmen: 2.11, archer: 2.11, lightCavalry: 1 } }, mix: {
      1: { militia: 0.75, pikemen: 0.25 }, 2: { militia: 0.75, pikemen: 0.25 }, 3: { pikemen: 1 }, 4: { pikemen: 1 },
      5: { swordsmen: 0.5, archer: 0.5 }, 6: { swordsmen: 0.5, archer: 0.5 }, 7: { archer: 0.5, lightCavalry: 0.5 },
      8: { archer: 0.5, lightCavalry: 0.5 }, 9: { lightCavalry: 1 }, 10: { lightCavalry: 1 } } },
  },

  // ---------- Wall defenses ----------
  // Fortification typeId -> [[ 'b' | 't', id, level ], ...]. UNVERIFIED.
  fortUnlock: { 14: [['b', 32, 1]], 15: [['b', 32, 2]], 16: [['b', 32, 3], ['t', 14, 1]], 17: [['b', 32, 5]], 18: [['b', 32, 7]] },
  fortCancelRefundRate: 1.0,
  fortDemolishRefundRate: 0.5,

  // ---------- Town Hall: Comfort and Levy ----------
  pacifyCooldownMinutes: 15,       // UNVERIFIED
  levyCooldownMinutes: 15,         // UNVERIFIED
  levyLoyaltyCost: 20,             // the client says Levy lowers loyalty by 20

  // ---------- Historic Cities ----------
  // Levels 18, 16 and 14 match the live game. Level 12s are every 18 tiles from 9,9 (Fox's notes); which
  // name sits where among the level 12s is a guess: UNVERIFIED.
  // level12Clearance: a level 12 grid tile this close to a bigger Historic City stays empty (Fox, live server).
  historic: { level12Enabled: true, level12: { x0: 9, y0: 9, step: 18 }, level12Clearance: 9 },

  // ---------- Items ----------
  blueprintFromLevel: 10,          // upgrading a building to this level uses a Michelangelo's Script (null: never; live: not past 10)
  heroItemBuffPercent: 25,         // Excalibur, The Art of War, The Wealth of Nations
  // Teleporting abandons the city's valleys, as on the live game; armies must be home first.
  teleport: { keepValleys: false, needArmiesHome: true },
  maxCities: 10,                   // most cities a lord can hold; each title allows one more (Civilian 1 ... Prinzessin 10)
  // Flats can be conquered like valleys (they hold no troops and produce nothing), as the City Expansion
  // quest "Conquering" asks. Each one uses a valley slot.
  flatsConquerable: true,
  // Building a new city on a flat you've conquered (FieldInfoWin's Build City, or a Build City march): the workers
  // and materials it takes from the sending city. The materials are used up and the workers stay on as the new
  // city's workers; any other troops come home (or stay, if the march window says so). Each title allows one more
  // city (maxCities above). `start` is what the new city has, as on the live game (Fox, Oct 2026): the same as a new
  // lord's first city (start above) but with 68,550 gold.
  // The name a city built on a flat (or founded with a city token) gets: "new" on the live game (Fox's screenshot).
  // City names are at most 10 characters in the client's rename window.
  newCityName: 'new',
  buildCity: {
    workers: 250, cost: { food: 10000, wood: 10000, stone: 10000, iron: 10000, gold: 10000 },
    start: { buildings: { '-1': [31, 1] }, resources: { food: 5000, wood: 5000, stone: 5000, iron: 5000, gold: 68550 }, population: 45, taxRate: 10, productionRate: 80 },
  },
  // Routine quests. dailyAmulet: the Daily Amulet category (a free Aries Amulet a day), which is this
  // server's own, not the live game's; false hides it.
  quests: { dailyAmulet: true, systems: { mail: true, market: true, injured: true, uprising: true, chat: true, achievement: true, stratagem: true } },
  // The Marketplace (the client's own texts): a 0.5% trading fee on every post, unit prices up to 150 gold, a
  // level L Marketplace holds L pending orders, and what you buy takes 30 minutes to arrive (game time).
  market: { feeRate: 0.005, maxPrice: 150, ordersPerLevel: 1, transportMinutes: 30 },
  // Wounded troops (Fox's live NPC 8 battle reports, Oct 23 2026, and the client's Hospital window): a tenth of
  // the troops lost in a battle survive wounded ("Wounded Proportion: 10%", rounded down per kind) and rest in
  // the Rally Spot of the city they belong to. Curing costs gold per troop: Scout 69, Archer 140, Cavalry 285,
  // Cataphract 875 (exact in all 31 reports); the other kinds cost healShare of their training resources, which
  // is what Scouts and Archers come to (UNVERIFIED). With Auto Heal on, every wounded troop in the city is cured
  // as soon as the battle ends if the city has the gold. "If the wounded soldiers are not attended to in time,
  // they will gradually die": diePerHour of them an hour (game time; the rate is UNVERIFIED).
  wounded: { share: 0.1, healGold: { scouter: 69, archer: 140, lightCavalry: 285, heavyCavalry: 875 }, healShare: 0.147, diePerHour: 0.1 },
  // Historic City policies (PoliciesView; the amounts are the client's own texts, in policies.js). Draft area,
  // miles in any direction, and uses a day, by Historic City level (Evony Advanced Guide): level 12 9 miles and 4
  // a day, 14 33 miles, 16 its whole state (99), 18 the whole map and 10 a day; levels 14 and 16 6 and 8 a day
  // (Fox, Oct 26 2026).
  policies: { perDay: { 12: 4, 14: 6, 16: 8, 18: 10 }, range: { 12: 9, 14: 33, 16: 99, 18: 400 } },
  // Colonies (colonies.js; game time, so a faster server shortens them). Fox (live, Oct 2026): the Colonization
  // Period is 8 hours, the colonizing army comes home once the Stabilization battle is won, and a colony pays 5% of
  // its production as tribute, continuously. One of Fox's cities is the suzerain of 28, so there's no limit here.
  //   max, perCity     colonies a lord, or one city, may hold (or be colonizing); null = no limit.
  //   policyShare      what each colony policy takes (the client: "10% of its gold reserve", "10% of its food
  //                    stock", "10% of idle population", "10% of one branch of troops"); one policy a day per colony.
  //   sowDiscordLoyalty  the client: "Decrease the loyalty of all heroes in the target city by 30 points".
  //   sowCaptureChance chance Sow Discord also captures a hero (the client says "a chance"; UNVERIFIED).
  //   uprisingMinutes  the client: "Your city's army fight your suzerain's suppression army in 30 minutes".
  //   withdrawHours    the client: "there's a 5-hour cool down for every troops withdrawal".
  //   abandonHours     how long handing a colony back takes (Instant Handover skips it; UNVERIFIED).
  colonies: { enabled: true, periodHours: 8, tributeShare: 0.05, max: null, perCity: null, policyShare: 0.1, sowDiscordLoyalty: 30, sowCaptureChance: 0.2,
    uprisingMinutes: 30, withdrawHours: 5, abandonHours: 12 },
  // Recruit Hero (handlers/heroes.js): a Legendary Ring makes a hero of this level with each attribute rolled
  // between min and max (UNVERIFIED: the client shows only the numbers it is sent), with freeResets free re-rolls a
  // day (the client: "Free reset of attributes 3 times today").
  // A Legendary Ring's hero (Fox's live capture, Oct 26 2026): level 1, loyalty 70, 2 points a level, up to level 120
  // (his eight 120s). Rolls seen: 51 to 110 in his capture, as low as 60 and as high as 170 on live (Fox).
  ringHero: { level: 1, min: 50, max: 170, freeResets: 3, maxLevel: 120, pointsPerLevel: 2 },
  // The Governor election (fame.js; Fox and the wiki): lords with minPrestige vote once a day; the poll closes at the
  // daily reset on closeDay (0 Sunday ... 6 Saturday; Monday, Fox).
  votes: { enabled: true, minPrestige: 1000, closeDay: 1 },
  // War (war.js; the client's texts): a lord's ordinary city can be attacked or colonized only in wartime, which
  // begins prepMinutes after Declare War and lasts warHours. Real time, as the client counts it. required: false
  // lets lords attack each other without a war (Historic Cities they hold are open either way).
  war: { enabled: true, required: true, prepMinutes: 30, warHours: 48 },
  // Alliances (alliances.js; AllianceConstants and the client's texts): createEmbassy and joinEmbassy the Embassy
  // levels to found and to join one, createGold what founding costs, nameMax its name's length, quitPrestigeRate
  // what quitting takes off the lord's prestige, relationCooldownHours how often a relation can change. Members:
  // membersPerEmbassyLevel a level of the Host's best Embassy, at most maxMembers (UNVERIFIED: live shows 100 for
  // a big alliance; 0 gives every alliance maxMembers).
  alliances: { createEmbassy: 2, joinEmbassy: 1, createGold: 10000, nameMax: 8, quitPrestigeRate: 0.1, relationCooldownHours: 24,
    maxMembers: 100, membersPerEmbassyLevel: 10, rankLimits: { 5: 2, 6: 5, 7: 10 }, textMax: 500, eventsMax: 200 },
  // Beginner's Protection (the client's own check): 7 days from the lord's creation, or until one of his Town Halls
  // reaches level 5. No war can be declared on him, and he can't declare one.
  beginnerProtection: { enabled: true, days: 7, townHall: 5 },
  // What a city's Beacon Tower shows of an incoming army, by level (the wiki's table): its purpose, arrival time,
  // lord, starting point, kinds of troops, roughly how many (the scouting words), exactly how many, and its hero.
  beacon: { purpose: 2, arrival: 3, lord: 4, origin: 5, kinds: 6, rough: 7, exact: 8, hero: 9 },
  // Mail: each box keeps this many mails, and system mails come from this sender.
  mail: { maxPerBox: 300, systemSender: 'System' },
  // Prestige for what is built, researched, trained and fortified: this much per resource spent (gold
  // included), credited when it finishes. UNVERIFIED: the client has no prestige values. 0.01 means 100
  // prestige per 10,000 resources; Knight needs 1,000 prestige, Prinzessin 256,000.
  // byTownHalls: divide it by all the lord's Town Hall levels together (the wiki; false: don't).
  prestige: { perResource: 0.01, byTownHalls: true },
  // Prestige from won attacks on NPC cities, Historic Cities and valleys (armies.battlePrestige), my fit to Fox's
  // 27 live attacks on an NPC 8 and the Evony Advanced Guide: what was killed is worth (as for hero experience)
  // x what the defenders were worth / what the attacking army was worth (capped at maxRatio) x factor, divided by
  // all the lord's Town Hall levels. So fewer troops sent earn more, and a lord with few Town Hall levels far more.
  // A lost battle costs the prestige the lost troops earned when trained (the wiki).
  battlePrestige: { enabled: true, factor: 0.01477, maxRatio: 10, losses: true },
  // Medals from won attacks on NPC and Historic Cities: chance = baseChance + chancePerLevel x level, the
  // medal rising with the city's level (level 1 mostly Cross, level 10 mostly Nation). UNVERIFIED.
  npcMedals: { enabled: true, baseChance: 0.2, chancePerLevel: 0.03 },
  // Hero gear research in the Workshop, minutes of game time for levels 1-10. UNVERIFIED: the client has
  // no times for these.
  // heroLevelsPerLevel: a hero wears gear up to one level per this many hero levels (Evony Advanced Guide, "Hero
  // Gear"; checked live by Fox), so a level 35 hero wears level 3 gear even when the Workshop has level 10, with
  // at most 9 stars (a level's stars: level + 6). 0 turns the limit off.
  gear: { researchMinutes: [5, 15, 30, 60, 120, 240, 480, 720, 1080, 1440], heroLevelsPerLevel: 10 },
  // Wheel of Fortune (Amulets). The board has 24 prizes, as on the live game; one is the grand prize (kind 1).
  // Like the live boards (Fox's screenshots), it mixes items with 1,000,000 of a resource (`resources`),
  // 10, 30 or 100 cents (`cents`) and gear materials by 5 (`materials`). Which prizes and how often each
  // is won are UNVERIFIED (itemUse.js PRIZES and TIER_ODDS).
  wheel: { slots: 24, resources: 1000000, cents: [10, 30, 100], materials: 5 },

  // World map
  zones: ['FRIESLAND', 'SAXONY', 'NORTH MARCH', 'BOHEMIA', 'LOWER LORRAINE', 'FRANCONIA', 'THURINGIA', 'MORAVIA',
          'UPPER LORRAINE', 'SWABIA', 'BAVARIA', 'CARINTHIA', 'BURGUNDY', 'LOMBARDY', 'TUSCANY', 'ROMAGNA'],
  npcOwner: 'Barbarians',
};

function merge(a, b){
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const o = { ...a };
  for (const k of Object.keys(b)) o[k] = (a && typeof a[k] === 'object' && !Array.isArray(a[k])) ? merge(a[k], b[k]) : b[k];
  return o;
}

function loadRules(dataDir, log){
  const file = path.join(dataDir, 'rules.json');
  if (!fs.existsSync(file)) return DEFAULTS;
  try { return merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (e){ log.warn(`Ignoring data/rules.json: ${e.message}`); return DEFAULTS; }
}

module.exports = { loadRules, DEFAULTS };
