'use strict';
// The lord's account and profile (the profile window and its Security Code, Vacation and Dream Truce windows):
//   Security Code: an extra code that guards the actions the lord picks (SetSecurity's boxes: 1 abandon colonies,
//   2 abandon cities, 4 dismiss troops, 8 dismiss heroes, 16 adjust the tax rate). A guarded action answers -200, and
//   the client asks for the code (ApplySecurityCode), then to unlock that action or all of them for the session
//   (UnlockSecurityCode). A forgotten code can be removed: "72 hours after cancelling your Security Code, you may
//   reset it to a new one. During this time period, no protected actions may be initiated."
//   Vacation: "10 cents per day. The Suzerain's city will be charged for another 10 cents for every 3 days per
//   colony. Minimum 2 days of this mode. Once Vacation mode is activated, no operation of the game is allowed"; the
//   lord can't be attacked, scouted or declared on; "There's a minimum of 24 hours time for every Holiday" before it
//   can be called off; with Auto Extend it renews itself while the coins last.
//   Dream Truce: "Every Dream Truce grants you continuous 10 hours truce time for a day ... you can set when the
//   Dream Truce Time starts ... you can change the Dream Truce Starting Time once for every 72 hours".
//   The portrait can be changed once (the profile hides the button after), and the client's membership and e-mail
//   options are kept (nothing is mailed).
const crypto = require('crypto');
const DAY = 86400000, HOUR = 3600000, ALL = 31;
const OPTION = { ABANDON_COLONY: 1, ABANDON_CITY: 2, DISMISS_TROOPS: 4, DISMISS_HEROES: 8, TAX_RATE: 16 };
const sha1 = s => crypto.createHash('sha1').update(String(s)).digest('hex');

