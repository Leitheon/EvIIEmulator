# Evony local server

A server that runs on your own PC and answers the original Evony Flash client
(`EvonyClient1921.swf`, client version `091103_11`). Evony's own client draws everything;
this server plays the part of Evony's game server.

Nothing from the game ships in this folder. Building costs, build times, troop stats and
research data are read at startup from **your** copy of the client, and art is fetched from
Evony's CDN on demand and cached in `cache/`, the same way your browser cache holds it.

## What works (milestone 3.77)

- Log in through the client's own login panel. The first login with a new name creates the
  account and your lord.
- A new lord's city starts as on the live game: called "City Name" (Rename City in the Town Hall),
  a level 1 Town Hall and nothing else, 5,000 food,
  lumber, stone and iron, 18,771 gold, 10% tax, an 80% production rate and 45 people. The tutorial's
  first step (build a Cottage) now makes sense. Existing cities are unchanged.
- **City**: all 20 buildings with Evony's real costs and times; production, storage, population,
  tax rate, labour split, loyalty. Hero salaries come out of gold.
  - **Population** settles at the population limit times (100 - tax rate)%, as on the live game: a
    city with no Cottage has a limit of 50 and at 10% tax holds 45. The limit is 50 plus what
    the Cottages hold (live: 20 level 8 Cottages show 72,050), not just the Cottages. Raising the tax lowers it and the
    population falls (the population tooltip says so); Civil Code and Population Raising can push it
    above that for a while. Existing cities drift to the new level (`populationCapByTax` in the rules).
- **Town Hall**: Comfort (Disaster Relief, Praying, Blessing, Population Raising) and Levy, with
  the costs the client describes and a cooldown.
- **World map**:
  - The 16 states, valleys and NPC cities.
  - **Valley levels cycle daily**: at each daily reset every valley and flat goes up a level, from
    10 back to 1. A valley you hold keeps the level you took it at, and joins the cycle again once
    given up (`valleyCycle` in the rules turns this off).
  - **Historic Cities**: Atlantis (level 18) at 0,0, the 16 state capitals (16), 126 level 14s
    and 1,795 level 12s, with the same names in the same places as the live server. Each shows
    Evony's art, title and built-in description.
  - The tile info window for every tile, with Scout and Attack on NPC and Historic Cities.
- **Heroes**:
  - The Inn offers as many heroes as its level. Hiring costs level x 1,000 gold, and the
    Feasting Hall holds as many heroes as its level.
  - Inn heroes are ordinary heroes: one name and one of the game's generic portraits.
  - Captured heroes (Fox, from the live game). An NPC city's own hero is picked again at every daily
    reset (a historic hero waiting there stays). The hero is captured when you conquer the city, and is
    held in the new city's Feasting Hall, or your home city's when that one is full. The client's
    Persuade button bribes the hero into joining for level x 1,000 gold (the client's own price); Release
    lets the hero go. A captive can't be mayor, lead an army, wear gear or take items, and draws no
    salary. A captive's loyalty is 0, as live; a persuaded hero starts at 70.
- **Conquering NPC cities**, from Fox's live battle reports (34 wins took a level 8 from loyalty 90 to
  0). **Changed in 3.56-3.57** (Fox): every attack you win on an NPC city lowers its loyalty by 1, 2 or 3 (10%,
  40% and 50% of the time), or 2-4 while its loyalty is above 80, however long the battle: about 37 wins for a
  level 8. Loyalty climbs
  back a point every 3 minutes (game time) and is full again after the daily reset. Scout reports show the current loyalty, and battle reports carry the live fields
  ("The Loyalty of this city is 83.").
  - At 0 the city is yours if your title has a free city slot (otherwise the report says so and the loyalty
    stays at 0). It's called "New city" and has the live game's fixed layout, every building at the NPC's
    level (Fox's screenshots of a conquered level 8): Town Hall and Walls; as Fox checked in the game: 0 Academy, 1 Forge, 2 Embassy, 3 Feasting Hall, 4 Marketplace, 5 Beacon Tower, 6 Stable, 7 Inn, 8
    Rally Spot, 9 Relief Station, 10 Workshop, 11 Barracks, and Cottages on 12-31; outside as many plots as
    the Town Hall allows (34 at level 8): Farms from 1001, then the Sawmill, Quarry and Ironmine on the
    last three (`npcConquest.layout`); Fox: every level 1-10 works the same way, only the number of Farms
    changes. It keeps the wall defenses that survived the final battle and what's left of its stores (Fox).
    It comes full, its population limit less the tax rate's share (64,845 of 72,050 at level 8),
    at 10% tax with every production rate at 80, as live. The last army, the one that took it, stays there
    with its hero and loot. Its hero is captured.
  - Historic Cities can be conquered too (Fox). One keeps its name and has Town Hall and Walls 10
    with nothing else inside, a Farm, Sawmill, Quarry and Ironmine on plots 1001-1004 at its own level
    (12-18), 5,000 of each resource and 50 people. Its King or Queen isn't captured. On the map it keeps its
    Historic City art and title, and its Rally Spot sends 1.25 (level 12), 1.5 (14), 2 (16) or 3 (18) times
    the troops, as the client's march window counts.
- **Historic heroes**: all 639 from the client, with their own names, portraits and
  biographies, each waiting in an NPC city somewhere on the map.
  - At the Inn: Hearsay lists rumours about 10 of them, More Hearsay (100 gold) changes the
    list, Hero Search (1,000 gold) finds one by name, and Enquire Details (10 cents) gives the
    exact location, the hero's portrait and a report.
  - Accept the hero's quest at the Inn. As live, it shows under Quests, Hero Quests, Heros,
    under the hero's name ("Catch Hero quest  Caesar quest"). It's done when you capture the hero, and
    Complete Quest pays the live award: an Aries Amulet, Beginner Guidelines, 30 population, 200 food,
    1,000 lumber, 200 stone and 100 iron.
  - The hero leads the NPC city's defence with his own attack and intelligence. As live, there's no
    hero loyalty: conquer the city (above), and if you hold the hero's quest and
    portrait, the hero is captured into your Feasting Hall, and Persuade (30,000 gold and the
    portrait) makes the hero yours. Without them the hero gets away to another NPC city. Release
    sends a captured historic hero to another NPC city too.
  - Wild historic heroes are level 30: the sheet's stats are their level 1 base, and the 60
    points their levels give (**changed in 3.61**: 2 a level, it was 1) are spread at random. Use Holy Water
    (3 for a level 30 hero) to reset and place them yourself.
  - **New in 3.61**, from Fox's capture of the live Hero ranking (its top 610: 594 historic heroes at 150 and 16
    Ring heroes at 120): historic heroes go up to **level 150** with **2 points a level**. 333 of the sheet's heroes
    hold exactly 300 points over their sheet stats there (164 more hold 719: 300 and a full set of gear).
  - **Sheet corrections (3.61):** 28 heroes whose live stats at 150 are *below* the sheet, which points and gear
    can't do, take the live value there (Caesar's politics 95 to 94, Constantine XI 80/25/85 to 79/25/60 and so on),
    and Peter the Hermit's unknown attack is filled in (65). The Hero ranking shows Ring heroes too.
  - Historic heroes keep their names, show their biography, and have their own leadership, which goes up 1 a
    level after the first (Fox; **fixed in 3.54**, it stayed at the base).
  - A dismissed historic hero goes back to an NPC city somewhere else.
  - Base stats come from Fox's sheet (`src/data/historic-heroes.csv`, 637 heroes), corrected from
    Evony Advanced Guide's Historic Hero List: the sheet had attack and intelligence swapped (Isaac
    Newton 98 attack, Genghis Khan 97 intelligence), 24 heroes had a value copied into both, and the
    list fills 38 of the 45 "?" values. Seven heroes still lack a value (mostly leadership), which the
    server estimates. Historic heroes you already hired take the corrected stats; the points you
    spent stay. A sheet saved as `data/historic-heroes.csv` (same columns) replaces it.
  - **Leadership** follows Evony Advanced Guide's formula: a hero leads (leadership x 10 + level) x
    leadership troops in full, 110,000 for a level 100 hero with leadership 100 (an ordinary hero's
    leadership is his level). In an attack, troops beyond that get none of his attack and intelligence
    bonus; defending, they get a quarter of it. NPC and Historic City rulers lead their whole garrison.
  - You can make a hero mayor, spend points, level up, reward, rename, dismiss, and refresh the
    Inn with Hero Hunting.
  - The mayor's politics raises production and building speed, and their intelligence speeds
    research. Their attack speeds troop training, 13% off for every 100 points (the guide's
    troop pages: swordsmen take 1:19 with Military Science 10, 1:09 with a 100-attack mayor, 0:20 with
    1,000).
- **Armies**:
  - Attack, scout, transport and reinforce from the Rally Spot. Level N sends N armies of up to
    N x 10,000 troops (15,000 more per level above 10). A War Ensign adds 25%.
  - Travel time and food use the same formula the client shows (cavalry take 40 seconds a tile at
    speed 1), and marches between your own cities get the Relief Station's speed-up.
  - Recall works, and armies arrive and return even while you're logged out.
  - **Fixed in 3.54:** a hero reinforcing one of your cities moves into its Feasting Hall (and rides home only if
    it has no free seat), and waves that reach a city or valley an earlier wave already took land without a
    fight and are recalled home, instead of attacking your own city.
