import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatviaApi, ChatviaStub } from '../src/types';

// main.ts replaces the embed's command-queue stub with the public API when the
// bundle loads. It runs once on import, so each test resets the module
// registry and installs a fresh stub first.
describe('window.chatvia public API', () => {
  beforeEach(() => {
    vi.resetModules();
    // Every request fails, so init fails the way it does with no server.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = Object.assign(() => {}, { agentId: 'agent-1', q: [['init']] });
    window.chatvia = stub as ChatviaStub;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete window.chatvia;
  });

  it('stays callable after load, as the documented legacy API requires', async () => {
    await import('../src/main');
    const chatvia = window.chatvia as ChatviaApi & ((...args: unknown[]) => Promise<unknown>);

    expect(typeof chatvia).toBe('function');
    await expect(chatvia('close')).resolves.toBeUndefined();
    expect(chatvia.agentId).toBe('agent-1');
  });

  it('does not throw when opened before the widget has mounted', async () => {
    await import('../src/main');
    const chatvia = window.chatvia as ChatviaApi;

    expect(() => chatvia.open()).not.toThrow();
    expect(chatvia.isOpen()).toBe(false);
  });

  it('only fires "ready" once init has succeeded', async () => {
    await import('../src/main');
    const chatvia = window.chatvia as ChatviaApi;
    const ready = vi.fn();
    chatvia.on('ready', ready);

    // Let the failed init settle.
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(ready).not.toHaveBeenCalled();
  });
});
