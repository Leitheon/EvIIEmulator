'use strict';
// AMF3 encoder/decoder covering what Flash's ByteArray.writeObject/readObject produce.
// Spec: Adobe "AMF 3 Specification" (2013).

const M = { UNDEF: 0, NULL: 1, FALSE: 2, TRUE: 3, INT: 4, DOUBLE: 5, STRING: 6, XMLDOC: 7, DATE: 8, ARRAY: 9, OBJECT: 10, XML: 11, BYTEARRAY: 12,
  VEC_INT: 13, VEC_UINT: 14, VEC_DOUBLE: 15, VEC_OBJECT: 16, DICT: 17 };
const INT_MIN = -(1 << 28), INT_MAX = (1 << 28) - 1;

// Flex wrappers that arrive externalizable; we unwrap them to their contents.
const EXTERNALIZABLE = new Set(['flex.messaging.io.ArrayCollection', 'flex.messaging.io.ArrayList', 'flex.messaging.io.ObjectProxy']);

class Reader {
  constructor(buf){ this.b = buf; this.p = 0; this.strs = []; this.objs = []; this.traits = []; }
  u8(){ if (this.p >= this.b.length) throw new Error('AMF3: unexpected end of data'); return this.b[this.p++]; }
  u29(){
    let v = 0;
    for (let i = 0; i < 3; i++){ const c = this.u8(); if (c < 0x80) return (v << 7) | c; v = (v << 7) | (c & 0x7f); }
    return ((v << 8) | this.u8()) >>> 0;
  }
  double(){ const v = this.b.readDoubleBE(this.p); this.p += 8; return v; }
  rawStr(len){ const s = this.b.toString('utf8', this.p, this.p + len); this.p += len; return s; }
  str(){
    const u = this.u29();
    if ((u & 1) === 0) return this.strs[u >> 1];
    const len = u >> 1; if (!len) return '';
    const s = this.rawStr(len); this.strs.push(s); return s;
  }
  value(){
    const m = this.u8();
    switch (m){
      case M.UNDEF: return undefined;
      case M.NULL: return null;
      case M.FALSE: return false;
      case M.TRUE: return true;
      case M.INT: { const v = this.u29(); return v & 0x10000000 ? v - 0x20000000 : v; }
      case M.DOUBLE: return this.double();
      case M.STRING: return this.str();
      case M.XMLDOC: case M.XML: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const s = this.rawStr(u >> 1); this.objs.push(s); return s;
      }
      case M.DATE: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const d = new Date(this.double()); this.objs.push(d); return d;
      }
      case M.ARRAY: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const n = u >> 1, arr = []; this.objs.push(arr);
        for (let k = this.str(); k !== ''; k = this.str()) arr[k] = this.value();
        for (let i = 0; i < n; i++) arr.push(this.value());
        return arr;
      }
      case M.OBJECT: return this.object();
      case M.BYTEARRAY: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const len = u >> 1, v = Buffer.from(this.b.subarray(this.p, this.p + len)); this.p += len; this.objs.push(v); return v;
      }
      case M.VEC_INT: case M.VEC_UINT: case M.VEC_DOUBLE: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const n = u >> 1; this.u8(); const v = []; this.objs.push(v);
        for (let i = 0; i < n; i++){
          if (m === M.VEC_DOUBLE){ v.push(this.double()); continue; }
          const x = m === M.VEC_INT ? this.b.readInt32BE(this.p) : this.b.readUInt32BE(this.p); this.p += 4; v.push(x);
        }
        return v;
      }
      case M.VEC_OBJECT: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const n = u >> 1; this.u8(); this.str(); const v = []; this.objs.push(v);
        for (let i = 0; i < n; i++) v.push(this.value());
        return v;
      }
      case M.DICT: {
        const u = this.u29(); if ((u & 1) === 0) return this.objs[u >> 1];
        const n = u >> 1; this.u8(); const d = new Map(); this.objs.push(d);
        for (let i = 0; i < n; i++){ const k = this.value(); d.set(k, this.value()); }
        return d;
      }
      default: throw new Error('AMF3: unknown marker ' + m + ' at ' + (this.p - 1));
    }
  }
  object(){
    const u = this.u29();
    if ((u & 1) === 0) return this.objs[u >> 1];
    let t;
    if ((u & 2) === 0) t = this.traits[u >> 2];
    else {
      t = { ext: !!(u & 4), dyn: !!(u & 8), cls: '', names: [] };
      const n = u >> 4; t.cls = this.str();
      for (let i = 0; i < n; i++) t.names.push(this.str());
      this.traits.push(t);
    }
    if (t.ext){
      if (!EXTERNALIZABLE.has(t.cls)) throw new Error('AMF3: cannot read externalizable class ' + t.cls);
      const slot = this.objs.length; this.objs.push(null);
      const inner = this.value(); this.objs[slot] = inner; return inner;
    }
    const o = {}; this.objs.push(o);
    if (t.cls) Object.defineProperty(o, '__class', { value: t.cls, enumerable: false });
    for (const k of t.names) o[k] = this.value();
    if (t.dyn) for (let k = this.str(); k !== ''; k = this.str()) o[k] = this.value();
    return o;
  }
}

