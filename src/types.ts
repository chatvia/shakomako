/**
 * Shapes of the data the widget exchanges with the Chatvia API and with the
 * embedding page: agent settings, conversations, messages, stream events and
 * the `window.chatvia` global. Types only; this module has no runtime code.
 */

import type { EndpointOverrides } from './endpoints';
import type { ThemePreference } from './state/config';
import type { HandoffMode } from './state/handoff';
import type { BarPlacement, WidgetMode } from './widget';

// ========================================
// Agent settings (GET agents/settings)
// ========================================

/** Agent-authored text keyed by locale, e.g. `{ en: 'Hello', fr: 'Bonjour' }`. */
export type LocalizedText = Record<string, string>;

/** A conversation starter: a plain string (legacy) or a localizable object. */
export type Starter =
  | string
  | { text?: string; icon?: string | null; translations?: LocalizedText };

/** A teaser bubble shown next to the launcher: a string, or a legacy object. */
export type TeaserBubble = string | { text?: string };

export interface BrandingSettings {
  enabled?: boolean;
  name?: string;
  url?: string;
  logo_url?: string;
}

/** Where the server's live-chat (Reverb) server runs; null fields are unset. */
export interface ReverbSettings {
  key?: string | null;
  host?: string | null;
  port?: string | number | null;
  scheme?: string | null;
}

export interface WidgetSettings {
  /** Per-surface kill switches (dashboard → Deploy). Absent means enabled. */
  widget_enabled?: boolean;
  bar_enabled?: boolean;
  /** Protected agents need a signed bootstrap token (embed data-auth). */
  protected?: boolean;

  title?: string;
  logo_url?: string | null;
  avatar_url?: string | null;
  /** Brand palette name and shade, e.g. `blue` and `600`. */
  color_theme?: string | null;
  color_shade?: string | number | null;
  /** Owner's theme ('auto' | 'light' | 'dark'); the widget writes back the resolved mode. */
  theme?: string;
  composer_placeholder?: string | null;
  welcome_message?: string | null;
  chat_footer_text?: string | null;
  privacy_policy_url?: string | null;
  text_translations?: {
    title?: LocalizedText;
    composer_placeholder?: LocalizedText;
    welcome_message?: LocalizedText;
  } | null;
  starters?: Starter[];
  bubbles?: TeaserBubble[];
  /** Translations for `bubbles`, index for index. */
  bubble_translations?: Array<LocalizedText | null | undefined>;

  /** The API sends 'small' | 'medium' | 'large'; the widget stores the CSS class. */
  window_size?: string;
  /** Bubble corner in a left-to-right layout ('bottom-left' | 'bottom-right'). */
  position?: string | null;
  bar_placement?: BarPlacement | string | null;
  is_fullscreen?: boolean;
  show_on_load?: boolean;
  show_on_load_delay?: number;
  keyboard_trigger?: string | null;

  /** Workspace-wide gate for the "Powered by" footer (remove-branding add-on). */
  chatvia_branding?: boolean;
  branding?: BrandingSettings | null;

  allow_file_uploads?: boolean;
  /** The voice-conversation button: on for the agent and set up on the server. */
  voice_conversation?: boolean;
  max_files_per_chat?: number;

  reverb?: ReverbSettings | null;
}

// ========================================
// Conversations and messages
// ========================================

