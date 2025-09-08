export class PersistenceManager {
  constructor(agentId = null) {
    this.agentId = agentId;
  }

  set(name, value) {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
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
