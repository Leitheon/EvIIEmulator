'use strict';
// The weekly Governor election (the Vote windows) and the Hall of Fame (Celebrity ranks).
// Votes (Fox, live, and the evony wiki's Governor page): a lord with at least 1,000 prestige casts one vote a day,
// for any lord, himself included. The poll closes once a week ("Polls close in"); the lord with the most votes is
// Governor (Governess) for the next week: he gets the client's Governor privilege buff, his name in World Chat
// reads "Governor <name>", and he can mute lords in chat (bdenyotherplayer). The client's Vote windows show this
// week's votes, last week's and the list of past winners.
// Hall of Fame (PrestigeRank): the first 100 lords to reach each prestige mark, each title from Baron up and each
// gear star set level, with the date they got there.
const DAY = 86400000;
const PRESTIGE = [10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000];
const TITLES = ['Baron', 'Viscount', 'Earl', 'Marquis', 'Duke', 'Furstin', 'Prinzessin'];
const STARS = [5, 8, 9, 10, 11, 12, 13, 14, 15];
const HALL_SIZE = 100, GOVERNOR_BUFF = 'TopeVotesPrivilegeBuf';
const pad = n => String(n).padStart(2, '0');
const ymd = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

class Fame {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.votes || {}; }
  player(id){ return this.db.players[id] || null; }
  // ---------- the weekly poll ----------
  state(){ return this.db.votes || (this.db.votes = { term: null, tally: {}, voted: {}, history: [], last: null }); }
  // Polls close at the daily reset on rules.votes.closeDay (0 Sunday ... 6 Saturday).
  offset(){ return (((this.rules.closeDay ?? 1) - 4) % 7 + 7) % 7; }     // 1970-01-01 was a Thursday
  resetMs(){ return (this.g.rules.dailyResetHourUTC || 0) * 3600000; }
  termOf(now){ return Math.floor((Math.floor((now - this.resetMs()) / DAY) - this.offset()) / 7); }
  termStart(t){ return (t * 7 + this.offset()) * DAY + this.resetMs(); }
  termEnd(t){ return this.termStart(t + 1); }
  label(t){ return `${ymd(this.termStart(t))} ~ ${ymd(this.termEnd(t) - DAY)}`; }
  // Close the polls that have ended: the top lord (more prestige breaks a tie) is Governor for the next week.
  roll(now = this.g.now()){
    const s = this.state(), t = this.termOf(now);
    if (s.term == null) s.term = t;
    while (s.term < t){
      const tally = s.tally || {}, total = Object.values(tally).reduce((a, n) => a + n, 0);
      const ranked = Object.entries(tally).map(([id, n]) => ({ p: this.player(id), n })).filter(x => x.p).sort((a, b) => b.n - a.n || (b.p.prestige || 0) - (a.p.prestige || 0));
      const win = ranked[0];
      s.last = { term: s.term, label: this.label(s.term), tally, total };
      if (win){
        s.history.unshift({ term: s.term, label: this.label(s.term), playerId: win.p.id, votes: win.n });
        s.history.length = Math.min(s.history.length, 100);
        const until = this.termEnd(s.term + 1);
        if (until > now){
          const had = this.g.activeBuffs(win.p, now); had.delete(GOVERNOR_BUFF);
          win.p.buffs = win.p.buffs || {}; win.p.buffs[GOVERNOR_BUFF] = until; this.g.pushBuffs(win.p, had, now);
          this.g.chat?.system(null, `${win.p.name} won the weekly poll with ${win.n} vote${win.n === 1 ? '' : 's'} and is ${win.p.sex ? 'Governess' : 'Governor'} this week.`);
        }
        this.g.log.info(`${win.p.name} won the poll for ${this.label(s.term)} with ${win.n} vote${win.n === 1 ? '' : 's'}`);
      }
      s.term++; s.tally = {};
      this.g.store.touch();
    }
    return s;
  }
  governor(now = this.g.now()){
    const s = this.roll(now), h = s.history[0];
    if (!h || h.term !== this.termOf(now) - 1) return null;
    return this.player(h.playerId);
  }
  isGovernor(p, now = this.g.now()){ const gv = this.governor(now); return !!gv && !!p && gv.id === p.id; }
  // "Governor " or "Governess " before the name in World Chat.
  chatName(p, now = this.g.now()){ return this.isGovernor(p, now) ? `${p.sex ? 'Governess' : 'Governor'} ${p.name}` : p.name; }
  vote(p, q, now = this.g.now()){
    if (this.rules.enabled === false) return [-1, 'The Governor election is turned off on this server.'];
    if (!q) return [-1, 'There is no lord by that name.'];
    const need = this.rules.minPrestige ?? 1000;
    if ((p.prestige || 0) < need) return [-1, `You need ${need.toLocaleString('en-US')} prestige to vote.`];
    const s = this.roll(now), day = this.g.npc.day(now);
    if (s.voted[p.id] === day) return [-1, 'You have already voted today. You can vote again after the daily maintenance.'];
    s.voted[p.id] = day;
    s.tally[q.id] = (s.tally[q.id] || 0) + 1;
    q.votesEver = (q.votesEver || 0) + 1;
    this.g.store.touch();
    this.g.log.info(`${p.name} voted for ${q.name}`);
    return {};
  }
  votesNow(q, now = this.g.now()){ return this.roll(now).tally[q.id] || 0; }
  votesLast(q, now = this.g.now()){ const s = this.roll(now); return s.last && s.last.term === this.termOf(now) - 1 ? s.last.tally[q.id] || 0 : 0; }
  // The PlayerInfoBean's vote fields.
  fields(q, now = this.g.now()){
    const s = this.roll(now), top = s.history.find(h => h.playerId === q.id);
    return { getvotes: this.votesNow(q, now), prweekvotes: this.votesLast(q, now), historygetvotes: q.votesEver || 0, topvotes: top ? top.votes : 0, term: top ? top.label : '',
      bdenyotherplayer: this.isGovernor(q, now) ? 1 : 0 };
  }
  // rank.getVoteRank: sortType 1 this week's poll, 0 last week's.
  rank(current, now = this.g.now()){
    const s = this.roll(now), tally = current ? s.tally : (s.last && s.last.term === this.termOf(now) - 1 ? s.last.tally : {});
    const rows = Object.entries(tally).map(([id, n]) => ({ p: this.player(id), n })).filter(x => x.p && x.n > 0).sort((a, b) => b.n - a.n || (b.p.prestige || 0) - (a.p.prestige || 0));
    return { rows, total: rows.reduce((a, x) => a + x.n, 0), label: current ? this.label(s.term) : this.label(this.termOf(now) - 1),
      endsIn: Math.max(0, Math.floor((this.termEnd(this.termOf(now)) - now) / 1000)) };
  }
  winners(now = this.g.now()){ return this.roll(now).history.map(h => ({ ...h, p: this.player(h.playerId) })).filter(h => h.p); }

  // ---------- the Hall of Fame ----------
  hall(){ return this.db.fame || (this.db.fame = { prestige: {}, title: {}, star: {} }); }
  // Note lord p in every list he has newly qualified for, while it has room.
  check(p, now = this.g.now()){
    const h = this.hall(), seen = p.fame || (p.fame = { prestige: [], title: [], star: [] });
    const add = (kind, key) => {
      if (seen[kind].includes(key)) return;
      seen[kind].push(key);
      const list = h[kind][key] || (h[kind][key] = []);
      if (list.length < HALL_SIZE && !list.some(e => e.id === p.id)){ list.push({ id: p.id, at: now }); this.g.store.touch(); }
    };
    for (const n of PRESTIGE) if ((p.prestige || 0) >= n) add('prestige', String(n));
    const t = this.g.quests.title(p);
    TITLES.forEach((name, i) => { if (t >= i + 3) add('title', name); });   // Civilian 0, Knight 1, Baronet 2, Baron 3 ...
    const stars = this.g.equipment.setStars(p, null);
    for (const n of STARS) if (stars >= n) add('star', String(n));
  }
  checkAll(now = this.g.now()){ for (const p of Object.values(this.db.players)) this.check(p, now); }
  list(kind, key){ return (this.hall()[kind][String(key)] || []).map((e, i) => ({ p: this.player(e.id), at: e.at, ranking: i + 1 })).filter(x => x.p); }
}

module.exports = { Fame, GOVERNOR_BUFF, PRESTIGE_MARKS: PRESTIGE, HALL_TITLES: TITLES, HALL_STARS: STARS };
