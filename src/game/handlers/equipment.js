'use strict';
// Hero gear: research in the Workshop (equipmenttech.*), wearing it (equipment.*) and gear stars.
module.exports = (game, H) => {
  const eq = game.equipment;
  H['equipmenttech.getResearchList'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, { academyCount: game.logic.level(c, 26) ? 1 : 0, acailableResearchBeans: eq.list(c, conn.player) });
  };
  H['equipmenttech.research'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = eq.start(c, p, Number(d.techId), game.now());
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, { tech: eq.bean(c, p, Number(d.techId)) });
    game.pushItems(p, r.items);
  };
  H['equipmenttech.cancelResearch'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = eq.cancel(p);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch(); game.reply(conn, cmd, {}); game.pushItems(p, r.items);
  };
  H['equipmenttech.getCoinsNeed'] = (conn, d, cmd) => {
    const r = conn.player.gearResearch, left = r ? Math.max(0, r.endTime - game.now()) : 0;
    game.reply(conn, cmd, { coinsNeed: left ? game.items.coinsFor(left) : 0 });
  };
  H['equipmenttech.speedUpResearch'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = p.gearResearch, now = game.now();
    if (!r) return game.fail(conn, cmd, -26, 'Nothing is being researched in the Workshop.');
    const left = Math.max(0, r.endTime - now);
    const s = game.items.speedup(p, d.itemId, left, game.items.coinsFor(left));
    if (s.err) return game.fail(conn, cmd, -44, s.err);
    if (s.item) game.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    r.endTime = now + Math.max(0, s.reduce(left));
    game.store.touch();
    const rc = game.db.castles[r.castleId] || c;
    game.reply(conn, cmd, { tech: eq.bean(rc, p, r.type) });
    if (s.item) game.pushItems(p, [s.item]);
    if (s.coins) game.pushPlayerInfo(p);
    game.completeDue(rc, true);
  };

  // ---------- wearing gear ----------
  const onHero = fn => (conn, d, cmd) => {
    const p = conn.player, id = Number(d.heroid);
    const c = game.castlesOf(p).find(x => game.heroes.find(x, id)); if (!c) return game.fail(conn, cmd, -1, 'No such hero.');
    const h = game.heroes.find(c, id);
    if (game.heroes.seized(h)) return game.fail(conn, cmd, -109, `${h.name} is a captive. Persuade or release the hero first.`);
    const r = fn(p, h, d);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.pushHero(c, h, 2);        // before the reply: the hero window redraws from the hero it holds
    game.reply(conn, cmd, {});
    game.pushResources(c);
  };
  H['equipment.WearEquipmenttech'] = onHero((p, h, d) => eq.wear(p, h, d.pos, d.AddAttributeType));
  H['equipment.WearAllEquipmenttech'] = onHero((p, h, d) => eq.wearAll(p, h, d.AddAttributeType));
  H['equipment.TakeOffEquipmenttech'] = onHero((p, h, d) => eq.takeOff(h, d.pos));
  H['equipment.TakeOffAllEquipmenttech'] = onHero((p, h) => eq.takeOffAll(h));

  // ---------- stars ----------
  // EnhancedStarByGemStone(gemstoneid, count, pos): pos is the gear technology type.
  H['equipment.EnhancedStarByGemStone'] = (conn, d, cmd) => {
    const p = conn.player, type = Number(d.pos);
    const r = eq.enhanceStar(p, type, d.gemstoneid, d.count);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, { enhancedstarlv: r.star, equipmenttechid: type });
    game.pushItems(p, [r.gemId]);
    // Worn pieces of this gear changed strength.
    for (const c of game.castlesOf(p)) for (const h of game.heroes.list(c)) if (h.gear && Object.keys(h.gear).length) game.pushHero(c, h, 2);
    game.log.info(`${p.name} ${r.ok ? 'raised' : 'failed to raise'} ${game.data.equipTechs[type]?.name} stars (${r.from} -> ${r.star}, ${r.rate}%)`);
  };
  H['equipment.EnhancedByGemStone'] = (conn, d, cmd) => game.fail(conn, cmd, -1, "Socketing gems isn't supported on this server yet.");
  H['shop.Gem_Smelting'] = (conn, d, cmd) => game.fail(conn, cmd, -1, "Gem smelting isn't supported on this server yet.");
};
