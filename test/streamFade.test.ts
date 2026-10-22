import { describe, it, expect } from 'vitest';
import { createStreamFade, STREAM_FADE_MS } from '../src/streamFade';
import { CSS_CLASSES } from '../src/utils';

/** The text of each fading span, with its animation delay. */
function fading(root: Element): Array<[string, string]> {
  return [...root.querySelectorAll<HTMLElement>(`.${CSS_CLASSES.STREAM_FADE}`)].map(span => [
    span.textContent ?? '',
    span.style.animationDelay
  ]);
}

describe('streaming fade', () => {
  it('fades in only the text that arrived since the last render', () => {
    let time = 0;
    const fade = createStreamFade(() => time);
    const bubble = document.createElement('div');

    bubble.innerHTML = '<p>Hello</p>';
    fade.apply(bubble);
    expect(fading(bubble)).toEqual([['Hello', '0ms']]);

    // Re-rendered from markdown: the old span is gone, the new text arrived later.
    time = 100;
    bubble.innerHTML = '<p>Hello world</p>';
    fade.apply(bubble);
    // The first stretch resumes 100ms into its fade instead of starting over.
    expect(fading(bubble)).toEqual([
      ['Hello', '-100ms'],
      [' world', '0ms']
    ]);
  });

  it('stops wrapping text once its fade is over', () => {
    let time = 0;
    const fade = createStreamFade(() => time);
    const bubble = document.createElement('div');

    bubble.innerHTML = '<p>Hello</p>';
    fade.apply(bubble);

    time = STREAM_FADE_MS + 1;
    bubble.innerHTML = '<p>Hello <strong>there</strong></p>';
    fade.apply(bubble);
    // The space before "there" is new text too.
    expect(fading(bubble)).toEqual([
      [' ', '0ms'],
      ['there', '0ms']
    ]);
    expect(bubble.querySelector('p')?.textContent).toBe('Hello there');
  });

  it('starts over when the answer is replaced by a shorter one', () => {
    let time = 0;
    const fade = createStreamFade(() => time);
    const bubble = document.createElement('div');

    bubble.innerHTML = '<p>A long answer</p>';
    fade.apply(bubble);

    time = 50;
    bubble.innerHTML = '<p>Sorry</p>';
    fade.apply(bubble);
    expect(fading(bubble)).toEqual([]);
  });
});
