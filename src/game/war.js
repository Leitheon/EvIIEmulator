'use strict';
// War between lords, as the client has it (DeclaredWarConstants, FieldInfoWin, PlayerInfo, WarDeclarationsBar,
// CastleFlagMc, DeclareWarReportDetail and their texts):
//   - A lord's ordinary city can only be attacked or colonized by a lord at war with him. FieldInfoWin hides the
//     Attack button on ordinary cities ("AttackFlag" servers aside) and enables Colonize only in wartime; a
//     captured Historic City can be attacked by anyone.
//   - Declare War (the city's map window, or the lord's profile): "War begins in 30 minutes after the war
//     declaration is made", "Wartime period lasts 48 hours", "Attacks can be performed by both parties during
//     the wartime period." The client counts these in real time (declaredWarStartTime + 30 minutes and + 48.5
//     hours), so they don't follow the server's game speed.
//   - "Cannot declare war against new players": Beginner's Protection lasts 7 days from the lord's creation, or
//     until one of his Town Halls reaches level 5 (the client's own check). A lord under it can't declare war
//     either ("Cannot perform this operation while you are under beginner's protection.").
//   - "Cannot attack players in Truce or Vacation status": a Truce Agreement shields a lord's ordinary cities, and
//     (Fox, live) no war can be declared on him meanwhile. Declaring costs nothing and has no limit or cool down.
//   - Scouting a lord needs no war, but a lord under Beginner's Protection can't be scouted (Fox, live).
// Both lords get the declaration report, the war bar under the city view ("War Declaration", then
// "Wartime"), and the map flags (purple in preparation, red at war).
const STATUS = { FROZEN: 0, PREPARATIONS: 1, WAR: 2, PEACE: 3 };
const DAY = 86400000, MIN = 60000;
const { REPORT_TYPE, stamp } = require('./reports');
const POS_TOWN_HALL = -1;

