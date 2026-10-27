'use strict';
// Historic City policies (the map's Policies button; the client's PoliciesView and its own texts). A lord who holds
// a Historic City can use it on another lord's city or an NPC city within its draft area:
//   Tax Imposition          "draw 30% of its gold reserve"
//   Population Redeployment "Draw 50% of idle population of target city to currently visiting city"
//   Food Levy               "draw 20% of its food stock"
//   Draft                   "Despatch 5% of one specific branch of troops to currently visiting city"
//   Disarmament             "Disarm 10% of one specific branch of troops"
// Draft and Disarmament can't be used on a Historic City that nobody holds (the client offers only the first
// three there). The client lets nobody pick the branch: the server takes the one the target has most of
// (UNVERIFIED). Draft area and uses a day: rules.policies (Evony Advanced Guide). Uses come back at the daily reset.
const world = require('./world');
const { REPORT_TYPE } = require('./reports');

const KIND = {
  tax: { name: 'Tax Imposition', share: 0.3 },
  population: { name: 'Population Redeployment', share: 0.5 },
  food: { name: 'Food Levy', share: 0.2 },
  draft: { name: 'Draft', share: 0.05, troops: true },
  disarm: { name: 'Disarmament', share: 0.1, troops: true },
};
// A captured Historic City's level from its power level (FieldConstants: 3 Village ... 0 City).
const LEVEL_OF_POWER = { 3: 12, 2: 14, 1: 16, 0: 18 };

class Policies {
  constructor(game){ this.g = game; }
  get rules(){ return this.g.rules.policies || {}; }
  level(c){ return LEVEL_OF_POWER[c.powerLevel ?? 4] || 0; }
  today(now){ return this.g.npc.day(now); }
  used(c, now){ const s = c.policies; return s && s.day === this.today(now) ? s.used : 0; }
  perDay(c){ return this.rules.perDay?.[this.level(c)] ?? 0; }
  left(c, now){ return Math.max(0, this.perDay(c) - this.used(c, now)); }
  share(kind){ return this.rules.share?.[kind] ?? KIND[kind].share; }
  // Miles in any direction (the map wraps around).
  inRange(c, fieldId){
    const L = this.level(c), r = this.rules.range?.[L]; if (r == null) return false;
    const a = world.xy(c.fieldId), b = world.xy(fieldId), wrap = d => Math.min(d, world.SIZE - d);
    return Math.max(wrap(Math.abs(a.x - b.x)), wrap(Math.abs(a.y - b.y))) <= r;
  }
  // Idle population: people not needed in the fields (the Town Hall's Available Labor less Required Labor).
  idle(c){
    const f = this.g.logic.fieldsOf(c), rate = this.g.logic.commence(c);
    const demand = Object.keys(f).reduce((a, k) => a + f[k].labour * rate[k] / 100, 0);
    return Math.max(0, (c.pop || 0) - demand);
  }
  biggest(troops){
    let best = null;
    for (const [k, n] of Object.entries(troops || {})) if (n > 0 && (!best || n > troops[best])) best = k;
    return best;
  }
  troopName(field){ return Object.values(this.g.data.troops).find(t => t.field === field)?.name || field; }

  use(c, p, kind, targetFieldId, now = this.g.now()){
    const g = this.g, k = KIND[kind], target = Number(targetFieldId);
    if (!this.level(c)) return [-1, 'Policies can only be issued from a Historic City you hold.'];
    if (!(target >= 0 && target < world.SIZE * world.SIZE)) return [-1, 'That map location does not exist.'];
    if (!this.left(c, now)) return [-1, `Your Historic City has used all its ${this.perDay(c)} policies today. They come back after the daily maintenance.`];
    if (!this.inRange(c, target)) return [-1, `That city is outside your draft area (${this.rules.range?.[this.level(c)]} miles in any direction).`];
    const tile = world.tileAt(g.store, target, now);
    let dc = null, dp = null, st = null;
    if (tile.type === world.T.CASTLE){
      dc = g.db.castles[tile.castleId]; dp = dc && g.db.players[dc.playerId];
      if (!dc || !dp) return [-1, 'There is no city there.'];
      if (dp.id === p.id) return [-1, 'Policies are for other lords\' cities.'];
      g.logic.settle(dc, dp, now);
    } else if (tile.type === world.T.NPC){
      if (tile.historic && k.troops) return [-1, `${k.name} can't be used on a Historic City.`];
      st = g.npc.state(g.db, tile, now);
    } else return [-1, 'Policies can only be used on a city.'];
    g.logic.settle(c, p, now);
    const share = this.share(kind), stores = dc ? dc.res : st.res || {}, troops = dc ? dc.troops : st.troops || {};
    let amount = 0, armyType = '';
    if (kind === 'tax' || kind === 'food'){
      const res = kind === 'tax' ? 'gold' : 'food';
      amount = Math.floor((stores[res] || 0) * share);
      stores[res] = (stores[res] || 0) - amount; c.res[res] = (c.res[res] || 0) + amount;
    } else if (kind === 'population'){
      amount = Math.floor((dc ? this.idle(dc) : g.npc.survey(tile).population) * share);
      if (dc) dc.pop -= amount;
      c.pop = (c.pop || 0) + amount;
    } else {
      const field = this.biggest(troops);
      if (!field) return [-1, 'That city has no troops.'];
      amount = Math.floor(troops[field] * share); armyType = this.troopName(field);
      troops[field] -= amount;
      if (kind === 'draft') c.troops[field] = (c.troops[field] || 0) + amount;
    }
    c.policies = { day: this.today(now), used: this.used(c, now) + 1 };
    if (st) g.npc.save(g.db, tile, st, now);
    const here = g.armies.placeName(target), what = this.what(kind, amount, armyType);
    if (dc){
      g.pushResources(dc); g.pushTroops(dc);
      g.reports.add(dp, { type: REPORT_TYPE.OTHER, startPos: g.armies.placeName(c.fieldId), targetPos: here, title: `${p.name} used ${k.name} on ${dc.name}`,
        content: `<reportData><policyReport detail="${esc(`${p.name} issued ${k.name} from ${c.name} on your city ${dc.name}: ${what.lost}.`)}"/></reportData>` });
    }
    g.reports.add(p, { type: REPORT_TYPE.OTHER, startPos: g.armies.placeName(c.fieldId), targetPos: here, title: `${k.name} on ${here}`,
      content: `<reportData><policyReport detail="${esc(`${k.name} from ${c.name} on ${here}: ${what.got}.`)}"/></reportData>` });
    g.store.touch(); g.pushResources(c); g.pushTroops(c);
    g.log.info(`${p.name} used ${k.name} from ${c.name} on ${here}: ${what.got}`);
    return { amount, armyType, castleId: c.id, targetFieldId: target };
  }
  what(kind, n, type){
    const N = n.toLocaleString('en-US');
    return {
      tax: { got: `acquired ${N} gold`, lost: `${N} gold taken` },
      population: { got: `${N} people moved here`, lost: `${N} people taken` },
      food: { got: `acquired ${N} food`, lost: `${N} food taken` },
      draft: { got: `${N} ${type} joined the army`, lost: `${N} ${type} taken` },
      disarm: { got: `${N} ${type} disbanded`, lost: `${N} ${type} disbanded` },
    }[kind];
  }
}
const esc = s => String(s).replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]));

module.exports = { Policies, POLICY_KIND: KIND, LEVEL_OF_POWER };