class Account {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.account || {}; }
  accountOf(p){ return Object.values(this.db.accounts).find(a => a.playerId === p.id) || null; }
  // The client sends SHA1(password), the same hash the account keeps.
  passwordOk(p, pwd){ const a = this.accountOf(p); return !a || String(pwd || '').toLowerCase() === a.pwd; }

  // ---------- Security Code ----------
  security(p, now = this.g.now()){
    const s = p.security;
    if (s && s.removeAt && s.removeAt <= now){ delete p.security; delete p.buffs?.RemovingSecurityCodeBuff; this.g.store.touch(); this.g.push(p.id, 'server.SecurityCodeRemovedEvent', {}); return null; }
    return s || null;
  }
  isSet(p, now){ return !!this.security(p, now); }
  // Why the action (an OPTION bit) can't go ahead without the code this session, or null.
  guard(conn, bit, now = this.g.now()){
    const p = conn.player, s = p && this.security(p, now);
    if (!s || !(s.options & bit)) return null;
    if (s.removeAt) return [-1, 'Your Security Code is being removed: no protected actions may be initiated until it is gone.'];
    if ((conn.unlocked || 0) & bit) return null;
    return [-200, 'This action is protected by your Security Code.'];
  }
  checkCode(code){ const c = String(code || ''); return c.length >= 4 && c.length <= 20 ? null : 'Choose a Security Code of 4 to 20 characters.'; }
  setCode(p, code, now){
    if (this.security(p, now)) return [-1, 'You already have a Security Code. Change it in your profile.'];
    const bad = this.checkCode(code); if (bad) return [-1, bad];
    p.security = { hash: sha1(code), options: ALL, setAt: now }; this.g.store.touch();
    return {};
  }
  auth(conn, code, now){
    const s = this.security(conn.player, now);
    if (!s) return [-1, 'You have no Security Code.'];
    if (sha1(code) !== s.hash) return [-1, 'Wrong Security Code.'];
    conn.securityOk = true;
    return {};
  }
  // UnlockSecurityCode: one guarded action, or all (31), for the rest of the session.
  unlock(conn, option, now){
    if (!this.security(conn.player, now)) return [-1, 'You have no Security Code.'];
    if (!conn.securityOk) return [-200, 'Enter your Security Code first.'];
    conn.unlocked = (conn.unlocked || 0) | (Number(option) & ALL || ALL);
    return {};
  }
  change(conn, cur, next, now){
    const s = this.security(conn.player, now);
    if (!s) return [-1, 'You have no Security Code.'];
    if (sha1(cur) !== s.hash) return [-1, 'The current Security Code is wrong.'];
    const bad = this.checkCode(next); if (bad) return [-1, bad];
    s.hash = sha1(next); this.g.store.touch();
    return {};
  }
  options(p, now){ return this.security(p, now)?.options ?? 0; }
  setOptions(conn, option, now){
    const s = this.security(conn.player, now);
    if (!s) return [-1, 'You have no Security Code.'];
    if (!conn.securityOk) return [-200, 'Enter your Security Code first.'];
    s.options = Number(option) & ALL; this.g.store.touch();
    return {};
  }
  remove(p, now){
    const s = this.security(p, now);
    if (!s) return [-1, 'You have no Security Code.'];
    if (s.removeAt) return [-1, 'Your Security Code is already being removed.'];
    s.removeAt = now + (this.rules.securityRemoveHours ?? 72) * HOUR;
    p.buffs = p.buffs || {}; p.buffs.RemovingSecurityCodeBuff = s.removeAt;
    this.g.store.touch();
    return {};
  }
  cancelRemoval(p, now){
    const s = this.security(p, now);
    if (!s || !s.removeAt) return [-1, 'Your Security Code is not being removed.'];
    delete s.removeAt; delete p.buffs?.RemovingSecurityCodeBuff; this.g.store.touch();
    return {};
  }

  // ---------- Vacation ----------
  vacation(p, now = this.g.now()){ const f = p.furlough; return f && f.end > now ? f : null; }
  vacationCost(p, days){
    const colonies = this.g.colonies.records().filter(r => r.suzerainPlayerId === p.id && r.status !== 1).length;
    return days * (this.rules.vacationCentsPerDay ?? 10) + Math.floor(days / 3) * colonies * (this.rules.vacationCentsPerColony ?? 10);
  }
  startVacation(p, days, pwd, auto, now){
    days = Math.floor(Number(days) || 0);
    if (!this.passwordOk(p, pwd)) return [-1, 'Wrong password.'];
    if (days < 2) return [-1, 'At least 2 days for Vacation mode. Please retype the duration.'];
    if (this.vacation(p, now)) return [-1, 'You are already on vacation.'];
    const cost = this.vacationCost(p, days);
    if ((p.coins || 0) < cost) return [-28, `${days} days of vacation cost ${cost} cents; you have ${p.coins || 0}.`];
    p.coins -= cost;
    p.furlough = { start: now, end: now + days * DAY, days, auto: !!auto };
    this.g.store.touch();
    this.g.log.info(`${p.name} went on vacation for ${days} days (${cost} cents)`);
    return {};
  }
  // HolidayTips at login: "h,m,minutes until it can be called off".
  vacationNote(p, now){
    const f = this.vacation(p, now), left = Math.max(0, f.end - now), wait = Math.max(0, f.start + DAY - now);
    return `${Math.floor(left / HOUR)},${Math.floor(left % HOUR / 60000)},${Math.ceil(wait / 60000)}`;
  }
  endVacation(p, now){
    const f = this.vacation(p, now);
    if (!f) return [-1, 'You are not on vacation.'];
    const wait = f.start + DAY - now;
    if (wait > 0) return [-1, `There's a minimum of 24 hours for every Holiday. You can cancel it in about ${Math.floor(wait / HOUR)} hours ${Math.ceil(wait % HOUR / 60000)} minutes.`];
    delete p.furlough; this.g.store.touch();
    this.g.log.info(`${p.name} came back from vacation`);
    return {};
  }
  tick(now){
    for (const p of Object.values(this.db.players)){
      const f = p.furlough; if (!f || f.end > now) continue;
      const cost = f.auto ? this.vacationCost(p, f.days) : Infinity;
      if ((p.coins || 0) >= cost){ p.coins -= cost; f.start = f.end; f.end += f.days * DAY; }
      else delete p.furlough;
      this.g.store.touch();
    }
  }

  // ---------- Dream Truce ----------
  // The truce windows: [the day's start time, + 10 hours) for each day from firstAt (a midnight). The times are the
  // game clock's, the server computer's local time, as the client shows it (it sends only hours, minutes, seconds).
  dreamWindows(p){
    const t = p.dreamTruce; if (!t) return [];
    const len = (this.rules.dreamTruceHours ?? 10) * HOUR, b = new Date(t.firstAt);
    return [...(t.extra ? [t.extra] : []), ...Array.from({ length: t.days }, (_, i) => { const a = new Date(b.getFullYear(), b.getMonth(), b.getDate() + i, 0, 0, t.startSec).getTime(); return [a, a + len]; })];
  }
  midnight(ms, plusDays = 0){ const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays).getTime(); }
  startSec(h, m, s){ return (Math.floor(Number(h)) || 0) * 3600 + (Math.floor(Number(m)) || 0) * 60 + (Math.floor(Number(s)) || 0); }
  inDreamTruce(p, now = this.g.now()){ return this.dreamWindows(p).some(([a, b]) => now >= a && now < b); }
  setDream(p, h, m, s, pwd, now){
    if (!this.passwordOk(p, pwd)) return [-1, 'Wrong password.'];
    if (!this.g.items.has(p, 'player.truce.dream')) return [-44, 'You need a Dream Truce.'];
    const live = p.dreamTruce && this.dreamWindows(p).some(([, b]) => b > now);
    if (live) p.dreamTruce.days += 1;   // another day of the same time span
    else {
      const startSec = this.startSec(h, m, s);
      if (!(startSec >= 0 && startSec < 86400)) return [-1, 'Enter a starting time from 00:00:00 to 23:59:59.'];
      const today = this.midnight(now), d = new Date(today);
      const firstAt = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, startSec).getTime() > now ? today : this.midnight(now, 1);
      p.dreamTruce = { startSec, firstAt, days: 1, changedAt: 0 };
    }
    this.g.items.take(p, 'player.truce.dream');
    this.syncDreamBuff(p);
    this.g.store.touch();
    return { items: ['player.truce.dream'] };
  }
  changeDream(p, h, m, s, pwd, now){
    if (!this.passwordOk(p, pwd)) return [-1, 'Wrong password.'];
    const t = p.dreamTruce, wins = t ? this.dreamWindows(p).filter(([, b]) => b > now) : [];
    if (!wins.length) return [-1, 'You have no Dream Truce.'];
    if (now - (t.changedAt || 0) < 72 * HOUR) return [-1, 'You can change the Dream Truce Starting Time once for every 72 hours.'];
    const startSec = this.startSec(h, m, s);
    if (!(startSec >= 0 && startSec < 86400)) return [-1, 'Enter a starting time from 00:00:00 to 23:59:59.'];
    // "It will come into effect on the next day": today's window stays as it was, the days after start at the new time.
    const tomorrow = this.midnight(now, 1);
    Object.assign(t, { extra: wins.find(([a]) => a < tomorrow) || null, startSec, firstAt: tomorrow, days: wins.filter(([a]) => a >= tomorrow).length, changedAt: now });
    this.syncDreamBuff(p);
    this.g.store.touch();
    return {};
  }
  cancelDream(p, pwd){
    if (!this.passwordOk(p, pwd)) return [-1, 'Wrong password.'];
    if (!p.dreamTruce) return [-1, 'You have no Dream Truce.'];
    delete p.dreamTruce; delete p.buffs?.DreamTruceBuff; this.g.store.touch();
    return {};
  }
  syncDreamBuff(p){ const w = this.dreamWindows(p), end = w.length ? w[w.length - 1][1] : 0; p.buffs = p.buffs || {}; if (end) p.buffs.DreamTruceBuff = end; else delete p.buffs.DreamTruceBuff; }

  // ---------- profile ----------
  changeFace(p, faceUrl, sex){
    if (p.changedFace) return [-1, 'Your portrait can only be changed once.'];
    const f = String(faceUrl || '');
    if (!/^images\/icon\/player\/face[AB]\d+\.(jpg|png)$/.test(f)) return [-1, 'Choose one of the portraits.'];
    p.faceUrl = f; p.sex = Number(sex) ? 1 : 0; p.changedFace = true; this.g.store.touch();
    return {};
  }
}

module.exports = { Account, SECURITY: OPTION };
