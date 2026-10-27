'use strict';
// Minimal SWF reader: pulls embedded binary data (DefineBinaryData) by the class name
// it is bound to (SymbolClass). Used to read Evony's data tables from your own copy of the client.
const zlib = require('zlib');

function readSwf(buf){
  const sig = buf.toString('ascii', 0, 3);
  let body;
  if (sig === 'FWS') body = buf.subarray(8);
  else if (sig === 'CWS') body = zlib.inflateSync(buf.subarray(8));
  else throw new Error(`Unsupported SWF signature "${sig}" (only FWS/CWS are handled)`);
  const nbits = body[0] >> 3;
  let p = Math.ceil((5 + 4 * nbits) / 8) + 4; // RECT, frame rate, frame count
  const binary = new Map(), symbols = new Map();
  while (p + 2 <= body.length){
    const head = body.readUInt16LE(p); p += 2;
    const code = head >> 6; let len = head & 0x3f;
    if (len === 0x3f){ len = body.readUInt32LE(p); p += 4; }
    const tag = body.subarray(p, p + len); p += len;
    if (code === 0) break;
    if (code === 87) binary.set(tag.readUInt16LE(0), tag.subarray(6));
    else if (code === 76){
      const n = tag.readUInt16LE(0); let q = 2;
      for (let i = 0; i < n; i++){
        const id = tag.readUInt16LE(q); q += 2;
        const end = tag.indexOf(0, q); symbols.set(tag.toString('utf8', q, end), id); q = end + 1;
      }
    }
  }
  return {
    version: buf[3],
    binaryByClass(name){ const id = symbols.get(name); return id === undefined ? null : binary.get(id) || null; },
    classNames(){ return [...symbols.keys()]; },
  };
}

module.exports = { readSwf };
