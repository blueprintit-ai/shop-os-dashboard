import { randomUUID } from "node:crypto";

export class SessionStore {
  constructor() {
    this.sessions = new Map();
  }

  create({ name, userId = null }) {
    const now = Date.now();
    const session = {
      id: randomUUID(),
      name,
      userId,
      claudeSessionId: null,
      startedAt: now,
      lastActivityAt: now,
      turns: [],
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id) ?? null;
  }

  touch(id) {
    const s = this.sessions.get(id);
    if (s) s.lastActivityAt = Date.now();
  }

  setClaudeSessionId(id, claudeSessionId) {
    const s = this.sessions.get(id);
    if (s) s.claudeSessionId = claudeSessionId;
  }

  recordTurn(id, turn) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.turns.push({ ...turn, ts: Date.now() });
    s.lastActivityAt = Date.now();
  }

  end(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    this.sessions.delete(id);
    return s;
  }

  gc(maxAgeMs = 1000 * 60 * 60) {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [id, s] of this.sessions) {
      if (s.lastActivityAt < cutoff) {
        this.sessions.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
