'use strict';
// Small XML reader for the client's data tables: elements, attributes and text. No DTDs.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] ?? m;
});

function parse(src){
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))){
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]){ if (stack.length > 1) stack.pop(); }
    else if (m[3]){
      const el = { tag: m[3], attrs: {}, children: [], text: '' };
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let a;
      while ((a = ar.exec(m[4]))) el.attrs[a[1]] = unescape(a[2] ?? a[3]);
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.text += unescape(m[6]);
  }
  return root.children[0] || null;
}
const kids = (el, tag) => (el ? el.children.filter(c => !tag || c.tag === tag) : []);
const child = (el, tag) => kids(el, tag)[0] || null;

module.exports = { parse, kids, child };
