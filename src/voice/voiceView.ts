/**
 * The widget's voice mode: covers the chat window while a live voice call
 * runs. The orb follows the visitor's microphone while they talk and the
 * agent's voice while it answers; the status line and the captions say what
 * is happening; Mute and End sit at the bottom (Escape ends too).
 *
 * Finished turns are added to the thread as they are spoken; the server
 * saves them on its own, and once the call is over the conversation is
 * reloaded from the server so the messages carry their real ids.
 */
import api from '../api';
import { t } from '../i18n';
import { requestConversationTitle } from '../state/conversations';
import { createElement, createIcon } from '../ui';
import { CSS_CLASSES } from '../utils';
import type { ChatWidget } from '../widget';
import { AudioLevel } from './audioLevel';
import { VoiceOrb, type OrbMode } from './orb';
import {
  RealtimeCall,
  type VoiceCallStarted,
  type VoiceCallState,
  type VoiceTurnEvent
} from './realtimeCall';

/** How long "Call ended" shows before the view closes. */
const CLOSE_DELAY_MS = 1200;

/**
 * How long after the call the thread is reloaded: the server saves a reply
 * once the visitor's words are written down, a moment after the call ends.
 */
const SYNC_DELAY_MS = 2500;

/** Shown until the visitor's words are written down. */
const PENDING_TEXT = '…';

const VOICE_CLASSES = {
  VIEW: 'chatvia-widget-voice',
  TIMER: 'chatvia-widget-voice-timer',
  CENTER: 'chatvia-widget-voice-center',
  ORB: 'chatvia-widget-voice-orb',
  STATUS: 'chatvia-widget-voice-status',
  CAPTION: 'chatvia-widget-voice-caption',
  ERROR: 'chatvia-widget-voice-error',
  CONTROLS: 'chatvia-widget-voice-controls',
  BUTTON: 'chatvia-widget-voice-btn',
  MUTE: 'chatvia-widget-voice-mute',
  END: 'chatvia-widget-voice-end'
} as const;

export { VOICE_CLASSES };

/** POST voice for the active conversation; rejects with the server's message. */
async function openCall(widget: ChatWidget, sdp: string): Promise<VoiceCallStarted> {
  const response = await api({
    endpoint: 'voice',
    method: 'POST',
    headers: {
      'X-AGENT-ID': widget.agentId,
      'X-SESSION-ID': widget.sessionId,
      'X-CONVERSATION-ID': widget.getCurrentActiveConversationId()
    },
    body: JSON.stringify({ sdp })
  });

  const body = (await response.json().catch(() => ({}))) as Partial<VoiceCallStarted> & {
    message?: string;
  };

  if (!response.ok || !body.sdp || !body.call_id) {
    throw new Error(body.message || t('voice.errors.failed'));
  }

  return body as VoiceCallStarted;
}

async function hangUpCall(widget: ChatWidget, callId: string): Promise<void> {
  await api({
    endpoint: `voice/calls/${encodeURIComponent(callId)}`,
    method: 'DELETE',
    headers: { 'X-AGENT-ID': widget.agentId, 'X-SESSION-ID': widget.sessionId }
  });
}

export class VoiceView {
  readonly element: HTMLDivElement;

  private readonly widget: ChatWidget;
  private readonly call: RealtimeCall;
  private readonly orb: VoiceOrb;
  private readonly microphone = new AudioLevel();
  private readonly agentVoice = new AudioLevel();
  private readonly timer: HTMLDivElement;
  private readonly status: HTMLParagraphElement;
  private readonly caption: HTMLParagraphElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly endButton: HTMLButtonElement;
  private readonly onClosed: () => void;
  private clock: ReturnType<typeof setInterval> | null = null;
  private startedAt: number | null = null;
  private spoke = false;
  private closed = false;
  /** The provider's id of each spoken turn → its message bubble in the thread. */
  private readonly userBubbles = new Map<string, HTMLElement | null>();

