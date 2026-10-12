import { describe, it, expect, beforeAll, vi } from 'vitest';
import { addMessage, sendUserMessage } from '../src/state/messages';
import { initI18n } from '../src/i18n';
import { CSS_CLASSES } from '../src/utils';
import type { Attachment, ChatMessage, Conversation } from '../src/types';
import type { ChatWidget } from '../src/widget';

function makeWidget(overrides: Record<string, unknown> = {}) {
  const messageHistory: ChatMessage[] = [];
  // After a history load the conversation's list IS widget.messageHistory.
  const conversation: Conversation = { id: 'conv-1', messages: messageHistory };
  const send = vi.fn().mockResolvedValue(true);
  const widget = {
    messagesContainer: document.createElement('div'),
    chatInput: document.createElement('textarea'),
    sendButton: document.createElement('button'),
    settings: {},
    messageHistory,
    attachments: [] as Attachment[],
    handoffMode: 'ai',
    sseClient: { send, isConnected: () => false },
    getActiveConversation: () => conversation,
    getCurrentActiveConversationId: () => 'conv-1',
    _updateConversationActionButtons() {},
    _clearAttachments() {},
    scrollToBottom() {},
    pinMessageToTop() {},
    followStream() {},
    autoResizeInput() {},
    hideStarters() {},
    showLoading() {},
    hideLoading() {},
    ...overrides
  } as unknown as ChatWidget;
  return { widget, conversation, send };
}

describe('message history', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it('stores a message once when the conversation shares the history array', async () => {
    const { widget, conversation } = makeWidget();

    await addMessage(widget, CSS_CLASSES.MESSAGE_USER, 'Hello');

    expect(widget.messageHistory).toHaveLength(1);
    expect(conversation.messages).toHaveLength(1);
  });

  it('marks message text for automatic direction', async () => {
    const { widget } = makeWidget();

    const el = await addMessage(widget, CSS_CLASSES.MESSAGE_AGENT, 'Hello', false);

    expect(el?.querySelector(`.${CSS_CLASSES.MESSAGE_BUBBLE}`)?.getAttribute('dir')).toBe('auto');
  });
});

describe('sendUserMessage guards', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it('waits while an attachment is still uploading', async () => {
    const uploading = { id: 'tmp-1', filename: 'a.pdf', size_bytes: 1, mime_type: '', url: '' };
    const { widget, send } = makeWidget({ attachments: [uploading] });

    await sendUserMessage(widget, 'Here is the file');

    expect(send).not.toHaveBeenCalled();
    expect(widget.messageHistory).toHaveLength(0);
  });

  it('does not start a second AI turn while a reply is streaming', async () => {
    const { widget, send } = makeWidget();
    widget.sseClient!.isConnected = () => true;

    await sendUserMessage(widget, 'Another question');

    expect(send).not.toHaveBeenCalled();
  });

  it('sends a ready message', async () => {
    const { widget, send } = makeWidget();

    await sendUserMessage(widget, 'Hello');

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello' }));
  });
});
