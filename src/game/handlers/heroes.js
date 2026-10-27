'use strict';
// Inn and Feasting Hall.
module.exports = (game, H) => {
  const { heroes } = game;
  const pool = () => game.faces;
  const listReply = (conn, cmd, c) => {
    const offers = heroes.innList(c, game.now(), pool());
    game.reply(conn, cmd, { heros: offers.map((o, i) => heroes.offerBean(o, i)), posCount: heroes.vacancies(c) });
  };
  H['hero.getHerosListFromTavern'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c){ listReply(conn, cmd, c); game.store.touch(); } };
  // "Hero Hunting" refreshes the Inn. Without one in the inventory the client offers to buy it, then asks
  // again, so the item's coin price is charged here instead.
  H['hero.refreshHerosListFromTavern'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, id = 'consume.refreshtavern.1', price = game.data.items[id]?.price || 5;
    if (!heroes.innLevel(c)) return game.fail(conn, cmd, -30, 'Build an Inn to recruit heroes.');
    if (game.items.take(p, id)) game.pushItems(p, [id]);
    else if ((p.coins || 0) >= price){ p.coins -= price; game.pushPlayerInfo(p); }
    else return game.fail(conn, cmd, -28, `Refreshing the Inn takes a Hero Hunting (${price} coins).`);
    heroes.refreshInn(c, game.now(), pool());
    game.store.touch();
    listReply(conn, cmd, c);
  };
  H['hero.hireHero'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const r = heroes.hire(c, d.heroName, () => game.store.id());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushHero(c, r.hero, 0);
    game.pushResources(c);
    if (r.hero.historic){
      game.hh.hired(r.hero.historic, c, r.hero.id, conn.player);
      const item = `hero.taskitem.${r.hero.historic}`;
      if (game.items.take(conn.player, item)) game.pushItems(conn.player, [item]);
    }
    game.log.info(`${conn.player.name} hired ${r.hero.name} (level ${r.hero.level})`);
  };
  // A captive (status 4) can only be persuaded or released; the client hides the other buttons.
  const heroAct = (fn, after, captives = false) => (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const held = d.heroId != null ? heroes.find(c, d.heroId) : null;
    if (!captives && heroes.seized(held)) return game.fail(conn, cmd, -1, `${held.name} is a captive. Persuade or release the hero first.`);
    const r = fn(c, d, conn.player, conn);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    if (r.hero) game.pushHero(c, r.hero, r.deleted ? 1 : 2);
    for (const h of r.changed || []) game.pushHero(c, h, 2);
    if (after) after(c, conn.player, r);
    game.pushResources(c);
  };
  H['hero.fireHero'] = heroAct((c, d, p, conn) => { const locked = game.account.guard(conn, 8); if (locked) return locked; const r = heroes.fire(c, d.heroId); return Array.isArray(r) ? r : { ...r, deleted: true }; },
    (c, p, r) => { if (r.hero.historic) game.hh.release(r.hero.historic); });
  // A captured NPC hero: Persuade (level x 1,000 gold) or Release.
  H['hero.tryGetSeizedHero'] = heroAct((c, d, p) => {
    const r = heroes.persuade(c, d.heroId, p.items);
    if (!Array.isArray(r) && r.item){ game.items.take(p, r.item); r.items = [r.item]; }
    if (!Array.isArray(r) && r.medal){ game.items.take(p, r.medal, r.medals); r.items = [...(r.items || []), r.medal]; }
    return r;
  }, (c, p, r) => {
    if (r.items) game.pushItems(p, r.items);
    if (r.hero.historic) game.hh.hired(r.hero.historic, c, r.hero.id, p);
    game.quests.flag(p, 'captureHero'); if (r.hero.historic) game.quests.flag(p, 'captureFamous'); game.questNotice(p);
    game.log.info(`${p.name} persuaded ${r.hero.name} to join`);
  }, true);
  // A released historic hero goes back to an NPC city somewhere else; another lord's hero goes home (captives.js).
  H['hero.releaseHero'] = heroAct((c, d) => { const r = heroes.release(c, d.heroId); return Array.isArray(r) ? r : { ...r, deleted: true }; },
    (c, p, r) => { if (r.hero.capturedFrom) game.captives.releaseHome(r.hero); else if (r.hero.historic) game.hh.release(r.hero.historic); }, true);
  H['hero.promoteToChief'] = heroAct((c, d) => heroes.promote(c, d.heroId));
  H['hero.dischargeChief'] = heroAct(c => heroes.discharge(c));
  H['hero.addPoint'] = heroAct((c, d) => heroes.addPoints(c, d.heroId, d.management, d.power, d.stratagem));
  H['hero.addPoint2'] = H['hero.addPoint'];
  H['hero.levelUp'] = heroAct((c, d) => heroes.levelUp(c, d.heroId));
  H['hero.awardGold'] = heroAct((c, d) => heroes.award(c, d.heroId));
  H['hero.changeName'] = heroAct((c, d) => heroes.rename(c, d.heroId, d.newName));
  H['hero.resetPoint'] = heroAct((c, d, p) => heroes.resetPoints(c, d.heroId, p.items), (c, p) => game.pushItems(p, ['hero.reset.1']));
  // Recall the army a hero leads (the Feasting Hall's Recall, for a hero out or stationed).
  H['hero.callBackHero'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, a = game.armies.of(p).find(x => x.heroId === Number(d.heroId));
    if (!a) return game.fail(conn, cmd, -1, 'That hero is not out with an army.');
    const foe = game.armies.hostile(a) ? game.targetLord(a) : null;
    const r = game.armies.recall(p, a.id, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushArmies(p); if (foe) game.pushEnemies(foe);
    const hc = game.db.castles[a.castleId], h = hc && heroes.find(hc, a.heroId); if (h) game.pushHero(hc, h, 2);
  };
  // Champions: the heroes a lord shows other lords (his profile's hero list; the map window's and profile's
  // Champions button).
  const shown = p => (p.showHeroes || []).filter(id => game.castlesOf(p).some(c => { const h = heroes.find(c, id); return h && !heroes.seized(h); }));
  game.heroes.shownOf = p => shown(p).map(id => ({ selectshowheroid: id }));
  H['hero.SetShowHeroId'] = (conn, d, cmd) => {
    const p = conn.player, id = Number(d.heroid), add = d.bAddOrDel !== false && d.bAddOrDel !== 'false';
    if (!game.castlesOf(p).some(c => heroes.find(c, id))) return game.fail(conn, cmd, -1, 'That hero is not yours.');
    const set = new Set(shown(p)); if (add) set.add(id); else set.delete(id);
    p.showHeroes = [...set]; game.store.touch();
    game.reply(conn, cmd, { selectheroids: game.heroes.shownOf(p) });
  };
  H['hero.ShowPlayerHerosByUserName'] = (conn, d, cmd) => {
    const name = String(d.UserName || '').trim().toLowerCase(), q = Object.values(game.db.players).find(x => x.name.toLowerCase() === name);
    if (!q) return game.fail(conn, cmd, -1, 'There is no lord by that name.');
    const ids = new Set(shown(q)), list = [];
    for (const c of game.castlesOf(q)) for (const h of heroes.list(c)) if (ids.has(h.id)) list.push(heroes.bean(h));
    game.reply(conn, cmd, { heros: list, posCount: list.length });
  };
  // Hero Ransom: on Age II heroes don't run off over unpaid salaries (Fox), so it stays empty.
  H['hero.getFleeHeroList'] = (conn, d, cmd) => game.reply(conn, cmd, { heros: [], posCount: 0 });
  H['hero.recruitFleeHero'] = (conn, d, cmd) => game.fail(conn, cmd, -1, "No hero has fled: on Age II heroes stay even when their salaries can't be paid.");
  // Heroes captured by other lords in the last 24 hours, and the Stone of Finding that brings one back.
  H['hero.GetDisappearHeros'] = (conn, d, cmd) => game.reply(conn, cmd, { heros: game.captives.lost(conn.player) });
  H['hero.RecoverDisappearHero'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleid ?? d.castleId); if (!c) return;
    const r = game.captives.recover(conn.player, c, d.id);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {}); game.pushItems(conn.player, r.items); game.pushResources(c);
  };
  // Recruit Hero (the top bar's button, shown on servers whose name has "ca" or "cc": the merged servers). Fox:
  // it takes an "Ancient Ring", the Legendary Ring, which merged servers gave out for each historic hero lost
  // in the merge. The hero has the lord's name and portrait (both can be changed) and rolled attributes; Reset
  // Attributes rolls the unlocked ones again, free 3 times a day ("Free reset of attributes 3 times today"),
  // then 10 coins and 10,000 gold, 20 and 20,000 with one attribute locked, 40 and 40,000 with two (the
  // client's own prices). The roll is rules.ringHero (UNVERIFIED).
  const RING = 'hero.gen.npc2', ring = () => game.rules.ringHero || {};
  const roll = () => { const lo = ring().min ?? 30, hi = ring().max ?? 100; return lo + Math.floor(Math.random() * (hi - lo + 1)); };
  const pending = p => {
    const day = game.npc.day(game.now()), s = p.ringHero || (p.ringHero = { management: roll(), power: roll(), stratagem: roll(), resets: 0, day });
    if (s.day !== day){ s.day = day; s.resets = 0; }
    return s;
  };
  const ringBean = (p, s, locks = []) => ({ id: p.id, player_id: p.id, management: s.management, power: s.power, stratagem: s.stratagem,
    resetcount: Math.max(0, (ring().freeResets ?? 3) - s.resets), resettime: s.resetAt || 0, lockmanagement: !!locks[0], lockpower: !!locks[1], lockstratagem: !!locks[2] });
  const noRing = 'Recruit Hero takes a Legendary Ring (an Ancient Ring: the merged servers gave one for each historic hero lost in the merge).';
  H['hero.GetRandomHero'] = (conn, d, cmd) => {
    const p = conn.player; if (!game.items.has(p, RING)) return game.fail(conn, cmd, -44, noRing);
    // (live: the roll waits, with its locks, until the hero is made)
    const s = pending(p); game.store.touch(); game.reply(conn, cmd, { randomherobean: ringBean(p, s, s.locks) });
  };
  H['hero.RetSetHeroAttri'] = (conn, d, cmd) => {
    const p = conn.player, yes = v => v === true || v === 'true', locks = [yes(d.lockmanagement), yes(d.lockpower), yes(d.lockstratagem)], n = locks.filter(Boolean).length;
    if (!game.items.has(p, RING)) return game.fail(conn, cmd, -44, noRing);
    if (n > 2) return game.fail(conn, cmd, -1, 'Lock at most two attributes.');
    const s = pending(p), free = s.resets < (ring().freeResets ?? 3);
    if (!free){
      const coins = n === 2 ? 40 : n === 1 ? 20 : 10, gold = coins * 1000;
      const cs = game.castlesOf(p); for (const c of cs) game.catchUp(c);
      const c = cs.reduce((a, b) => (b.res.gold > a.res.gold ? b : a), cs[0]);
      if ((p.coins || 0) < coins || !c || c.res.gold < gold) return game.fail(conn, cmd, -28, `This reset costs ${coins} coins and ${gold.toLocaleString('en-US')} gold.`);
      p.coins -= coins; c.res.gold -= gold; game.pushPlayerInfo(p); game.pushResources(c);
    }
    s.resets++; s.locks = locks; s.resetAt = game.now();
    if (!locks[0]) s.management = roll(); if (!locks[1]) s.power = roll(); if (!locks[2]) s.stratagem = roll();
    game.store.touch(); game.reply(conn, cmd, { randomherobean: ringBean(p, s, locks) });
  };
  H['hero.GenSaveRandomHero'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleid ?? d.castleId); if (!c) return;
    const p = conn.player, name = String(d.heroname || '').trim(), face = String(d.faceurl || '');
    if (!game.items.has(p, RING)) return game.fail(conn, cmd, -44, noRing);
    if (!name || name.length > 20) return game.fail(conn, cmd, -1, 'Hero names must be 1 to 20 characters.');
    if (!heroes.vacancies(c)) return game.fail(conn, cmd, -1, `The Feasting Hall in ${c.name} has no free seat.`);
    const s = pending(p), now = game.now();
    const h = { id: game.store.id(), name, level: ring().level ?? 1, exp: 0, base: { pol: s.management, atk: s.power, int: s.stratagem }, added: { pol: 0, atk: 0, int: 0 }, points: 0,
      face: /^images\/icon\/player\/face[AB]\d+\.(jpg|png)$/.test(face) ? face : p.faceUrl, sex: /faceB/.test(face), status: 0, loyalty: game.rules.heroStartLoyalty ?? 70, hiredAt: now, ringHero: true };
    game.items.take(p, RING); delete p.ringHero;
    heroes.list(c).push(h);
    game.store.touch(); game.reply(conn, cmd, {});
    game.pushHero(c, h, 0); game.pushItems(p, [RING]);
    game.log.info(`${p.name} recruited ${name} with a Legendary Ring (${s.management}/${s.power}/${s.stratagem})`);
  };
  // Medals, experience books, Excalibur / The Art of War / The Wealth of Nations.
  H['hero.useItem'] = heroAct((c, d, p) => {
    const h = heroes.find(c, d.heroId); if (!h) return [-1, 'No such hero.'];
    return game.itemUse.useOnHero(p, c, h, d.itemId, game.now());
  }, (c, p, r) => game.pushItems(p, r.items || []));
};
