'use strict';
// The Quests window: Routine Quests (quests.js, with ranks and titles) and Hero Quests (historicHeroes.js).
// The client counts the finished quests in both lists for the flashing Quests button, but it only redraws a
// list that has something in it, so Hero Quests always has at least a guide entry.
const HERO_GUIDE = 1999999;

const { QUEST_BASE } = require('../historicHeroes');

module.exports = (game, H) => {
  const q = game.quests, hh = game.hh;
  const heroGuideType = () => ({ typeId: HERO_GUIDE, mainId: 4, name: 'Historic Heroes', description: 'How to recruit a historic hero', isFinish: false, recommend: false, version: 0 });
  const heroGuideQuest = () => ({ questId: HERO_GUIDE, name: 'Recruit a historic hero', isFinish: false, isCard: false, islast: false, recommend: false, version: 0, award: 'A historic hero at your Inn',
    description: 'Historic heroes wait in NPC cities around the world. Find one at the Inn, accept the hero\'s quest there, and it will show here.',
    manual: 'At the Inn: Hearsay lists rumours, Hero Search finds a hero by name, and Enquire Details (10 cents) gives the exact place and the hero\'s portrait. Then accept the quest and conquer that NPC city: win attacks until its loyalty reaches 0.',
    targets: [{ name: 'Accept a historic hero\'s quest at the Inn', finished: false }] });

  H['quest.getQuestType'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, type = Number(d.type);
    if (type === 4){ const t = hh.questTypes(p); return game.reply(conn, cmd, { types: t.length ? t : [heroGuideType()] }); }
    game.reply(conn, cmd, { types: type === 1 ? q.typeBeans(p, c, game.now()) : [] });
  };
  H['quest.getQuestList'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, typeId = Number(d.typeId);
    if (typeId === HERO_GUIDE) return game.reply(conn, cmd, { quests: [heroGuideQuest()] });
    if (typeId === QUEST_BASE) return game.reply(conn, cmd, { quests: hh.questBeans(p, game.now()) });
    const id = hh.questOf(p, typeId);
    if (id != null) return game.reply(conn, cmd, { quests: [hh.questBean(p, id, game.now())] });
    game.reply(conn, cmd, { quests: q.listBeans(p, c, typeId, game.now()) || [] });
  };
  H['quest.award'] = (conn, d, cmd) => {
    const c = game.castleOr(conn, cmd, d.castleId); if (!c) return;
    const p = conn.player, now = game.now();
    // A historic hero's quest is done once the hero is captured (live: the target ticks when the city falls);
    // claiming it pays the live award and clears it.
    const hid = hh.questOf(p, d.questId);
    if (hid != null){
      if (!hh.quests(p)[hid].done) return game.fail(conn, cmd, -1, `Conquer the NPC city ${hh.roster.get(hid).name} waits in first.`);
      delete hh.quests(p)[hid];
      const r = hh.award();
      for (const [k, v] of Object.entries(r.res)) c.res[k] = (c.res[k] || 0) + v;
      if (r.pop) c.pop += r.pop;
      for (const [id, n] of Object.entries(r.items)) game.items.add(p, id, n);
      game.store.touch(); game.reply(conn, cmd, {});
      game.pushItems(p, Object.keys(r.items)); game.pushResources(c);
      return;
    }
    if (Number(d.questId) === HERO_GUIDE) return game.fail(conn, cmd, -1, 'Accept a historic hero\'s quest at the Inn first.');
    const r = q.award(p, c, d.questId, now);
    if (!r) return game.fail(conn, cmd, -1, 'There is no such quest.');
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]);
    game.store.touch();
    game.reply(conn, cmd, {});
    if (r.changed.player) game.pushPlayerInfo(p);
    if (r.changed.forts) game.push(p.id, 'server.FortificationsUpdate', { castleId: c.id, fortification: game.beans.forts(c) });
    game.pushResources(c);
    const what = r.def.promo === 'rank' ? ` and is now a ${q.rankName(p)}` : r.def.promo === 'title' ? ` and is now ${['a', 'an'][/^[AEIOU]/.test(game.quests.titleName(p)) ? 1 : 0]} ${game.quests.titleName(p)}` : '';
    game.log.info(`${p.name} completed the quest ${r.def.name}${what}`);
  };
  H['quest.abandon'] = (conn, d, cmd) => {
    const id = d.questid ?? d.questId;
    if (Number(id) === HERO_GUIDE) return game.reply(conn, cmd, {});
    const r = hh.abandon(conn.player, id);
    if (Array.isArray(r)) return game.fail(conn, cmd, r[0], 'Only historic hero quests can be abandoned.');
    game.store.touch(); game.reply(conn, cmd, {});
  };
  H['quest.donate'] = (conn, d, cmd) => game.fail(conn, cmd, -1, 'Historic hero quests can\'t be donated on this server.');
  // The reward items of a quest, for the client's tutorial.
  H['quest.getAwardItems'] = (conn, d, cmd) => {
    const def = q.defs.get(Number(d.questId));
    game.reply(conn, cmd, { itemBeans: def ? Object.entries(def.reward.items).map(([id, count]) => ({ id, name: game.items.name(id), count, minCount: 0, maxCount: 0 })) : [] });
  };
};
