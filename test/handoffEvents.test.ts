import { describe, it, expect, beforeAll, vi } from 'vitest';
import { handleHandoffEvent, HANDOFF_MODE } from '../src/state/handoff';
import { initI18n } from '../src/i18n';
import type { ChatWidget } from '../src/widget';

function makeWidget() {
  const emit = vi.fn();
  const addMessage = vi.fn().mockResolvedValue(null);
  const widget = {
    agentId: 'agent-1',
    sessionId: 'sess-1',
    handoffMode: HANDOFF_MODE.AI,
    adminName: null,
    isOpen: false,
    _emit: emit,
    addMessage,
    setupSSE() {},
    scrollToBottom() {},
    _updateMenuForHandoffState() {},
    getCurrentActiveConversationId: () => 'conv-1'
  } as unknown as ChatWidget;
  return { widget, emit, addMessage };
}

// The same status can reach the widget twice (stream and WebSocket, or echoed
// after the visitor ends the chat). Host pages must get one event per change,
// and the chat one status message.
describe('handoff events', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('fires one event, with the server payload, when an agent takes over', async () => {
    const { widget, emit } = makeWidget();

    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Sam' });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('handoff', {
      mode: 'human',
      status: 'human',
      admin_name: 'Sam'
    });
  });

  it('ignores a repeated status: no second event or message', async () => {
    const { widget, emit, addMessage } = makeWidget();

    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Sam' });
    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Sam' });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledTimes(1);
  });

  it('treats a different agent taking over as a change', async () => {
    const { widget, emit } = makeWidget();

    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Sam' });
    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Alex' });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(widget.adminName).toBe('Alex');
  });

  it('returns to AI once, however many "returned" events arrive', async () => {
    const { widget, emit } = makeWidget();

    await handleHandoffEvent(widget, { status: 'human', admin_name: 'Sam' });
    await handleHandoffEvent(widget, { status: 'returned' });
    await handleHandoffEvent(widget, { status: 'ai' });

    expect(emit).toHaveBeenCalledTimes(2);
    expect(widget.handoffMode).toBe(HANDOFF_MODE.AI);
  });
});
