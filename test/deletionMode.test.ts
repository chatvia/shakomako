import { describe, it, expect, beforeAll, vi } from 'vitest';
import { ChatWidget } from '../src/widget';
import { initI18n } from '../src/i18n';
import { confirmDeleteConversation, getDeletionMode } from '../src/state/conversations';
import type { WidgetSettings } from '../src/types';

/** A bare widget with just what the menu and the confirm flow read. */
function buildWidget(mode?: WidgetSettings['chat_deletion_mode']) {
  const widget = Object.create(ChatWidget.prototype) as ChatWidget;
  widget.settings = { chat_deletion_mode: mode };
  widget.conversations = [{ id: 'conv-1', messages: [{ role: 'user', content: 'Hi' }] }];
  const deleteConversation = vi.fn(async () => false);
  const createNewConversation = vi.fn(async () => null);
  widget.storageManager = {
    getActiveConversationId: () => 'conv-1',
    deleteConversation,
    createNewConversation
  } as unknown as ChatWidget['storageManager'];
  return { widget, deleteConversation, createNewConversation };
}

const menuLabels = (widget: ChatWidget) =>
  [...widget._createMenuDropdown().querySelectorAll('[role="menuitem"]')].map(
    item => item.textContent
  );

describe('chat deletion mode', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it.each([undefined, null, '', 'archive'])('falls back to end for %s', mode => {
    expect(getDeletionMode(buildWidget(mode).widget)).toBe('end');
  });

  it('offers End chat and no bulk action in end mode', () => {
    expect(menuLabels(buildWidget('end').widget)).toEqual([
      'Start new chat',
      'Chat history',
      'End chat'
    ]);
  });

  it('says "remove from history", never "delete", in hide mode', () => {
    expect(menuLabels(buildWidget('hide').widget)).toEqual([
      'Start new chat',
      'Chat history',
      'Remove from history',
      'Remove all from history'
    ]);
  });

  it('keeps the delete wording in delete mode', () => {
    expect(menuLabels(buildWidget('delete').widget)).toEqual([
      'Start new chat',
      'Chat history',
      'Clear current chat',
      'Clear all'
    ]);
  });

  describe('confirming', () => {
    function confirm(mode: WidgetSettings['chat_deletion_mode']) {
      const built = buildWidget(mode);
      const { widget } = built;
      const dialog = vi.fn();
      Object.assign(widget, {
        isStreaming: false,
        closeMenuDropdown: vi.fn(),
        clearMessages: vi.fn(),
        showFetchSpinner: vi.fn(),
        hideFetchSpinner: vi.fn(),
        addMessage: vi.fn(async () => null),
        _showConfirmationDialog: dialog
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      confirmDeleteConversation(widget);
      const [title, , button, onConfirm] = dialog.mock.calls[0];
      return { ...built, title, button, onConfirm: onConfirm as () => Promise<void> };
    }

    it('ends the chat without deleting it in end mode', async () => {
      const { title, button, onConfirm, deleteConversation, createNewConversation } =
        confirm('end');
      expect([title, button]).toEqual(['End Chat', 'End Chat']);

      await onConfirm();

      expect(deleteConversation).not.toHaveBeenCalled();
      expect(createNewConversation).toHaveBeenCalled();
    });

    it.each(['hide', 'delete'] as const)(
      'asks the server to remove the chat in %s mode',
      async mode => {
        const { onConfirm, deleteConversation } = confirm(mode);

        await onConfirm();

        expect(deleteConversation).toHaveBeenCalledWith('conv-1');
      }
    );
  });
});