  constructor(widget: ChatWidget, onClosed: () => void) {
    this.widget = widget;
    this.onClosed = onClosed;

    this.element = createElement('div', {
      className: VOICE_CLASSES.VIEW,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('voice.title')
    });

    this.timer = createElement('div', { className: VOICE_CLASSES.TIMER });

    const canvas = createElement('canvas', { className: VOICE_CLASSES.ORB, 'aria-hidden': 'true' });
    this.status = createElement('p', {
      className: VOICE_CLASSES.STATUS,
      role: 'status',
      'aria-live': 'polite'
    });
    this.caption = createElement('p', { className: VOICE_CLASSES.CAPTION, dir: 'auto' });
    const center = createElement('div', { className: VOICE_CLASSES.CENTER });
    center.append(canvas, this.status, this.caption);

    this.muteButton = createElement('button', {
      type: 'button',
      className: `${VOICE_CLASSES.BUTTON} ${VOICE_CLASSES.MUTE}`,
      'aria-label': t('voice.mute'),
      'aria-pressed': 'false'
    });
    this.muteButton.appendChild(createIcon('mic'));
    this.muteButton.addEventListener('click', () => this.call.toggleMute());

    this.endButton = createElement('button', {
      type: 'button',
      className: `${VOICE_CLASSES.BUTTON} ${VOICE_CLASSES.END}`,
      'aria-label': t('voice.end')
    });
    this.endButton.appendChild(createIcon('x'));
    this.endButton.addEventListener('click', () => void this.end());

    const controls = createElement('div', { className: VOICE_CLASSES.CONTROLS });
    controls.append(this.muteButton, this.endButton);

    this.element.append(this.timer, center, controls);
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        void this.end();
      }
    });

    this.call = new RealtimeCall({
      open: sdp => openCall(widget, sdp),
      hangUp: callId => hangUpCall(widget, callId),
      messages: {
        notSupported: t('voice.errors.not_supported'),
        microphoneDenied: t('voice.errors.microphone_denied'),
        microphoneNotFound: t('voice.errors.microphone_not_found'),
        busy: t('voice.errors.busy'),
        failed: t('voice.errors.failed')
      },
      onState: state => this.render(state),
      onCaption: (_who, text) => this.showCaption(text),
      onTurn: event => void this.addTurn(event),
      onStreams: (local, remote) => {
        this.microphone.attach(local);
        this.agentVoice.attach(remote);
      }
    });

    this.orb = new VoiceOrb(canvas, () => {
      if (this.call.state === 'speaking') return this.agentVoice.level();
      if (this.call.state === 'listening' && !this.call.muted) return this.microphone.level();
      return 0;
    });
  }

  /** Show the view in the chat window and start the call. */
  open(): void {
    this.widget.chatWindow.appendChild(this.element);
    this.orb.start();
    this.render('connecting');
    this.endButton.focus();
    this.clock = setInterval(() => this.renderTimer(), 1000);
    void this.call.start();
  }

  /** End the call, or close the view once it is over. */
  async end(): Promise<void> {
    if (this.call.isLive()) {
      await this.call.hangUp();
      return;
    }

    this.close();
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.clock !== null) clearInterval(this.clock);
    this.orb.stop();
    this.microphone.detach();
    this.agentVoice.detach();
    this.element.remove();
    this.onClosed();

    if (this.spoke) void this.syncAfterCall();
  }

  private render(state: VoiceCallState): void {
    const live = this.call.isLive();

    this.orb.mode = this.orbMode(state);
    this.orb.dimmed = this.call.muted || state === 'error' || state === 'ended';
    this.status.textContent = this.statusText(state);

    if (state === 'listening' && this.startedAt === null) this.startedAt = Date.now();

    if (state === 'error') {
      this.caption.className = VOICE_CLASSES.ERROR;
      this.caption.setAttribute('role', 'alert');
      this.caption.textContent = this.call.error ?? t('voice.errors.failed');
    }

    this.muteButton.hidden = !live;
    this.muteButton.disabled = state === 'connecting' || state === 'waiting';
    this.muteButton.setAttribute('aria-pressed', String(this.call.muted));
    this.muteButton.setAttribute(
      'aria-label',
      this.call.muted ? t('voice.unmute') : t('voice.mute')
    );
    this.muteButton.replaceChildren(createIcon(this.call.muted ? 'mic-off' : 'mic'));
    this.endButton.setAttribute('aria-label', live ? t('voice.end') : t('voice.close'));
    this.endButton.classList.toggle('chatvia-widget-voice-end-live', live);

    if (state === 'ended') setTimeout(() => this.close(), CLOSE_DELAY_MS);
  }

  /**
   * Live captions: keep the newest words in view as a long answer grows, and
   * fade the lines above once it outgrows the box.
   */
  private showCaption(text: string): void {
    this.caption.textContent = text;
    this.caption.classList.toggle(
      'chatvia-widget-voice-caption-overflow',
      this.caption.scrollHeight > this.caption.clientHeight + 1
    );
    this.caption.scrollTop = this.caption.scrollHeight;
  }

  private renderTimer(): void {
    if (this.startedAt === null) return;

    const seconds = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    this.timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  private orbMode(state: VoiceCallState): OrbMode {
    if (state === 'speaking') return 'speaking';
    if (state === 'listening') return 'listening';
    if (state === 'thinking' || state === 'connecting' || state === 'waiting') return 'thinking';
    return 'idle';
  }

  private statusText(state: VoiceCallState): string {
    switch (state) {
      case 'connecting':
      case 'waiting':
        return t('voice.connecting');
      case 'listening':
        return this.call.muted ? t('voice.muted') : t('voice.listening');
      case 'thinking':
        return t('voice.thinking');
      case 'speaking':
        return t('voice.speaking');
      case 'ended':
        return t('voice.ended');
      default:
        return '';
    }
  }

  /** Mirror a finished turn into the thread, in the order it was spoken. */
  private async addTurn(event: VoiceTurnEvent): Promise<void> {
    this.spoke = true;

    if (event.kind === 'user-started') {
      const message = await this.widget.addMessage(CSS_CLASSES.MESSAGE_USER, PENDING_TEXT, false);
      this.userBubbles.set(
        event.id,
        message?.querySelector<HTMLElement>(`.${CSS_CLASSES.MESSAGE_BUBBLE}`) ?? null
      );
    } else if (event.kind === 'user') {
      const bubble = this.userBubbles.get(event.id);
      if (bubble) bubble.textContent = event.text || PENDING_TEXT;
      else if (event.text)
        await this.widget.addMessage(CSS_CLASSES.MESSAGE_USER, event.text, false);
    } else {
      await this.widget.addMessage(CSS_CLASSES.MESSAGE_AGENT, event.text, false);
    }

    this.widget.hideStarters();
    this.widget.scrollToBottom();
  }

  /** The server's copy of the thread, once its last turn is saved; then a title. */
  private async syncAfterCall(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, SYNC_DELAY_MS));

    try {
      await this.widget.loadActiveConversation();
      await requestConversationTitle(this.widget);
    } catch (error) {
      console.warn('Could not reload the conversation after the voice call.', error);
    }
  }
}