/** A file the visitor attached to a message (POST conversations/attachments). */
export interface Attachment {
  id: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  url: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'agent';

/** Feedback as the API stores it; never a boolean. */
export type MessageFeedback = 'positive' | 'negative';

/** Unix seconds, Unix milliseconds or an ISO 8601 string. */
export type MessageTimestamp = string | number;

export interface FormOption {
  value?: string | number | boolean | null;
  label?: string | null;
}

/** One field of a form artifact, as a FormKit schema node. */
export interface FormSchemaNode {
  $formkit?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  help?: string;
  /** Pipe-separated FormKit rules, e.g. `required|email`. */
  validation?: string;
  multiple?: boolean;
  options?: FormOption[];
}

/** A fillable form a tool produced mid-conversation (RenderFormTool). */
export interface FormArtifact {
  form_instance_id: string;
  status?: 'pending' | 'submitted' | 'expired' | string;
  title?: string;
  subtitle?: string;
  submit_label?: string;
  success_message?: string;
  schema?: FormSchemaNode[];
}

/** Structured output a tool attached to a message. Only forms are rendered. */
export interface MessageArtifact {
  kind: 'form' | string;
  data?: FormArtifact;
}

export interface MessageMetadata {
  artifacts?: MessageArtifact[];
  attachments?: Attachment[];
}

/** Options for rendering one message (see state/messages.ts addMessage). */
export interface AddMessageOptions {
  messageId?: string | null;
  feedback?: MessageFeedback | null;
  timestamp?: MessageTimestamp;
  /** From a live human agent rather than the AI. */
  isHuman?: boolean;
  hideActions?: boolean;
  readAt?: string | null;
  attachments?: Attachment[];
  formArtifacts?: FormArtifact[];
  metadata?: MessageMetadata;
  senderName?: string;
}

/**
 * A message in a conversation. The API returns `{ id, role, content, … }`;
 * messages added during the session carry the same fields plus the legacy
 * `type` (CSS class) and `text`.
 */
export interface ChatMessage {
  id?: string | null;
  role?: MessageRole | string;
  content: string;
  type?: string;
  text?: string;
  feedback?: MessageFeedback | null;
  timestamp?: MessageTimestamp;
  created_at?: MessageTimestamp;
  read_at?: string | null;
  attachments?: Attachment[];
  metadata?: MessageMetadata;
  options?: AddMessageOptions;
}

export interface Conversation {
  id: string;
  title?: string | null;
  /** Unix seconds. */
  timestamp?: number;
  messages?: ChatMessage[];
  hasUserInteraction?: boolean;
  welcomeShown?: boolean;
}

// ========================================
// Streaming and live-agent handoff
// ========================================

/**
 * A source an agent reply was given, as the server streams it: its name, the
 * page of a PDF, and a public link for a website page or a video.
 */
export interface StreamSource {
  id: string | null;
  label: string;
  kind: string;
  url: string | null;
  page: number | null;
}

/** Lifecycle of a function or MCP tool call during a streamed turn. */
export interface ToolEvent {
  type?: string;
  phase?: 'start' | 'end';
  tool_call_id?: string;
  kind?: string;
  label?: string;
  /** Phrase to show while the tool runs, e.g. "Searching the web…". */
  activity_label?: string;
  /** Builtin capability (forms, charts, leads): no activity indicator. */
  internal?: boolean;
  artifacts?: MessageArtifact[];
}

/** A change of who answers the conversation, from the stream or the WebSocket. */
export interface HandoffEventData {
  status?: string;
  conversation_id?: string;
  admin_name?: string | null;
  admin_id?: string | number | null;
  message?: string;
}

/** One message the stream client hands to the widget. */
export interface StreamMessage extends ToolEvent, HandoffEventData {
  type?: string;
  id?: string | null;
  message_id?: string;
  content?: string;
  code?: string;
  handoff?: HandoffEventData;
  sources?: StreamSource[];
}

/** Payload of a `handoff` event fired to host-page listeners. */
export interface HandoffWidgetEvent extends HandoffEventData {
  mode: HandoffMode;
}

// ========================================
// The `window.chatvia` global
// ========================================

/** A command queued before the bundle loaded, e.g. `chatvia('open')`. */
export type QueuedCommand = ArrayLike<unknown> & Iterable<unknown>;

export type WidgetEventListener = (data?: unknown) => void;

/** Fires a widget event ('open', 'close', 'ready', 'handoff') to host-page listeners. */
export type WidgetEventEmitter = (event: string, data?: unknown) => void;

/**
 * `window.chatvia` before the bundle loads: the command-queue function from the
 * embed snippet, carrying the embed tag's settings. Also the shape left behind
 * when the widget fails to start.
 */
export interface ChatviaStub {
  (...args: unknown[]): void;
  q?: QueuedCommand[];
  initialized?: boolean;
  error?: string;
  agentId?: string | null;
  mode?: WidgetMode;
  language?: string;
  theme?: ThemePreference | null;
  mountId?: string;
  auth?: string;
  endpoints?: EndpointOverrides;
}

/** `window.chatvia` once the widget has started: its public API. */
export interface ChatviaApi {
  agentId: string;
  init(): Promise<void>;
  open(): void;
  close(): void;
  /** Toggles the chat window and returns whether it is now open. */
  toggle(): boolean;
  isOpen(): boolean;
  send(message: string): Promise<void>;
  /** Alias for send(), kept for backward compatibility. */
  sendMessage(message: string): Promise<void>;
  newChat(): Promise<void>;
  destroy(): void;
  isHumanMode(): boolean;
  isPending(): boolean;
  getHandoffMode(): HandoffMode;
  getAdminName(): string | null | undefined;
  requestHuman(): Promise<null>;
  /** Subscribes to a widget event; returns the matching unsubscribe function. */
  on(event: string, callback: WidgetEventListener): () => void;
  /** Removes one listener, or every listener for the event when none is given. */
  off(event: string, callback?: WidgetEventListener): void;
  /** Legacy function-style API, `chatvia('open')`: a command name, then its arguments. */
  __call(...args: unknown[]): Promise<unknown>;
}
