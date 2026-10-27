'use strict';
// Information screens: resource production, rankings, player lookup, quests.
module.exports = (game, H) => {
  const RES = [[1, 'food'], [2, 'wood'], [3, 'stone'], [4, 'iron']];
  H['interior.getResourceProduceData'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = game.logic.rates(c, p), rate = game.logic.commence(c), speed = game.logic.speed;
    game.reply(conn, cmd, { resourceProduceDataBean: RES.map(([typeid, k]) => {
      // The client shows these as amounts an hour at a 100% rate and scales them itself (ResourceProduction):
      // Productivity = productionCapacity (the fields' output), Basic Production = that x rate x staffing, Providence
      // = naturalPercentage, and the Technology, Hero, Valley and Items rows = each "percentage" x rate x staffing.
      const x = r.detail[k], amount = pct => Math.round(x.capacity * (pct || 0) / 100 * speed);
      return { typeid, basicOutput: Math.round(x.basic * speed), naturalPercentage: Math.round(x.natural * speed), technologicalPercentage: amount(x.tech), heroPercentage: amount(x.hero), fieldPercentage: amount(x.field),
        cimeliaPercentage: amount(x.item), armyPercentage: 0, commenceRate: rate[k], commenceDemands: x.workers, maxLabour: x.labour,
        productionCapacity: Math.round(x.capacity * speed), totalOutput: Math.round((r[k] - (r.tribute?.[k] || 0)) * speed) };
    }) });
  };

  const page = (list, d) => {
    const size = Math.max(1, Math.min(100, d.pageSize | 0 || 10)), total = Math.max(1, Math.ceil(list.length / size));
    const no = Math.max(1, Math.min(total, d.pageNo | 0 || 1));
    return { beans: list.slice((no - 1) * size, no * size), pageNo: no, pageSize: size, totalPage: total };
  };
  const match = (name, key) => !key || String(name).toLowerCase().includes(String(key).toLowerCase());
  // Rankings. sortType is the client's drop-down: players 1 title, 2 prestige, 3 honor, 4 cities, 5 population
  // (0: prestige); heroes 1 level, 2 politics, 3 attack, 4 intelligence; cities 1 population, 2 level.
  const by = (...keys) => (a, b) => { for (const k of keys){ const d = (b[k] || 0) - (a[k] || 0); if (d) return d; } return 0; };
  H['rank.getPlayerRank'] = (conn, d, cmd) => {
    const rows = Object.values(game.db.players).map(p => { const cs = game.castlesOf(p); return { p, title: p.title || 0, prestige: p.prestige || 0, honor: Math.round(p.honor || 0), cities: cs.length, pop: cs.reduce((a, c) => a + Math.floor(c.pop), 0) }; });
    const key = { 1: ['title', 'prestige'], 3: ['honor', 'prestige'], 4: ['cities', 'prestige'], 5: ['pop', 'prestige'] }[Number(d.sortType)] || ['prestige', 'pop'];
    const list = rows.sort(by(...key)).map(({ p }, i) => ({ ...game.beans.playerInfo(p, game.castlesOf(p)), ranking: i + 1 })).filter(b => match(b.userName, d.key));
    game.reply(conn, cmd, page(list, d));
  };
  H['rank.getCastleRank'] = (conn, d, cmd) => {
    const rows = Object.values(game.db.castles).map(c => ({ c, population: Math.floor(c.pop), level: game.logic.townHall(c) }));
    const list = rows.sort(Number(d.sortType) === 2 ? by('level', 'population') : by('population', 'level'))
      .map(({ c, population, level }, i) => ({ rank: i + 1, name: c.name, alliance: '', kind: game.db.players[c.playerId]?.name || '', grade: '', level, population }))
      .filter(b => match(b.name, d.key));
    game.reply(conn, cmd, page(list, d));
  };
  H['rank.getHeroRank'] = (conn, d, cmd) => {
    const H2 = game.heroes, rows = [];
    for (const c of Object.values(game.db.castles)) for (const h of H2.list(c)) rows.push({ h, lord: game.db.players[c.playerId]?.name || '', level: h.level,
      management: Math.round(H2.effective(h, 'pol')), power: Math.round(H2.effective(h, 'atk')), stratagem: Math.round(H2.effective(h, 'int')) });
    const key = { 2: ['management', 'level'], 3: ['power', 'level'], 4: ['stratagem', 'level'] }[Number(d.sortType)] || ['level', 'power'];
    const list = rows.sort(by(...key)).map((r, i) => ({ rank: i + 1, name: r.h.name, kind: r.lord, grade: r.level, management: r.management, power: r.power, stratagem: r.stratagem,
      isHero: r.h.king ? 2 : r.h.historic ? 1 : r.h.ringHero ? 4 : 0 })).filter(b => match(b.name, d.key));
    game.reply(conn, cmd, page(list, d));
  };
  H['common.getPlayerInfoByName'] = (conn, d, cmd) => {
    const p = game.chat.byName(d.userName);   // (a name clicked in the chat may carry the Governor's title)
    if (!p) return game.fail(conn, cmd, -41, 'No lord by that name.');
    game.reply(conn, cmd, { playerInfo: game.beans.playerInfo(p, game.castlesOf(p)) });
  };
};
