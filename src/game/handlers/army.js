'use strict';
// Sending and recalling armies.
module.exports = (game, H) => {
  const { armies } = game;
  H['army.newArmy'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now();
    const r = armies.send(c, p, d.newArmyBean || {}, now);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushTroops(c); game.pushResources(c);
    if (r.hero) game.pushHero(c, r.hero, 2);
    if (r.usedItems?.length) game.pushItems(p, r.usedItems);
    game.pushArmies(p);
    if (armies.hostile(r.army)) game.pushEnemies(game.targetLord(r.army));
    if (r.army.mission === 2){ const t = armies.targetCity(r.army); if (t && t.playerId !== p.id) game.pushFriends(game.db.players[t.playerId]); }   // (troops on their way to an ally)
    game.log.info(`${p.name} sent an army (mission ${r.army.mission}) to ${armies.placeName(r.army.target)}, arriving in ${Math.round((r.army.reachTime - now) / 1000)}s`);
  };
  H['army.callBackArmy'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const a0 = armies.list()[d.armyId], foe = a0 && a0.playerId === conn.player.id && armies.hostile(a0) ? game.targetLord(a0) : null;
    const goingTo = a0 && a0.mission === 2 ? armies.targetCity(a0) : null;
    const r = armies.recall(conn.player, d.armyId, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushArmies(conn.player);
    if (foe) game.pushEnemies(foe);
    // Allied troops: their lord and the city's lord both see them go.
    const owner = game.db.players[r.army.playerId], hostLord = r.host ? game.db.players[r.host.playerId] : null;
    if (r.sentBack && owner){ game.reports.add(owner, { type: 2, title: `${conn.player.name} sent your troops home from ${r.host.name}`, content: 'Your troops are heading home.' }); game.pushArmies(owner); }
    if (hostLord) game.pushFriends(hostLord);
    else if (goingTo && goingTo.playerId !== conn.player.id) game.pushFriends(game.db.players[goingTo.playerId]);
  };
  // The Embassy: allied troops stationed in the city, or on their way to it, and whether allies may station any.
  H['army.getStayAllianceArmys'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, { allianceArmys: [...armies.guests(c), ...armies.guestsComing(c)].map(a => armies.bean(a)) });
  };
  const flag = v => v === true || v === 'true' || v === 1;
  H['army.setAllowAllianceArmy'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (!c) return; c.allowAlliance = flag(d.isAllow); game.store.touch(); game.reply(conn, cmd, {}); };
  // The Rally Spot's "go out of the city" (kept; it changes nothing in battle here: live cities all show false).
  H['army.setArmyGoOut'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (!c) return; c.goOut = flag(d.isArmyGoOut); game.store.touch(); game.reply(conn, cmd, {}); };
  // The Fugitive Camp (Rally Spot): "Mutiny may occur when your city does not have enough food to feed the troops."
  // Fox: that was Age I (10% an hour); on Age II hungry troops don't desert, they just can't march without food.
  // So the camp stays empty.
  H['army.getFleeTroop'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, {});
    game.push(c.playerId, 'server.FleeTroopUpdate', { castleId: c.id, goldNeed: 0, troop: game.beans.troop({}) });
  };
  for (const cmd of ['army.recruitFleeTroop', 'army.disbandFleeTroop'])
    H[cmd] = (conn, d) => game.fail(conn, cmd, -29, "No troops have fled this city: on Age II hungry troops don't desert.");
  // The Drill Grounds' Maneuver: a practice battle between two forces you enter, fought with your own research
  // (no heroes, walls or defenses) and costing nothing.
  H['army.exerciseArmy'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, C = game.combat;
    const side = t => { const o = {}; for (const x of Object.values(game.data.troops)) o[x.field] = Math.max(0, Math.min(1e9, Math.floor(Number(t?.[x.field]) || 0))); return o; };
    const a = side(d.troopParamAttack), b = side(d.troopParamDefend);
    if (!Object.values(a).some(Boolean) || !Object.values(b).some(Boolean)) return game.fail(conn, cmd, -27, 'Both sides need troops for a maneuver.');
    const r = C.fight({ troops: a, mods: C.mods(game.logic, p, null, a, { side: 'attack' }) }, { troops: b, mods: C.mods(game.logic, p, null, b, { side: 'defence' }) });
    const lost = (was, left) => game.beans.troop({ troops: Object.fromEntries(Object.entries(was).map(([k, n]) => [k, n - (left[k] || 0)])) });
    game.reply(conn, cmd, { result: r.attackerWon ? 1 : -1, round: r.round, attackLostTroop: lost(a, r.attLeft), defendLostTroop: lost(b, r.defLeft) });
  };
  // The Hospital window: wounded troops resting in the Rally Spot.
  H['army.getInjuredTroop'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (!c) return; game.reply(conn, cmd, {}); game.pushInjured(c); };
  H['army.cureInjuredTroop'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const r = armies.cure(c, conn.player, game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.reply(conn, cmd, {}); game.questNotice(conn.player, c);
    game.log.info(`${conn.player.name} cured ${Object.values(r.troops).reduce((a, b) => a + b, 0)} wounded for ${r.gold} gold`);
  };
  H['army.disbandInjuredTroop'] = (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (!c) return; armies.disbandWounded(c, game.now()); game.reply(conn, cmd, {}); };
  // The Hospital's Auto Heal box.
  H['common.setAutoHeal'] = (conn, d, cmd) => { conn.player.autoHeal = !!d.autoHeal && d.autoHeal !== 'false'; game.store.touch(); game.reply(conn, cmd, {}); };
};
