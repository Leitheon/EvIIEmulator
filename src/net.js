'use strict';
// Socket layer: Flash socket policy, message framing and AMF3 payloads.
//   frame = int32 big-endian length (+ top bit set when the server zlib-compresses) + AMF3 {cmd, data}
const net = require('net');
const zlib = require('zlib');
const amf3 = require('./amf3');

const POLICY_REQ = '<policy-file-request/>';
const POLICY_XML = '<?xml version="1.0"?><!DOCTYPE cross-domain-policy SYSTEM "http://www.adobe.com/xml/dtds/cross-domain-policy.dtd">' +
  '<cross-domain-policy><site-control permitted-cross-domain-policies="master-only"/><allow-access-from domain="*" to-ports="*"/></cross-domain-policy>\0';
const MAX_PACKAGE = 1048576;
// Messages go out uncompressed. The Flash client can unzip a message whose length has the top bit set, but
// RoboEvony can't (it reads that as a negative size and disconnects), and it worked against the live servers, so
// they didn't compress what it was sent. Only a message too big for either client's 1 MB limit is compressed.
const COMPRESS_OVER = MAX_PACKAGE;

function startPolicyServer(port, log){
  const srv = net.createServer(sock => {
    sock.setTimeout(10000, () => sock.destroy());
    sock.on('error', () => {});
    sock.once('data', () => { sock.end(POLICY_XML); });
  });
  srv.on('error', e => log.warn(`Policy server on port ${port} failed (${e.code}). Flash will fall back to asking the game port, which also answers.`));
  srv.listen(port, () => log.info(`Socket policy server listening on ${port}`));
  return srv;
}

let connSeq = 0;
class Connection {
  constructor(sock, onMessage, onClose, log){
    this.id = ++connSeq; this.sock = sock; this.log = log; this.buf = Buffer.alloc(0); this.closed = false; this.first = true;
    this.player = null; this.ip = sock.remoteAddress;
    sock.setNoDelay(true);
    sock.on('data', d => this.onData(d, onMessage));
    sock.on('error', e => log.debug(`conn ${this.id} error ${e.code || e.message}`));
    sock.on('close', () => { this.closed = true; onClose(this); });
  }
  onData(d, onMessage){
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.first){
      if (this.buf[0] === 0x3c){ // '<' : Flash asking this port for its policy file
        if (this.buf.indexOf(0) === -1 && this.buf.length < 64) return;
        if (this.buf.toString('ascii', 0, POLICY_REQ.length) === POLICY_REQ){ this.sock.end(POLICY_XML); return; }
      }
      this.first = false;
    }
    while (this.buf.length >= 4){
      const len = this.buf.readUInt32BE(0) & 0x7fffffff;
      if (len > MAX_PACKAGE){ this.log.warn(`conn ${this.id} sent an oversized packet (${len}); closing`); this.sock.destroy(); return; }
      if (this.buf.length < 4 + len) return;
      const payload = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      let msg;
      try { msg = amf3.decode(payload); }
      catch (e){ this.log.warn(`conn ${this.id} sent unreadable data: ${e.message}`); continue; }
      if (!msg || typeof msg.cmd !== 'string'){ this.log.warn(`conn ${this.id} sent a message without cmd`); continue; }
      onMessage(this, msg.cmd, msg.data);
    }
  }
  send(cmd, data){
    if (this.closed) return;
    let payload = amf3.encode({ cmd, data: data == null ? {} : data });
    let head = payload.length;
    if (payload.length > COMPRESS_OVER){
      const raw = payload.length;
      payload = zlib.deflateSync(payload); head = (payload.length | 0x80000000) >>> 0;
      this.log.warn(`${cmd} is ${raw} bytes, over the clients' 1 MB limit, so it went out compressed (${payload.length} bytes); RoboEvony can't read that`);
    }
    const h = Buffer.alloc(4); h.writeUInt32BE(head >>> 0);
    this.sock.write(Buffer.concat([h, payload]));
  }
  close(){ try { this.sock.end(); } catch (e){} }
}

function startGameServer(port, onMessage, onClose, log){
  const srv = net.createServer(sock => new Connection(sock, onMessage, onClose, log));
  srv.on('error', e => { log.error(`Game server could not listen on port ${port}: ${e.code || e.message}`); process.exitCode = 1; });
  srv.listen(port, () => log.info(`Game server listening on ${port}`));
  return srv;
}

module.exports = { startPolicyServer, startGameServer, POLICY_XML, Connection, MAX_PACKAGE };
