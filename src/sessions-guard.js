export class SessionsGuard {
  constructor({ max = 3 } = {}) {
    this.max = max;
    this.running = new Set();
    this.queue = []; // [{ key, grant }]
  }
  stats() { return { running: this.running.size, queued: this.queue.length }; }
  position(key) {
    if (this.running.has(key)) return 0;
    const i = this.queue.findIndex((q) => q.key === key);
    return i < 0 ? -1 : i + 1;
  }
  acquire(key) {
    return new Promise((resolve) => {
      const grant = () => {
        this.running.add(key);
        let released = false;
        resolve(() => { if (released) return; released = true; this.running.delete(key); this._next(); });
      };
      if (this.running.size < this.max) grant(); else this.queue.push({ key, grant });
    });
  }
  _next() {
    while (this.running.size < this.max && this.queue.length) this.queue.shift().grant();
  }
}