class War {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.war || {}; }
  list(){ return this.db.wars || (this.db.wars = {}); }
  records(){ return Object.values(this.list()); }
  player(id){ return this.db.players[id] || null; }
  prepMs(){ return (this.rules.prepMinutes ?? 30) * MIN; }
  warMs(){ return (this.rules.warHours ?? 48) * 60 * MIN; }
  // The war between two lords (either one declared it), or null.
  between(p, q){ if (!p || !q) return null; return this.records().find(r => (r.from === p.id && r.to === q.id) || (r.from === q.id && r.to === p.id)) || null; }
  phase(rec, now){ if (!rec) return STATUS.PEACE; const t = now - rec.declaredAt; return t < this.prepMs() ? STATUS.PREPARATIONS : t < this.prepMs() + this.warMs() ? STATUS.WAR : STATUS.PEACE; }
  status(p, q, now = this.g.now()){ return this.phase(this.between(p, q), now); }
  atWar(p, q, now = this.g.now()){ return this.status(p, q, now) === STATUS.WAR; }

  // Beginner's Protection (the client's UIUtil.checkOffice: 7 days, or a Town Hall above level 4).
  beginner(p, now = this.g.now()){
    const b = this.g.rules.beginnerProtection || {};
    if (!p || b.enabled === false) return false;
    if (now - (p.createdAt || 0) >= (b.days ?? 7) * DAY) return false;
    return !this.g.castlesOf(p).some(c => (c.buildings[POS_TOWN_HALL]?.level || 0) >= (b.townHall ?? 5));
  }
  // A Truce Agreement, or a Dream Truce's window (account.js).
  truce(p, now = this.g.now()){ return !!p && (this.g.logic.buffActive(p, 'PlayerPeaceBuff', now) || this.g.account.inDreamTruce(p, now)); }
  vacation(p, now = this.g.now()){ return !!p && !!this.g.account.vacation(p, now); }
  left(ms){ const m = Math.max(1, Math.ceil(ms / MIN)), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; }

  // Why lord p can't declare war on lord q, or null.
  cantDeclare(p, q, now = this.g.now()){
    if (this.rules.enabled === false) return [-1, "Wars aren't turned on on this server."];
    if (!q) return [-1, 'There is no such lord.'];
    if (q.id === p.id) return [-1, 'You cannot declare war on yourself.'];
    if (this.beginner(p, now)) return [-1, "Cannot perform this operation while you are under beginner's protection."];
    const rel = this.g.alliances?.relation(p, q);
    if (this.beginner(q, now) || rel === 0 || rel === 1) return [-1, 'Cannot declare war against new players or players from your alliance and friendly alliances.'];
    // Fox (live): a lord under a Truce Agreement can't be declared on; nor one on vacation.
    if (this.truce(q, now)) return [-1, `${q.name} is under a Truce Agreement. War can't be declared on a lord in Truce.`];
    if (this.vacation(q, now)) return [-1, `${q.name} is on vacation. Cannot attack players in Truce or Vacation status.`];
    const rec = this.between(p, q), st = this.phase(rec, now);
    if (st === STATUS.PREPARATIONS) return [-1, `You have already declared war on ${q.name}: war begins in ${this.left(rec.declaredAt + this.prepMs() - now)}.`];
    if (st === STATUS.WAR) return [-1, `You are already at war with ${q.name}: war ends in ${this.left(rec.declaredAt + this.prepMs() + this.warMs() - now)}.`];
    return null;
  }
  declare(p, q, now = this.g.now()){
    const bad = this.cantDeclare(p, q, now);
    if (bad) return bad;
    const old = this.between(p, q); if (old) delete this.list()[old.id];
    const id = this.g.store.id();
    // Wage War without Declaration (stratagems.js): the war begins at once, without the 30 minutes of preparation.
    const instant = this.g.stratagems?.instant(p, q, now), start = instant ? now - this.prepMs() : now;
    if (instant) delete p.instantWar[q.id];
    const rec = this.list()[id] = { id, from: p.id, to: q.id, declaredAt: start, seen: instant ? STATUS.WAR : STATUS.PREPARATIONS };
    const startTime = stamp(start + this.prepMs()), endTime = stamp(start + this.prepMs() + this.warMs());
    const content = mine => `<reportData><declaredWarReport myself="${mine}" startTime="${startTime}" endTime="${endTime}"/></reportData>`;
    // DeclareWarReportDetail: "You have declared war against <targetPos>" / "<startPos> has declared war against you."
    this.g.reports.add(p, { type: REPORT_TYPE.ARMY, startPos: p.name, targetPos: q.name, title: `You have declared war against ${q.name}`, content: content(true) });
    this.g.reports.add(q, { type: REPORT_TYPE.ARMY, attack: false, startPos: p.name, targetPos: q.name, title: `${p.name} has declared war against you`, content: content(false) });
    this.g.store.touch();
    this.push(rec, instant ? STATUS.WAR : STATUS.PREPARATIONS);
    this.g.log.info(`${p.name} declared war on ${q.name}`);
    return { war: rec };
  }

  // PlayerDeclaredWarBean for each of p's wars: the bar's phase and its start and end.
  beans(p, now = this.g.now()){
    const out = [];
    for (const r of this.records()){
      if (r.from !== p.id && r.to !== p.id) continue;
      const other = this.player(r.from === p.id ? r.to : r.from), st = this.phase(r, now);
      if (!other || st === STATUS.PEACE) continue;
      const prepEnd = r.declaredAt + this.prepMs();
      out.push(st === STATUS.PREPARATIONS ? { playerName: other.name, status: st, startTime: r.declaredAt, endTime: prepEnd }
        : { playerName: other.name, status: st, startTime: prepEnd, endTime: prepEnd + this.warMs() });
    }
    return out;
  }
  // The war's new phase to both lords: their war bars (DeclaredWarUpdate) and map flags (DeclaredWarStatusChange).
  push(rec, st){
    for (const [me, other] of [[rec.from, rec.to], [rec.to, rec.from]]){
      const p = this.player(me), o = this.player(other); if (!p || !o) continue;
      this.g.push(p.id, 'server.DeclaredWarUpdate', { declaredWarBeans: this.beans(p) });
      this.g.push(p.id, 'server.DeclaredWarStatusChange', { userName: o.name, status: st });
    }
  }
  tick(now){
    for (const rec of this.records()){
      const st = this.phase(rec, now);
      if (st === rec.seen) continue;
      rec.seen = st;
      if (st === STATUS.PEACE) delete this.list()[rec.id];
      this.g.store.touch();
      this.push(rec, st);
      if (st === STATUS.PEACE) this.g.log.info(`The war between ${this.player(rec.from)?.name} and ${this.player(rec.to)?.name} is over`);
    }
  }

  // Why lord p can't attack (or colonize) city dc now, or null. A captured Historic City is open to anyone; a
  // lord's ordinary city takes a war, and not while he is under a Truce Agreement. `suppress`: an attack on
  // the lord's own uprising colony, which needs no war.
  cantAttack(p, dc, now = this.g.now(), { suppress = false } = {}){
    const q = dc && this.player(dc.playerId);
    if (!q || q.id === p.id || suppress) return null;
    if ((dc.powerLevel ?? 4) !== 4) return null;
    if (this.truce(q, now)) return [-13, `${q.name} is under a Truce Agreement and can't be attacked. Cannot attack players in Truce or Vacation status.`];
    if (this.vacation(q, now)) return [-13, `${q.name} is on vacation and can't be attacked. Cannot attack players in Truce or Vacation status.`];
    const rel = this.g.alliances?.relation(p, q);
    if (rel === 0) return [-13, `${q.name} is in your alliance.`];
    if (rel === 1) return [-13, `${q.name}'s alliance is friendly to yours.`];
    if (rel === 3) return null;   // a hostile alliance (the client enables Attack without a war)
    if (this.rules.enabled === false || this.rules.required === false) return null;
    const rec = this.between(p, q), st = this.phase(rec, now);
    if (st === STATUS.WAR) return null;
    if (st === STATUS.PREPARATIONS) return [-13, `War begins in ${this.left(rec.declaredAt + this.prepMs() - now)}. Attacks can be performed by both parties during the wartime period.`];
    return [-13, `You are not at war with ${q.name}. Declare war on him first (Declare War, on his city or his profile): war begins 30 minutes later and lasts 48 hours.`];
  }
  // The field window's "Status:" for lord q's cities as lord `me` sees them (PlayerInfoTypeManager.getState): 1
  // Peacetime, 2 Truce, 3 Beginner, 4 Wartime, 5 Vacation, 6 Dream Truce. Fox (live): a lord shows Wartime only to
  // a lord he is at war with, or whose alliance and his are at war (either one set the other hostile); to everyone
  // else he is at peace. Your own cities show Wartime while you are at war with anyone.
  cityState(q, me = null, now = this.g.now()){
    if (!q) return 0;
    if (this.vacation(q, now)) return 5;
    if (this.g.account.inDreamTruce(q, now)) return 6;
    if (this.g.logic.buffActive(q, 'PlayerPeaceBuff', now)) return 2;
    if (this.beginner(q, now)) return 3;
    if (!me || me.id === q.id) return this.records().some(r => (r.from === q.id || r.to === q.id) && this.phase(r, now) === STATUS.WAR) ? 4 : 1;
    const A = this.g.alliances;
    if (this.atWar(me, q, now) || A?.relation(me, q) === 3 || A?.relation(q, me) === 3) return 4;
    return 1;
  }
  // The MapCastleBean's war fields for city c (lord q) as lord `me` sees it.
  mapFields(me, q, now = this.g.now()){
    if (!me || !q || me.id === q.id) return { declaredWarStatus: STATUS.PEACE, declaredWarStartTime: 0, canDeclaredWar: false, freshMan: this.beginner(q, now) };
    const rec = this.between(me, q), st = this.phase(rec, now);
    return { declaredWarStatus: st, declaredWarStartTime: st === STATUS.PEACE ? 0 : rec.declaredAt, canDeclaredWar: !this.cantDeclare(me, q, now), freshMan: this.beginner(q, now) };
  }
}

module.exports = { War, WAR_STATUS: STATUS };
