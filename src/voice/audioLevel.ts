/**
 * The live loudness of an audio stream, 0–1: the average of an analyser's
 * frequency bins, read whenever the orb draws a frame. One meter per stream
 * (the visitor's microphone, the agent's voice).
 */

/** Analyser resolution: 128 frequency bins, plenty for a loudness value. */
const FFT_SIZE = 256;

export class AudioLevel {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private bins: Uint8Array<ArrayBuffer> | null = null;

  /** Start measuring a stream (replacing the one before); null stops. */
  attach(stream: MediaStream | null): void {
    this.detach();
    if (!stream || typeof AudioContext === 'undefined') return;

    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    // A context created outside a user gesture starts suspended.
    void this.context.resume();
  }

  detach(): void {
    this.source?.disconnect();
    this.source = null;
    this.analyser = null;
    this.bins = null;

    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  level(): number {
    if (!this.analyser || !this.bins) return 0;

    this.analyser.getByteFrequencyData(this.bins);
    return this.bins.reduce((sum, value) => sum + value, 0) / this.bins.length / 255;
  }
}
