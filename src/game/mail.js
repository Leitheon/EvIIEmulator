'use strict';
// Mail between lords (MailWin). Every lord keeps his own copies: a sent mail goes into the receiver's Inbox
// (box 1, unread) and the sender's Sent box (box 3, read), so deleting one copy leaves the other. System mails
// (box 2) come from the server itself. The client limits titles to 200 characters and messages to 500
// (MailConstants), and the server holds the same limits.
const { stamp } = require('./reports');

const BOX = { INBOX: 1, SYSTEM: 2, SENT: 3, BROADCAST: 4 };
const TITLE_LIMIT = 200, CONTENT_LIMIT = 500;

class Mail {
  constructor(game){ this.g = game; }
  list(p){ return p.mails || (p.mails = []); }
  // Unread counts for server.NewMail and the player bean: all unread, Inbox, System.
  counts(p){
    const unread = this.list(p).filter(m => !m.isRead);
    return { count: unread.length, count_inbox: unread.filter(m => m.box === BOX.INBOX).length, count_system: unread.filter(m => m.box === BOX.SYSTEM || m.box === BOX.BROADCAST).length };
  }
  pushCounts(p){ this.g.push(p.id, 'server.NewMail', this.counts(p)); }
  // A lord by name, ignoring case and spaces at the ends.
  playerByName(name){
    const n = String(name || '').trim().toLowerCase(); if (!n) return null;
    return Object.values(this.g.db.players).find(p => String(p.name || '').toLowerCase() === n) || null;
  }
  add(p, m){
    p.mailSeq = (p.mailSeq || 0) + 1;
    const mail = { id: p.mailSeq, ...m };
    const list = this.list(p); list.unshift(mail);
    // Keep each box to its newest rules.mail.maxPerBox mails.
    const max = this.g.rules.mail?.maxPerBox ?? 300;
    const inBox = list.filter(x => x.box === mail.box);
    if (inBox.length > max){ const drop = new Set(inBox.slice(max)); p.mails = list.filter(x => !drop.has(x)); }
    this.g.store.touch();
    return mail;
  }
  send(from, toName, title, content, now = this.g.now()){
    title = String(title ?? '').trim(); content = String(content ?? '');
    const to = this.playerByName(toName);
    if (!to) return [-1, `There is no lord called ${String(toName || '').trim() || '(nobody)'}.`];
    if (!title) return [-1, 'Give your mail a title.'];
    if (title.length > TITLE_LIMIT) return [-1, `A title can be at most ${TITLE_LIMIT} characters.`];
    if (content.length > CONTENT_LIMIT) return [-1, `A mail can be at most ${CONTENT_LIMIT} characters.`];
    const base = { title, content, at: now, senderId: from.id, sender: from.name, receiverId: to.id, receiver: to.name };
    this.add(to, { ...base, box: BOX.INBOX, isRead: 0 });
    if (to !== from) this.add(from, { ...base, box: BOX.SENT, isRead: 1 });
    this.pushCounts(to);
    return { to };
  }
  // A mail from the server itself (System box).
  system(p, title, content, now = this.g.now()){
    const m = this.add(p, { box: BOX.SYSTEM, isRead: 0, title, content, at: now, senderId: 0, sender: this.g.rules.mail?.systemSender || 'System', receiverId: p.id, receiver: p.name });
    this.pushCounts(p);
    return m;
  }
  ids(text){ return new Set(String(text ?? '').split(',').map(s => Number(s.trim())).filter(n => n > 0)); }
  markRead(p, ids){ let n = 0; for (const m of this.list(p)) if (ids.has(m.id) && !m.isRead){ m.isRead = 1; n++; } if (n) this.g.store.touch(); return n; }
  remove(p, ids){ const before = this.list(p).length; p.mails = this.list(p).filter(m => !ids.has(m.id)); if (p.mails.length !== before) this.g.store.touch(); return before - p.mails.length; }
  find(p, id){ return this.list(p).find(m => m.id === Number(id)) || null; }
  // A page of one box. The System tab shows system mails and broadcasts.
  page(p, box, pageNo, pageSize){
    const want = Number(box) || BOX.INBOX, size = Math.max(1, Math.min(50, Number(pageSize) || 10));
    const all = this.list(p).filter(m => want === BOX.SYSTEM ? m.box === BOX.SYSTEM || m.box === BOX.BROADCAST : m.box === want);
    const totalPage = Math.max(1, Math.ceil(all.length / size)), no = Math.max(1, Math.min(totalPage, Number(pageNo) || 1));
    return { mails: all.slice((no - 1) * size, no * size).map(m => this.bean(m)), pageNo: no, totalPage };
  }
  bean(m){
    return { mailid: m.id, title: m.title, sender: m.sender, receiver: m.receiver, receiveTime: stamp(m.at), isRead: m.isRead ? 1 : 0,
      playerId: m.senderId || 0, targetId: m.receiverId || 0, selected: false };
  }
  detail(m){ return { ...this.bean(m), content: m.content, type_id: m.box }; }
}

module.exports = { Mail, MAIL_BOX: BOX };
