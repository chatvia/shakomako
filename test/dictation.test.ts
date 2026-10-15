import { describe, it, expect, vi } from 'vitest';
import { Dictation, type DictationOptions, type DictationState } from '../src/voice/dictation';

// The composer mic's recorder, against a fake microphone and MediaRecorder:
// a press records, the next one stops and writes the recording down, and the
// microphone is let go whatever happens.

class FakeRecorder {
  state: RecordingState = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly mimeType: string;

  constructor(
    readonly heard: boolean,
    options: MediaRecorderOptions
  ) {
    this.mimeType = options.mimeType ?? '';
  }

  start() {
    this.state = 'recording';
  }

  // Like a real recorder: the last chunk arrives, then `stop`.
  stop() {
    this.state = 'inactive';
    if (this.heard) this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const messages = {
  microphoneDenied: 'mic denied',
  microphoneNotFound: 'no mic',
  microphoneFailed: 'mic failed',
  failed: 'transcription failed'
};

function setup(overrides: Partial<DictationOptions> = {}, { heard = true } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorders: FakeRecorder[] = [];
  const states: DictationState[] = [];
  const transcribe = vi.fn(async () => '  hello there ');
  const getUserMedia = vi.fn(async () => stream);

  const dictation = new Dictation({
    transcribe,
    messages,
    onState: state => states.push(state),
    getUserMedia,
    createRecorder: (_stream, options) => {
      const recorder = new FakeRecorder(heard, options);
      recorders.push(recorder);
      return recorder as unknown as MediaRecorder;
    },
    isTypeSupported: type => type === 'audio/webm',
    ...overrides
  });

  return { dictation, track, recorders, states, transcribe, getUserMedia };
}

describe('Dictation', () => {
  it('records, then writes the recording down and lets the microphone go', async () => {
    const { dictation, track, recorders, states, transcribe, getUserMedia } = setup();

    await dictation.start();
    expect(dictation.state).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: true }) });
    expect(recorders[0].mimeType).toBe('audio/webm');
    expect(track.stop).not.toHaveBeenCalled();

    await expect(dictation.stop()).resolves.toBe('hello there');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), 'recording.webm');
    expect(track.stop).toHaveBeenCalled();
    expect(dictation.state).toBe('idle');
    expect(states).toEqual(['recording', 'transcribing', 'idle']);
  });

  it('records mp4 where the browser cannot record webm', async () => {
    const { dictation, recorders, transcribe } = setup({ isTypeSupported: type => type === 'audio/mp4' });

    await dictation.start();
    await dictation.stop();

    expect(recorders[0].mimeType).toBe('audio/mp4');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), 'recording.mp4');
  });

  it.each([
    ['NotAllowedError', 'mic denied'],
    ['NotFoundError', 'no mic'],
    ['NotReadableError', 'mic failed']
  ])('says why the microphone could not start (%s)', async (name, message) => {
    const error = Object.assign(new Error('nope'), { name });
    const { dictation, states } = setup({ getUserMedia: vi.fn(async () => Promise.reject(error)) });

    await expect(dictation.start()).rejects.toThrow(message);
    expect(dictation.state).toBe('idle');
    expect(states).toEqual([]);
  });

  it('lets the microphone go and says so when the recording cannot be written down', async () => {
    const { dictation, track } = setup({ transcribe: vi.fn(async () => Promise.reject(new Error('500'))) });

    await dictation.start();
    await expect(dictation.stop()).rejects.toThrow('transcription failed');
    expect(track.stop).toHaveBeenCalled();
    expect(dictation.state).toBe('idle');
  });

  it('sends nothing when nothing was recorded', async () => {
    const { dictation, transcribe, states } = setup({}, { heard: false });

    await dictation.start();
    await expect(dictation.stop()).resolves.toBe('');
    expect(transcribe).not.toHaveBeenCalled();
    expect(states).toEqual(['recording', 'idle']);
  });

  it('drops the recording when cancelled', async () => {
    const { dictation, track, transcribe } = setup();

    await dictation.start();
    dictation.cancel();

    expect(track.stop).toHaveBeenCalled();
    expect(dictation.state).toBe('idle');
    await expect(dictation.stop()).resolves.toBe('');
    expect(transcribe).not.toHaveBeenCalled();
  });
});
