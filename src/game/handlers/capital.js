'use strict';
// Historic City policies (PoliciesView): uses left and used today, and the five policies.
module.exports = (game, H) => {
  const P = game.policies;
  const inCity = fn => (conn, d, cmd) => { const c = game.castleOr(conn, cmd, d.castleId); if (c) fn(c, conn.player, d, cmd, conn); };
  H['capital.getLeftPoliciesTimes'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, { amount: P.left(c, game.now()), castleId: c.id }));
  H['capital.getUsedPoliciesTimes'] = inCity((c, p, d, cmd, conn) => game.reply(conn, cmd, { amount: P.used(c, game.now()), castleId: c.id }));
  for (const [cmdName, kind] of [['capital.levyTaxes', 'tax'], ['capital.levyPopulation', 'population'], ['capital.levyFood', 'food'], ['capital.levyArmy', 'draft'], ['capital.reduceArmaments', 'disarm']]){
    H[cmdName] = inCity((c, p, d, cmd, conn) => {
      const r = P.use(c, p, kind, d.targetFieldId, game.now());
      if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
      game.reply(conn, cmd, r);
    });
  }
};
