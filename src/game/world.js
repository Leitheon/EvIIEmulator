'use strict';
// The 800x800 world. Tile id = y * 800 + x (from the client's Coordinate class).
// Terrain is derived from the world seed; only tiles that change (cities, occupied valleys) are stored.
const SIZE = 800;
const T = { FOREST: 1, DESERT: 2, HILL: 3, SWAMP: 4, GRASSLAND: 5, LAKE: 6, FLAT: 10, CASTLE: 11, NPC: 12 };

function hash(seed, n){
  let h = (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const xy = id => ({ x: id % SIZE, y: Math.floor(id / SIZE) });
const idOf = (x, y) => ((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE);
const zoneOf = id => { const { x, y } = xy(id); return Math.floor(y / 200) * 4 + Math.floor(x / 200); };

function terrain(seed, id){
  const r = hash(seed, id);
  let type;
  if (r < 0.45) type = T.FLAT;
  else if (r < 0.55) type = T.FOREST;
  else if (r < 0.63) type = T.DESERT;
  else if (r < 0.72) type = T.HILL;
  else if (r < 0.79) type = T.SWAMP;
  else if (r < 0.88) type = T.GRASSLAND;
  else if (r < 0.98) type = T.LAKE;
  else type = T.NPC;
  const level = 1 + Math.floor(hash(seed ^ 0x5bd1e995, id) * 10);
  return { type, level };
}

// Valley levels cycle (the wiki's Valley page): every day at the daily reset each valley and flat goes up a level,
// from 10 back to 1. A valley someone holds keeps the level it was taken at (it's stored in db.tiles) and joins the
// cycle again when it's given up. Set at startup from the rules.
let cycle = { enabled: false, resetHourUTC: 0 };
function setValleyCycle(o){ cycle = { ...cycle, ...o }; }
const DAY = 86400000;
function cycleDay(now = Date.now()){ return Math.floor((now - (cycle.resetHourUTC || 0) * 3600000) / DAY); }
function cycledLevel(base, now){ return cycle.enabled ? ((base - 1 + cycleDay(now)) % 10 + 10) % 10 + 1 : base; }

// Historic Cities (see historic.js), set once at startup: fieldId -> { name, level, powerLevel, ... }
let historic = new Map();
function setHistoric(map){ historic = map; }
function historicAt(id){ return historic.get(id) || null; }

// What the map itself has at id at a time, ignoring cities and anything saved there (an abandoned city's spot).
function naturalTile(seed, id, now = Date.now()){
  const t = terrain(seed, id);
  return { id, type: t.type, level: t.type === T.NPC ? t.level : cycledLevel(t.level, now) };
}
function tileAt(store, id, now = Date.now()){
  const saved = store.db.tiles[id];
  if (saved) return { id, ...saved };
  const h = historic.get(id);
  if (h) return { id, type: T.NPC, level: 10, historic: h };
  const t = terrain(store.db.seed, id);
  return { id, type: t.type, level: t.type === T.NPC ? t.level : cycledLevel(t.level, now) };
}

// A free flat tile for a new city, spiralling out from a random point.
function findHome(store){
  const cx = 100 + Math.floor(Math.random() * 600), cy = 100 + Math.floor(Math.random() * 600);
  for (let r = 0; r < 200; r++){
    for (let dx = -r; dx <= r; dx++) for (const dy of [-r, r]){
      for (const [x, y] of [[cx + dx, cy + dy], [cx + dy, cy + dx]]){
        const id = idOf(x, y), t = tileAt(store, id);
        if (t.type === T.FLAT && !store.db.tiles[id]) return id;
      }
    }
  }
  throw new Error('No free tile found for a new city');
}

// Two hex digits per tile for the map view: terrain type, then level (WorldMap.parserString / Tile.setFirstMap).
function tileCode(t){ return t.type.toString(16) + Math.max(0, Math.min(15, t.level || 0)).toString(16); }

module.exports = { SIZE, T, xy, idOf, zoneOf, terrain, naturalTile, tileAt, findHome, tileCode, setHistoric, historicAt, setValleyCycle, cycleDay };
