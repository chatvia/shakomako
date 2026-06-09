export class PersistenceManager {
  constructor(agentId = null) {
    this.agentId = agentId;
  }

  set(name, value) {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    // Treat null/undefined as a removal. localStorage.setItem coerces them to
    // the literal strings "null"/"undefined", which then read back as truthy —
    // e.g. setActiveConversationId(null) used to persist "null", so the next
    // "do I have an active conversation?" check wrongly answered yes. Removing
    // the key makes get() return a real null.
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  }

  get(name) {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    return localStorage.getItem(key);
  }

  remove(name) {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    localStorage.removeItem(key);
  }

  clear() {
    if (this.agentId) {
      // Remove all keys for this specific agent
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(`${this.agentId}-`)) {
          localStorage.removeItem(key);
        }
      });
    } else {
      localStorage.clear();
    }
  }
}
