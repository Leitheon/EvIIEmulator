'use strict';
// World state kept in one JSON file (data/world.json), saved every few seconds and on exit.
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dataDir, log){
    this.file = path.join(dataDir, 'world.json'); this.log = log; this.dirty = false;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = { version: 1, seq: 100, seed: (Math.random() * 2 ** 31) | 0, accounts: {}, players: {}, castles: {}, tiles: {} };
    if (fs.existsSync(this.file)){
      try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; }
      catch (e){
        const bad = this.file + '.unreadable-' + Date.now();
        fs.copyFileSync(this.file, bad);
        log.error(`world.json could not be read (${e.message}). A copy was kept as ${path.basename(bad)}; starting a fresh world.`);
      }
    }
    this.timer = setInterval(() => this.flush(), 5000);
    this.timer.unref?.();
  }
  id(){ this.dirty = true; return ++this.db.seq; }
  touch(){ this.dirty = true; }
  flush(){
    if (!this.dirty) return;
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
}

module.exports = { Store };
