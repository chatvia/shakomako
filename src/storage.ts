import { PersistenceManager } from './persistence';
import api from './api';
import type { ChatMessage, Conversation } from './types';

/** Response of GET conversations. */
interface ConversationsResponse {
  conversations?: Conversation[];
  active_conversation_id?: string | null;
}

export default class StorageManager {
  agentId: string;
  sessionId: string | null;
  persistenceManager: PersistenceManager;
  activeConversationPersistedId: string;

  constructor(agentId: string, sessionId: string | null) {
    this.agentId = agentId;
    this.sessionId = sessionId;

    this.persistenceManager = new PersistenceManager(agentId);
    this.activeConversationPersistedId = 'chat-widget-active-conversation-id';
  }

  getActiveConversationId(): string | null {
    return this.persistenceManager.get(this.activeConversationPersistedId);
  }

  setActiveConversationId(conversationId: string | null): void {
    this.persistenceManager.set(this.activeConversationPersistedId, conversationId);
  }

  /**
   * The visitor's conversations and which one is active. Throws when they can't
   * be loaded, so callers can tell a failure from a visitor with no history.
   */
  async loadConversations(): Promise<{
    conversations: Conversation[];
    activeConversationId: string | null;
  }> {
    const response = await api({
      endpoint: 'conversations',
      method: 'GET',
      headers: {
        'X-AGENT-ID': this.agentId,
        'X-SESSION-ID': this.sessionId,
        // Always pull a fresh list from the server — never a cached response.
        // Without this the browser/CDN can serve a stale list and a freshly
        // generated conversation title (server-side) wouldn't show. Mirrors
        // the no-cache already used by getMessages().
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to load conversations');
    }

    const data: ConversationsResponse = await response.json();

    // Prioritize locally stored active conversation ID over server's
    const localActiveConversationId = this.getActiveConversationId();
    let activeConversationId = localActiveConversationId;

    // Only use server's active conversation ID if we don't have one locally
    if (!activeConversationId && data.active_conversation_id) {
      activeConversationId = data.active_conversation_id;
      this.setActiveConversationId(activeConversationId);
    }

    // If still no active conversation ID, use the first conversation
    if (!activeConversationId && data.conversations && data.conversations.length > 0) {
      activeConversationId = data.conversations[0].id;
      this.setActiveConversationId(activeConversationId);
    }

    return {
      conversations: data.conversations || [],
      activeConversationId: activeConversationId
    };
  }

  async createNewConversation(): Promise<Conversation> {
    try {
      const response = await api({
        endpoint: 'conversations',
        method: 'POST',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId
        }
      });

      if (!response.ok) {
        throw new Error('Failed to create new conversation');
      }

      const newConversation: Conversation = await response.json();

      if (newConversation.id) {
        this.setActiveConversationId(newConversation.id);
        console.log('New conversation created and set as active:', newConversation.id);
        return newConversation;
      } else {
        throw new Error('Conversation ID not found in create response.');
      }
    } catch (error) {
      console.error('Error creating new conversation:', error);
      throw error;
    }
  }

  async deleteConversation(conversationId: string): Promise<boolean> {
    const response = await api({
      endpoint: 'conversations',
      method: 'DELETE',
      headers: {
        'X-AGENT-ID': this.agentId,
        'X-SESSION-ID': this.sessionId,
        'X-CONVERSATION-ID': conversationId
      }
    });

    if (!response.ok) {
      console.error('Failed to delete conversation:', conversationId);
      return false;
    }

    console.log('Conversation deleted successfully:', conversationId);

    // Clear the active conversation ID if it was the deleted conversation
    const currentActiveConversationId = this.getActiveConversationId();
    if (currentActiveConversationId === conversationId) {
      this.persistenceManager.remove(this.activeConversationPersistedId);
    }

    return true;
  }

  async deleteAllConversations(): Promise<boolean> {
    try {
      const response = await api({
        endpoint: 'conversations',
        method: 'DELETE',
        headers: {
          'X-AGENT-ID': this.agentId,
          'X-SESSION-ID': this.sessionId
        }
      });
      // A rejected request (401, 500, …) deleted nothing, so keep the local
      // state rather than showing the visitor an empty history.
      if (!response.ok) {
        console.error('Failed to delete all conversations:', response.status);
        return false;
      }
      this.setActiveConversationId(null);
      return true;
    } catch (error) {
      console.error('Error deleting all conversations:', error);
      return false;
    }
  }

  /** A conversation's messages. Throws when they can't be loaded. */
  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    const response = await api({
      endpoint: 'conversations/messages',
      method: 'GET',
      headers: {
        'X-AGENT-ID': this.agentId,
        'X-SESSION-ID': this.sessionId,
        'X-CONVERSATION-ID': conversationId,
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load messages (HTTP ${response.status})`);
    }

    return await response.json();
  }
}
