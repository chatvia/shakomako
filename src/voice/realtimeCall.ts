/**
 * One live voice call with the agent. The visitor's microphone and the
 * agent's voice travel over WebRTC straight to the speech model; the Chatvia
 * server only opens the call (it answers our offer) and joins it to steer it.
 * The data channel ("oai-events") carries the call's events, which drive the
 * state, the captions and the transcript.
 *
 * The microphone stays silent until the server has joined (it turns on
 * listening, seen here as `session.updated`), so nothing is answered before
 * the server can check and save it. If it does not join in time, the call
 * ends as "busy".
 */

export type VoiceCallState =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'ended'
  | 'error';

/** POST voice: the call the server opened. */
export interface VoiceCallStarted {
  /** The WebRTC answer to apply. */
  sdp: string;
  call_id: string;
  conversation_id: string;
  max_seconds: number;
  /** Seconds to wait for the server to join the call before giving up. */
  join_timeout: number;
}

/** A line for the chat thread: the visitor's turn starts, their words arrive, or the agent replied. */
export type VoiceTurnEvent =
  | { kind: 'user-started'; id: string }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; text: string };

export interface VoiceCallMessages {
  notSupported: string;
  microphoneDenied: string;
  microphoneNotFound: string;
  busy: string;
  failed: string;
}

export interface RealtimeCallOptions {
  /** Open the call on the server for this offer. Rejects with the message to show. */
  open: (sdp: string) => Promise<VoiceCallStarted>;
  /** Hang the call up on the server. */
  hangUp: (callId: string) => Promise<void>;
  messages: VoiceCallMessages;
  onState?: (state: VoiceCallState, error: string | null) => void;
  onCaption?: (who: 'user' | 'agent', text: string) => void;
  onTurn?: (event: VoiceTurnEvent) => void;
  /** The microphone's and the agent's audio, for the level meters. */
  onStreams?: (local: MediaStream | null, remote: MediaStream | null) => void;
  /** Seams for tests. */
  createPeer?: () => RTCPeerConnection;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPlayer?: () => HTMLAudioElement;
}

interface ServerEvent {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  session?: { audio?: { input?: { turn_detection?: unknown } } };
  response?: {
    metadata?: Record<string, string> | null;
    output?: { type?: string; content?: { transcript?: string; text?: string }[] }[];
  };
}

/** Seconds past the call's limit after which the browser hangs up on its own. */
const LIMIT_GRACE_SECONDS = 30;

const LIVE_STATES: VoiceCallState[] = [
  'connecting',
  'waiting',
  'listening',
  'thinking',
  'speaking'
];

