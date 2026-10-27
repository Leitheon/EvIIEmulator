'use strict';
// Academy research.
module.exports = (game, H) => {
  const { research } = game;
  H['tech.getResearchList'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    game.reply(conn, cmd, { academyCount: game.logic.level(c, 25) ? 1 : 0, acailableResearchBeans: research.list(c, conn.player) });
  };
  H['tech.research'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const err = research.start(c, conn.player, d.techId, game.now());
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch();
    game.reply(conn, cmd, { tech: research.bean(c, conn.player, d.techId) });
    game.push(conn.player.id, 'server.AcademyResearchUpdate', { castleId: c.id, researchBean: research.bean(c, conn.player, d.techId) });
    game.pushResources(c);
  };
  H['tech.cancelResearch'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const techId = conn.player.research?.techId;
    const err = research.cancel(conn.player, game.db.castles);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    game.store.touch(); game.reply(conn, cmd, {});
    if (techId) game.push(conn.player.id, 'server.AcademyResearchUpdate', { castleId: c.id, researchBean: research.bean(c, conn.player, techId) });
    game.pushResources(c);
  };
  H['tech.getCoinsNeed'] = (conn, d, cmd) => {
    const r = conn.player.research, left = r ? Math.max(0, r.endTime - game.now()) : 0;
    game.reply(conn, cmd, { coinsNeed: left ? game.items.coinsFor(left) : 0 });
  };
  H['tech.speedUpResearch'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, r = p.research, now = game.now();
    if (!r) return game.fail(conn, cmd, -26, 'Nothing is being researched.');
    const left = Math.max(0, r.endTime - now);
    const s = game.items.speedup(p, d.itemId, left, game.items.coinsFor(left));
    if (s.err) return game.fail(conn, cmd, -44, s.err);
    if (s.item) game.items.take(p, s.item);
    if (s.coins) p.coins -= s.coins;
    r.endTime = now + Math.max(0, s.reduce(left));
    game.store.touch();
    const rc = game.db.castles[r.castleId] || c;
    game.reply(conn, cmd, { tech: research.bean(rc, p, r.techId) });
    if (s.item) game.pushItems(p, [s.item]);
    if (s.coins) game.pushPlayerInfo(p);
    game.push(p.id, 'server.AcademyResearchUpdate', { castleId: rc.id, researchBean: research.bean(rc, p, r.techId) });
    game.completeDue(rc, true);
  };
};
