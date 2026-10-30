'use strict';
// Alliances, as the client has them (AllianceConstants, the alliance windows and their texts) and as Fox's live
// capture of his alliance's tabs shows them (Oct 26 2026):
//   - The Embassy: "At level 1, you can join alliances created by other players. At level 2, you can establish an
//     alliance yourself". "Creating an Alliance costs 10,000 Gold." A name is at most 8 characters.
//   - Ranks (the lord's levelId): 4 Host, 5 Vice Host (at most 2), 6 Presbyter (5), 7 Officer (10), 8 Member;
//     0 no alliance. The windows give: inviting and reviewing applications to Host, Vice Host, Presbyter and
//     Officer; setting ranks and expelling (of lower ranks) to Host, Vice Host and Presbyter; diplomacy, the
//     alliance's introduction and notice, and mail to every member to Host and Vice Host; handing the Host on to
//     the Host. Any officer can resign to Member, and anyone can quit: "If you quit your alliance, 10% of your
//     Prestige will be deducted." A live alliance holds at most 100 ("memberLimit":100; the client's
//     ALLIANCE_MEMBER_MAX_LIMIT 100 and ALLIANCE_MEMBER_ADD_COUNT 10: here 10 a level of the Host's best Embassy).
//   - Diplomacy: another alliance is friendly (1), neutral (2) or an enemy (3), changed at most once a day per
//     alliance (SET_ALLIANCE_FRIENDSHIP_COOLDOWN_TIME 24). The map shows a lord of your own alliance green, a
//     friendly one blue, an enemy red; war can't be declared on your own or friendly alliances ("Cannot declare
//     war against new players or players from your alliance and friendly alliances."), and an enemy alliance's
//     cities can be attacked without a war (the client enables Attack for them).
//   - Alliance chat ("In Alliance chat, you can communicate with the members of your own alliance."), mail to every
//     member, the events list ("HKCA has invited OGNI to an alliance." is live; the other events' wording is mine),
//     the members' battles (Military Situation), and the Alliance ranking by prestige.
//   - Allied troops: a lord can station troops in an alliance member's city (armies.js, "allied troops").
const RANK = { HOST: 4, VICE: 5, PRESBYTER: 6, OFFICER: 7, MEMBER: 8 };
const RANK_NAME = { 4: 'Host', 5: 'Vice Host', 6: 'Presbyter', 7: 'Officer', 8: 'Member' };
const REL = { SAME: 0, FRIEND: 1, MIDDLE: 2, ENEMY: 3 };
const EMBASSY = 28, HOUR = 3600000, INT_MAX = 2147483647;
const fold = s => String(s ?? '').trim().toLowerCase();
const clampInt = n => Math.max(-INT_MAX, Math.min(INT_MAX, Math.floor(n || 0)));