class Writer {
  constructor(){ this.parts = []; this.size = 0; this.strs = new Map(); }
  push(b){ this.parts.push(b); this.size += b.length; }
  u8(v){ this.push(Buffer.from([v])); }
  u29(v){
    v >>>= 0;
    if (v < 0x80) return this.push(Buffer.from([v]));
    if (v < 0x4000) return this.push(Buffer.from([(v >> 7) | 0x80, v & 0x7f]));
    if (v < 0x200000) return this.push(Buffer.from([(v >> 14) | 0x80, ((v >> 7) & 0x7f) | 0x80, v & 0x7f]));
    if (v < 0x20000000) return this.push(Buffer.from([(v >> 22) | 0x80, ((v >> 15) & 0x7f) | 0x80, ((v >> 8) & 0x7f) | 0x80, v & 0xff]));
    throw new Error('AMF3: U29 out of range ' + v);
  }
  str(s){
    if (s === ''){ this.u8(1); return; }
    const ref = this.strs.get(s);
    if (ref !== undefined){ this.u29(ref << 1); return; }
    this.strs.set(s, this.strs.size);
    const b = Buffer.from(s, 'utf8'); this.u29((b.length << 1) | 1); this.push(b);
  }
  value(v){
    if (v === undefined) return this.u8(M.UNDEF);
    if (v === null) return this.u8(M.NULL);
    if (v === false) return this.u8(M.FALSE);
    if (v === true) return this.u8(M.TRUE);
    if (typeof v === 'number'){
      if (Number.isInteger(v) && v >= INT_MIN && v <= INT_MAX){ this.u8(M.INT); this.u29(v & 0x1fffffff); return; }
      this.u8(M.DOUBLE); const b = Buffer.alloc(8); b.writeDoubleBE(v); this.push(b); return;
    }
    if (typeof v === 'bigint') return this.value(Number(v));
    if (typeof v === 'string'){ this.u8(M.STRING); this.str(v); return; }
    if (v instanceof Date){ this.u8(M.DATE); this.u8(1); const b = Buffer.alloc(8); b.writeDoubleBE(v.getTime()); this.push(b); return; }
    if (Buffer.isBuffer(v)){ this.u8(M.BYTEARRAY); this.u29((v.length << 1) | 1); this.push(v); return; }
    if (Array.isArray(v)){
      this.u8(M.ARRAY); this.u29((v.length << 1) | 1); this.u8(1);
      for (const x of v) this.value(x);
      return;
    }
    if (typeof v === 'object'){
      this.u8(M.OBJECT); this.u8(0x0b); this.u8(1); // inline traits, dynamic, anonymous class, 0 sealed members
      for (const k of Object.keys(v)){ if (v[k] === undefined) continue; this.str(k); this.value(v[k]); }
      this.u8(1);
      return;
    }
    this.u8(M.UNDEF);
  }
  buffer(){ return Buffer.concat(this.parts, this.size); }
}

function decode(buf){ return new Reader(buf).value(); }
function encode(v){ const w = new Writer(); w.value(v); return w.buffer(); }

module.exports = { decode, encode };
