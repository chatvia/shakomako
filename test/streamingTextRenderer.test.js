import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamingTextRenderer } from '../src/state/streamingTextRenderer.js';

// Fake timers make the setTimeout-paced reveal deterministic: advance the clock
// to release words. jsdom reports document.hidden === false, so the visible
// cadence (wordsPerSec) path is exercised.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeRenderer(opts) {
  const target = document.createElement('div');
  const r = new StreamingTextRenderer(target, { wordsPerSec: 100, ...opts }); // 10ms/word
  return { r, target };
}

const words = target =>
  [...target.querySelectorAll('.chatvia-widget-word')].map(s => s.textContent);

describe('StreamingTextRenderer — tokenization', () => {
  it('queues whole words including their trailing whitespace', () => {
    const { r } = makeRenderer();
    r.setText('Hello world there ');
    expect(r._queue).toEqual(['Hello ', 'world ', 'there ']);
  });

  it('buffers a partial trailing word until whitespace completes it', () => {
    const { r } = makeRenderer();
    r.setText('Hel'); // split mid-word across SSE chunks
    expect(r._queue).toEqual([]); // held in _pending, not queued
    r.setText('Hello '); // the rest arrives
    expect(r._queue).toEqual(['Hello ']); // one token, not "Hel" + "lo"
  });

  it('flush() emits a still-incomplete trailing word', () => {
    const { r } = makeRenderer();
    r.setText('Hello wor'); // "Hello " queued, "wor" buffered
    expect(r._queue).toEqual(['Hello ']);
    r.flush(); // stream ended mid-word
    expect(r._queue).toEqual(['Hello ', 'wor']);
  });
});

describe('StreamingTextRenderer — paced reveal', () => {
  it('releases words at the configured cadence, not all at once', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 100 }); // 10ms each
    r.setText('a b c ');
    expect(words(target)).toEqual([]); // nothing on arrival
    vi.advanceTimersByTime(10);
    expect(words(target)).toEqual(['a ']);
    vi.advanceTimersByTime(10);
    expect(words(target)).toEqual(['a ', 'b ']);
    vi.advanceTimersByTime(10);
    expect(words(target)).toEqual(['a ', 'b ', 'c ']);
  });

  it('catches up by releasing multiple words/tick when far behind', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 100, maxLagWords: 2 });
    r.setText('a b c d e f g h '); // backlog 8 > 2 → ceil(8/2) = 4 per tick
    vi.advanceTimersByTime(10);
    expect(words(target).length).toBe(4);
  });

  it('idle() resolves only after the queue fully drains', async () => {
    const { r, target } = makeRenderer({ wordsPerSec: 100 });
    r.setText('a b c ');
    const idle = r.idle();
    await vi.advanceTimersByTimeAsync(40);
    await expect(idle).resolves.toBeUndefined();
    expect(words(target)).toEqual(['a ', 'b ', 'c ']);
  });

  it('preserves whitespace and newlines between words', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 1000 });
    r.setText('line one\nline two ');
    vi.advanceTimersByTime(100);
    expect(target.textContent).toBe('line one\nline two ');
  });
});

describe('StreamingTextRenderer — lifecycle', () => {
  it('stop() halts pacing but leaves rendered text intact (no disappearing message)', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 1000 });
    r.setText('hello world ');
    vi.advanceTimersByTime(100);
    expect(target.textContent).toBe('hello world ');
    r.stop();
    expect(target.textContent).toBe('hello world '); // NOT wiped
  });

  it('reset() halts pacing AND clears the DOM', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 1000 });
    r.setText('hello world ');
    vi.advanceTimersByTime(100);
    r.reset();
    expect(target.textContent).toBe('');
  });

  it('treats a shorter text as a new message and starts over', () => {
    const { r, target } = makeRenderer({ wordsPerSec: 1000 });
    r.setText('first message here ');
    vi.advanceTimersByTime(100);
    r.setText('new '); // shorter than consumed → reset + restart
    vi.advanceTimersByTime(100);
    expect(target.textContent).toBe('new ');
  });
});