class Alliances {
  constructor(game){ this.g = game; }
  get db(){ return this.g.db; }
  get rules(){ return this.g.rules.alliances || {}; }
  all(){ return this.db.alliances || (this.db.alliances = {}); }
  list(){ return Object.values(this.all()); }
  of(p){ return p?.allianceId ? this.all()[p.allianceId] || null : null; }
  byName(name){ const n = fold(name); return n ? this.list().find(a => fold(a.name) === n) || null : null; }
  player(id){ return this.db.players[id] || null; }
  members(a){ return (a?.members || []).map(id => this.player(id)).filter(Boolean); }
  rank(p){ return this.of(p) ? p.allianceLevel || RANK.MEMBER : 0; }
  rankName(p){ return RANK_NAME[this.rank(p)] || ''; }
  same(p, q){ return !!p && !!q && !!p.allianceId && p.allianceId === q.allianceId; }
  // How lord `me` sees lord q: 0 his own alliance, 1 friendly, 3 enemy, 2 anything else (AllianceConstants).
  relation(me, q){
    if (!me || !q) return REL.MIDDLE;
    if (this.same(me, q)) return REL.SAME;
    const a = this.of(me), b = this.of(q);
    return a && b ? a.relations?.[b.id]?.type || REL.MIDDLE : REL.MIDDLE;
  }
  prestige(a){ return clampInt(this.members(a).reduce((s, p) => s + (p.prestige || 0), 0)); }
  honor(a){ return clampInt(this.members(a).reduce((s, p) => s + (p.honor || 0), 0)); }
  ranked(){ return this.list().map(a => ({ a, prestige: this.prestige(a) })).sort((x, y) => y.prestige - x.prestige || x.a.createdAt - y.a.createdAt); }
  ranking(a){ const i = this.ranked().findIndex(x => x.a === a); return i < 0 ? 0 : i + 1; }
  embassy(p){ return Math.max(0, ...this.g.castlesOf(p).map(c => this.g.logic.level(c, EMBASSY))); }
  // 10 a level of the Host's best Embassy (at most 100); a Ritual of Pact makes it 100 ("Instantly increase alliance
  // member limit to 100"), and the Advanced, Premium and Ultimate ones 1,000 for 15, 30 or 90 days.
  memberLimit(a, now = this.g.now()){
    const max = this.rules.maxMembers ?? 100, per = this.rules.membersPerEmbassyLevel ?? 10;
    const base = per ? Math.min(max, Math.max(per, per * this.embassy(this.player(a.leader)))) : max;
    return Math.max(base, a.limit || 0, (a.pactUntil || 0) > now ? (this.rules.pactMembers ?? 1000) : 0);
  }
  pact(p, itemId, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE], 'use a Ritual of Pact'); if (Array.isArray(a)) return a;
    if (itemId === 'consume.hegemony.1'){
      if ((a.limit || 0) >= 100) return [-1, `${a.name}'s member limit is already 100.`];
      a.limit = 100; this.event(a, `${p.name} used a Ritual of Pact: the alliance can have 100 members.`, now); this.g.store.touch();
      return { note: `${a.name} can now have 100 members.` };
    }
    const days = { advanced: 15, premium: 30, ultimate: 90 }[itemId.split('.').pop()];
    if (!days) return [-40, 'That pact does nothing here.'];
    a.pactUntil = Math.max(now, a.pactUntil || 0) + days * 24 * HOUR;   // (more of them lengthen it)
    this.event(a, `${p.name} used a Ritual of Pact: the alliance can have 1,000 members for ${days} more days.`, now); this.g.store.touch();
    return { note: `${a.name} can have 1,000 members until ${new Date(a.pactUntil).toISOString().slice(0, 10)}.` };
  }
  event(a, text, now = this.g.now()){
    (a.events || (a.events = [])).unshift({ eventName: text, time: now });
    const max = this.rules.eventsMax ?? 200; if (a.events.length > max) a.events.length = max;
  }
  touch(...players){ this.g.store.touch(); for (const p of players) if (p) this.g.pushPlayerInfo(p); }
  need(p, levels, what){
    const a = this.of(p); if (!a) return [-1, 'You are not in an alliance.'];
    return levels.includes(this.rank(p)) ? a : [-42, `Only the ${levels.map(l => RANK_NAME[l]).join(', ').replace(/, ([^,]*)$/, ' or $1')} can ${what}.`];
  }
  lord(name){ const q = this.g.mail.playerByName(name); return q || null; }

  // ---------- founding, joining and leaving ----------
  create(p, c, name, now = this.g.now()){
    if (this.of(p)) return [-1, 'Quit your current alliance before you join another.'];
    name = String(name ?? '').trim();
    if (!name) return [-1, 'Give your alliance a name.'];
    if (name.length > (this.rules.nameMax ?? 8)) return [-1, `An alliance name can be at most ${this.rules.nameMax ?? 8} characters.`];
    if (/[<>&"']/.test(name)) return [-1, 'That name has characters an alliance name can\'t use.'];
    if (this.byName(name)) return [-1, `There is already an alliance called ${name}.`];
    if (!c || this.g.logic.level(c, EMBASSY) < (this.rules.createEmbassy ?? 2)) return [-1, 'Level 2 Embassy is necessary to create an alliance.'];
    const gold = this.rules.createGold ?? 10000;
    this.g.logic.settle(c, p, now);
    if (c.res.gold < gold) return [-1, `Creating an Alliance costs ${gold.toLocaleString('en-US')} Gold.`];
    c.res.gold -= gold;
    const id = this.g.store.id();
    const a = this.all()[id] = { id, name, creator: p.id, creatorName: p.name, leader: p.id, members: [], info: '', note: '', relations: {}, invites: [], applications: [], events: [], createdAt: now };
    this.dropPending(p);
    this.enter(a, p, RANK.HOST);
    this.event(a, `${p.name} founded the alliance ${name}.`, now);
    this.touch(p); this.g.pushResources(c);
    this.g.log.info(`${p.name} founded the alliance ${name}`);
    return { alliance: a };
  }
  enter(a, q, level = RANK.MEMBER){ a.members = [...new Set([...(a.members || []), q.id])]; q.allianceId = a.id; q.allianceLevel = level; this.questFlags(a, q); }
  // The Alliance quests: Join Alliance, and Member Enrichment at 5, 10, 20 ... 100 members (for every member).
  questFlags(a, q){
    const Q = this.g.quests; if (!Q) return;
    Q.flag(q, 'joinAlliance');
    for (const n of [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) if (a.members.length >= n) for (const id of a.members){ const m = this.g.db.players[id]; if (m) Q.flag(m, `allianceMembers${n}`); }
  }
  // A lord's open application and the invitations he holds end when he joins an alliance.
  dropPending(q){
    for (const a of this.list()){ a.applications = (a.applications || []).filter(x => x.playerId !== q.id); a.invites = (a.invites || []).filter(x => x.playerId !== q.id); }
  }
  join(a, q, now, how){
    if (this.of(q)) return [-1, `${q.name} is already in an alliance.`];
    if (a.members.length >= this.memberLimit(a)) return [-1, `${a.name} is full (${this.memberLimit(a)} members).`];
    this.dropPending(q);
    this.enter(a, q);
    this.event(a, how || `${q.name} has joined the alliance.`, now);
    this.touch(q);
    this.g.log.info(`${q.name} joined ${a.name}`);
    return { alliance: a };
  }
  // Leaving: 10% of the lord's prestige (the client's warning). The Host leaves only as the last member, and the
  // alliance ends with him.
  quit(p, now = this.g.now()){
    const a = this.of(p); if (!a) return [-1, 'You are not in an alliance.'];
    if (this.rank(p) === RANK.HOST && a.members.length > 1) return [-1, 'Hand the Host on to another member (Relinquish Host) before you quit.'];
    p.prestige = Math.floor((p.prestige || 0) * (1 - (this.rules.quitPrestigeRate ?? 0.1)));
    this.leave(a, p);
    if (!a.members.length) this.disband(a);
    else this.event(a, `${p.name} has left the alliance.`, now);
    this.touch(p);
    this.g.log.info(`${p.name} left ${a.name}`);
    return { alliance: a };
  }
  leave(a, q){ a.members = a.members.filter(id => id !== q.id); delete q.allianceId; delete q.allianceLevel; this.g.armies?.checkGuests(this.g.now()); }
  disband(a){
    delete this.all()[a.id];
    for (const b of this.list()) if (b.relations?.[a.id]) delete b.relations[a.id];
    this.g.log.info(`The alliance ${a.name} disbanded`);
  }
  kick(p, name, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER], 'expel members'); if (Array.isArray(a)) return a;
    const q = this.lord(name);
    if (!q || !this.same(p, q)) return [-1, 'This player is not in your alliance.'];
    if (q.id === p.id) return [-1, 'Use Quit Alliance to leave.'];
    if (this.rank(q) <= this.rank(p)) return [-42, `You can only expel members below you (${q.name} is ${this.rankName(q)}).`];
    this.leave(a, q);
    this.event(a, `${q.name} was expelled from the alliance by ${p.name}.`, now);
    this.g.mail.system(q, `You were expelled from ${a.name}`, `${p.name} expelled you from the alliance ${a.name}.`, now);
    this.touch(q);
    return { alliance: a };
  }

  // ---------- applications (a lord asks) ----------
  apply(p, name, now = this.g.now()){
    if (this.of(p)) return [-1, 'Quit your current alliance before you join another.'];
    if (this.embassy(p) < (this.rules.joinEmbassy ?? 1)) return [-1, 'Joining alliance: Embassy Level 1; creating alliance: Embassy Level 2'];
    const a = this.byName(name); if (!a) return [-1, `There is no alliance called ${String(name ?? '').trim()}.`];
    if (this.wanted(p)) return [-1, `You have already applied to ${this.wanted(p).name}. Cancel that application first.`];
    a.applications.push({ playerId: p.id, at: now });
    this.g.store.touch();
    return { alliance: a, waitIntoAllianceName: a.name };
  }
  wanted(p){ return this.list().find(a => (a.applications || []).some(x => x.playerId === p.id)) || null; }
  cancelApply(p, name){
    const a = this.byName(name) || this.wanted(p);
    if (!a || !a.applications.some(x => x.playerId === p.id)) return [-1, 'You have no application to that alliance.'];
    a.applications = a.applications.filter(x => x.playerId !== p.id);
    this.g.store.touch();
    return { alliance: a };
  }
  applicants(a){
    return (a?.applications || []).map(x => ({ x, q: this.player(x.playerId) })).filter(r => r.q)
      .map(({ x, q }) => ({ userName: q.name, castleCount: this.g.castlesOf(q).length, prestige: clampInt(q.prestige), rank: this.g.beans.prestigeRank(q), inviteTime: x.at }));
  }
  approve(p, name, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER, RANK.OFFICER], 'review applications'); if (Array.isArray(a)) return a;
    const q = this.lord(name);
    if (!q || !a.applications.some(x => x.playerId === q.id)) return [-1, `${String(name ?? '').trim()} hasn't applied to your alliance.`];
    return this.join(a, q, now, `${p.name} accepted ${q.name} into the alliance.`);
  }
  refuse(p, name){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER, RANK.OFFICER], 'review applications'); if (Array.isArray(a)) return a;
    const q = this.lord(name);
    a.applications = a.applications.filter(x => !q || x.playerId !== q.id);
    this.g.store.touch();
    return { alliance: a };
  }

  // ---------- invitations (the alliance asks) ----------
  invite(p, name, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER, RANK.OFFICER], 'invite lords'); if (Array.isArray(a)) return a;
    const q = this.lord(name); if (!q) return [-1, `There is no lord called ${String(name ?? '').trim()}.`];
    if (this.of(q)) return [-1, this.same(p, q) ? `${q.name} is already in your alliance.` : `${q.name} is already in an alliance.`];
    if (a.invites.some(x => x.playerId === q.id)) return [-1, `${q.name} has already been invited.`];
    a.invites.push({ playerId: q.id, by: p.id, at: now });
    this.event(a, `${p.name} has invited ${q.name} to an alliance.`, now);   // (the live wording)
    this.g.mail.system(q, `An invitation from ${a.name}`, `${p.name} has invited you to join the alliance ${a.name}. Open the Embassy's alliance window to accept or decline.`, now);
    this.g.store.touch();
    return { alliance: a };
  }
  invited(a){
    return (a?.invites || []).map(x => ({ x, q: this.player(x.playerId) })).filter(r => r.q)
      .map(({ x, q }) => ({ userName: q.name, invitePerson: this.player(x.by)?.name || '', inviteTime: x.at, prestige: clampInt(q.prestige), rank: this.g.beans.prestigeRank(q), state: 'Waiting' }));
  }
  cancelInvite(p, name){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER, RANK.OFFICER], 'call off invitations'); if (Array.isArray(a)) return a;
    const q = this.lord(name);
    a.invites = a.invites.filter(x => !q || x.playerId !== q.id);
    this.g.store.touch();
    return { alliance: a };
  }
  invitesFor(p){
    return this.list().filter(a => (a.invites || []).some(x => x.playerId === p.id))
      .map(a => ({ allianceName: a.name, memberCount: a.members.length, prestige: this.prestige(a), rank: this.ranking(a) }));
  }
  accept(p, c, name, now = this.g.now()){
    const a = this.byName(name);
    if (!a || !a.invites.some(x => x.playerId === p.id)) return [-1, `${String(name ?? '').trim()} hasn't invited you.`];
    if (this.embassy(p) < (this.rules.joinEmbassy ?? 1)) return [-1, 'Joining alliance: Embassy Level 1; creating alliance: Embassy Level 2'];
    return this.join(a, p, now);
  }
  decline(p, name){
    const a = this.byName(name); if (!a) return [-1, `There is no alliance called ${String(name ?? '').trim()}.`];
    a.invites = a.invites.filter(x => x.playerId !== p.id);
    this.g.store.touch();
    return { alliance: a };
  }

  // ---------- ranks ----------
  setRank(p, name, typeId, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE, RANK.PRESBYTER], 'change ranks'); if (Array.isArray(a)) return a;
    const q = this.lord(name), to = Number(typeId);
    if (!q || !this.same(p, q)) return [-1, 'This player is not in your alliance.'];
    if (![RANK.VICE, RANK.PRESBYTER, RANK.OFFICER, RANK.MEMBER].includes(to)) return [-1, 'There is no such rank.'];
    if (q.id === p.id) return [-1, 'You cannot change your own rank (Resign steps down to Member).'];
    if (this.rank(q) <= this.rank(p) || to <= this.rank(p)) return [-42, 'You can only give ranks below your own, to members below you.'];
    if (this.rank(q) === to) return [-1, `${q.name} is already ${RANK_NAME[to]}.`];
    const limit = (this.rules.rankLimits || { 5: 2, 6: 5, 7: 10 })[to];
    if (limit && this.members(a).filter(m => this.rank(m) === to).length >= limit) return [-1, `An alliance can have at most ${limit} ${RANK_NAME[to]}${limit > 1 ? 's' : ''}.`];
    q.allianceLevel = to;
    this.event(a, `${p.name} made ${q.name} ${RANK_NAME[to]}.`, now);
    this.touch(q);
    return { alliance: a };
  }
  // "Relinquish Host": the Host hands the alliance to another member and becomes a Member.
  passHost(p, name, now = this.g.now()){
    const a = this.need(p, [RANK.HOST], 'hand the Host on'); if (Array.isArray(a)) return a;
    const q = this.lord(name);
    if (!q || !this.same(p, q)) return [-1, 'This player is not in your alliance.'];
    if (q.id === p.id) return [-1, 'You are the Host already.'];
    q.allianceLevel = RANK.HOST; p.allianceLevel = RANK.MEMBER; a.leader = q.id;
    this.event(a, `${p.name} handed the Host to ${q.name}.`, now);
    this.touch(p, q);
    return { alliance: a };
  }
  resign(p, now = this.g.now()){
    const a = this.of(p); if (!a) return [-1, 'You are not in an alliance.'];
    if (this.rank(p) === RANK.HOST) return [-1, 'The Host can\'t resign: hand the Host on to another member first (Relinquish Host).'];
    if (this.rank(p) === RANK.MEMBER) return [-1, 'You hold no office to resign.'];
    p.allianceLevel = RANK.MEMBER;
    this.event(a, `${p.name} resigned and is a Member now.`, now);
    this.touch(p);
    return { alliance: a };
  }

  // ---------- the alliance's texts, mail ----------
  setInfo(p, info, note){
    const a = this.need(p, [RANK.HOST, RANK.VICE], 'change the alliance\'s introduction'); if (Array.isArray(a)) return a;
    const max = this.rules.textMax ?? 500;
    a.info = String(info ?? '').slice(0, max); a.note = String(note ?? '').slice(0, max);
    this.g.store.touch();
    return { alliance: a };
  }
  mailAll(p, title, message, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE], 'mail the whole alliance'); if (Array.isArray(a)) return a;
    title = String(title ?? '').trim(); message = String(message ?? '');
    if (!title) return [-1, 'Give your mail a title.'];
    if (message.length > (this.rules.textMax ?? 500)) return [-1, `An alliance message can be at most ${this.rules.textMax ?? 500} characters.`];
    let sent = 0;
    for (const q of this.members(a)){ const r = this.g.mail.send(p, q.name, `[${a.name}] ${title}`, message, now); if (!Array.isArray(r)) sent++; }
    return { alliance: a, sent };
  }

  // ---------- diplomacy ----------
  setRelation(p, targetName, type, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE], 'handle diplomacy'); if (Array.isArray(a)) return a;
    const b = this.byName(targetName); if (!b) return [-1, `There is no alliance called ${String(targetName ?? '').trim()}.`];
    if (b === a) return [-1, 'That is your own alliance.'];
    const t = Number(type); if (![REL.FRIEND, REL.MIDDLE, REL.ENEMY].includes(t)) return [-1, 'Choose friendly, neutral or hostile.'];
    const cur = a.relations[b.id], cool = (this.rules.relationCooldownHours ?? 24) * HOUR;
    if (cur && now - cur.at < cool) return [-1, `You can change your relation with ${b.name} again in ${Math.ceil((cur.at + cool - now) / HOUR)} hours.`];
    a.relations[b.id] = { type: t, at: now };
    this.event(a, `${p.name} set ${b.name} as ${t === REL.FRIEND ? 'a friendly' : t === REL.ENEMY ? 'a hostile' : 'a neutral'} alliance.`, now);
    this.g.store.touch();
    return { alliance: a };
  }
  dropRelation(p, targetName, now = this.g.now()){
    const a = this.need(p, [RANK.HOST, RANK.VICE], 'handle diplomacy'); if (Array.isArray(a)) return a;
    const b = this.byName(targetName);
    if (!b || !a.relations[b.id]) return [-1, `You have no relation set with ${String(targetName ?? '').trim()}.`];
    delete a.relations[b.id];
    this.event(a, `${p.name} dropped the relation with ${b.name}.`, now);
    this.g.store.touch();
    return { alliance: a };
  }
  unit(b){ return { allianceName: b.name, leaderName: this.player(b.leader)?.name || '', memberCount: b.members.length, aPrestigeCount: this.prestige(b), honor: this.honor(b), rank: this.ranking(b) }; }
  relations(a){
    const out = { friendlyList: [], middleList: [], enemyList: [] };
    for (const [id, r] of Object.entries(a?.relations || {})){
      const b = this.all()[id]; if (!b) continue;
      (r.type === REL.FRIEND ? out.friendlyList : r.type === REL.ENEMY ? out.enemyList : out.middleList).push(this.unit(b));
    }
    return out;
  }

  // ---------- what the windows show ----------
  index(a){
    return { allianceName: a.name, allianceInfo: a.info || '', allianceNote: a.note || '', creatorName: a.creatorName || this.player(a.creator)?.name || '',
      leaderName: this.player(a.leader)?.name || '', memberCount: a.members.length, memberLimit: this.memberLimit(a), prestige: this.prestige(a), rank: this.ranking(a) };
  }
  info(a){ return { allinaceInfo: a.info || '', creator: a.creatorName || '', leader: this.player(a.leader)?.name || '', memberCount: a.members.length, prestigeCount: this.prestige(a), ranking: this.ranking(a) }; }
  query(a){
    return { name: a.name, creatorName: a.creatorName || '', leaderName: this.player(a.leader)?.name || '', curNum: a.members.length, limit: this.memberLimit(a),
      prestige: this.prestige(a), ranking: this.ranking(a), desc: a.info || '', bulletin: a.note || '' };
  }
  rankBean(x, i){
    const a = x.a;
    return { id: a.id, rank: i + 1, name: a.name, createrName: a.creatorName || '', playerName: this.player(a.leader)?.name || '', member: a.members.length,
      city: this.members(a).reduce((s, q) => s + this.g.castlesOf(q).length, 0), prestige: x.prestige, honor: this.honor(a), description: a.info || '' };
  }
  memberBeans(a, viewer){
    return this.members(a).sort((x, y) => this.rank(x) - this.rank(y) || (y.prestige || 0) - (x.prestige || 0))
      .map(q => ({ ...this.g.beans.playerInfo(q, this.g.castlesOf(q)), accountName: q.id === viewer?.id ? q.account : '' }));
  }
  // The members' battles with other lords (Military Situation), newest first.
  situations(a){
    const seen = new Set(), out = [];
    for (const q of this.members(a)){
      for (const r of this.g.reports.list(q)){
        if (r.type !== 1 || !/<battleReport/.test(r.content || '')) continue;
        const atk = /<attackTroop[^>]*\bking="([^"]*)"/.exec(r.content)?.[1], def = /<defendTroop[^>]*\bking="([^"]*)"/.exec(r.content)?.[1];
        if (!atk || !def) continue;   // (lords' battles only)
        const key = `${r.at}|${atk}|${def}|${r.targetPos}`; if (seen.has(key)) continue; seen.add(key);
        const other = this.lord(r.attack ? def : atk), ob = this.of(other);
        out.push({ at: r.at, bean: { id: 0, type: 1, attack: !!r.attack, eventName: `${atk} Attack ${r.targetPos}`, startPos: r.startPos, targetPos: r.targetPos,
          otherAllianceName: ob ? ob.name : '', time: r.eventTime, xml_data: r.content } });
      }
    }
    return out.sort((x, y) => y.at - x.at).map(x => x.bean);
  }
}

module.exports = { Alliances, ALLIANCE_RANK: RANK, ALLIANCE_RANK_NAME: RANK_NAME, ALLIANCE_RELATION: REL };
