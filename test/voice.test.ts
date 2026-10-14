import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeCall, type RealtimeCallOptions, type VoiceCallStarted, type VoiceTurnEvent } from '../src/voice/realtimeCall';

// The voice call's state machine, against a fake WebRTC peer: the microphone
// stays silent until the server joins (session.updated turns listening on),
// turns reach the thread in order, notices do not, and a server that never
// joins ends the call as busy.

class FakeChannel {
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

class FakePeer {
  channel = new FakeChannel();
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  remoteDescription: RTCSessionDescriptionInit | null = null;
  tracks: MediaStreamTrack[] = [];
  closed = false;
  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }
  createDataChannel() {
    return this.channel;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }
  close() {
    this.closed = true;
  }
}

function fakeStream() {
  const track = { enabled: true, stop: vi.fn() };
  return {
    track,
    stream: { getAudioTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream
  };
}

const started: VoiceCallStarted = {
  sdp: 'v=0 answer',
  call_id: 'call-1',
  conversation_id: 'conv-1',
  max_seconds: 600,
  join_timeout: 20
};

const messages = {
  notSupported: 'not supported',
  microphoneDenied: 'mic denied',
  microphoneNotFound: 'no mic',
  busy: 'busy',
  failed: 'failed'
};

function setup(overrides: Partial<RealtimeCallOptions> = {}) {
  const peer = new FakePeer();
  const mic = fakeStream();
  const turns: VoiceTurnEvent[] = [];
  const open = vi.fn(async () => started);
  const hangUp = vi.fn(async () => {});
  const call = new RealtimeCall({
    open,
    hangUp,
    messages,
    onTurn: event => turns.push(event),
    createPeer: () => peer as unknown as RTCPeerConnection,
    getUserMedia: async () => mic.stream,
    createPlayer: () => ({ autoplay: false, srcObject: null }) as unknown as HTMLAudioElement,
    ...overrides
  });

  return { call, peer, mic, turns, open, hangUp };
}

describe('RealtimeCall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the offer, applies the answer and waits with the microphone silent', async () => {
    const { call, peer, mic, open } = setup();

    await call.start();

    expect(open).toHaveBeenCalledWith('v=0 offer');
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'v=0 answer' });
    expect(call.state).toBe('waiting');
    expect(mic.track.enabled).toBe(false);
  });

  it('opens the microphone once the server turns listening on', async () => {
    const { call, peer, mic } = setup();
    await call.start();

    peer.channel.emit({ type: 'session.updated', session: { audio: { input: { turn_detection: { type: 'semantic_vad' } } } } });

    expect(call.state).toBe('listening');
    expect(mic.track.enabled).toBe(true);
  });

  it('ignores a session update that does not turn listening on', async () => {
    const { call, peer } = setup();
    await call.start();

    peer.channel.emit({ type: 'session.updated', session: { audio: { input: { turn_detection: null } } } });

    expect(call.state).toBe('waiting');
  });

  it('ends as busy and hangs up when the server never joins', async () => {
    const { call, hangUp } = setup();
    await call.start();

    await vi.advanceTimersByTimeAsync(started.join_timeout * 1000);

    expect(call.state).toBe('error');
    expect(call.error).toBe('busy');
    expect(hangUp).toHaveBeenCalledWith('call-1');
  });

  it('passes the turns to the thread in order and leaves notices out', async () => {
    const { call, peer, turns } = setup();
    await call.start();
    peer.channel.emit({ type: 'session.updated', session: { audio: { input: { turn_detection: {} } } } });

    peer.channel.emit({ type: 'input_audio_buffer.committed', item_id: 'item-1' });
    peer.channel.emit({
      type: 'response.done',
      response: { output: [{ type: 'message', content: [{ type: 'output_audio', transcript: 'We open at nine.' }] }] }
    });
    peer.channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: ' When do you open? ' });
    peer.channel.emit({
      type: 'response.done',
      response: { metadata: { notice: '1' }, output: [{ type: 'message', content: [{ transcript: 'Goodbye.' }] }] }
    });

    expect(turns).toEqual([
      { kind: 'user-started', id: 'item-1' },
      { kind: 'agent', text: 'We open at nine.' },
      { kind: 'user', id: 'item-1', text: 'When do you open?' }
    ]);
  });

  it('follows who is talking', async () => {
    const { call, peer } = setup();
    await call.start();
    peer.channel.emit({ type: 'session.updated', session: { audio: { input: { turn_detection: {} } } } });

    peer.channel.emit({ type: 'input_audio_buffer.speech_stopped' });
    expect(call.state).toBe('thinking');

    peer.channel.emit({ type: 'response.output_audio_transcript.delta', delta: 'Hi' });
    expect(call.state).toBe('speaking');

    peer.channel.emit({ type: 'output_audio_buffer.stopped' });
    expect(call.state).toBe('listening');
  });

  it('mutes and unmutes the microphone', async () => {
    const { call, peer, mic } = setup();
    await call.start();
    peer.channel.emit({ type: 'session.updated', session: { audio: { input: { turn_detection: {} } } } });

    call.toggleMute();
    expect(mic.track.enabled).toBe(false);

    call.toggleMute();
    expect(mic.track.enabled).toBe(true);
  });

  it('hangs up on the server and closes the peer', async () => {
    const { call, peer, mic, hangUp } = setup();
    await call.start();

    await call.hangUp();

    expect(hangUp).toHaveBeenCalledWith('call-1');
    expect(peer.closed).toBe(true);
    expect(peer.channel.closed).toBe(true);
    expect(mic.track.stop).toHaveBeenCalled();
    expect(call.state).toBe('ended');
  });

  it('shows why the microphone could not be used', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const { call, open } = setup({ getUserMedia: async () => Promise.reject(denied) });

    await call.start();

    expect(call.state).toBe('error');
    expect(call.error).toBe('mic denied');
    expect(open).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the call is refused", async () => {
    const { call, peer } = setup({ open: async () => Promise.reject(new Error('Voice is busy right now.')) });

    await call.start();

    expect(call.state).toBe('error');
    expect(call.error).toBe('Voice is busy right now.');
    expect(peer.closed).toBe(true);
  });
});