export function isVoiceCallSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'RTCPeerConnection' in window &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class RealtimeCall {
  state: VoiceCallState = 'idle';
  error: string | null = null;
  muted = false;

  private readonly options: RealtimeCallOptions;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private player: HTMLAudioElement | null = null;
  private local: MediaStream | null = null;
  private remote: MediaStream | null = null;
  private callId: string | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private userCaption = '';
  private agentCaption = '';

  constructor(options: RealtimeCallOptions) {
    this.options = options;
  }

  isLive(): boolean {
    return LIVE_STATES.includes(this.state);
  }

  async start(): Promise<void> {
    if (this.isLive()) return;

    this.error = null;
    this.setState('connecting');

    const getUserMedia =
      this.options.getUserMedia ??
      (isVoiceCallSupported()
        ? (c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c)
        : null);

    if (!getUserMedia) {
      this.fail(this.options.messages.notSupported);
      return;
    }

    try {
      this.local = await getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      this.fail(
        name === 'NotFoundError'
          ? this.options.messages.microphoneNotFound
          : this.options.messages.microphoneDenied
      );
      return;
    }

    // Silent until the server has joined the call.
    const track = this.microphone();
    if (track) track.enabled = false;
    this.options.onStreams?.(this.local, null);

    try {
      const peer = (this.options.createPeer ?? (() => new RTCPeerConnection()))();
      this.peer = peer;
      this.player = (this.options.createPlayer ?? (() => new Audio()))();
      this.player.autoplay = true;

      peer.ontrack = event => {
        this.remote = event.streams[0] ?? null;
        if (this.player) this.player.srcObject = this.remote;
        this.options.onStreams?.(this.local, this.remote);
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'closed'].includes(peer.connectionState) && this.isLive()) this.close();
      };

      if (track && this.local) peer.addTrack(track, this.local);

      this.channel = peer.createDataChannel('oai-events');
      this.channel.onmessage = message => this.onServerEvent(message.data);
      this.channel.onclose = () => {
        if (this.isLive()) this.close();
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const call = await this.options.open(offer.sdp ?? '');
      // Ended while the server answered.
      if (!this.peer) return;

      this.callId = call.call_id;
      await peer.setRemoteDescription({ type: 'answer', sdp: call.sdp });

      this.setState('waiting');
      this.readyTimer = setTimeout(() => {
        if (this.state === 'waiting') {
          void this.hangUp();
          this.fail(this.options.messages.busy);
        }
      }, call.join_timeout * 1000);
      this.limitTimer = setTimeout(
        () => void this.hangUp(),
        (call.max_seconds + LIMIT_GRACE_SECONDS) * 1000
      );
    } catch (err) {
      this.close();
      this.fail(err instanceof Error && err.message ? err.message : this.options.messages.failed);
    }
  }

  toggleMute(): void {
    this.muted = !this.muted;

    const track = this.microphone();
    if (track && this.state !== 'waiting') track.enabled = !this.muted;
    this.setState(this.state);
  }

  /** End the call: the server hangs up the provider's side too. */
  async hangUp(): Promise<void> {
    const id = this.callId;
    this.close();

    if (id) {
      try {
        await this.options.hangUp(id);
      } catch {
        // The server ends the call on its own at the latest by its time limit.
      }
    }
  }

  /** Handles one data-channel event (public for tests). */
  onServerEvent(raw: unknown): void {
    let event: ServerEvent;

    try {
      event = JSON.parse(String(raw)) as ServerEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case 'session.updated':
        if (event.session?.audio?.input?.turn_detection) this.ready();
        break;
      case 'input_audio_buffer.speech_started':
        this.ready();
        this.userCaption = '';
        this.caption('user', '');
        this.setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.setState('thinking');
        break;
      case 'input_audio_buffer.committed':
        if (event.item_id) this.options.onTurn?.({ kind: 'user-started', id: event.item_id });
        break;
      case 'conversation.item.input_audio_transcription.delta':
        this.userCaption += event.delta ?? '';
        this.caption('user', this.userCaption);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        this.userCaption = event.transcript ?? this.userCaption;
        this.caption('user', this.userCaption);
        if (event.item_id) {
          this.options.onTurn?.({
            kind: 'user',
            id: event.item_id,
            text: (event.transcript ?? '').trim()
          });
        }
        break;
      case 'response.created':
        this.agentCaption = '';
        if (this.state !== 'speaking') this.setState('thinking');
        break;
      case 'response.output_audio_transcript.delta':
        this.agentCaption += event.delta ?? '';
        this.caption('agent', this.agentCaption);
        this.setState('speaking');
        break;
      case 'output_audio_buffer.started':
        this.setState('speaking');
        break;
      case 'output_audio_buffer.stopped':
        if (this.isLive() && this.state !== 'waiting') this.setState('listening');
        break;
      case 'response.done':
        this.onResponseDone(event.response);
        break;
    }
  }

  /** A finished reply goes to the thread; notices ("let me check", goodbye, "too busy") do not. */
  private onResponseDone(response: ServerEvent['response']): void {
    if (!response || response.metadata?.notice) return;

    const text = (response.output ?? [])
      .filter(item => item.type === 'message')
      .flatMap(item => item.content ?? [])
      .map(part => part.transcript ?? part.text ?? '')
      .join(' ')
      .trim();

    if (text) this.options.onTurn?.({ kind: 'agent', text });
  }

  /** The server joined and turned listening on: open the microphone. */
  private ready(): void {
    if (this.state !== 'waiting') return;

    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }

    const track = this.microphone();
    if (track) track.enabled = !this.muted;

    this.setState('listening');
  }

  private microphone(): MediaStreamTrack | undefined {
    return this.local?.getAudioTracks()[0];
  }

  private caption(who: 'user' | 'agent', text: string): void {
    this.options.onCaption?.(who, text);
  }

  private setState(state: VoiceCallState): void {
    this.state = state;
    this.options.onState?.(state, this.error);
  }

  private close(): void {
    for (const timer of [this.readyTimer, this.limitTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.readyTimer = null;
    this.limitTimer = null;

    if (this.channel) {
      this.channel.onclose = null;
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }

    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
      this.peer = null;
    }

    this.local?.getTracks().forEach(track => track.stop());
    this.local = null;
    this.remote = null;
    this.options.onStreams?.(null, null);

    if (this.player) {
      this.player.srcObject = null;
      this.player = null;
    }

    this.callId = null;
    if (this.state !== 'error') this.setState('ended');
  }

  private fail(message: string): void {
    this.error = message;
    this.setState('error');
    this.close();
  }
}
