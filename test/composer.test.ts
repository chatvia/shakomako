import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { ChatWidget } from '../src/widget';
import { initI18n } from '../src/i18n';
import { CSS_CLASSES } from '../src/utils';
import type { WidgetSettings } from '../src/types';

// `_createInputContainer` only reads `this.settings` / `this.options` /
// `this.attachments`, so we exercise it on a bare prototype instance instead
// of booting the whole widget (which needs network, storage, sessions…).
function buildComposer(settings: WidgetSettings): HTMLDivElement {
  const stub = Object.create(ChatWidget.prototype);
  stub.settings = settings;
  stub.options = {};
  stub.attachments = [];
  return stub._createInputContainer();
}

const attachSelector = '.' + CSS_CLASSES.ATTACH_BUTTON;

describe('composer file-upload gate', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it('shows the paperclip when allow_file_uploads is true', () => {
    const composer = buildComposer({ allow_file_uploads: true });
    expect(composer.querySelector(attachSelector)).not.toBeNull();
    expect(composer.querySelector('input[type="file"]')).not.toBeNull();
  });

  it('hides the paperclip and the file input when allow_file_uploads is false', () => {
    const composer = buildComposer({ allow_file_uploads: false });
    expect(composer.querySelector(attachSelector)).toBeNull();
    expect(composer.querySelector('input[type="file"]')).toBeNull();
  });

  it('defaults to showing the paperclip when the flag is absent', () => {
    // Backend defaults allow_file_uploads to true, so a missing flag must not
    // silently disable uploads.
    const composer = buildComposer({});
    expect(composer.querySelector(attachSelector)).not.toBeNull();
  });
});

const voiceSelector = '.' + CSS_CLASSES.VOICE_BUTTON;

describe('composer voice-conversation gate', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // jsdom has no WebRTC; a browser that can make calls has both of these.
  function stubWebRtc(): void {
    vi.stubGlobal('RTCPeerConnection', class {});
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn() } });
  }

  it('shows the voice button when the agent offers voice conversations', () => {
    stubWebRtc();
    const composer = buildComposer({ voice_conversation: true });
    const button = composer.querySelector(voiceSelector);
    expect(button).not.toBeNull();
    // Between the textarea and send, so the empty-input send style still applies.
    const textarea = composer.querySelector('textarea')!;
    const send = composer.querySelector('.' + CSS_CLASSES.SEND_BUTTON)!;
    expect(textarea.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button!.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the voice button when the agent does not offer them', () => {
    stubWebRtc();
    expect(buildComposer({ voice_conversation: false }).querySelector(voiceSelector)).toBeNull();
    expect(buildComposer({}).querySelector(voiceSelector)).toBeNull();
  });

  it('hides the voice button in a browser without WebRTC', () => {
    expect(buildComposer({ voice_conversation: true }).querySelector(voiceSelector)).toBeNull();
  });
});

const micSelector = '.' + CSS_CLASSES.MIC_BUTTON;

describe('composer voice input (dictation)', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // jsdom cannot record; a browser that can has MediaRecorder and getUserMedia.
  function stubRecording(): { stopTrack: ReturnType<typeof vi.fn> } {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported = (type: string) => type === 'audio/webm';
        state = 'inactive';
        mimeType = 'audio/webm';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        start() {
          this.state = 'recording';
        }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
          this.onstop?.();
        }
      }
    );
    vi.stubGlobal('RTCPeerConnection', class {});
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: { getUserMedia: vi.fn(async () => stream) }
    });
    return { stopTrack };
  }

  /** A composer on a bare widget whose transcription answers `transcribe`. */
  function buildDictatingComposer(transcribe: () => Promise<string>) {
    const stub = Object.create(ChatWidget.prototype);
    stub.settings = { allow_voice_input: true, voice_conversation: true };
    stub.options = {};
    stub.attachments = [];
    stub._transcribeDictation = vi.fn(transcribe);
    stub.addMessage = vi.fn(async () => document.createElement('div'));
    const composer: HTMLDivElement = stub._createInputContainer();
    document.body.appendChild(composer);
    return {
      stub,
      mic: composer.querySelector<HTMLButtonElement>(micSelector)!,
      call: composer.querySelector<HTMLButtonElement>(voiceSelector)!,
      input: composer.querySelector('textarea')!
    };
  }

  it('shows the mic between the textarea and the send button when the agent allows voice input', () => {
    stubRecording();
    const composer = buildComposer({ allow_voice_input: true, voice_conversation: true });
    const mic = composer.querySelector(micSelector)!;
    expect(mic).not.toBeNull();
    expect(mic.getAttribute('aria-label')).toBe('Start voice input');

    const textarea = composer.querySelector('textarea')!;
    const call = composer.querySelector(voiceSelector)!;
    expect(textarea.compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Mic, then the call button, as in the hosted chat.
    expect(mic.compareDocumentPosition(call) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the mic when the agent does not allow voice input', () => {
    stubRecording();
    expect(buildComposer({ allow_voice_input: false }).querySelector(micSelector)).toBeNull();
    expect(buildComposer({}).querySelector(micSelector)).toBeNull();
  });

  it('hides the mic in a browser that cannot record', () => {
    expect(buildComposer({ allow_voice_input: true }).querySelector(micSelector)).toBeNull();
  });

  it('records on the first press and puts the words after the typed text on the second', async () => {
    const { stopTrack } = stubRecording();
    const { stub, mic, call, input } = buildDictatingComposer(async () => 'about pricing');
    input.value = 'Tell me ';

    await stub.toggleDictation();
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(mic.getAttribute('aria-label')).toBe('Stop recording');
    // One microphone at a time: no call while the mic records.
    expect(call.disabled).toBe(true);

    await stub.toggleDictation();
    expect(stub._transcribeDictation).toHaveBeenCalledWith(expect.any(Blob), 'recording.webm');
    expect(input.value).toBe('Tell me about pricing');
    expect(stopTrack).toHaveBeenCalled();
    expect(mic.getAttribute('aria-pressed')).toBe('false');
    expect(mic.disabled).toBe(false);
    expect(call.disabled).toBe(false);
  });

  it('shows a failed transcription in the thread and leaves the composer as it was', async () => {
    stubRecording();
    const { stub, input } = buildDictatingComposer(async () => Promise.reject(new Error('500')));
    input.value = 'Draft';

    await stub.toggleDictation();
    await stub.toggleDictation();

    expect(input.value).toBe('Draft');
    expect(stub.addMessage).toHaveBeenCalledWith(CSS_CLASSES.MESSAGE_SYSTEM, 'Transcription failed', false);
  });
});
