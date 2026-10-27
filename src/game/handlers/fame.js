'use strict';
// The Governor election (Vote windows) and the Hall of Fame (Celebrity ranks); fame.js has the rules.
const { dateTime } = require('../beans');
module.exports = (game, H) => {
  const F = game.fame, info = p => game.beans.playerInfo(p, game.castlesOf(p));
  const byName = name => game.chat.byName(name);
  const page = (list, d) => {
    const size = Math.max(1, Math.min(100, d.pageSize | 0 || 10)), total = Math.max(1, Math.ceil(list.length / size));
    const no = Math.max(1, Math.min(total, d.pageNo | 0 || 1));
    return { beans: list.slice((no - 1) * size, no * size), pageNo: no, pageSize: size, totalPage: total };
  };
  const vote = (conn, cmd, q) => { const r = F.vote(conn.player, q, game.now()); if (Array.isArray(r)) return game.fail(conn, cmd, r[0], r[1]); game.reply(conn, cmd, {}); };
  H['vote.voteToPlayerByName'] = (conn, d, cmd) => vote(conn, cmd, byName(d.name));
  H['vote.voteToPlayerById'] = (conn, d, cmd) => vote(conn, cmd, game.db.players[Number(d.playerId)] || null);
  // sortType 1: this week's poll (VoteCurWin), 0: last week's (VotePreWin). voteendtime: seconds until the polls close.
  H['rank.getVoteRank'] = (conn, d, cmd) => {
    const r = F.rank(Number(d.sortType) === 1, game.now()), key = String(d.key || '').toLowerCase();
    const list = r.rows.map((x, i) => ({ ...info(x.p), ranking: i + 1 })).filter(b => !key || b.userName.toLowerCase().includes(key));
    game.reply(conn, cmd, { ...page(list, d), votestoal: r.total, voteendtime: r.endsIn, preweekterm: F.label(F.termOf(game.now()) - 1) });
  };
  // The past winners (VoteHisWin): one row a week.
  H['rank.getTopVotesPlayer'] = (conn, d, cmd) => game.reply(conn, cmd, { beans: F.winners(game.now()).map((h, i) => ({ ...info(h.p), ranking: i + 1, term: h.label, topvotes: h.votes })) });
  // The Hall of Fame: the first 100 lords to reach each mark, with the date (alliances aren't on this server yet).
  const hall = (conn, cmd, kind, key) => game.reply(conn, cmd, { playerBean: F.list(kind, key).map(x => ({ ...info(x.p), ranking: x.ranking, date: dateTime(x.at) })), allianceBean: [] });
  H['celeb.findPlayerByPrestige'] = (conn, d, cmd) => hall(conn, cmd, 'prestige', Number(String(d.prestige || '').replace(/,/g, '')) || 0);
  H['celeb.findPlayerByTitle'] = (conn, d, cmd) => hall(conn, cmd, 'title', String(d.title || ''));
  H['celeb.findPlayerByStar'] = (conn, d, cmd) => hall(conn, cmd, 'star', Number(d.starlv) || 0);
  H['celeb.findAllianceByPrestige'] = (conn, d, cmd) => game.reply(conn, cmd, { playerBean: [], allianceBean: [] });
};
