// Every localStorage access is wrapped: Safari throws a SecurityError on any
// localStorage operation when storage is partitioned or blocked — "Prevent
// Cross-Site Tracking" (default on), "Block All Cookies", Private Browsing, or
// a sandboxed/third-party iframe. An unguarded throw here used to propagate
// into AgentManager.verifyClient(), which swallowed it and reported the agent
// as unverified, aborting init BEFORE the widget ever mounted — so the widget
// was simply invisible in Safari while working in Chrome. Degrading to "no
// persistence" keeps the widget rendering; it just re-verifies and re-creates
// sessions each load instead of caching them. (config.ts guards its theme
// storage the same way.)
//
// "No persistence" still has to mean "remembered for this page view": the
// widget keeps state such as the active conversation id here, and losing it on
// every write made init create a second conversation and then lock the chat.
// So when localStorage throws, values fall back to this in-memory map, shared
// by every PersistenceManager on the page.
const memoryFallback = new Map<string, string>();

export class PersistenceManager {
  agentId: string | null;

  constructor(agentId: string | null = null) {
    this.agentId = agentId;
  }

  set(name: string, value: string | null | undefined): void {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    try {
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
    } catch {
      /* storage unavailable — non-fatal, widget still renders */
      if (value === null || value === undefined) memoryFallback.delete(key);
      else memoryFallback.set(key, value);
    }
  }

  get(name: string): string | null {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  }

  remove(name: string): void {
    const key = this.agentId ? `${this.agentId}-${name}` : name;
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable — non-fatal */
      memoryFallback.delete(key);
    }
  }

  clear(): void {
    try {
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
    } catch {
      /* storage unavailable — non-fatal */
      for (const key of [...memoryFallback.keys()]) {
        if (!this.agentId || key.startsWith(`${this.agentId}-`)) memoryFallback.delete(key);
      }
    }
  }
}
