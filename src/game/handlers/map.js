'use strict';
// World map: terrain string, cities and Historic Cities on screen, tile info and the zone list.
const world = require('../world');

module.exports = (game, H) => {
  const MAX_TILES = 40000;
  const zoneName = id => game.rules.zones[world.zoneOf(id)] || '';
  const base = (t, extra) => ({
    id: t.id, castleId: 0, name: '', userName: '', flag: '', type: t.type, npc: false, powerLevel: 4, prestige: 0, honor: 0, allianceName: null, state: 0,
    relation: 6, ownerPlayerId: 0, castleIcon: 0, playerLogoUrl: null, zoneName: zoneName(t.id), suzerain: '', canScout: true, canLoot: true, canOccupy: true,
    canSend: false, canTrans: false, canColonize: false, canDeclaredWar: false, freshMan: false, furlough: false, changeface: 0, colonialRelation: 0,
    colonialStatus: 0, declaredWarStatus: 0, declaredWarStartTime: 0, ...extra });

  // The MapCastleBean for any tile. allianceName is null (no alliance): an empty string would match the lord's own
  // empty alliance, and the march window would then show the Relief Station bonus for every target. NPC and Historic Cities send playerLogoUrl null: that is how the client tells them apart.
  game.mapBean = (conn, t) => {
    const me = conn.player;
    if (t.type === world.T.NPC){
      // No lord's name (a name adds Send Mail and Champions buttons), and canOccupy shows the Attack button
      // (FieldInfoWin), as on the live game.
      if (t.historic) return base(t, { name: t.historic.name, userName: '', flag: '', npc: true, powerLevel: t.historic.powerLevel, canOccupy: true });
      return base(t, { name: "Barbarian's city", userName: '', flag: '', npc: true, canOccupy: true });   // (the live name, no flag)
    }
    if (t.type === world.T.CASTLE){
      const c = game.db.castles[t.castleId], p = c && game.db.players[c.playerId];
      if (!c || !p) return base(t, {});
      const mine = me && p.id === me.id;
      // A captured Historic City keeps its art and title through its powerLevel.
      // Colonies (FieldInfoWin): colonialRelation FREE shows Colonize, BEING_COLONIED shows Uprise (colonies.mapFields).
      // War (war.js): relation 2 (no alliance between them) shows Declare War, and the war's status and start
      // drive the Attack and Colonize buttons, their "War begins in" tooltips and the city's flag.
      // (alliances.js: 0 the viewer's own alliance, 1 friendly, 2 neutral, 3 hostile; the flag's colour follows it)
      // canOccupy: whether he can attack it now (a war, a hostile alliance, a captured Historic City). With it the
      // field window shows Colonize; live shows a lord you aren't at war with Declare War and no Colonize (Fox).
      // canSend / canTrans: Reinforce and Transport, only to your own and your alliance's cities (and a city your army
      // is colonizing, to reinforce it); live shows neither on a neutral lord's city (Fox).
      const helps = mine || (!!me && game.alliances.same(me, p)), backs = helps || (!!me && game.colonies.canReinforce(me, c));
      return base(t, { castleId: c.id, name: c.name, userName: p.name, flag: p.flag, prestige: p.prestige || 0, relation: mine ? 1 : game.alliances.relation(me, p), ownerPlayerId: p.id,
        allianceName: game.alliances.of(p)?.name || null, honor: p.honor || 0, state: game.war.cityState(p, me),
        powerLevel: c.powerLevel ?? 4, castleIcon: c.icon || 0, playerLogoUrl: p.faceUrl || '', canScout: !mine, canLoot: !mine,
        canOccupy: !mine && !!me && !game.war.cantAttack(me, c), canSend: backs, canTrans: helps,
        ...game.colonies.mapFields(c, me), ...game.war.mapFields(me, p), furlough: game.war.vacation(p) });
    }
    if (t.ownerCastle){
      const c = game.db.castles[t.ownerCastle], p = c && game.db.players[c.playerId];
      if (c && p){
        const mine = me && p.id === me.id;
        return base(t, { castleId: c.id, name: c.name, userName: p.name, flag: p.flag, prestige: p.prestige || 0, relation: mine ? 1 : 6, ownerPlayerId: p.id,
          canScout: !mine, canLoot: false, canOccupy: !mine });
      }
    }
    return base(t, { canLoot: false, canOccupy: t.type !== world.T.FLAT || !!game.rules.flatsConquerable });
  };

  // Tiles from (x1,y1) to (x2,y2) inclusive, row by row; coordinates wrap around the 800x800 world.
  function area(conn, d){
    const x1 = d.x1 | 0, y1 = d.y1 | 0, x2 = d.x2 | 0, y2 = d.y2 | 0;
    if (x2 < x1 || y2 < y1 || (x2 - x1 + 1) * (y2 - y1 + 1) > MAX_TILES) return null;
    let mapStr = ''; const castles = [], seen = new Set();
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++){
      const id = world.idOf(x, y), t = world.tileAt(game.store, id);
      if (t.type === world.T.CASTLE){
        const c = game.db.castles[t.castleId];
        mapStr += world.tileCode({ type: t.type, level: c ? Math.max(1, game.logic.townHall(c)) : 1 });
      } else mapStr += world.tileCode(t);
      // Cities, Historic Cities and NPC cities need a bean: Historic City art and level come from its powerLevel.
      if ((t.type === world.T.CASTLE || t.type === world.T.NPC) && !seen.has(id)){ seen.add(id); castles.push(game.mapBean(conn, t)); }
    }
    return { x1, y1, x2, y2, mapStr, castles };
  }
  for (const cmd of ['common.mapInfoSimple', 'common.mapInfo']){
    H[cmd] = (conn, d) => { const a = area(conn, d); if (!a) return game.fail(conn, cmd, -1, 'That map area is too large.'); game.reply(conn, cmd, a); };
  }
  H['common.mapCastle'] = (conn, d, cmd) => { const a = area(conn, d); if (!a) return game.fail(conn, cmd, -1, 'That map area is too large.'); game.reply(conn, cmd, { castleArray: a.castles }); };
  H['common.zoneInfo'] = (conn, d, cmd) => {
    const counts = new Array(16).fill(0), players = new Array(16).fill(null).map(() => new Set());
    for (const c of Object.values(game.db.castles)){ const z = world.zoneOf(c.fieldId); counts[z]++; players[z].add(c.playerId); }
    game.reply(conn, cmd, { zones: game.rules.zones.map((name, id) => ({ id, name, castleCount: counts[id], playerCount: players[id].size, rate: Math.min(99, Math.round(counts[id] / 100)) })) });
  };
};
