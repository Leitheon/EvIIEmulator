'use strict';
// Turns server state into the data objects ("beans") the client parses. Field names match
// the client's bean classes exactly (see docs/PROTOCOL.md).
const world = require('./world');
const { STATUS } = require('./castle');

const pad = n => String(n).padStart(2, '0');
// Context.timerHandler parses "YYYY.MM.DD HH.MM.SS" every second.
function dateTime(ms){ const d = new Date(ms); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`; }

class Beans {
  constructor(data, logic, items){ this.data = data; this.logic = logic; this.items = items; this.game = null; }

  building(pos, b){
    return { positionId: Number(pos), typeId: b.typeId, level: b.level, status: b.status, startTime: b.startTime || 0, endTime: b.endTime || 0,
      name: this.logic.typeName(b.typeId), appearance: 0, help: 0 };
  }
  // increaseRate is the gross output: the client takes troopCostFood (and adds colony and supply food) itself, both
  // for the numbers it shows and for counting the food up between updates (Context.timerHandler).
  resourceInfo(c, p, k, r){
    const prod = r[k];
    return { amount: Math.floor(c.res[k]), increaseRate: Math.round(prod * this.logic.speed), max: this.logic.capacity(c, p, k), storeRercent: 100, workPeople: 0 };
  }
  resource(c, p){
    const r = this.logic.rates(c, p);
    return {
      food: this.resourceInfo(c, p, 'food', r), wood: this.resourceInfo(c, p, 'wood', r), stone: this.resourceInfo(c, p, 'stone', r), iron: this.resourceInfo(c, p, 'iron', r),
      gold: Math.floor(c.res.gold), curPopulation: Math.floor(c.pop), maxPopulation: this.logic.popMax(c), populationDirection: this.popDirection(c),
      texRate: c.taxRate, taxIncome: Math.floor((r.gold + r.salary - (r.tribute?.gold || 0)) * this.logic.speed), support: Math.round(c.loyalty ?? (100 - c.taxRate)), complaint: Math.round(c.complaint || 0),
      workPeople: Math.min(Math.floor(c.pop), r.workNeeded), buildPeople: 0, herosSalary: Math.round(r.salary * this.logic.speed), troopCostFood: Math.round(r.foodUpkeep * this.logic.speed), supplyFood: 0,
      // Tribute an hour: received by a suzerain (positive), paid by a colony (negative, as ResourceProduction adds it).
      ...Object.fromEntries(['food', 'gold', 'iron', 'stone', 'wood'].map(k => ['colony' + k[0].toUpperCase() + k.slice(1), Math.round((r.tribute?.[k] || 0) * this.logic.speed)])),
    };
  }
  // The population tooltip's Rising / Stable / Falling: toward the level the tax rate lets it settle at.
  popDirection(c){ const t = this.logic.popTarget(c); return c.pop < t - 0.5 ? 1 : c.pop > t + 0.5 ? -1 : 0; }
  troop(c){ const t = {}; for (const x of Object.values(this.data.troops)) t[x.field] = c.troops?.[x.field] || 0; return t; }
  troopStr(c){ const t = {}; for (const x of Object.values(this.data.troops)) t[x.field] = String(c.troops?.[x.field] || 0); return t; }
  forts(c){ const f = {}; for (const x of Object.values(this.data.forts)) f[x.field] = c.forts?.[x.field] || 0; return f; }
  castle(c, p){
    const buildings = Object.entries(c.buildings).filter(([, b]) => b.level > 0 || b.status !== STATUS.NORMAL).map(([pos, b]) => this.building(pos, b));
    // powerlevel 4 is an ordinary city (FieldConstants.POWER_NORMAL); 0-3 are captured Historic Cities, which
    // the client gives higher resource field caps, Policies on the map and a bigger Rally Spot limit.
    return {
      id: c.id, name: c.name, fieldId: c.fieldId, zoneId: world.zoneOf(c.fieldId), icon: c.icon || 0, logUrl: c.logUrl || null, status: 0, powerlevel: c.powerLevel ?? 4,   // (an amulet city is an ordinary city, 4, on the live server: Fox's capture)
      allowAlliance: c.allowAlliance !== false, canChangeIcon: true, goOutForBattle: this.game.armies.gateOpen(c), hasEnemy: this.game.armies.incoming(c).length > 0, colonization: this.game.colonies.colonization(c), usePACIFY_SUCCOUR_OR_PACIFY_PRAY: 0,
      buildings, buildingQueues: this.game.buildQueue.beans(c), resource: this.resource(c, p), troop: this.troop(c), strTroop: this.troopStr(c), fortification: this.forts(c),
      heros: (c.heroes || []).map(h => this.game.heroes.bean(h)), fields: (c.valleys || []).map(id => this.game.armies.fieldBean(world.tileAt(this.game.store, id))),
      buffs: [], trades: this.game.market.ordersOf(c).map(o => this.game.market.tradeBean(o)), transingTrades: this.game.market.shipsOf(c).map(s => this.game.market.shipBean(s)), colonyBeans: this.game.colonies.beans(c), mercenaryBeans: [],
    };
  }
  mailCounts(p){ const m = this.game.mail.counts(p); return { newMailCount: m.count, newMaileCount_inbox: m.count_inbox, newMaileCount_system: m.count_system }; }
  reportCounts(p){
    const u = this.game.reports.unread(p);
    return { newReportCount: u.count, newReportCount_army: u.army_count, newReportCount_other: u.other_count, newReportCount_scout: u.scout_cout, newReportCount_trade: u.trade_count };
  }
  // Place in the prestige ranking (1 = most prestige).
  prestigeRank(p){ const mine = p.prestige || 0; return 1 + Object.values(this.game.db.players).filter(o => (o.prestige || 0) > mine).length; }
  playerInfo(p, castles){
    return {
      id: p.id, userId: p.id, userName: p.name, accountName: p.account, sex: p.sex || 0, faceUrl: p.faceUrl, flag: p.flag, alliance: this.game.alliances.of(p)?.name || '', allianceLevel: this.game.alliances.rankName(p),
      office: this.game.quests.rankName(p), titleId: this.game.quests.title(p), levelId: this.game.alliances.rank(p), starlv: this.game.equipment.setStars(p, null), medal: Math.floor(p.coins || 0), honor: Math.round(p.honor || 0),
      prestige: Math.floor(p.prestige || 0), ranking: this.prestigeRank(p), population: castles.reduce((a, c) => a + Math.floor(c.pop), 0),
      castleCount: castles.length, createrTime: p.createdAt, lastLoginTime: p.lastLoginAt || p.createdAt, date: dateTime(p.createdAt), effortPoint: p.effort?.points || 0, bdenyotherplayer: 0,
      facebookId: '', ...this.game.fame.fields(p),
    };
  }
  player(p, castles, now){
    return {
      playerInfo: this.playerInfo(p, castles), castles: castles.map(c => this.castle(c, p)),
      currentTime: now, currentDateTime: dateTime(now), mapSizeX: world.SIZE, mapSizeY: world.SIZE, gameSpeed: Math.max(1, Math.round(this.logic.speed)),
      tutorialStepId: p.tutorialStep ?? 999, freshMan: this.game.war.beginner(p, now), isEvonyMember: !!p.evonyMember, isSetSecurityCode: this.game.account.isSet(p, now), changedFace: !!p.changedFace,
      furlough: !!this.game.account.vacation(p, now), furloughDay: p.furlough?.days || 0, autoFurlough: !!p.furlough?.auto, autoHeal: !!p.autoHeal, isReceiveIncomingAttack: p.receiveIncomingAttack !== false, finishedQuestCount: 0, effortPoint: p.effort?.points || 0, redCount: 0, disconnectvotes: 0,
      ...this.mailCounts(p), ...this.reportCounts(p),
      emailAddress: p.email || '', headline: p.headline || '', digiId: '', gamblingItemIndex: 0, returnReport: !!p.returnReport,
      items: this.items.itemBeans(p), buffs: this.items.buffBeans(p, now), saleItemBeans: this.items.saleItems(), saleTypeBeans: this.items.saleTypes(),
      troopConfigBeans: Object.entries(p.troopConfigs || {}).map(([name, x]) => ({ name, time: x.time, troop: this.troop({ troops: x.troop }) })), selfArmys: this.game.armies.beans(p), friendArmys: this.game.armies.friends(p), enemyArmys: this.game.armies.enemies(p), friendBeans: this.game.friends.beans(p, 'friend'), blockBeans: this.game.friends.beans(p, 'block'), castleSignBean: this.game.signs(p), declaredWarBeans: this.game.war.beans(p, now),
      equipments: this.game.equipment.types().map(t => ({ equipmenttechid: t, lv: this.game.equipment.level(p, t) })),
      gemstoneinpos: [], packageBean: this.game.packages.beans(p, now), randomEvents: [], setshowinfro: this.game.heroes.shownOf ? this.game.heroes.shownOf(p) : [],
    };
  }
}

module.exports = { Beans, dateTime };
