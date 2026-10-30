'use strict';
// Commission Quests: the Quest window's Commission tab (QuestWin, AddArmyWin, QuestAmryInfo; CommissionQuestCommands).
// The only kind in the client is Anti-Colonization (CommonConstants.COMMISSION_QUEST_TYPE_COLONY). Its own texts:
//   Issuing: "the designated city will execute Uprise order automatically. Quest is available for default 24 hours.
//   If you have manually executed Uprise before, the quest is only available for the remaining time of the Uprising
//   War. You cannot issue Commission Quest while the remaining time is less than an hour. Once this quest is issued,
//   you cannot manually Resist your Suzerain. The mercenary troops will fight for you when the quest (bidding)
//   expires. Players who accepted the commission quest will get the chance to join the uprising battle against the
//   Suzerain one by one. And the player who wins the uprising battle will receive game coins as reward."
//   Bidding: "Players who run for the quest can add troops anytime during the Uprising Period to secure the claim.
//   Player's troops that have the highest experience will be granted the quest. Troops can only be recalled by
//   giving up the quest. Troops cost normal upkeep of bidders."
// Here the reward (cents) is taken from the issuer when he issues. Bidders' armies march to the colony (mission 10)
// and camp there, fed by their own cities. When the uprising war ends the suzerain's suppression army fights them a
// bidder at a time, the highest Army's Experience (what the troops are worth, as hero experience counts it) first,
// each bidder's troops defending the city with its walls and defenses; what is left of the suppression army goes on
// to the next. The first bidder to beat it frees the city and is paid the reward. If none does, what is left of it
// fights the colony itself as in any uprising, and the issuer gets the reward back. With no suppression army set the
// city goes free unopposed and the bidder ranked first is paid. The ranking can only show your own army's details.
const world = require('./world');
const { TYPE } = require('./castle');
const { REPORT_TYPE, battleXml } = require('./reports');
const { HERO_STATUS } = require('./heroes');

const TYPE_COLONY = 1, MISSION_ANTI = 10, DIR_STAY = 3, DIR_FORWARD = 1;
const pad = n => String(n).padStart(2, '0');
const dateTime = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const N = n => Math.floor(n).toLocaleString('en-US');

