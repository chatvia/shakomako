import { describe, it, expect, afterEach, vi } from 'vitest';
import { PersistenceManager } from '../src/persistence';

// Safari throws on every localStorage call when storage is blocked ("Block All
// Cookies", Private Browsing, sandboxed iframes). The widget must still
// remember values for the page view: losing the active conversation id on
// every write made init create a second conversation and then lock the chat.
describe('PersistenceManager without localStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function blockStorage() {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(blocked);
  }

  it('remembers values in memory for the page view', () => {
    blockStorage();
    const storage = new PersistenceManager('agent-1');

    storage.set('chat-widget-active-conversation-id', 'conv-1');

    expect(storage.get('chat-widget-active-conversation-id')).toBe('conv-1');
  });

  it('shares remembered values between managers for the same agent', () => {
    blockStorage();
    new PersistenceManager('agent-2').set('chat-widget-session-id', 'sess-1');

    expect(new PersistenceManager('agent-2').get('chat-widget-session-id')).toBe('sess-1');
    expect(new PersistenceManager('agent-3').get('chat-widget-session-id')).toBeNull();
  });

  it('forgets a value set to null or removed', () => {
    blockStorage();
    const storage = new PersistenceManager('agent-4');

    storage.set('key', 'value');
    storage.set('key', null);
    expect(storage.get('key')).toBeNull();

    storage.set('key', 'value');
    storage.remove('key');
    expect(storage.get('key')).toBeNull();
  });
});
