/**
 * Voice input for the composer, like the hosted chat's mic: the first press
 * records the microphone, the second stops and has the widget API write the
 * recording down (POST transcribe). The text then goes into the composer for
 * the visitor to read before they send it.
 */

export type DictationState = 'idle' | 'recording' | 'transcribing';

export interface DictationMessages {
  microphoneDenied: string;
  microphoneNotFound: string;
  microphoneFailed: string;
  failed: string;
}

export interface DictationOptions {
  /** Writes the recording down; resolves to '' when nothing was heard. */
  transcribe: (audio: Blob, filename: string) => Promise<string>;
  messages: DictationMessages;
  onState?: (state: DictationState) => void;
  /** Seams for tests. */
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
}

/** Container formats to record in, best first (Safari only does mp4). */
const MIME_TYPES = ['audio/webm', 'audio/mp4'];

/** How often the recorder hands over a chunk while recording. */
const CHUNK_INTERVAL_MS = 100;

export function isDictationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export class Dictation {
  state: DictationState = 'idle';

  private readonly options: DictationOptions;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(options: DictationOptions) {
    this.options = options;
  }

  /** Asks for the microphone and starts recording. Rejects with the message to show. */
  async start(): Promise<void> {
    if (this.state !== 'idle') return;

    const getUserMedia =
      this.options.getUserMedia ??
      (constraints => navigator.mediaDevices.getUserMedia(constraints));
    const createRecorder =
      this.options.createRecorder ?? ((stream, options) => new MediaRecorder(stream, options));

    try {
      this.stream = await getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
      this.chunks = [];
      this.recorder = createRecorder(this.stream, { mimeType: this.pickMimeType() });
      this.recorder.ondataavailable = event => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      this.recorder.start(CHUNK_INTERVAL_MS);
    } catch (error) {
      this.release();
      throw new Error(this.microphoneError(error), { cause: error });
    }

    this.setState('recording');
  }

  /**
   * Stops recording and writes it down. Resolves with the text, or '' when
   * nothing was recorded or heard; rejects with the message to show.
   */
  async stop(): Promise<string> {
    if (this.state !== 'recording') return '';

    const audio = await this.finishRecording();
    if (!audio) {
      this.setState('idle');
      return '';
    }

    this.setState('transcribing');
    try {
      const extension = audio.type.includes('mp4') ? 'mp4' : 'webm';
      return (await this.options.transcribe(audio, `recording.${extension}`)).trim();
    } catch (error) {
      throw new Error(this.options.messages.failed, { cause: error });
    } finally {
      this.setState('idle');
    }
  }

  /** Stops without keeping the audio (the widget closed or was torn down). */
  cancel(): void {
    if (this.state !== 'recording') return;

    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop();
    }
    this.release();
    this.setState('idle');
  }

  /** Resolves (from the recorder's `stop` event) with the recorded audio, or null. */
  private finishRecording(): Promise<Blob | null> {
    return new Promise(resolve => {
      const recorder = this.recorder;
      if (!recorder || recorder.state === 'inactive') {
        this.release();
        resolve(null);
        return;
      }

      recorder.onstop = () => {
        const chunks = this.chunks;
        this.release();
        resolve(
          chunks.length > 0 ? new Blob(chunks, { type: recorder.mimeType || MIME_TYPES[0] }) : null
        );
      };
      recorder.stop();
    });
  }

  private pickMimeType(): string {
    const isTypeSupported =
      this.options.isTypeSupported ?? (type => MediaRecorder.isTypeSupported(type));
    return MIME_TYPES.find(type => isTypeSupported(type)) ?? MIME_TYPES[MIME_TYPES.length - 1];
  }

  private microphoneError(error: unknown): string {
    const { messages } = this.options;
    switch ((error as { name?: string } | null)?.name) {
      case 'NotAllowedError':
        return messages.microphoneDenied;
      case 'NotFoundError':
        return messages.microphoneNotFound;
      default:
        return messages.microphoneFailed;
    }
  }

  /** Turns the microphone off. */
  private release(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }

  private setState(state: DictationState): void {
    this.state = state;
    this.options.onState?.(state);
  }
}
