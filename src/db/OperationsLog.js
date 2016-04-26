'use strict';

const Log         = require('ipfs-log');
const Cache       = require('../Cache');
const DBOperation = require('./Operation');

class OperationsLog {
  constructor(ipfs, dbname, events, opts) {
    this.dbname = dbname;
    this.options = opts || { cacheFile: null };
    this.id = null;
    this.lastWrite = null;
    this._ipfs = ipfs;
    this._log = null;
    this._cached = {};
    this.events = events;
  }

  get ops() {
    return this._log.items.map((f) => this._cached[f.payload]);
  }

  create(id) {
    this.events.emit('load', this.dbname);
    this.id = id;
    return Log.create(this._ipfs, id)
      .then((log) => this._log = log)
      .then(() => Cache.loadCache(this.options.cacheFile))
      .then(() => this.merge(Cache.get(this.dbname)))
      .then(() => this);
  }

  delete() {
    this._log.clear();
  }

  merge(hash) {
    if(!hash || hash === this.lastWrite || !this._log)
      return Promise.resolve();

    this.events.emit('load', this.dbname);
    const oldCount = this._log.items.length;

    return Log.fromIpfsHash(this._ipfs, hash)
      .then((other) => this._log.join(other))
      .then((merged) => {
        if(this._log.items.length - oldCount === 0)
          return;

        return this._cacheInMemory(this._log);
      })
      .then(() => {
        Cache.set(this.dbname, hash)
        this.events.emit('readable', this.dbname, hash)
        return this;
      })
  }

  addOperation(operation, key, value) {
    let post;
    return DBOperation.create(this._ipfs, operation, key, value)
      .then((result) => {
        return this._log.add(result.Hash).then((node) => {
          return { node: node, op: result.Post };
        });
      })
      .then((result) => {
        this._cachePayload(result.node.payload, result.op);
        return result;
      })
      .then((result) => {
        return Log.getIpfsHash(this._ipfs, this._log).then((hash) => {
          this.lastWrite = hash;
          Cache.set(this.dbname, hash);
          this.events.emit('data', this.dbname, hash);
          return result.op.hash;
        });
      })
  }

  _cacheInMemory(log) {
    const promises = log.items
      .map((f) => f.payload)
      .filter((f) => !this._cached[f])
      .map((f) => {
        return this._ipfs.object.get(f)
          .then((obj) => this._cachePayload(f, JSON.parse(obj.Data)))
      });

    return Promise.all(promises);
  }

  _cachePayload(hash, payload) {
    if(!this._cached[hash]) {
      Object.assign(payload, { hash: hash });
      if(payload.key === null) Object.assign(payload, { key: hash });
      this._cached[hash] = payload;
    }
  }
}

module.exports = OperationsLog;