- **Battles**: against NPC cities, Historic Cities, valleys and other lords' cities (an ordinary city in wartime only; see war, below).
  - Fought round by round on a battlefield, the way Age II did it: the field is as wide as the
    longest base range taking part plus 200 (5,200 when a city has traps), the fastest troops act
    first, each troop type attacks one enemy type per round, and defenders march out to meet you.
    Archers, ballistae, catapults and archer's towers shoot enemy ranged units in range before anything
    else (the Age I combat guide), and melee troops go for the fastest enemy in reach.
  - Damage follows the formula players worked out for Age I: attack x bonus x (1 - defense/1000)
    / life, with Age I's attack bonuses (pikemen x1.8 against horsemen, archers x2 against
    cavalry, and so on), and ranged units at half damage.
  - **Star set life bonus** (Evony Advanced Guide): when every one of your 14 gear technologies has at
    least 5 stars, your troops get +50% life attacking NPC and Historic Cities; 9 stars +100%, 12 stars
    +150%, and (the guide's guesses) 14 stars +200%, 15 stars +250%. It is added to Medicine's bonus.
    It goes by your lord's stars, not by what the leading hero wears. In Fox's live test (a
    level 30 hero with and without gear at an NPC 5), both attacks lost too few troops for anything less.
  - **Walls give defenders range** (Fox, from the live game): 4.5% per Walls level for archers,
    ballistae, catapults and archer's towers, added to Archery's. Behind level 10 Walls with Archery 10,
    archers reach 2,340 and towers 2,535. NPC cities have Walls of their own level, Historic Cities 10.
  - **Re-tuned battle numbers** (again). The first five dxcalc test battles were fought with 15-star
    sets, and dxcalc counts the star bonus, so the m3.28 tuning had it built in for everyone. With the
    bonus and the Walls counted, the numbers now match all seven of Fox's dxcalc battles (including the
    two new ones with no stars, within 8%). dxcalc's own value for 15 stars comes out at +220% to +250%,
    in line with the guide's guess. They also match the guide's live table of NPC 6-9 losses by star
    level (mostly within 15%) and its free ballista farming of NPC 1-5. On Fox's two live NPC 5 battles
    the server loses about 20% more archers than the live game did. Without stars, NPC attacks cost more
    than in m3.28; battles between lords are quicker and bloodier. The old numbers are in the rules
    (`battle`).
  - Uses each troop's real attack, defense, life, range and speed, plus research (including
    Compass and Horseback Riding for battlefield speed) and the hero's attack and intelligence.
  - Traps fire 8% of their number each round; abatis stop horsemen; rolling logs and defensive
    trebuchets fire once; archer's towers shoot every round.
  - NPC cities and Historic Cities fight with their own research, Walls and hero, as the dxcalc
    battle calculator sets them up. Level 16 and 18 Historic Cities always hold Cataphracts and
    Catapults (the guide); only their swordsmen and pikemen change at the daily reset. From
    Fox's live scout reports: when a level 12 or 14 holds Ballistae it has as many as its cavalry
    (108,444 or 271,111); level 14s have 171,228 archers; NPC 6 has 2,250 abatis; and level 12 and 14
    Historic Cities hold the same stores as an NPC 10. They rebuild
    some defenses right after a battle and are back
    to full strength within an hour.
  - Heroes gain battle experience per enemy killed, worked out from dxcalc's reports.
  - Plunder respects Warehouse protection.
  - A won valley is yours (up to your Town Hall level) and adds its production bonus.
- **Building a new city**: conquer a flat (attack it; it holds troops like a valley), open its tile window and
  click Build City. It takes a free city slot from your title (a Civilian rules 1 city, a Knight 2 ...
  a Prinzessin 10), and 250 Workers and 10,000 of each resource from the city you send them from.
  The workers march to the flat with the materials and the city goes up when they arrive. As on the
  live game, the new city is called "new" and has a level 1 Town Hall and nothing else, the 250 Workers, 5,000 food,
  lumber, stone and iron, 68,550 gold, 10% tax and an 80% production rate; the materials are used up.
  Other troops on a Build City march come home, or stay if the march window says so. City tokens
  still work as before.
- **Production** adds up the way the Town Hall's Production tab shows it (it now fills in every row):
  research, hero, valley and item bonuses apply to the fields' output, scaled by the production rate
  and staffing, and the flat 100 an hour ("Providence") is added on top, untouched. The live game shows
  Providence 100 and Technology Plus 0 in a new city with no fields. Bonuses used to multiply the 100
  too, so a city with Agriculture, say, makes a little less than before.
- **Mail** (the Mail window): write to any lord by name (any capitals), with the client's limits (title
  200 characters, message 500). Inbox, System and Sent boxes, unread counts on the Mail button, reading,
  marking read and deleting; each lord keeps his own copy, so deleting yours leaves the other's. Bug and
  player reports from the client go to `data/player-reports.log` for whoever runs the server. Sending a mail
  ticks the Correspondence quest.
- **the Marketplace**, from the client's own texts: one order book for the server per resource (food,
  lumber, stone, iron). Post a bid or an offer at up to 150 gold a unit; every post costs 0.5% of its total
  as a trading fee. A bid holds its gold and an offer its goods. A new order trades at once with the best
  waiting orders at their price; the rest waits in Pending Orders (a level L Marketplace holds L). Sellers
  are paid at once; what you buy reaches your city after 30 minutes (Trading Status), or at once with a
  Merchant Fleet. Cancelling returns what wasn't traded. Both sides get a trade report. Prices come only
  from players: there are no NPC traders, so on a one-lord server nothing trades.
