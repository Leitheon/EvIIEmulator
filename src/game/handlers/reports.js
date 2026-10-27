'use strict';
// Reports (the "Report" tab of the info window).
module.exports = (game, H) => {
  const R = game.reports;
  const ids = s => String(s || '').split(/[,#;\s]+/).map(Number).filter(n => n > 0);
  const pushCounts = p => game.push(p.id, 'server.NewReport', R.unread(p));
  H['report.receiveReportList'] = (conn, d, cmd) => {
    const p = conn.player, size = Math.max(1, Math.min(50, d.pageSize | 0 || 10));
    const list = R.list(p).filter(r => d.reportType == null || r.type === d.reportType);
    const total = Math.max(1, Math.ceil(list.length / size)), no = Math.max(1, Math.min(total, d.pageNo | 0 || 1));
    game.reply(conn, cmd, { reports: list.slice((no - 1) * size, no * size).map(r => R.bean(r)), pageNo: no, totalPage: total });
  };
  H['report.markAsRead'] = (conn, d, cmd) => {
    const p = conn.player, r = R.list(p).find(x => x.id === d.reportId);
    if (!r) return game.fail(conn, cmd, -1, 'That report was deleted.');
    if (!r.isRead){ r.isRead = 1; game.store.touch(); pushCounts(p); }
    game.reply(conn, cmd, { report: R.bean(r) });
  };
  H['report.readOverReport'] = (conn, d, cmd) => {
    const p = conn.player, want = new Set(ids(d.reportIds));
    for (const r of R.list(p)) if (want.has(r.id)) r.isRead = 1;
    game.store.touch(); game.reply(conn, cmd, {}); pushCounts(p);
  };
  H['report.deleteReport'] = (conn, d, cmd) => {
    const p = conn.player, gone = new Set(ids(d.idStr));
    p.reports = R.list(p).filter(r => !gone.has(r.id));
    game.store.touch(); game.reply(conn, cmd, {}); pushCounts(p);
  };
  H['report.deleteAllReports'] = (conn, d, cmd) => {
    const p = conn.player;
    p.reports = R.list(p).filter(r => d.reportType != null && r.type !== d.reportType);
    game.store.touch(); game.reply(conn, cmd, {}); pushCounts(p);
  };
  H['report.shareReport'] = (conn, d, cmd) => game.fail(conn, cmd, -1, "Sharing reports isn't supported on this server.");
};
