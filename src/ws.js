'use strict';
// WebSocket bridge for Ruffle (the Flash emulator). A browser page can't open a raw TCP socket, so Ruffle's
// socketProxy setting sends the client's game socket over ws://<web server>/ws instead; this passes the bytes
// to the game port and back unchanged, so the game server sees an ordinary connection. A minimal RFC 6455
// server: binary frames, ping/pong and close; no extensions.
const crypto = require('crypto');
const net = require('net');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BUFFER = 4 * 1048576;

function frame(opcode, payload){
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.alloc(10);
  if (n >= 65536){ head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}

// Reads client frames from buf; returns [frames, rest] or null when the stream is malformed.
function parse(buf){
  const out = [];
  let p = 0;
  while (buf.length - p >= 2){
    const b0 = buf[p], b1 = buf[p + 1], masked = b1 & 0x80;
    let len = b1 & 0x7f, q = p + 2;
    if (len === 126){ if (buf.length - q < 2) break; len = buf.readUInt16BE(q); q += 2; }
    else if (len === 127){ if (buf.length - q < 8) break; const big = buf.readBigUInt64BE(q); if (big > BigInt(MAX_BUFFER)) return null; len = Number(big); q += 8; }
    if (!masked) return null; // browsers always mask
    if (buf.length - q < 4 + len) break;
    const key = buf.subarray(q, q + 4), data = Buffer.from(buf.subarray(q + 4, q + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= key[i & 3];
    out.push({ opcode: b0 & 0x0f, data });
    p = q + 4 + len;
  }
  return [out, buf.subarray(p)];
}

// Answers WebSocket upgrades to /ws on httpSrv by bridging them to the game server at host:port.
function attachSocketBridge(httpSrv, host, port, log){
  httpSrv.on('upgrade', (req, sock, first) => {
    const key = req.headers['sec-websocket-key'];
    if (!/^\/ws\/?(\?.*)?$/.test(req.url || '') || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || !key){
      sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sock.setNoDelay(true);
    const game = net.connect(port, host);
    game.setNoDelay(true);
    let buf = Buffer.alloc(0), closed = false;
    const close = () => {
      if (closed) return; closed = true;
      try { if (!sock.destroyed) sock.end(frame(0x8, Buffer.alloc(0))); } catch (e){}
      game.destroy();
      log?.debug?.('Ruffle socket closed');
    };
    game.on('data', d => { if (!sock.destroyed) sock.write(frame(0x2, d)); });
    game.on('close', close); game.on('error', close);
    sock.on('close', close); sock.on('error', close);
    const onData = d => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (buf.length > MAX_BUFFER){ close(); return; }
      const r = parse(buf);
      if (!r){ close(); return; }
      buf = r[1];
      for (const f of r[0]){
        if (f.opcode === 0x0 || f.opcode === 0x1 || f.opcode === 0x2) game.write(f.data);
        else if (f.opcode === 0x8){ close(); return; }
        else if (f.opcode === 0x9) sock.write(frame(0xA, f.data));
      }
    };
    sock.on('data', onData);
    if (first?.length) onData(Buffer.from(first)); // frames that came in the same packet as the upgrade request
    log?.info?.('Ruffle connected (WebSocket bridge to the game server)');
  });
}

module.exports = { attachSocketBridge, frame, parse };
