'use strict';
// Friends List and BlockList (FriendList, PlayerInfo, the chat's name menu, MailWin's Block button).
//   - friend.addFriend / addBlock / deleteFriend / deleteBlock take a lord's name; every reply carries both lists
//     (FriendResponse friendArr and blockArr), which the client keeps in its player bean.
//   - A lord is on one list at most: the client removes him from the other list first ("Are you sure you want to
//     remove this player from your blocklist?"), and the server does the same.
//   - "You will not receive any messages (from alliance chat, whisper and mail) from players added to your
//     blocklist." World chat can't be blocked ("the player's world chat can not be blocked under any
//     circumstances"). The chat's own Block (屏蔽) is the client's and lasts until logout.
//   - friend.isBlockMailPlayer: MailWin's Block, which puts the mail's sender on the blocklist.
const MAX = 200;

class Friends {
  constructor(game){ this.g = game; }
  list(p, kind){ const k = kind === 'block' ? 'blocks' : 'friends'; return p[k] || (p[k] = []); }
  // p has blocked q.
  blocked(p, q){ return !!(p && q && (p.blocks || []).includes(q.id)); }
  bean(q){ return { ...this.g.beans.playerInfo(q, this.g.castlesOf(q)), accountName: '' }; }
  beans(p, kind){ return this.list(p, kind).map(id => this.g.db.players[id]).filter(Boolean).map(q => this.bean(q)); }
  lists(p){ return { friendArr: this.beans(p, 'friend'), blockArr: this.beans(p, 'block') }; }
  add(p, kind, name){
    const q = this.g.chat.byName(name), what = kind === 'block' ? 'blocklist' : 'friends list';
    if (!q) return [-3, `There is no lord called ${String(name || '').trim()}.`];
    if (q.id === p.id) return [-1, "You can't add yourself."];
    const list = this.list(p, kind);
    if (list.includes(q.id)) return [-1, `${q.name} is already on your ${what}.`];
    if (list.length >= MAX) return [-1, `Your ${what} is full (${MAX} lords).`];
    const other = this.list(p, kind === 'block' ? 'friend' : 'block'), i = other.indexOf(q.id);
    if (i >= 0) other.splice(i, 1);
    list.push(q.id);
    this.g.store.touch();
    return { target: q };
  }
  remove(p, kind, name){
    const q = this.g.chat.byName(name), list = this.list(p, kind);
    const i = q ? list.indexOf(q.id) : -1;
    if (i < 0) return [-1, `${q ? q.name : String(name || '').trim()} isn't on your ${kind === 'block' ? 'blocklist' : 'friends list'}.`];
    list.splice(i, 1);
    this.g.store.touch();
    return { target: q };
  }
  // MailWin's Block: the sender of one of p's mails.
  blockMail(p, mailId){
    const m = this.g.mail.find(p, mailId);
    if (!m) return [-1, "That mail isn't there any more."];
    const q = m.box === 3 ? null : this.g.db.players[m.senderId];
    if (!q) return [-1, 'Only mail from another lord can be blocked.'];
    if (this.blocked(p, q)) return { target: q };
    return this.add(p, 'block', q.name);
  }
}

module.exports = { Friends, MAX_FRIENDS: MAX };
