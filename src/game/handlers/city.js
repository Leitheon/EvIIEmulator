'use strict';
// City commands: teleporting (Adv City Teleporter, City Teleporter, War Teleporter, Pioneer Express),
// renaming the city and the lord, the flag, the city icon and the Truce Agreement.
const world = require('../world');
const { HOUR } = require('../items');

module.exports = (game, H) => {
  const { items } = game;
  // Where an Adv City Teleporter can land: an empty flat tile.
  const landError = (id) => {
    if (!(id >= 0 && id < world.SIZE * world.SIZE)) return 'That map location does not exist.';
    const t = world.tileAt(game.store, id);
    if (t.historic) return 'A Historic City stands there.';
    if (t.type === world.T.CASTLE) return 'Another city already stands there.';
    if (t.type !== world.T.FLAT || game.db.tiles[id]) return 'You can only move your city to an empty flat.';
    return null;
  };
  // Where a War Teleporter can land: on a barbarian city ("Teleport your city to a barbarian city"; Fox: the city
  // lands on top of it, and the barbarian city is gone).
  const barbarianError = (id) => {
    if (!(id >= 0 && id < world.SIZE * world.SIZE)) return 'That map location does not exist.';
    const t = world.tileAt(game.store, id);
    if (t.historic) return 'A War Teleporter can\'t land on a Historic City.';
    return t.type === world.T.NPC ? null : 'Choose a barbarian city: a War Teleporter lands on one.';
  };
  // Move the city to `to`. Valleys are given up (as on the live game) and armies must be home.
  const move = (c, to, onBarbarian = false) => {
    const p = game.playerOf(c), rules = game.rules.teleport || {};
    if (to === c.fieldId) return [-13, 'Your city is already there.'];
    const err = onBarbarian ? barbarianError(to) : landError(to); if (err) return [-13, err];
    if (rules.needArmiesHome !== false){
      const out = game.armies.fromCastle(c).length;
      if (out) return [-13, `${out} of this city's armies ${out === 1 ? 'is' : 'are'} still out. Bring them home before teleporting.`];
      // The teleporters: "Any troops sent or garrison troops in your city is not allowed while teleporting."
      const guests = game.armies.guests(c).length + game.armies.guestsComing(c).length;
      if (guests) return [-13, 'Allied troops are stationed in this city or on their way to it. Send them home (the Embassy) before teleporting.'];
    }
    const from = c.fieldId, dropped = [];
    if (!rules.keepValleys) for (const v of [...(c.valleys || [])]){ const r = game.armies.giveUp(c, v); if (!Array.isArray(r)) dropped.push(r.bean); }
    // The spot it leaves is a flat again (a barbarian city it had landed on or taken doesn't come back).
    const natural = world.naturalTile(game.db.seed, from);
    if (natural.type === world.T.FLAT || world.historicAt(from)) delete game.db.tiles[from];   // (a Historic City's spot is its own again)
    else game.db.tiles[from] = { type: world.T.FLAT, level: c.flatLevel || 1 };
    c.flatLevel = game.spotLevel(to);
    if (onBarbarian && game.db.npc) delete game.db.npc[to];
    game.db.tiles[to] = { type: world.T.CASTLE, level: 1, castleId: c.id, playerId: p.id };
    c.fieldId = to;
    game.store.touch();
    for (const bean of dropped) game.push(p.id, 'server.CastleFieldUpdate', { castleId: c.id, updateType: 1, bean });
    const a = world.xy(from), b = world.xy(to);
    game.log.info(`${p.name} teleported ${c.name} from (${a.x},${a.y}) to (${b.x},${b.y})${dropped.length ? `, giving up ${dropped.length} valley${dropped.length === 1 ? '' : 's'}` : ''}`);
    return null;
  };
  const teleport = (itemIds, pickTarget, onBarbarian = false) => (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player;
    const itemId = itemIds.find(id => items.has(p, id));
    if (!itemId) return game.fail(conn, cmd, -44, `You don't have ${items.name(itemIds[0])}.`);
    const to = pickTarget(c, d);
    if (Array.isArray(to)) return game.fail(conn, cmd, to[0], to[1]);
    const err = move(c, to, onBarbarian);
    if (err) return game.fail(conn, cmd, err[0], err[1]);
    items.take(p, itemId);
    game.pushCastle(c, 2);
    game.reply(conn, cmd, {});
    game.pushItems(p, [itemId]);
    game.pushResources(c);
  };
  const chosen = (c, d) => Math.floor(Number(d.targetId));
  H['city.advMoveCastle'] = teleport(['player.more.castle.1.a'], chosen);
  H['city.uniteAdvMoveCastle'] = teleport(['player.move.castle.1.b', 'player.more.castle.1.a'], chosen);
  // War Teleporter: "Teleport your city to a barbarian city" - on top of it (Fox).
  H['city.WarMoveCastle'] = teleport(['player.more.castle.1.c'], chosen, true);
  // City Teleporter: a random empty flat in the chosen zone (or anywhere).
  H['city.moveCastle'] = teleport(['consume.move.1'], (c, d) => {
    const zone = Number(d.zoneId), inZone = zone >= 0 && zone < 16;
    for (let i = 0; i < 5000; i++){
      const x = inZone ? (zone % 4) * 200 + Math.floor(Math.random() * 200) : Math.floor(Math.random() * world.SIZE);
      const y = inZone ? Math.floor(zone / 4) * 200 + Math.floor(Math.random() * 200) : Math.floor(Math.random() * world.SIZE);
      const id = world.idOf(x, y);
      if (!landError(id)) return id;
    }
    return [-13, 'No empty flat was found there. Try another region.'];
  });

  // ---------- names, flag and icon ----------
  const cleanName = (s, max) => { s = String(s || '').trim(); return s && s.length <= max && !/[<>&"]/.test(s) ? s : null; };
  // Build City on a flat you hold (FieldInfoWin): a construct march with 250 Workers and the materials. The window
  // always sends the workers back afterwards (isTroopBack).
  H['city.constructCastle'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now(), workers = game.rules.buildCity?.workers ?? 250;
    const r = game.armies.send(c, p, { missionType: 4, targetPoint: d.fieldId, troops: { peasants: workers }, resource: {}, heroId: -1, backAfterConstruct: d.isTroopBack !== false }, now);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    game.pushTroops(c); game.pushResources(c); game.pushArmies(p);
    game.log.info(`${p.name} sent ${workers} workers to build a city at ${game.armies.placeName(r.army.target)}, arriving in ${Math.round((r.army.reachTime - now) / 1000)}s`);
  };
  H['city.modifyCastleName'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const name = cleanName(d.name, 20); if (!name) return game.fail(conn, cmd, -1, 'City names must be 1 to 20 characters.');
    c.name = name; game.store.touch();
    game.reply(conn, cmd, {}); game.pushCastle(c, 2);
  };
  H['city.modifyCastleIcon'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    c.icon = Math.max(0, Math.floor(Number(d.icon) || 0)); game.store.touch();
    game.reply(conn, cmd, {}); game.pushCastle(c, 2);
  };
  // National Flag: change the text on the flag.
  H['city.modifyFlag'] = (conn, d, cmd) => {
    const p = conn.player, flag = cleanName(d.newFlag, 3);
    if (!flag) return game.fail(conn, cmd, -1, 'A flag holds 1 to 3 characters.');
    if (!items.take(p, 'consume.changeflag.1')) return game.fail(conn, cmd, -44, "You need a National Flag to change your flag.");
    p.flag = flag; game.store.touch();
    game.reply(conn, cmd, {}); game.pushItems(p, ['consume.changeflag.1']); game.pushPlayerInfo(p);
  };
  // New ID: change the lord's name.
  H['city.modifyUserName'] = (conn, d, cmd) => {
    const p = conn.player, name = cleanName(d.userName, 20), itemId = d.itemId || 'player.name.1.a';
    if (!name) return game.fail(conn, cmd, -1, 'Lord names must be 1 to 20 characters.');
    if (Object.values(game.db.players).some(o => o !== p && o.name.toLowerCase() === name.toLowerCase())) return game.fail(conn, cmd, -1, 'Another lord already has that name.');
    if (!items.take(p, itemId)) return game.fail(conn, cmd, -44, 'You need a New ID to change your name.');
    const old = p.name; p.name = name; game.store.touch();
    game.reply(conn, cmd, {}); game.pushItems(p, [itemId]); game.pushPlayerInfo(p);
    game.log.info(`${old} is now called ${name}`);
  };
  // Truce Agreement: 12 hours in which you neither attack other lords nor can be attacked.
  // ---------- the Warehouse window ----------
  const RES = ['food', 'wood', 'stone', 'iron'];
  H['city.getStoreList'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, L = game.logic, total = L.protectedAmount(c, p), pct = L.storePercents(c);
    game.reply(conn, cmd, { totalCap: total, storeBeans: RES.map((k, i) => {
      const keep = L.protectedOf(c, p, k), have = Math.floor(c.res[k] || 0);
      return { storeTypeId: i + 1, storePercent: pct[k], resLimt: Math.floor(L.capacity(c, p, k)), warehourseCapacity: total, magnitude: have, storage: Math.min(have, keep), unstorage: Math.max(0, have - keep) };
    }) });
  };
  H['city.modifyStorePercent'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const v = { food: d.foodrate, wood: d.woodrate, stone: d.stonerate, iron: d.ironrate };
    for (const k of RES){ const n = Math.round(Number(v[k])); if (!(n >= 0 && n <= 100)) return game.fail(conn, cmd, -1, 'Each Store Percent must be between 0 and 100.'); v[k] = n; }
    if (RES.reduce((a, k) => a + v[k], 0) > 100) return game.fail(conn, cmd, -1, 'The Store Percents add up to more than 100%.');
    c.storePct = v; game.store.touch();
    game.reply(conn, cmd, {});
  };

  // ---------- Abandon City (the Town Hall) ----------
  // "To abandon a city means completely giving up the city, including the in-town heroes, troops, constructions and
  // resources." Fox: the spot becomes a barbarian city. Needs the password, another city, and its armies home;
  // the Security Code can guard it (account.js, bit 2).
  H['city.giveupCastle'] = (conn, d, cmd) => {
    const p = conn.player, c = game.castleFor(conn, Number(d.castleId));
    if (!c) return game.fail(conn, cmd, -51, 'That city is not yours.');
    const locked = game.account.guard(conn, 2); if (locked) return game.fail(conn, cmd, locked[0], locked[1]);
    if (!game.account.passwordOk(p, d.password)) return game.fail(conn, cmd, -50, 'Wrong password.');
    if (game.castlesOf(p).length < 2) return game.fail(conn, cmd, -19, "You can't abandon your only city.");
    const A = game.armies, out = A.fromCastle(c).length, coming = Object.values(A.list()).filter(a => a.playerId === p.id && a.target === c.fieldId && a.castleId !== c.id).length;
    if (out) return game.fail(conn, cmd, -19, `${out} of this city's armies ${out === 1 ? 'is' : 'are'} still out. Bring them home first.`);
    if (coming) return game.fail(conn, cmd, -19, 'Some of your armies are on their way to this city. Let them arrive or call them back first.');
    const r = game.abandonCastle(p, c, game.now());
    game.reply(conn, cmd, {});
    game.push(p.id, 'server.CastleUpdate', { updateType: 1, castleBean: { id: c.id, name: c.name, fieldId: c.fieldId } });
    game.pushPlayerInfo(p);
    game.log.info(`${p.name} abandoned ${c.name}; it is now a level ${r.level} barbarian city`);
  };

  H['city.setStopWarState'] = (conn, d, cmd) => {
    const p = conn.player, itemId = d.ItemId || d.itemId || 'player.peace.1', now = game.now();
    const acct = Object.values(game.db.accounts).find(a => a.playerId === p.id);
    if (acct && d.passWord && String(d.passWord).toLowerCase() !== acct.pwd) return game.fail(conn, cmd, -1, 'Wrong password.');
    if (itemId !== 'player.peace.1') return game.fail(conn, cmd, -40, "That item doesn't start a truce.");
    const had = game.activeBuffs(p, now);
    if (!items.take(p, itemId)) return game.fail(conn, cmd, -44, 'You need a Truce Agreement.');
    items.startBuff(p, 'PlayerPeaceBuff', 12 * HOUR, now);
    game.store.touch();
    game.reply(conn, cmd, {}); game.pushItems(p, [itemId]); game.pushBuffs(p, had);
  };
};