class Commission {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.commission || {}; }
  list(){ return this.db.commissions || (this.db.commissions = {}); }
  quests(){ return Object.values(this.list()); }
  open(){ return this.quests().filter(q => q.status === 'open'); }
  ofColony(rec){ return rec ? this.open().find(q => q.colonyRecId === rec.id) || null : null; }
  player(id){ return this.db.players[id] || null; }
  castle(id){ return this.db.castles[id] || null; }
  ms(hours){ return hours * 3600000 / this.g.logic.speed; }

  // ---------- the quest list beans ----------
  bean(q, p){
    const dc = this.castle(q.colonyCastleId), { x, y } = world.xy(dc ? dc.fieldId : q.fieldId);
    return { id: q.id, type: q.type, name: 'Anti-Colonization', position: `${x},${y}`, target: dc ? dc.name : q.colonyName || '',
      reward: q.reward, timeout: q.status === 'open' ? q.endTime : 0, endtime: dateTime(q.endTime), playerCount: q.bidders.length,
      isAccepted: !!p && q.bidders.some(b => b.playerId === p.id), isMyIssue: !!p && q.issuerId === p.id, isFinish: q.status !== 'open' };
  }
  all(p){ return this.open().sort((a, b) => b.reward - a.reward || a.endTime - b.endTime).map(q => this.bean(q, p)); }
  // Yours: open, and those that ended in the last day.
  mine(p, now = this.g.now()){ return this.quests().filter(q => q.issuerId === p.id && (q.status === 'open' || now - (q.finishedAt || 0) < 86400000)).map(q => this.bean(q, p)); }
  accepted(p){ return this.open().filter(q => q.bidders.some(b => b.playerId === p.id)).map(q => this.bean(q, p)); }

  // ---------- issuing ----------
  issue(p, type, x, y, reward, now){
    const g = this.g;
    if (Number(type) !== TYPE_COLONY) return [-1, 'Unknown kind of commission quest.'];
    const fx = Math.floor(Number(x)), fy = Math.floor(Number(y));
    if (!(fx >= 0 && fy >= 0 && fx < world.SIZE && fy < world.SIZE)) return [-1, 'Enter the coordinates of one of your own cities that is a colony.'];
    const fid = world.idOf(fx, fy);
    const tile = world.tileAt(g.store, fid, now), dc = tile.type === world.T.CASTLE ? this.castle(tile.castleId) : null;
    if (!dc || dc.playerId !== p.id) return [-1, 'Enter the coordinates of one of your own cities that is a colony.'];
    const rec = g.colonies.ofColony(dc);
    if (!rec || rec.colonyPlayerId !== p.id || ![2, 3].includes(rec.status)) return [-1, `${dc.name} is not a colony, so it needs no Anti-Colonization quest.`];
    if (this.ofColony(rec)) return [-1, `${dc.name} already has a commission quest.`];
    reward = Math.floor(Number(reward));
    const min = this.rules.minReward ?? 1;
    if (!(reward >= min)) return [-1, `The reward must be at least ${N(min)} cents.`];
    if ((p.coins || 0) < reward) return [-1, `You have only ${N(p.coins || 0)} cents for the reward.`];
    if (rec.status === 3){
      if (rec.endTime - now < this.ms(1)) return [-1, 'You cannot issue a Commission Quest while less than an hour of the uprising is left.'];
    } else {
      const r = g.colonies.uprise(dc, p, now, (this.rules.hours ?? 24) * 60);
      if (Array.isArray(r)) return r;
    }
    p.coins -= reward;
    const id = g.store.id();
    const q = this.list()[id] = { id, type: TYPE_COLONY, issuerId: p.id, colonyCastleId: dc.id, colonyName: dc.name, fieldId: dc.fieldId, colonyRecId: rec.id,
      suzerainId: rec.suzerainPlayerId, reward, createdAt: now, endTime: rec.endTime, status: 'open', bidders: [] };
    g.quests.flag(p, 'commission');
    g.store.touch(); g.pushPlayerInfo(p);
    g.log.info(`${p.name} issued an Anti-Colonization quest for ${dc.name} (${N(reward)} cents, until ${new Date(q.endTime).toLocaleString()})`);
    return { quest: q };
  }

  // ---------- bidding ----------
  // Accept (a first army, with a hero if you like) or Add Troops (more armies, heroId -1). Bidders march to the colony.
  bid(p, c, questId, bean, now, more){
    const g = this.g, q = this.list()[Number(questId)];
    if (!q || q.status !== 'open') return [-1, 'That commission quest is over.'];
    if (q.issuerId === p.id) return [-1, 'You issued this quest yourself.'];
    if (q.suzerainId === p.id) return [-1, 'You are the suzerain this quest is against.'];
    const mine = q.bidders.some(b => b.playerId === p.id);
    if (more && !mine) return [-1, 'Accept the quest before adding troops.'];
    if (!more && mine) return [-1, 'You have already accepted this quest. Add troops from the Army Ranking.'];
    const dc = this.castle(q.colonyCastleId); if (!dc) return [-1, 'That city is gone.'];
    const send = { ...(bean || {}), missionType: MISSION_ANTI, targetPoint: dc.fieldId, restTime: 0, useFlag: false, useItem: false, commission: q.id };
    if (more || !(Number(send.heroId) > 0)) send.heroId = 0;
    const ms = g.armies.travelMs(c.fieldId, dc.fieldId, Object.fromEntries(Object.entries(send.troops || {}).filter(([, n]) => Number(n) > 0)), p, null, 1);
    if (now + ms >= q.endTime) return [-1, 'Your troops could not reach the city before the quest ends.'];
    const r = g.armies.send(c, p, send, now);
    if (Array.isArray(r)) return r;
    r.army.commissionId = q.id;
    if (!mine) q.bidders.push({ playerId: p.id, at: now });
    g.store.touch();
    return r;
  }
  // A bidder's army reaching the colony camps there until the quest ends; too late, it goes home.
  arrive(a, p, report, now){
    const q = this.list()[a.commissionId], dc = q && this.castle(q.colonyCastleId);
    if (!q || q.status !== 'open' || !dc || now >= q.endTime || !q.bidders.some(b => b.playerId === p.id)){
      report(p, { type: REPORT_TYPE.OTHER, title: 'Your mercenaries arrived too late', content: 'The Anti-Colonization quest is over. Your troops are heading home.' });
      delete a.commissionId;
      return false;
    }
    Object.assign(a, { direction: DIR_STAY, startTime: now, reachTime: q.endTime });
    report(p, { type: REPORT_TYPE.OTHER, title: `Your mercenaries reached ${dc.name}`,
      content: `Your troops are camped at ${dc.name} for the Anti-Colonization quest. When the uprising war ends (${dateTime(q.endTime)}) the bidders fight the suzerain's suppression army one by one, the strongest first.` });
    return 'parked';
  }
  armies(q, playerId = null){ return Object.values(this.db.armies || {}).filter(a => a.commissionId === q.id && (playerId == null || a.playerId === playerId)); }
  camped(q, playerId){ return this.armies(q, playerId).filter(a => a.direction === DIR_STAY); }
  // What troops are worth (the hero experience table), the Army's Experience the ranking shows.
  worth(troops){ return Math.round(this.g.combat.value(Object.entries(troops).map(([k, n]) => ({ typeId: this.typeOf(k), lose: n })))); }
  typeOf(field){ return Object.values(this.g.data.troops).find(t => t.field === field)?.id; }
  sum(list){ const t = {}; for (const a of list) for (const [k, n] of Object.entries(a.troops)) if (n > 0) t[k] = (t[k] || 0) + n; return t; }
  ranking(q){
    return q.bidders.map(b => ({ playerId: b.playerId, at: b.at, experience: this.worth(this.sum(this.armies(q, b.playerId))) }))
      .sort((a, b) => b.experience - a.experience || a.at - b.at).map((x, i) => ({ rank: i + 1, playerId: x.playerId, experience: x.experience }));
  }
  // Your bid as one ArmyBean (QuestAmryInfo shows only your own).
  armyInfo(p, playerId, questId){
    const q = this.list()[Number(questId)];
    if (!q) return [-1, 'That commission quest is over.'];
    if (Number(playerId) !== p.id) return [-1, 'You can only look at your own army.'];
    const list = this.armies(q, p.id); if (!list.length) return [-1, 'You have no troops on this quest.'];
    const b = this.g.armies.bean(list[0]), troop = {};
    for (const t of Object.values(this.g.data.troops)) troop[t.field] = String(this.sum(list)[t.field] || 0);
    return { armyBean: { ...b, troop } };
  }
  // Give up: every army on the quest comes home (marching ones turn round).
  decline(p, questId, now){
    const q = this.list()[Number(questId)];
    if (!q || !q.bidders.some(b => b.playerId === p.id)) return [-1, "You haven't accepted that quest."];
    if (q.status !== 'open') return [-1, 'That commission quest is over.'];
    for (const a of this.armies(q, p.id)) this.home(a, now);
    q.bidders = q.bidders.filter(b => b.playerId !== p.id);
    this.g.store.touch(); this.g.pushArmies(p);
    return {};
  }
  home(a, now){
    delete a.commissionId;
    if (a.direction === DIR_STAY) this.g.armies.sendHome(a, now);
    else if (a.direction === DIR_FORWARD){ const gone = Math.max(1000, now - a.startTime); Object.assign(a, { direction: 2, startTime: now, reachTime: now + Math.min(gone, a.oneWay || gone) }); }
  }
  // (armies.recall: only giving up the quest brings them home.)
  locked(a){ const q = a?.commissionId && this.list()[a.commissionId]; return !!q && q.status === 'open'; }
  upkeep(c){ return Object.values(this.db.armies || {}).filter(a => a.commissionId && a.castleId === c.id && a.direction === DIR_STAY).reduce((s, a) => s + this.g.armies.upkeepOf(a.troops), 0); }

  // ---------- the end of the uprising war ----------
  // Called by colonies.uprisingEnd with the suppression army already taken out of the suzerain city. Returns what is
  // left of it and whether a bidder freed the city.
  battles(rec, sc, sp, dc, dp, troops, now){
    const q = this.ofColony(rec); if (!q) return null;
    const g = this.g;
    let left = { ...troops };
    for (const { playerId } of this.ranking(q)){
      if (!Object.values(left).some(n => n > 0)) break;
      const bp = this.player(playerId), armies = this.camped(q, playerId); if (!bp || !armies.length) continue;
      const lead = armies[0], home = this.castle(lead.castleId), hero = home ? g.heroes.find(home, lead.heroId) : null, mine = this.sum(armies);
      const attacker = { troops: left, mods: g.combat.mods(g.logic, sp, null, left, { side: 'attack', life: 0 }) };
      const fortsBefore = { ...(dc.forts || {}) };
      const defender = { troops: mine, forts: dc.forts, mods: g.combat.mods(g.logic, bp, hero, mine, { side: 'defence', walls: g.logic.level(dc, TYPE.WALLS) }) };
      const r = g.combat.fight(attacker, defender);
      left = r.attLeft;
      this.share(armies, mine, r.defLeft);
      const fortsAfter = { ...fortsBefore };
      for (const [k, n] of Object.entries(r.fortsUsed)) fortsAfter[k] = Math.max(0, (fortsAfter[k] || 0) - n);
      if (fortsBefore.arrowTower) fortsAfter.arrowTower = r.towersLeft;
      dc.forts = fortsAfter;
      if (hero) g.heroes.gainExp(hero, r.expDefender);
      const units = rows => rows.map(u => ({ typeId: u.typeId, count: u.count, lose: u.lose }));
      const body = { round: r.round, heroExp: hero ? r.expDefender : undefined,
        attacker: { king: sp.name, hero: null, pos: g.armies.placeName(sc.fieldId), units: units(r.att) },
        defender: { king: bp.name, hero, pos: g.armies.placeName(dc.fieldId), units: units(r.def) }, loot: null, back: null };
      const won = !r.attackerWon, colony = { isUprising: true }, here = g.armies.placeName(dc.fieldId), from = g.armies.placeName(sc.fieldId);
      g.reports.add(bp, { type: REPORT_TYPE.ARMY, attack: false, armyType: MISSION_ANTI, startPos: from, targetPos: here, title: won ? `Your mercenaries freed ${dc.name}` : `Your mercenaries lost at ${dc.name}`, content: battleXml({ ...body, isAttack: false, won: !won, colony }) });
      g.reports.add(sp, { type: REPORT_TYPE.ARMY, startPos: from, targetPos: here, title: won ? `${bp.name}'s mercenaries beat your suppression army at ${dc.name}` : `You beat ${bp.name}'s mercenaries at ${dc.name}`, content: battleXml({ ...body, isAttack: true, won: !won, colony }) });
      if (dp) g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: from, targetPos: here, title: won ? `${bp.name}'s mercenaries freed ${dc.name}` : `${bp.name}'s mercenaries lost at ${dc.name}`, content: '' });
      g.log.info(`Anti-Colonization at ${dc.name}: ${bp.name}'s mercenaries ${won ? 'won' : 'lost'} in ${r.round} rounds`);
      if (won){ this.finish(q, playerId, now); return { freed: true, left }; }
    }
    return { freed: false, left };
  }
  // A bidder's losses, spread over his armies in proportion.
  share(armies, before, after){
    for (const [k, n] of Object.entries(before)){
      const keep = n > 0 ? (after[k] || 0) / n : 0; let given = 0;
      armies.forEach((a, i) => {
        if (!a.troops[k]) return;
        const v = i === armies.length - 1 ? Math.max(0, (after[k] || 0) - given) : Math.floor(a.troops[k] * keep);
        a.troops[k] = Math.min(a.troops[k], v); given += a.troops[k];
      });
    }
  }
  // The quest ends: the winner (if any) is paid, otherwise the issuer gets the reward back; every army goes home.
  finish(q, winnerId, now, why = ''){
    if (q.status !== 'open') return;
    const g = this.g, issuer = this.player(q.issuerId), winner = winnerId ? this.player(winnerId) : null, name = q.colonyName;
    q.status = winner ? 'won' : 'failed'; q.winnerId = winner ? winner.id : 0; q.finishedAt = now;
    if (winner){
      winner.coins = (winner.coins || 0) + q.reward; g.pushPlayerInfo(winner);
      g.reports.add(winner, { type: REPORT_TYPE.OTHER, title: `Anti-Colonization quest won: ${N(q.reward)} cents`, content: `Your mercenaries freed ${name}. ${issuer ? issuer.name : 'Its lord'} paid you the reward of ${N(q.reward)} cents.` });
      if (issuer) g.reports.add(issuer, { type: REPORT_TYPE.OTHER, title: `${winner.name} completed your Anti-Colonization quest`, content: `${winner.name}'s mercenaries freed ${name} and received the reward of ${N(q.reward)} cents.` });
    } else if (issuer){
      issuer.coins = (issuer.coins || 0) + q.reward; g.pushPlayerInfo(issuer);
      g.reports.add(issuer, { type: REPORT_TYPE.OTHER, title: 'Anti-Colonization quest ended', content: `${why || 'No mercenary won the uprising battle.'} The reward of ${N(q.reward)} cents is back in your account.` });
    }
    for (const b of q.bidders){ const bp = this.player(b.playerId); if (!bp) continue; for (const a of this.armies(q, b.playerId)) this.home(a, now); g.pushArmies(bp); }
    g.store.touch();
  }
  // The colony record ended some other way (freed by its own troops, suppressed, abandoned, the city gone).
  closeFor(rec, now, why){
    const q = this.ofColony(rec); if (!q) return;
    this.finish(q, null, now, why);
  }
  // Unopposed: no suppression army was set, so the bidder ranked first (with troops at the city) wins.
  unopposed(rec, now){
    const q = this.ofColony(rec); if (!q) return;
    const first = this.ranking(q).find(x => this.camped(q, x.playerId).length);
    this.finish(q, first ? first.playerId : null, now, 'The city went free without a fight, and no mercenary was there yet.');
  }
  tick(now){
    for (const q of this.quests()){
      if (q.status === 'open' && !this.g.colonies.list()[q.colonyRecId]) this.finish(q, null, now, 'The city is no longer a colony.');
      else if (q.status !== 'open' && now - (q.finishedAt || 0) > 86400000) delete this.list()[q.id];
    }
  }
}

module.exports = { Commission, MISSION_ANTI };
