import { PersistenceManager } from './persistence';
import api from './api';

/** The session (and conversation) the server validated or created. */
export interface SessionInit {
  sessionId: string;
  conversationId: string | null | undefined;
  isNewSession: boolean;
  isNewConversation: boolean;
}

/** Response of POST sessions/init. */
interface SessionInitResponse {
  session_id?: string;
  conversation_id?: string | null;
  is_new_session?: boolean;
  is_new_conversation?: boolean;
}

export class SessionManager {
  agentId: string;
  persistedSessionId: string;
  persistedConversationId: string;
  persistenceManager: PersistenceManager;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.persistedSessionId = 'chat-widget-session-id';
    this.persistedConversationId = 'chat-widget-active-conversation-id'; // Existing key used by StorageManager

    this.persistenceManager = new PersistenceManager(agentId);
  }

  /**
   * Initialize session and conversation.
   * Always calls the backend to validate/create session and conversation.
   *
   * @returns null when the session could not be initialized
   */
  async startSession(): Promise<SessionInit | null> {
    try {
      const existingSessionId = this.getCurrentPersistedSessionId();
      const existingConversationId = this.getCurrentPersistedConversationId();

      const headers: Record<string, string> = {
        'X-AGENT-ID': this.agentId
      };

      // Include existing session if we have one (for HMAC validation)
      if (existingSessionId) {
        headers['X-SESSION-ID'] = existingSessionId;
        console.log('Sending existing session ID for validation:', existingSessionId);
      }

      // Include existing conversation if we have one (for validation)
      if (existingConversationId) {
        headers['X-CONVERSATION-ID'] = existingConversationId;
        console.log('Sending existing conversation ID for validation:', existingConversationId);
      }

      const response = await api({
        endpoint: 'sessions/init',
        method: 'POST',
        headers
      });

      if (!response.ok) {
        throw new Error('Failed to initialize session');
      }

      const data: SessionInitResponse = await response.json();

      if (!data.session_id) {
        throw new Error('No session ID returned from init');
      }

      // Update localStorage if session changed
      if (data.session_id !== existingSessionId) {
        console.log(
          data.is_new_session ? '✨ New session created:' : '🔄 Session restored from server:',
          data.session_id
        );
        this.persistenceManager.set(this.persistedSessionId, data.session_id);
      } else {
        console.log('✅ Session validated:', data.session_id);
      }

      // Note: Conversation ID persistence is handled by StorageManager.setActiveConversationId()
      // We just log the status here
      if (data.conversation_id) {
        if (data.conversation_id !== existingConversationId) {
          console.log(
            data.is_new_conversation
              ? '✨ New conversation created:'
              : '🔄 Conversation restored from server:',
            data.conversation_id
          );
        } else {
          console.log('✅ Conversation validated:', data.conversation_id);
        }
      }

      return {
        sessionId: data.session_id,
        conversationId: data.conversation_id,
        isNewSession: data.is_new_session || false,
        isNewConversation: data.is_new_conversation || false
      };
    } catch (error) {
      console.error('Error initializing session:', error);
      return null;
    }
  }

  getCurrentPersistedSessionId(): string | null {
    return this.persistenceManager.get(this.persistedSessionId);
  }

  getCurrentPersistedConversationId(): string | null {
    return this.persistenceManager.get(this.persistedConversationId);
  }
}
