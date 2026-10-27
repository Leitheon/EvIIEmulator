'use strict';
// Evony's own data tables, read from the client SWF you supply (client/EvonyClient1921.swf).
// Nothing from the game ships with this server; it all comes from your copy of the client.
const fs = require('fs');
const { readSwf } = require('./swf');
const xml = require('./xml');

const num = v => (v === undefined || v === '' ? 0 : Number(v));
// Server-side field names for troops (TroopBean) keyed by the typeId in the troop table.
const TROOP_FIELD = { 2: 'peasants', 3: 'militia', 4: 'scouter', 5: 'pikemen', 6: 'swordsmen', 7: 'archer', 8: 'carriage', 9: 'lightCavalry', 10: 'heavyCavalry', 11: 'ballista', 12: 'batteringRam', 13: 'catapult' };
// FortificationsBean fields keyed by typeId in the fortification table.
const FORT_FIELD = { 14: 'trap', 15: 'abatis', 16: 'arrowTower', 17: 'rollingLogs', 18: 'rockfall' };

function load(swfPath){
  if (!fs.existsSync(swfPath)) throw new Error(`Client file not found at ${swfPath}. Copy EvonyClient1921.swf into the client folder.`);
  const swf = readSwf(fs.readFileSync(swfPath));
  const doc = cls => {
    const b = swf.binaryByClass(cls);
    if (!b) throw new Error(`The client file has no ${cls}. Is it EvonyClient1921.swf?`);
    return xml.parse(b.toString('utf8'));
  };

  const buildings = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLBuilding'), 'buildingEum')){
    const id = num(el.attrs.typeId);
    const levels = xml.kids(xml.child(el, 'levelDatas'), 'levelData').map(l => ({
      level: num(l.attrs.level) + 1, food: num(l.attrs.food), wood: num(l.attrs.wood), stone: num(l.attrs.stone), iron: num(l.attrs.iron),
      time: num(l.attrs.time), workPeople: num(l.attrs.workPeople), limit: num(l.attrs.limit), produce: num(l.attrs.produce), buildPeople: num(l.attrs.buildPeple),
    }));
    buildings[id] = { id, name: el.attrs.name, levels };
  }
  // The client's table stops the Rally Spot at 10, but Historic and amulet cities come with one at 11-18. The live
  // server's level 14 (Fox's capture: 819,200 food, 4,915,200 lumber, 16,384,000 stone, 1,228,800 iron, 1,228,800 s)
  // is level 10 doubled four times, so each level past 10 doubles the one before; armies and troops go up by level.
  const rally = buildings[29];
  while (rally && rally.levels.length && rally.levels.length < 18){
    const l = rally.levels[rally.levels.length - 1], L = l.level + 1;
    rally.levels.push({ ...l, level: L, food: l.food * 2, wood: l.wood * 2, stone: l.stone * 2, iron: l.iron * 2, time: l.time * 2,
      limit: l.limit ? L : 0, workPeople: l.workPeople ? l.workPeople / l.level * L : 0 });
  }

  const techs = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLTech'), 'techEum')){
    const id = num(el.attrs.typeId);
    const levels = xml.kids(xml.child(el, 'levelDatas'), 'levelData').map(l => ({
      level: num(l.attrs.level) + 1, effect: num(l.attrs.effect), food: num(l.attrs.food), wood: num(l.attrs.wood), stone: num(l.attrs.stone), iron: num(l.attrs.iron), gold: num(l.attrs.gold), time: num(l.attrs.time),
    }));
    techs[id] = { id, name: el.attrs.name.trim(), levels };
  }

  const troops = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLTroop'), 'troopEum')){
    const a = el.attrs, id = num(a.typeId);
    troops[id] = { id, name: a.name, field: TROOP_FIELD[id], life: num(a.life), attack: num(a.attack), defence: num(a.defence), range: num(a.range), speed: num(a.speed), load: num(a.load),
      food: num(a.food), wood: num(a.wood), stone: num(a.stone), iron: num(a.iron), upkeep: num(a.foodRequest), time: num(a.time), population: num(a.population) };
  }

  const forts = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLFort'), 'fortificationEum')){
    const a = el.attrs, id = num(a.typeId);
    forts[id] = { id, name: a.name, field: FORT_FIELD[id], life: num(a.life), attack: num(a.attack), defence: num(a.defence), range: num(a.range), space: num(a.space),
      food: num(a.food), wood: num(a.wood), stone: num(a.stone), iron: num(a.iron), time: num(a.time), exp: num(a.exp) };
  }

  // Items with their coin prices. itemType is the client's category key (Chinese), used by the shop.
  const items = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLItem'), 'itemEum')){
    const a = el.attrs;
    items[a.id] = { id: a.id, name: a.name, type: a.itemType, price: num(a.price), desc: a.desc || '', itemDesc: a.itemDesc || '', icon: a.iconUrl || '' };
  }

  // Gear (equipment) technologies researched in the Workshop: per level, the buildings needed and the
  // materials used up ("upgradeitem" is The Lost Armor Script, needed from level 3).
  const equipTechs = {};
  for (const el of xml.kids(doc('com.evony.eum.GetDataXML_XMLEquipTech'), 'equipmenttech')){
    const type = num(el.attrs.type);
    const levels = xml.kids(el, 'equipmentdefine').filter(d => num(d.attrs.lv) > 0).map(d => ({
      level: num(d.attrs.lv), desc: d.attrs.des || '',
      builds: xml.kids(xml.child(d, 'buildlist'), 'build').map(b => ({ typeId: num(b.attrs.type), level: num(b.attrs.lv) })),
      items: [...xml.kids(xml.child(d, 'itemlist'), 'item'), ...xml.kids(xml.child(d, 'upgradeitem'), 'item')].map(i => ({ id: i.attrs.type, count: num(i.attrs.count) })),
    })).sort((a, b) => a.level - b.level);
    equipTechs[type] = { type, key: el.attrs.equipmenttechid, name: el.attrs.name, levels };
  }

  // Quest names and rewards. The client's sharing texts (FbData) cover every routine quest by its id:
  // "...completed the quest Cottage Building and earned Food*200, Wood*1000, ... Beginner Guildlines*1".
  const questTexts = {};
  try {
    const fb = xml.parse(swf.binaryByClass('com.evony.data.FbData_xmlClass').toString('utf8'));
    for (const el of xml.kids(fb, 'fbEum')) if (el.attrs.type === 'quest') questTexts[num(el.attrs.id)] = el.attrs.desc || '';
  } catch (e){ /* an older client without FbData: quests fall back to built-in names */ }

  // Generic portraits for lords and ordinary heroes (the client's own hero picker uses these). The numbered
  // images/icon/hero/N.png portraits belong to historic heroes (the client's hero.taskitem.N items).
  const logoEum = xml.child(doc('com.evony.eum.GetDataXML_XMLPlayerLogo'), 'playerLogoEum');
  const urls = tag => xml.kids(xml.child(logoEum, tag), 'logo').map(l => l.attrs.url).filter(Boolean);
  const portraits = { male: urls('maleLogos'), female: urls('femaileLogos') };   // (sic: the client spells it femaile)

  // Historic City names in the client's own order. Kept exactly as written (one has a leading space,
  // Atlantis has a byte-order mark) because the client looks up each city's description by exact name.
  const historicNames = xml.kids(doc('com.evony.Lang2_xmlClass'), 'value').map(v => v.attrs.key);

  return { buildings, techs, troops, forts, items, equipTechs, questTexts, historicNames, portraits, swfVersion: swf.version };
}

module.exports = { load, TROOP_FIELD, FORT_FIELD };