- **wounded troops** (the Rally Spot's Hospital), from Fox's live NPC 8 battle reports: a tenth of the
  troops an army loses in battle (rounded down, per kind) come back wounded and rest in the city they belong
  to; defending lords' cities get theirs too. Curing costs gold a troop: Scout 69, Archer 140, Cavalry 285,
  Cataphract 875 (exact in all 31 reports); you can also disband them. With Auto Heal on, every wounded troop
  in the city is cured right after the battle if the city has the gold, and the battle report says so
  ("All of your wounded troops in ... were automatically healed.", and the gold). Battle reports show the
  Wounded Proportion (10%). Left alone, the wounded "gradually die". Curing ticks the Military Operation quest.
- **Historic City policies** (the map's Policies button), from a Historic City you hold, on another
  lord's city or an NPC city in its draft area, with the client's own amounts: Tax Imposition takes 30% of
  the target's gold, Food Levy 20% of its food, Population Redeployment 50% of its idle people, Draft 5% of
  its biggest troop branch (they join your Historic City's army), Disarmament disbands 10% of it. A Historic
  City nobody holds can't be drafted or disarmed. Draft area and uses a day (Evony Advanced Guide): level 12
  9 miles in any direction and 4 a day, 14 33 miles, 16 its whole state, 18 the whole map and 10 a day; they
  come back after the daily maintenance. A lord on the receiving end gets a policy report.
- **New: heroes between lords** (Fox, live, and the client's windows):
  - An attacking hero whose loyalty is 0 is captured by the lord's city that beats it, if its Feasting Hall has
    a seat (the battle report says "Your hero was captured"). When a city is taken, every hero still in it becomes
    the new lord's prisoner. Sow Discord's captive works the same way.
  - A captured hero waits in the captor's Feasting Hall: Persuade it (level x 1,000 gold) or Release it, and a
    released hero goes home to its lord. **New in 3.59** (live, from Fox's captures): above level 50, persuading
    also takes medals, one tier for every 10 levels past 50 and as many as the tier (level 54: 1 Cross Medal,
    100: 5 Courage Medals, 120: 7 Freedom Medals). The hero window says so before you try.
  - **Changed in 3.59** (live, all 137 heroes in Fox's captures): the next level takes 150 x level² experience
    (it was 100 x level²), so 3,750 at level 5 and 1,500,000 at 100. Heroes stop at level 100 (Ring heroes 120);
    an ordinary hero at 100 keeps no experience and can't use experience books, while a Ring hero at 120 goes on
    gathering it, as live. Not enough experience gives live's "You have insufficient experience points to
    upgrade."
  - Its lord counts it lost: the **Stone of Finding** brings back a hero lost in the last 24 hours, from wherever
    it is (unless it's out leading an army). Using the item opens the client's list of lost heroes.
  - **Historic Cities held by lords can be taken**: each won attack lowers the city's loyalty the way it does an
    NPC city's (it climbs back toward 100 minus the tax rate, 10 points an hour), and at 0 the city is yours if
    your title has a free city slot. The army that took it stays there. Its lord's armies out from it come home to
    his other city, and a lord's last city can't be taken.
  - **Recruit Hero** (the button at the top of the screen, on merged "ca"/"cc" servers; this server's ID,
    `local`, counts) takes a Legendary Ring, the "Ancient Ring" the merged servers gave out for each historic hero
    lost in a merge (Fox). The hero gets your name and portrait (both can be changed) and rolled attributes. Reset
    Attributes rolls the unlocked ones again: free three times a day, then 10 coins and 10,000 gold, 20 and 20,000
    with one attribute locked, 40 and 40,000 with two (the client's prices). **New in 3.59**, from Fox's live
    capture of a Ring hero: it starts at level 1 with loyalty 70, gets 2 points a level instead of 1, goes up to
    level 120 instead of 100, and shows its name in yellow in the Feasting Hall (the live `isHero` 4, which also
    keeps its Rename button off, as live). A pending roll keeps its locks until the hero is made.
  - **Champions**: in your profile you pick the heroes other lords see when they click Champions on your city or
    profile.
  - The Feasting Hall shows a hero leading an army as out, returning or stationed, and **Recall** brings its army
    back.
  - Hero Ransom stays empty: on Age II heroes don't run off over unpaid salaries (Fox).
- **New: stratagems** (the Stratagem button in a city's or an army's window; all 22 "player.trick" items, which
  never fail, Fox). One you don't hold is bought for its price in cents. The lord they're used on gets a report in
  Others ("Player StarKiller has applied Wage War without Declaration to you. You are at war with him now...").
  - **Your city**: Regard Bushes and Trees as Soldiers / Empty City (scouts see 5-10 times, or 10-20%, of your
    troops), Cast A Brick to Attract A Gem / Solid Walls and Empty Fields (the same for resources), for 24 hours
    and longer with more; Advance by A Hidden Path lifts Ambush from All Sides.
  - **Another lord's city, any time** (Fox): Inundate with Rumors (+15 grievance, once a day), Alienating and
    Instigating (a hero loses 10-50 loyalty, once a day), Ambush from All Sides (its troops can't be sent out for
    2 hours, not again within 6), Wage War without Declaration (for 15 minutes a war you declare on him starts at once,
    without the 30 minutes of preparation, and lasts the usual 48 hours (Fox); you lose 10% of your honor; not again
    within 6 hours; his Truce Agreement still protects him), Loot a Burning House (its Warehouses
    protect half for 30 minutes, once a day), Sow Spies in Enemy's Camp (a report of the armies marching to and
    from it), Besiege Enemy's Fort to Rescue Ally's City (its armies are recalled), Burn the Warehouses (10-50% of
    its food, not again within 6 hours), Beauty Trap (a hero's attack 30-80% lower, once a day) and Ears and Eyes in
    Enemy's City (a full scout report).
  - **Your army**: Cicada Sheds Its Skin (home 30% faster; lifts Bolt the Door), Thunder Raid (30% less march
    time), Bluffing / Cover up Army Maneuvers (a Beacon Tower sees 5-10 times, or 10-20%, of its troops, 12 hours).
  - **An army coming at you**: Entrapping (30% longer march), Bolt the Door to Catch the Thief (it can't be
    recalled), Entice Enemy into Compromising Position (50% faster, so it arrives early).
- **New: city management**:
  - The **Warehouse** window: its capacity is now shared between food, lumber, stone and iron by the Store Percents
    you set (25% each until changed), as on live (Fox). Before, each resource was protected up to the full
    capacity. Plunder takes what's above each resource's share (less what Privateering gets past).
  - **Abandon City** (Town Hall): with your password, from another city, once its armies are home. The city, its
    heroes, troops, buildings and resources are gone; prisoners held there go home and historic heroes back to the
    map; its valleys, colonies and trades end. The spot becomes a barbarian city (Fox) of its Town Hall's level
    (a Historic City's spot is the Historic City again). Your last city can't be abandoned, and the Security
    Code can guard it.
  - The march window's **saved troop settings** (Settings 1 to 3) are kept.
- **New: achievements** (the Achievements button on the toolbar): 252 achievements in 12 categories, with the
  requirements and points from the client's own texts ("Kill 1,000 Workers", 25 points).
  - They count what you do from now on: troops trained and killed (in your attacks and your defense), cities
    seized, valleys occupied, successful scouting, miles marched, heroes captured, resources produced and medals
    acquired. Cities owned, heroes in your Feasting Halls (historic, level 100) and level 10 research count as
    they stand.
  - Points add up in your profile and count toward the Achievement quests (now offered). Finishing one shows the
    client's "Your people have completed ..." window.
  - The **Summary** page's 12 bonuses work, 5 levels each: +5% gold, food, lumber, stone or iron production; -5%
    infantry, cavalry or mechanics training cost; -5% construction cost; faster-fading grievance; +2% medal drops;
    +1% wounded. Each level comes with one achievement, picked by the points the client lists for it.
- **New: troops** (Rally Spot, Barracks, Drill Grounds):
  - **Dismiss** troops in the Barracks: 30% of their training food, lumber, stone and iron comes back, as the client
    shows. The Security Code can guard it.
  - **Hungry cities**: on Age II troops don't starve or desert (Fox; Age I lost 10% an hour). A city out of food
    can't send armies (a march needs food for the road), and the hungry icon shows among your buffs while one of
    your cities is out of food and eating more than it grows. So the Rally Spot's **Fugitive Camp** stays empty.
  - The Drill Grounds' **Maneuver**: a practice battle between any two forces you enter, fought with your research
    (no heroes or walls), showing who wins, in how many rounds and the losses. It costs nothing and touches no troops.
- **New: chat** (the chat box under the city), with the client's own rules and texts:
  - **World channel**: each message uses a Speaker ("Used while speaking in World channel"; the Shop sells them).
    Lords under Beginner's Protection can't talk there ("You cannot speak in world chat until the Beginner's
    Protection expires") but have the **Beginners' channel**, which everyone on the server can read.
  - **Whispers** (`/name message`, or Whisper on a name) reach a lord who is online; otherwise send a letter.
  - The **Governor** talks in the World channel as "Governor <name>" (or Governess), in orange, without Speakers,
    and can **mute** a lord for 30 minutes from his name in the chat. The weekly poll's winner is announced in the
    chat.
  - **Publicity Ambassador** badges show their icon before your name (the bronze ones gave the silver badge
    before; fixed).
  - **Alliance chat** (new in 3.63) reaches your alliance's members who are online; it needs no Speaker. The
    rules' `chat` section can let everyone talk without Speakers, or let beginners into the World channel.
- **New: building queues** (Bernini's Hammer; the client's Queue Upgrade button and queue offers are on now):
  - While your builders are busy, a city can queue more work: a new building ("It costs 1 Bernini's Hammer to
    queue this building"), the next levels of one, or demolishing a level. Each entry takes a hammer, or buys one
    for 5 cents when you have none.
  - Each city queues 1 building per title (a Civilian 1, a Baron 4, at most 10). Queuing pays the building's cost
    there and then, so you can't queue what you can't afford (Fox).
  - When a builder is free the first entry starts; the bar under the city shows the rest as "(Queued)". If an
    entry's requirements still aren't met when its turn comes, it's dropped ("building queue canceled for
    requirement not met!") and its cost comes back.
  - Speed-ups and Instant Build work on queued buildings before they start. Calling an entry off returns its cost,
    but the hammer is used up (Fox).
  - A build refused because the builders are busy now answers with the code the client offers a queue on
    (`buildQueue.enabled: false` in the rules turns queues off).
- **New in 3.58, from Fox's live captures:**
  - The building window's upgrade check answers as live: the demolish tooltip now shows how long a demolition
    takes and what it gives back, and a building at its top level says "The building has already reached
    maximum level." (an upgrade there is refused the same way).
  - The Rally Spot's levels go to 18 for amulet cities, each level past 10 doubling the one before (live's level 14
    cost and time match exactly).
  - **Instant Finish** (the speed-up window's coin button) costs what the Guidelines would: as many of the
    biggest that fit (8 h 50 coins, 2.5 h 20, 1 h 10), Beginner Guidelines (15 min, 5) for the rest, or one
    Guideline that covers it all if that is cheaper. That fits live's three prices (20 coins for 1.91 hours, 50 for
    4.41, 85 for 11.02); it was 1 coin a minute. `coinsPerMinuteOfSpeedup` in the rules brings the old way back.
- **New in 3.63: alliances** (the Embassy's Alliance window, every tab), from the client's own rules and texts and
  Fox's live capture of his alliance's tabs:
  - **Founding**: a level 2 Embassy and 10,000 gold (from that city); names up to 8 characters. The founder is the
    Host. **Joining**: a level 1 Embassy, by applying from the alliance list (an officer accepts or refuses) or by
    accepting an invitation (they come by mail too, and wait in the Alliance window).
  - **Ranks**: Host, Vice Host (at most 2), Presbyter (5), Officer (10), Member, with the client's powers: Host to
    Officer invite and review applications; Host to Presbyter set lower members' ranks and expel them; Host and Vice
    Host write the introduction and notice, handle diplomacy and mail every member; the Host hands the alliance on
    (Relinquish Host). Officers can resign to Member. **Quitting costs 10% of your prestige** (the client's warning);
    the Host can only quit as the last member, which ends the alliance.
  - **Size**: 10 members for each level of the Host's best Embassy, at most 100 (live shows 100; the 10 a level is
    my reading of the client's constants). A **Ritual of Pact** makes it 100 for good, and the Advanced, Premium and
    Ultimate Rituals 1,000 for 15, 30 or 90 days (more of them lengthen it); the Host or a Vice Host uses them.
  - **Diplomacy**: another alliance is friendly, neutral or hostile, changed at most once a day. On the map your
    alliance's cities fly green flags, friendly ones blue, hostile ones red. War can't be declared on your own or a
    friendly alliance ("...players from your alliance and friendly alliances"), and **a hostile alliance's cities can
    be attacked without a war**, as the client allows. It's one-sided: they need to set you hostile to do the same.
  - The member list, alliance info, events, the **Military Situation** (members' battles with other lords, newest
    first), the alliance list and the **Alliance ranking** by prestige. Marches to an ally's city get the Relief
    Station's speed, as the march window shows.
- **Fixed in 3.77: RoboEvony logs in again.** The server zipped every message over 16 KB, which the Flash client
  unpacks but RoboEvony can't ("invalid package size -2147475778" at login once a lord's login reply grew past
  16 KB). Messages now go out plain, as live sent them to RoboEvony; only one over the clients' 1 MB limit would be
  zipped, with a warning in the log.
- **New in 3.76: the debug menu sets research and gear.** Get More Coins now also sets research (one topic or all,
  level 0-10), the Workshop's gear technologies (level 0-10) and their stars (0-15, at most level + 6 as in the
  game), with a "Max everything" button. It shows the current levels and the star set. Reopen the Academy or the
  Workshop to see the change; heroes' stats update at once. Levels set here give no prestige.
- **New in 3.75: play without Flash** (experimental). http://127.0.0.1:8080/ruffle.html runs the client in Ruffle,
  the open-source Flash emulator, in any current browser; see "Without Flash" under Setup.
- **Checked in 3.74: Fox's wave on a level 12 Historic City** (1,000 of each troop and 90,000 catapults against
  its 108,444 ballistae, 6,666 archer's towers and a few troops). The server's report matches dxcalc on every
  line but one: dxcalc also kills 52 of the ballistae, and the hero's experience for them (8,406 against 5,771).
  Neither kills a tower. Behind level 10 Walls with Archery 10 the ballistae reach 2,730, farther than anything
  an attacker has (catapults 2,250), and one volley wipes out any stack under about 120,000 catapults or 37,000
  cataphracts, so this wave never gets a shot at them in either calculator. What dxcalc does to kill those 52 is
  still unknown; several documented rules were tried (below) and none produced it without spoiling Fox's other
  dxcalc battles. Here a large single stack that survives a volley (about 500,000 cataphracts) is what takes it.
  - **New: ranged units shoot ranged units first** (the Age I combat guide: "they will always attack enemy ranged
    units first"). It fits Fox's dxcalc battles and the guide's live tables a little better, and the guide's
    lossless ballista farming of NPC 1-5 now loses nothing (550 ballistae used to lose 17 at an NPC 5). The tower,
    trap, abatis, log and trebuchet numbers were re-fitted with it. `battle.rangedFirst` turns it off.
  - Tried and left off (`battle` switches): damage by distance (50% beyond half range, 100% within it, 25%
    point-blank), ballistae moving while they shoot, defenders' ranged troops holding the wall, and Walls adding
    range to towers only.
- **Fixed in 3.73, from Fox's testing:**
  - **War Ensign and Stygandr's Banner of the Horde in the march window.** The client sends the Ensign's box as
    useFlag and the Banner's as useItem; the server read useItem as the Ensign and ignored the Banner, so either box
    ended in "can send at most 100,000 troops". Now the Ensign adds 25% and the Banner multiplies the limit by 10
    (both: 12.5 times), as the client's own limit shows. Only what the army needs is used up: nothing when the
    Rally Spot's own limit is enough, the Ensign alone when that's enough.
  - **Chests give what their description lists.** The client shows a chest's itemDesc when it has one ("Includes:10
    x Stygandr's Banner of the Horde,3 x War Teleporter,..."), but the server only read the other description, so
    chests like Stygandr's Tools fell back to a random prize. Both are read now, and the one read completely wins. The
    reader also learned "50 Million of each resource", "1 Billion Food", "will grant you", "you will gain one of the
    following", lists run together ("2 x Amulets 1 x Adv City Teleporter", "Adv City TeleporterNapoleon's Diary"),
    and the descriptions' own spellings (Mechanics Battallion, Warmonger's Package, Querrying Tools, Ctiy Teleporter,
    Key of Winnter and others).
  - A lord's Historic City or an NPC city at loyalty below 1 (shown as 0) is taken by the next won attack; a few
    hundredths of a point regained in between kept it from being taken.
- **New in 3.72: prestige as the Evony wiki and the Evony Advanced Guide describe it** (Fox):
  - Prestige for building, research, training and defenses is **divided by all your Town Hall levels together**,
    the fraction dropped ("dividing experience by the total number of town hall levels you have"). A level 4
    Cottage gives 8 with seven Town Hall levels and none with a hundred; a lord with one small city earns far more
    than one with ten level 10 Town Halls, as the guide says.
  - **Won attacks on NPC cities, Historic Cities and valleys earn prestige**: what you killed is worth (as for hero
    experience) x what the defenders were worth / what your army was worth x 0.01477, divided by your Town Hall
    levels. Sending fewer troops earns more, as the guide says. My fit to Fox's 27 live attacks on an NPC 8 with nine
    cities (86 Town Hall levels): 106 for the first attack (live 106), 2 for the next (live 3), none for the rest
    (live none). The guide's NPC 9 examples come out at about 1,400 with 100,000 Warriors and 2,000 with 70,000 (its
    "about 500" and "about 1,000"), so treat the size as an estimate (`battlePrestige` in the rules). The attack
    report shows it (live: prestige="106"). Battles between lords give honor instead.
  - **Losing a battle costs the prestige your lost troops earned when trained** ("you lose the same amount of
    prestige as the troops you lose"), never below 0.
- **New in 3.71, from Fox's test run and his war reports capture:**
  - **Honor** from battles between lords (#12): what you killed is worth, less what you lost is worth, divided by 8
    if you won and by 2 if you lost (losing hurts four times as much). A unit is worth what hero experience counts
    it at: 18 a Pikeman, 27 an Archer, 57 a Cavalry, 59.5 a Transporter, 175 a Cataphract, 200 a Ballista, about 275
    a Battering Ram; defenses their own experience / 50. That matches all twelve of Fox's live reports (a defender
    who killed 100,000 Cataphracts and lost 195,512 Transporters: +733,379; one who lost 40 Archer Towers and 15
    Traps to 39 Pikemen: -5,960) to within a few points in a million. Each side's report shows its honor, and the
    lord's total shows in his profile, on his cities and in the honor ranking. Battles with NPCs give none, as live.
  - Killing Cataphracts, Transporters, Ballistas and Battering Rams gives the live hero experience (a Cataphract
    87.5 to the winner; it was 67.5).
  - **Camp time** in the march window is a wait at home before the march, up to 24 hours, as live; the city feeds
    the troops meanwhile (the window adds that food to what the march needs). Called off in camp, an army is back
    at once with the food it didn't eat. It was a stay timer for allied troops; there is none.
  - **The strongest hero leads a city's defence**: the one with the highest politics, attack and intelligence
    together (gear included) among the city's heroes at home and the heroes of allied armies stationed there, in
    attacks and suppression fights alike (Fox: live). It was the mayor.
  - **Historic City defenses grow back about 10% an hour and aren't rebuilt right after a battle** (Fox). NPC cities
    are unchanged: Fox's 27 live attacks on an NPC 8 show them rebuilding 27% of the Archer Towers, 45% of the Traps,
    63% of the Rolling Logs and 72% of the Trebuchets they lose at once, and growing back fully in an hour, which is
    what this server did. `npcFortRegen` in the rules.
  - **Historic heroes from older saves get the points they were short**: before 3.61 they came with 1 point a level
    for their first 30, so Holy Water gave back 30 instead of 60. Wild ones still waiting in NPC cities are topped up too.
  - **Speaker packages** (10 and 100) open into Speakers, and World chat uses one by itself when there's no loose
    Speaker. World chat still takes a Speaker a message and is closed to lords under Beginner's Protection.
- **Fixed in 3.68 to 3.70: the city window on the map** (another lord's city), against Fox's live screenshots:
  - **Stratagems used from it work.** The client sends the city's map position, not its id, so every stratagem
    aimed at another lord's city (Wage War without Declaration and the rest) said "There is no city there."
  - **Colonize shows only when you can attack the city**: at war with its lord (or his alliance hostile to yours).
    A lord you aren't at war with shows Declare War and no Colonize, as on live; at war it's the other way round.
  - **Reinforce and Transport** show only on your own and your alliance's cities (Reinforce also on a city your army
    is colonizing), not on a neutral lord's city or one you're at war with (3.70).
  - **Status** reads Peacetime, Wartime, Truce, Beginner, Vacation or Dream Truce. It was blank. A lord shows Wartime
    only to a lord he is at war with, or whose alliance and his are at war (either set the other hostile); to everyone
    else he is at peace (Fox). Your own cities show Wartime while you are in any war.
- **Fixed in 3.67: new lords build two buildings at once for their first 72 hours**, as the client's notice says
  ("All new players can build two buildings at one time in 72 hours.") and its buff icon shows. The client showed
  both but the server only allowed one. Each city gets two builders until the account is 72 hours old
  (`newPlayerDoubleBuildHours` in the rules; 0 turns it off). Gundulf's Compass still gives the same for 3 days.
- **Changed in 3.65: resource fields go at most one level above the Town Hall** (Fox: live), so a Town Hall 5
  city's fields stop at 6. With the Town Hall at 10 they go to 10, or to a Historic City's own cap (12 to 18). The
  upgrade window shows the Town Hall level needed, in red, only while it holds a field back (live leaves it out once
  it's met); the Upgrade button stays off until then, and Queue Upgrade can still line it up behind the Town Hall.
  `fieldsAboveTownHall` in the rules (null turns it off). Any mix of fields fits the plots outside the walls (13 at
  Town Hall 1, 3 more a level, 40 at 10), as on live.
- **Changed in 3.66: the Walls can't be demolished**, like the Town Hall (the client shows no Demolish for either;
  Fox: live never lowers them). The server now refuses it outright and in the building queue.
- **New in 3.64: allied troops in an ally's city** (the Embassy's "Level N allows N alliance troops to be
  garrisoned"). Send reinforcements to an alliance member's city from the march window:
  - The city needs an Embassy, one allied army per Embassy level (those on their way count), and its lord must
    allow it (the Embassy's "Allied Garrison Troops" box, ticked unless turned off).
  - A city with allied troops in it, or on their way, can't teleport (the teleporters: "Any troops sent or garrison
    troops in your city is not allowed while teleporting").
  - They stay until called back, and **the city they guard feeds them** meanwhile (Fox: live).
  - They **defend the city alongside its own troops**, and each kind loses the same share in the city and in every
    allied army. Their lord gets the battle report. If the city falls they head home.
  - Their lord can recall them, and the city's lord can **send them home** from the Embassy (their lord is told).
    They also head home if either lord leaves the alliance, or the city changes hands.
  - The city's lord sees allied armies coming and staying in the Embassy's table.
- **Changed in 3.63: valleys and flats at levels 6-10**, from Fox's scout reports. Each holds one to three kinds of
  troops, picked again each day, sharing the valley's strength equally. Each kind's count is its share times its
  weight: Warriors 9.3, Pikemen 3.16, Swordsmen and Archers 2.11, Cavalry 1. These weights fit every live report
  from level 1 to 10. Strength roughly doubles a level, from about 200 Cavalry's worth at level 6 to about 2,750 at
  10, and varies by up to a third either way. Levels 1-5 keep the live mixes.
- **New in 3.62, from Fox's captures and answers:**
  - **Building speed is live's**: each Construction level takes 10% off what is left (it was a straight 10% a
    level), and each whole point of the mayor's politics, gear included, takes 0.14% off (it was 1% a point added).
    That gives live's times to the second in all 14 readings (an Academy going 8 to 9 took 42,845 s with no mayor,
    41,720 with 19 politics, 19,606 with 558). Wall defenses take Construction the same way. Research and training
    use the same 0.14% a point for the mayor's intelligence and attack (training was already 13% a hundred points).
  - **An abandoned city** leaves a barbarian city at the level its flat had when the city was founded (Fox; it was
    the Town Hall's level). It stays until it's conquered or a War Teleporter lands on it.
  - Beauty Trap lasts **8 hours** (Fox; it was 24). A Legendary Ring's rolls run 50 to **170** (Fox has seen 170).
  - The two Nicolaus Copernicus and two Lentulus Sura in the hero sheet are now two different heroes each, as live:
    the second Copernicus has 64 politics, the second Lentulus 91/53/80.
- **New in 3.61:** marches take whole seconds, as live (150,000 Archers reinforcing a city 1.4 tiles away with a
  level 10 Relief Station took 28 seconds; the formula alone gives 28.3).
- **New in 3.60, from the same captures:**
  - **Storage**: a city holds 10,000 of each resource plus its fields' limits, and Stockpile raises the fields' part
    10% a level (it was the Warehouse's protection only), so twice their limits at Stockpile 10. All 19 cities in
    Fox's captures fit this exactly.
  - **Michelangelo's Script** is needed for level 10 only. Live asks for one on a Farm going 9 to 10, but not 11 to
    12 or 13 to 14 in a Historic City.
  - **Production** matched all 12 cities in the captures: the fields' output times the production rate and
    staffing, raised by research and 1% a point of the mayor's politics, plus 100. Only one change was needed: the
    politics counts in whole points.
  - The City Expansion quest **Acquire Capital City** (conquer one city: 5 Intermediate and 5 Senior Guidelines, 5
    Aries Amulets, 100,000 prestige), as the live quest window shows it.
  - Barbarian cities are called "Barbarian's city" on the map, with no flag, as live. The hero window shows the
    stars a hero's level allows on every slot, as live (6 for a new hero).
- **New: the Coordinates List** (map signs): "Add to CL" on another lord's city keeps it in the list under the
  map, which jumps there (with the city's current name); entries can be removed.
- **New: your account and profile** (the profile window's Security Code, Vacation and Dream Truce windows, with
  the client's own texts):
  - **Security Code**: an extra code that guards the actions you tick: abandoning colonies, dismissing heroes,
    dismissing troops, abandoning cities and changing the tax rate. A guarded
    action asks for the code, then lets you unlock that action, or all of them, until you log out. You can change
    the code with the current one. Removing a forgotten code takes 72 hours ("no protected actions may be
    initiated" meanwhile) and can be called off.
  - **Vacation**: 10 cents a day, plus 10 cents per colony for every 3 days, for at least 2 days; it needs your
    password. While you're away nothing can be done in the game, and nobody can attack, scout or declare war on
    you. Logging in shows the Holiday window with the time left; it can be called off after 24 hours. Auto
    Extend renews it while your cents last.
  - **Dream Truce** (use the item): 10 hours of truce every day from the time you choose; each item adds a day at
    the same time. Clicking its buff lets you change the starting time (from the next day, once every 72 hours)
    or cancel it. During those hours you can't be attacked and no war can be declared on you.
  - The portrait can be changed once (the profile hides the button after); the headline and the membership
    e-mail are kept (nothing is mailed).
- **War between lords** (new in 3.44), as the client has it. A lord's ordinary city can be attacked or colonized only
  while you're at war with him (the client hides Attack on lords' cities and enables Colonize only in wartime);
  Historic Cities lords hold are open to anyone, as before.
  - **Declare War** from his city's map window or his profile. As the client says, "War begins in 30 minutes
    after the war declaration is made" and "Wartime period lasts 48 hours"; both of you can attack each other
    then. Both lords get the declaration report, the war bar under the city view ("War Declaration", then
    "Wartime", with its timer), and each other's cities turn purple on the map, then red. The Attack and
    Colonize buttons show "War begins in ..." and "War ends in ...". These run in real time, as the client
    counts them, whatever the server's speed.
  - **Beginner's Protection**: for 7 days, or until one of his Town Halls reaches level 5 (the client's own
    check), nobody can declare war on a new lord ("Cannot declare war against new players..."), and he can't
    declare one either.
  - A lord under a **Truce Agreement** can't be attacked ("Cannot attack players in Truce or Vacation status"),
    and no war can be declared on him meanwhile (Fox). Declaring costs nothing and has no limit or cool down.
  - Scouting a lord needs no war, but a lord under Beginner's Protection can't be scouted (Fox).
  - An army whose war ends (or whose target takes a Truce) on the way turns back.
  - **Incoming armies**: other lords' attacks, Scouts and Colonize marches on their way to your cities and
    valleys show in the Report window's enemy list and light the under-attack warning, with as much as the
    target city's **Beacon Tower** sees (the wiki's table): level 1 only that something is coming, 2 its
    purpose, 3 when it arrives, 4 whose it is, 5 where it set out from, 6 the kinds of troops, 7 roughly how
    many, 8 exactly how many, 9 its hero. Without a Beacon Tower there's no warning.
- **Colonies** (new in 3.43), from the client's colony windows and texts, with Fox's live timings. Colonizing a
  lord's city takes a war with him (above).
  - **Colonize** (the map's Colonize button) another lord's ordinary city with a hero-led army. Win the first
    fight and the 8-hour Colonization Period begins: the army stays in the city (the report says "Troops
    stationed in the target city" and gives the period's times) and both lords see the colony bar's timer.
    You can Send more troops to it meanwhile; its lord can reinforce it and train. At the end the
    Stabilization battle is fought, your stationed troops against the city's troops and defenses: win and the
    city is your Protectorate and your troops come home; lose (or recall the troops) and it stays free.
  - There's no limit on how many colonies you hold: one of Fox's cities is the suzerain of 28 on the live game
    (`colonies.max` and `colonies.perCity` can set one). A colony must regain its freedom before it can colonize, Historic Cities and NPC
    cities can't be colonized, and you can't attack your own Protectorate except to put down an uprising.
  - A Protectorate pays **tribute**: 5% of what it produces (food, lumber, stone, iron and tax gold), all the
    time, to its suzerain. The Town Hall's production rows and the resource tooltips show it as "Colonies
    Tributes" or "Tributes paid".
  - **Policies** on a Protectorate (the city list's colony window), one a day per colony, all sharing one cool
    down until the daily maintenance, 10% each as the client says: Tax Imposition (gold), Food Levy, Population
    Redeployment (idle people), Draft (one troop branch joins your city) and Disarmament (one branch
    disbanded), and Sow Discord: every hero there loses 30 loyalty, and one may be captured into your Feasting
    Hall if it has a seat. Both lords get a report (the colony's lord the client's imposition, Sow Discord and
    abandonment reports).
  - **The suppression army** (Suppression setting): a percentage of each kind of troop in your city, within
    its Rally Spot's dispatch limit. Lowering it has a 5-hour cool down.
  - **Uprise**: the colony's lord rises up (the Uprise button on the colony's or the suzerain's city). As the
    client says, 30 minutes later the colony's army fights the suzerain's suppression army: if the suppression
    army wins, the city stays a Protectorate; if it loses, or none was set, the city is free. Meanwhile an
    attack on the uprising colony puts it down too. Rising up ticks the Uprising quest, now offered.
  - **Abandon** hands a colony back after 12 hours, or at once with an Instant Handover.
  - The city list's colony marks, colony bars and windows update as things happen; whether a city counts as
    a colony or a suzerain (the tribute row's label, the Colonize button's "regain your freedom" note) the
    client only reads at login.
  - Not done: Anti-Colonization commission quests, and colonies in alliance wars.
- **Reports**: battle, scouting and transport reports in the Report window. Battle reports list
  the defender's traps, abatis, towers, logs and trebuchets too.
- **Walls**: build traps, abatis, archer's towers, rolling logs and defensive trebuchets within
  the Walls' space.
- **Items**:
  - **Teleporters**: the Adv City Teleporter (and the free Pioneer Express) moves your city to
    any empty flat you choose; the City Teleporter to a random flat in the region you pick; the
    War Teleporter onto a barbarian city, which is gone (**changed in 3.62**, Fox; it landed next to one). Armies
    must be home first, and the city's valleys are given up, as on the live game.
  - **Wheel of Fortune**: every Amulet spins a board of 24 prizes (one grand prize), as on the live
    game, and pays out the one it lands on. Like the live boards it mixes items with 1,000,000 of a
    resource (paid to the city), 10, 30 or 100 cents, and gear materials by 5. Items whose icon the
    client can't load are left off the board. The billboard counts spins.
  - **Chests and packages**: each gives what its description lists (items, resources, cents,
    troops); "Chest A (...) or Chest B (...)" gives one set; chests that only promise "a random
    prize" draw from the wheel's prize table. Lockboxes and event chests need their key (or a
    Silver Key). Medal boxes, troop chests and the Gambler's Charm work too.
  - **Hero items**: medals raise loyalty, Anabasis / Epitome / On War give experience, and
    Excalibur, The Art of War and The Wealth of Nations add 25% to an attribute for 7 days (shown
    in the hero window).
  - **Helms**: Leather Helm of Robinhood to Crystal of Attunement, Ardee's Sigil, the Royal Guard,
    the King and Queen helms and the epic hero box put a hero straight into the Feasting Hall.
  - **Buffs**: War Horn / Ivory Horn (+20% troop attack), Corselet / Ultra Corselet (+20%
    defence), Penicillin (30% of battle losses survive), Vesta's Blessing and the holiday treats
    (half or no troop upkeep), Gundulf's Compass (two buildings at once), the production tools and
    Tax Policy, the Haunted and Christmas Castle (+10% production, +25% Rally Spot limit).
  - **City items**: Civil Code, Speech Text, Dynamite (finishes a demolition, no refund),
    Archimedes' Note, the speed-ups, Hero Hunting, Holy Water, National Flag, New ID, Truce
    Agreement.
  - **City tokens** (Fox: they made up for a Historic City lost in a server merge): the Bronze, Silver and Gold
    Amulets found a city with a level 10 Town Hall and Walls, a Rally Spot of level 11, 12 or 14 on plot 31, and
    **all 40 resource fields** at that level: 9 Farms, 15 Sawmills, 15 Ironmines and 1 Quarry (**changed in 3.62**,
    Fox; it was one of each). **Changed in 3.58** to match Fox's live capture of his Gold Amulet city:
    it is an ordinary city (it can be renamed and has no Policies button), and nothing in it can be upgraded past
    10, so its Rally Spot and fields stay at the amulet's level ("The building has already reached maximum level.").
    The 3.57 Village/Town power level is gone.
  - **Changed in 3.58:** a captured Historic City again comes with no Rally Spot, as in Fox's live capture of an
    account with nine level 14 cities: every Rally Spot there was one its lord built, at 10, and a level 14 city's
    Farm went from 13 to 14 but no further. `npcConquest.historicRallySpot: true` in the rules brings back the 3.56
    Rally Spot at the city's level on plot 11.
  - **Michelangelo's Script** is needed to upgrade a building to level 10, as on the live game
    (`blueprintFromLevel` in the rules turns this off).
  - The **debug menu** (Get More Coins; it was the owner panel) can give you any item, including event chests the
    shop doesn't sell, and **new:** troops, of one kind or every kind, in any of your cities.
- **Hero gear**: research the 14 gear technologies in the Workshop with the client's own building
  and material requirements, then put each piece on a hero in the hero window (politics, attack
  or intelligence, +1 point per level; the mount adds 10% marching speed per level). Gear stars
  use Delicate and Flawless gems with the client's success rates, failure rules and bonuses.
  - **Gear follows the hero's level**, as Fox checked on the live game: one gear level per 10 hero
    levels, and at most that level's stars (level + 6). A level 10 hero wears level 1 gear with 7 stars,
    a level 30 hero level 3 with 9, a level 100 hero level 10 with 15; below level 10, none.
  - **Star points as the live server counts them**: 1.32^(stars - 3) cut off at two decimals
    (3.03 for 7 stars, where the client's tooltip says 3.04), so the hero window shows the same attack
    as on the live game (+60.45 for 15 pieces at level 1 with 7 stars). The mount's stars add no speed:
    a hero's speed is 10 x his mount's level.
- **Quests** (Routine Quests): the Evony wiki's Routine Quest list, with its categories in its order
  under the live game's names (Queen, Rebuild, Commodity Gathering, Consolation, Resources Levy,
  Administration, Trading, Domain Expansion, Scientific Research, Alliance, Hero Recruitment, Military
  Service, Scouting, Fortification, Colony, City Expansion, Rich Store, Transportation, Alarming,
  Population Increase, Wealthy Society, Prestige Building, Item Purchase, Promotion, Battlefield,
  Guidelines, The Medals, Be an Evonian, Hero Gear), each quest's wiki name, target and award, and the
  client's quest ids. Plus Daily Amulet, which is this server's own (`quests.dailyAmulet` turns it off).
  Each category shows the next quest of each chain; tick every target and click Complete Quest. The
  Quests button lights up as soon as something is ready to claim.
  - A quest opens once you can do it: a technology's once the Academy can research it, a troop's once
    the Barracks can train it, a defense's once the Walls allow it, the gear quests once you have a
    Workshop, the historic-hero quests once you have an Inn. Empty categories are hidden.
  - Quests for systems this server doesn't have yet are held back: alliance membership and Issuing Commission.
    Correspondence (mail, and the chat), Achievement, **new:** Stratagem, the Marketplace quests and
    Military Operation (wounded troops) are offered, and the Uprising quest (rise up in a colony).
  - **Flats** can now be conquered like valleys (they hold troops, give no production, take one valley slot), for
    City Expansion's "Conquering" quest (`flatsConquerable` in the rules).
  - Saves from 0.3.14: the old Queen quest (Town Hall 3) becomes the second Queen step, and the old
    Hero Gear quests are replaced by the wiki's.
  - **Ranks**: Lieutenant, Captain, Major, Colonel, General. Each takes gold, a Town Hall level and
    medals (used up), and shows as your Rank.
  - **Titles**: Knight to Prinzessin. Each takes the rank before it, prestige, gold and medals (used up)
    and lets you rule one more city (a Civilian rules 1, a Prinzessin 10).
  - **Prestige** is earned for everything built, researched, trained and fortified, plus quest
    rewards. Saves from earlier versions are credited once for what was already there.
  - **Medals** drop from won attacks on NPC and Historic Cities, better ones at higher levels.
  - **The Medals**: contribute your first medal of each kind for two more, 100 prestige and 10,000 food.
  - **Daily Amulet**: a free Aries Amulet every day.
  - New lords start with the Newbies Package and the Package for Lords, which the Rebuild quests ask
    you to open; existing lords get them once.
- **Hero Quests**: claiming a historic hero's quest or hiring the hero clears it, so the Quests button
  stops flashing.
- **Rankings**: lords (by title, prestige, cities or population), heroes (by level, politics, attack or
  intelligence) and cities (by population or level). Lords' star set level shows too.
  - **New: the Governor election** (the Vote button; Fox and the wiki's Governor page): a lord with at least 1,000
    prestige casts one vote a day for any lord, himself included. The poll closes every Monday at the daily reset
    (`votes.closeDay`); the lord with the most votes (more prestige breaks a tie) is Governor, or Governess, for the
    next week, with the Governor buff. The Vote windows show this week's poll (votes cast, time left), last
    week's results and the past winners. In World Chat the Governor shows as "Governor <name>" in orange and can mute
    lords (see the chat). The wiki's other powers (adding loyalty to a Historic City under attack, gifting gold)
    have no buttons in this client.
  - **New: the Hall of Fame** (Celebrity): the first 100 lords to reach each prestige mark (10,000 to
    10,000,000), each title from Baron to Prinzessin and each gear star set level, with the date they got there.
    Alliances' lists stay empty until alliances are in.
- **Academy research** follows the wiki's research pages: each topic's prerequisites (Mining needs
  Masonry 1, Privateering needs Informatics 5 and Military Science 8, and so on), and the topics whose
  every level needs a building of that level (Agriculture a Farm, Lumbering a Sawmill, Masonry a
  Quarry, Mining an Ironmine, Metal Casting a Workshop, Military Science a Forge, Horseback Riding a
  Stable, Stockpile a Warehouse). Research already done in older saves is kept.
  - Military Science takes 10% off the remaining training time per level (90% at level 1, 35% at 10).
  - Metal Casting speeds training of siege units (Transporter, Ballista, Battering Ram, Catapult) and
    Construction speeds wall defenses, as the client's descriptions say (defenses used Metal Casting).
  - A kind of wall defense that's wiped out in a battle no longer repairs itself.
- **Scouting** works like the live game's reports:
  - Scouts always get into valleys, NPC cities and Historic Cities (live: one Scout at a level 4 lake).
  - How much they see is your Informatics minus the target's: a valley's or flat's level, a lord's
    Informatics, and (from Fox's Informatics 7 reports) an NPC city's level or a Historic City's (12-18). Valleys and cities fill in differently:
    - Valleys, Informatics 6 and one Scout: levels 1-3 show exact troops (level 1 also its hero), 4-5
      troops as words ("Horde", "Lots"), 6-10 nothing ("Level of Informatics is too low"). So 1-2 above
      the target gives words, 3 exact troops, 5 the hero (`scouting.reveal`).
    - NPC and Historic Cities, Informatics 7 and one Scout: level equal to yours shows food,
      lumber, stone and iron; 1 below adds the buildings except the resource fields; 2 below gold,
      population and loyalty; 3 below the Sawmill, Quarry, Ironmine and Farms; 4 below the defenses; 5
      below the troops, always exact. Above your level you see nothing (live: NPC 8-10 and a level 12
      Historic City). The hero didn't show even 6 below, so it comes in at 7 below, a guess
      (`scouting.cityReveal`).
    - Informatics 10 sees everything at NPC and Historic Cities, even with one Scout (live: NPC 1, 2, 3
      and 10 with one Scout; level 12 and 14 Historic Cities with 100). The number of Scouts doesn't
      matter (`scouting.scoutTiers` is off). The same goes for valleys (live: one Scout at a
      level 10 desert saw its exact troops and hero). Informatics 8 and 9 count as themselves until
      tested (`scouting.informaticsAs`).
    - A valley's report has no defenses or stores, and a troop type a valley or NPC city has
      lost entirely still shows, at 0, as live.
    - The gold in a scout report isn't repeated inside the resources, and NPC reports say the Scouts got
      in and met no Scouts (`isFound`), as live.
  - An NPC city's report shows what the live one does: its hero (an ordinary name, level 1 to 50),
    population and loyalty (1,000 and 80 at NPC 1 up to 78,000 and 90 at NPC 10 and Historic Cities), its
    buildings (20 Cottages, 7 + 3 x level Farms and one of everything else, at its level; a Historic City's
    resource buildings at 12 or 14), and "No defending troops found." with the Scouts that came back.
    Reports are titled "Scout Reports", NPC cities are called "Barbarian's city", and report times read
    "10/22 18:58:27", as on the live game. Battle reports show the NPC city's hero too.
  - Amounts are the wiki's words (Few 1-24, Pack 25-49, Lots 50-99, Horde, Throng, Swarm, Zounds, Legion,
    Bulk, Giga 10,000+) until your Informatics is 3 above a valley or lord. One Scout is enough for exact
    numbers, as live (the wiki's 10 Scouts per level is off: `scouting.scoutsPerLevel`). The Beacon Tower
    plays no part in scouting.
  - Valley and flat garrisons from Fox's live reports: 24 + 22 x level troops, warriors and
    pikemen 3:1 at levels 1-2 (35 and 12, then 51 and 17), pikemen at 3-4 (90 at level 3), swordsmen and
    archers at 5. Levels 6-9 follow the same count with a mix that is my guess. Level 10 holds
    3,236 pikemen, 2,157 archers and 1,022 cavalry, as a live level 10 desert did (it had lost all its
    warriors and swordsmen, so a full one holds more; `garrison.valley.exact`). Flats hold troops too
    (live: a level 2 flat had 51 warriors and 17 pikemen), and valleys have a hero.
  - Scouting a lord's city: your Scouts fight the Scouts at home there (Informatics and hero intelligence
    help each side). The weaker side's Scouts die; if yours lose you get no report. Both lords get the
    client's own result messages.
- **RoboEvony**: with the patched roboevony.exe (roboevony-local.zip), type `127.0.0.1:8080` (the web
  port) as the server and log in with your account name and password. The server answers the bot's
  config.xml lookup with the game port. The bot's own commands beyond what the client uses may show up
  in unhandled.log.
- **Building requirements** follow the wiki's building pages: Barracks need a Rally Spot, the Inn a
  level 2 Cottage, the Forge a level 3 Ironmine, the Workshop a level 2 Forge, the Walls a level 2
  Quarry and a Workshop, the Stable a level 5 Farm, the Relief Station a Stable (and Horseback Riding
  at its own level), the Academy and Embassy Town Hall 2, the Beacon Tower Barracks. Cottage level N
  needs Town Hall N-1 (from level 3), and Town Hall level N needs Walls N-2 (from level 3). Other
  buildings are no longer capped at the Town Hall's level (`capByTownHall` in the rules turns that back on).
  - Transporters need Barracks 6.
  - Stockpile multiplies what the Warehouse protects by 1.1 a level, and Privateering cuts it by 3% a
    level, compounding (the wiki's Warehouse page).
  - NPC cities regain their stores over 8 hours and are full again after the daily reset.
- **Barracks**, **shop**, **coins** and the **debug menu**, as before.

Items that need systems this server doesn't have yet say so when used: socketing gems.

Still to come: Commission Quests, buying resources with cents, and gems
(and the quests that need them). Until then:
- screens that only *read* data open empty;
- actions show "This server doesn't support that yet (command name)".

Every unsupported command is written to `data/unhandled.log`. That file is the to-do list for
the next milestone.

### What's exact and what's my estimate

- **Checked on the live game by Fox**: gear limited by hero level and its star cap
  (`gear.heroLevelsPerLevel`), the star points the hero window adds up, mount speed, and the Walls'
  range bonus (`battle.wallRangePerLevel`).
- **Exact, from your client file or the live game**: building, research, troop and defense
  costs, times and stats; item prices; Historic City names and the level 14 to 18 locations;
  NPC city (levels 1-10) troops, defenses and stores; level 12 Historic City positions and names
  (every 18 tiles from 9,9, none right next to a bigger Historic City; checked against the live
  server: a scan of 24 spots and 6 names); all Historic City garrisons (levels 12, 14, 16 and 18), including the
  either/or troop types that change at each daily reset and the level 100 King or Queen who can't
  be captured (635 to 1,335 attack, as dxcalc sets them up);
  hiring cost and salaries; Rally Spot, Inn, Feasting Hall, Walls and Academy limits; valley
  bonuses; Comfort and Levy amounts; what each item does (from its description); gear research
  requirements, gear bonuses and the star success rates; research requirements (the wiki's pages,
  `techUnlock` and `techBuildingPerLevel` in the rules).
- **Scouting**: checked on the live game at a level 4 lake with Informatics 1-5, at valleys 1-10 with
  Informatics 6 and one Scout, at NPC 1-10 and a level 12 Historic City with Informatics 7 and one Scout,
  at NPC 1, 2, 3 and 10 with Informatics 10 and one Scout, and at NPC 1-10 and level 12 and 14 Historic
  Cities with Informatics 10 and 100 Scouts, and a level 10 desert with Informatics 10 and one Scout; the
  amount words are the wiki's. When an NPC city's hero
  shows (live it was often missing), what Informatics 8 and 9 see at cities, what
  defenses, resources and buildings add at valleys, scouting lords (your Informatics minus theirs), and
  the Scout fight against lords are my estimates (`scouting` in the rules).
- **From players, not the client**: Military Science stacking 10% a level (the wiki; the client only
  says "10% per level", `militaryScienceStep`), and Masonry needing Lumbering 1 and Iron Working
  needing Military Science 2 (only on the wiki's Routine Quest page). From Evony Advanced Guide: the
  leadership formula (`leadership`), the star set life bonus (`starSetLife`; 14 and 15 stars are its
  guesses; lord-wide rather than per hero from Fox's live battles), the mayor's attack speeding
  training (`mayorTrainingStepPer100Attack`) and the fixed Cataphracts and Catapults of level 16 and
  18 Historic Cities. The guide's troop pages agree with the client's troop table except that they
  give Workers 12 iron (the client: 10; the server keeps the client's).
- **My estimates**, all in `src/rules.js` and adjustable in `data/rules.json`:
  - (the last two level 14 slots, 693,759 and 759,759, are empty: Fox checked live);
  - exactly how close to a bigger Historic City a level 12 spot stays empty (`historic.level12Clearance`);
  - conquering NPC cities: the odds of the 2-4 drop above 80 (Fox: 4 only above 80; 1-3 at 10/40/50% below), the
    recovery rate (one point every 160 to 200 seconds fits), and loyalty being full after the daily reset;
  - wounded troops: the cure price of Workers, Warriors, Pikemen, Swordsmen, Transporters and siege engines
    (14.7% of their training resources, as Scouts and Archers come to; `wounded.healShare`), how fast the
    untreated die (a tenth an hour, `wounded.diePerHour`), and that Auto Heal does nothing when the gold
    falls short;
  - policies: that Draft and Disarmament pick the branch the target has most of (the client lets nobody choose;
    the uses a day, 6 and 8 at levels 14 and 16, are Fox's);
  - the Governor election: the time the poll closes (the daily reset; Monday is Fox's), and the tie-break;
  - stratagems: which hero Alienating and Beauty Trap pick (one at random), loyalty points for Alienating's 10-50%
    (Beauty Trap's 8 hours are Fox's);
  - city management: that an abandoned city's armies must be home first;
  - achievements: the categories and their order (a 2010 players' guide), which achievement gives each bonus level
    (matched by the client's point lists; Domain, the Captive, Marching, Civilization, Resource Production's
    "complete N" steps, Conquering and Enemy Killing's "complete N" steps), the medal types beyond Cross, Rose,
    Lion and Honor and Medal Acquisition's "complete N" steps, mileage counted one way, and the titles (the
    category's name). Booty is left out: nothing says what it asks;
  - chat: that the Beginners' channel uses Speakers too (the client asks for one there), and that a whisper to a
    lord who is offline is refused rather than kept;
  - building queues: that a dropped or called-off entry's cost comes back (as a cancelled construction's does
    here), and that a queued building waits only for the builders (requirements are checked when it starts);
    the Coordinates List's size (50, `coordinates.max`);
  - account: the Dream Truce times are the game clock's (your computer's time, as the client shows it; the client
    doesn't say which), and that a lord
    on vacation can't be scouted (the client only says he can't be attacked);
  - heroes: Recruit Hero's attribute roll (50 to 170 each: 51-110 in Fox's capture, 60-170 seen on live; `ringHero`), that an attacking hero is
    captured only when the attack fails, that a released lord's hero goes home (and is gone if its city has no
    seat), and that a taken Historic City's loyalty starts again at 100 minus its tax rate;
  - war: the Beacon Tower table is the wiki's (`beacon`; Fox checked that levels 1-3 hide the lord and the
    arrival time);
  - colonies (`colonies` in the rules): Sow
    Discord's capture chance (20%, and that it takes the least loyal free hero), the 12-hour handover when
    you abandon a colony, that tribute includes tax gold and stops during an uprising or a handover, that a
    lost suppression battle frees the colony at once (the client's texts say so; the "24 hours" in the
    suzerain's uprising report is the client's own wording), and that a Stabilization battle won by the city
    leaves it free with no further penalty;
  - historic heroes: which NPC levels
    they hide in, and the values the sheet marks "?" (`historicHeroes`);
  - level 16 and 18 Historic City stores (12 and 14 are checked: an NPC 10's), and how many Catapults
    or Battering Rams a level 12 or 14 has (14,640 or 36,600; Ballistae are checked);
  - valley garrisons at levels 6-10: how many kinds a valley holds (one to three here) and how much its strength
    varies (a third either way), fitted to Fox's six live reports;
  - alliances: the member limit (10 a level of the Host's Embassy), the events' wording (but "X has invited Y to an
    alliance." is live), that founding and joining need an Embassy in the city you use;
  - allied troops in an ally's city: that they lose the same share as the city's own troops and leave when their
    lords' alliance parts (the city feeding them and the strongest hero leading are live);
  - honor: a Battering Ram's worth (about 275) and the rounding; a lord's honor can go below 0;
  - prestige: the "experience" the wiki divides by Town Hall levels is taken as 1% of the resources spent, and the
    battle prestige formula is my fit (above);
  - captured heroes: that persuading always works and needs no title (the medals above level 50 are live; a
    historic hero takes the portrait), that a captive's points are an Inn hero's of that level, that captives draw no salary, that
    the hero gets away when no Feasting Hall has room, and that valley heroes don't change daily;
  - the battle model's constants. The rules come from players' guides and the damage formula
    players worked out for Age I; the numbers in `battle` (damage scale, ranged and tower
    multiplier, trap/abatis kills, logs and trebuchets) and the hero's intelligence effect were fitted
    so the simulation matches dxcalc, with the star set bonus and Walls counted. On Fox's seven dxcalc
    battles it picks the same winner every time, is within 3 rounds, and lands within about 8% on
    losses; it also follows the guide's live NPC 6-9 table. On the live game traps fired less than
    dxcalc's 8% a round (61% and 84% of them over 13 rounds), which isn't modelled yet;
  - hero stats (experience is live since 3.59; historic heroes' level cap and points since 3.61);
  - the mayor's intelligence speeding research (0.14% a point, as his politics does building on live);
  - the research needed for troops and defenses (the wiki's pages give only the Barracks and Walls levels);
  - cooldowns;
  - the Wheel of Fortune's prizes and odds, and what chests without a contents list give (`wheel`);
  - gear research times (`gear.researchMinutes`); the client has none;
  - stats of heroes from helms, beyond what each helm's description promises;
  - cities founded with a city token are called "new" too, like those built on a flat;
  - how fast the population moves toward its settled level (half the gap an hour, `populationGrowthPerHour`),
    (the base limit of 50 adds to the Cottages': checked live).
  - quests: the wiki's list (players' notes) is followed as written. Where it's garbled the client's
    texts fill in (Population Increase gold, Continuous Development iron, the Duke's prestige). The
    first, third, fourth and fifth Queen awards (the wiki shows 1-5; I used 100, 200, 300 and 500),
    and when each quest opens, are my estimates. The two "Conquer an NPC city" Queen steps can't be
    done yet, since NPC cities can't be taken;
  - how prestige is earned (`prestige.perResource`); the client has no prestige values;
  - medal drop chances from NPC battles (`npcMedals`);
  - rank and title requirements come from players' guides (2009-2010), not the live server.

## Setup (Windows)

1. Install **Node.js 18 or newer** (LTS) from nodejs.org.
2. Copy your `EvonyClient1921.swf` into the `client` folder.
3. Double-click `start.bat` (or run `npm start` in this folder). Leave the window open.
   If Windows Firewall asks about Node.js, you can cancel; everything stays on your PC.
4. In Basilisk, open **http://127.0.0.1:8080/**
5. In the client's login panel:
   - Account: any name
   - Password: anything
   - IP: `127.0.0.1` (pre-filled)
   - Then press Login.

   The first login creates the account; later logins need the same password.

To stop the server, close its window or press Ctrl+C. Your world is saved in `data/world.json`.

### Without Flash: Ruffle (experimental, new in 3.75)

Open **http://127.0.0.1:8080/ruffle.html** in any current browser (Chrome, Edge, Firefox). It runs
the same client in [Ruffle](https://ruffle.rs), an open-source Flash Player emulator, so no Flash is
needed. The page loads Ruffle 0.7.1 from the npm CDN (unpkg.com); to play offline, download Ruffle's
"self-hosted" build and put `ruffle.js` and its `.wasm` files in `public/ruffle/`. A browser can't
open the game's raw socket, so Ruffle sends it as a WebSocket to `/ws` on the web server, which
passes it to the game port; nothing else changes and both pages can be used at the same time.

Ruffle doesn't implement all of Flash yet (Flex, which the client is built on, is one of its weaker
spots), so a screen may draw wrong or a click may do nothing. Basilisk stays the reference. When
something breaks in Ruffle only, note the screen and send the browser console (F12) along with
`data/server.log`.

## Settings (`config.json`)

| Setting | Default | Meaning |
|---|---|---|
| `host` | `127.0.0.1` | Address the client connects to. Use your PC's LAN address to let others on your network join. |
| `httpPort` | `8080` | Port for the launch page and art. |
| `gamePort` | `9443` | Game socket. Evony used 443. |
| `policyPort` | `843` | Flash asks this port for permission before opening the game socket. |
| `speed` | `1` | Multiplies production and divides timers. `1` is Evony's real pace (Town Hall 2 takes 30 minutes); try `10` while testing. |
| `assetCdn` | `http://e2.eimg.us` | Where missing art is fetched from. Set to `""` to work offline from `cache/` only. |

Coins: `startCoins` (default 1,000) and `coinsPage` (default on) live in `data/rules.json`.

## Rules (`data/rules.json`)

Some rules aren't in the client, because the client asks the server for them. These include
starting resources, which buildings unlock which, how many outside plots each Town Hall level
opens, and demolish refunds. `src/rules.js` lists the defaults.

The building, troop and wall defense requirements (`unlock`, `troopUnlock`, `fortUnlock`), the
garrisons (`garrison`) and the battle settings (`battle`, `counters`) are **estimates**. To correct one, check the requirements in
the live game's build menu. Then put just what differs in `data/rules.json`, for example:

```json
{ "unlock": { "25": [[31, 3]] }, "start": { "resources": { "food": 50000 } } }
```

## If something goes wrong

- **Black screen or stuck loading.** Check the server window. If no "logged in" line appears,
  Basilisk isn't reaching the game socket. Make sure ports 843 and 9443 aren't used by
  anything else.
- **Logged in but a screen is blank or broken.** Send `data/server.log` and
  `data/unhandled.log` along with a description of what you clicked.
- **An icon or picture is missing.** The server log has a `Missing art:` line for each file the
  client asked for that isn't in `cache/` and that the art server doesn't have. Those that the art
  server answered "not found" are kept in `cache/missing-art.json`; delete that file to try them again.
- **Start over.** Stop the server and delete `data/world.json`.

## For development

- `npm test` runs an end-to-end check that plays the client's side of the protocol.
- `docs/PROTOCOL.md` documents every message the client can send or receive. It was generated
  from the decompiled client by `tools/extract_protocol.py`.
- Code layout:
  - `src/net.js`: socket framing, AMF3 and the Flash policy.
  - `src/http.js`: launch page, `config2.xml` and the art cache.
  - `src/ws.js`: the WebSocket bridge Ruffle's page uses for the game socket (`public/ruffle.html`).
  - `src/game/`: game logic and command handlers.
