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
