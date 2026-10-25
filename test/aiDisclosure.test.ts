import { describe, it, expect, beforeAll } from 'vitest';
import { ChatWidget } from '../src/widget';
import { initI18n } from '../src/i18n';
import { applyDisclosure } from '../src/state/config';
import type { WidgetSettings } from '../src/types';

// The header line under the title says who is answering (EU AI Act Art. 50).
// The install may turn the "AI assistant" label off; "Human agent" still shows
// while a person answers.
function buildHeader(settings: WidgetSettings) {
  const stub = Object.create(ChatWidget.prototype);
  stub.settings = settings;
  stub.handoffMode = 'ai';
  stub._createHeader();
  return stub;
}

describe('AI disclosure', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it('says "AI assistant" when the setting is absent', () => {
    const w = buildHeader({});

    expect(w.headerSubtitle.textContent).toBe('AI assistant');
    expect(w.headerSubtitle.style.display).not.toBe('none');
  });

  it('hides the line when the install turned the label off', () => {
    const w = buildHeader({ ai_disclosure: false });

    expect(w.headerSubtitle.textContent).toBe('');
    expect(w.headerSubtitle.style.display).toBe('none');
  });

  it('still says "Human agent" while a person answers, and hides again after', () => {
    const w = buildHeader({ ai_disclosure: false });

    applyDisclosure(w, 'human');
    expect(w.headerSubtitle.textContent).toBe('Human agent');
    expect(w.headerSubtitle.style.display).not.toBe('none');

    applyDisclosure(w, 'ai');
    expect(w.headerSubtitle.style.display).toBe('none');
  });
});
