/**
 * StreamingTextRenderer
 *
 * Smoothly reveals streamed text word-by-word with a CSS fade-in, at a capped
 * *reading cadence* — so a reply that arrives in a fast burst is still revealed
 * at a comfortable, readable speed instead of dumping all at once.
 *
 * Design notes:
 *  - Rate-limited: words are released on a `setTimeout` cadence (`wordsPerSec`),
 *    NOT as fast as they arrive. This is what actually slows the stream down.
 *  - Catch-up: if the backlog grows past `maxLagWords` (a long, fast message),
 *    it releases several words per tick so it never lags far behind — settling
 *    back to one-per-tick once caught up.
 *  - Append-only: each revealed word is a persistent <span> that is never
 *    rebuilt, so its fade always plays to completion — no flicker, no re-layout.
 *  - Background-tab safe: `setTimeout` keeps firing in hidden tabs (rAF does
 *    not), and when hidden we release the whole backlog at once so the full
 *    message is present when the user returns.
 *  - stop() halts pacing WITHOUT clearing the DOM; reset() also wipes the
 *    target. Finalize uses stop() so the rendered message is never erased.
 *
 * Plain text only: markdown is applied once at finalize (see
 * finalizeStreamingMessage). Persistent word-spans can't coexist with a full
 * markdown re-parse every frame.
 */
import { CSS_CLASSES } from '../utils.js';

export class StreamingTextRenderer {
  constructor(target, opts = {}) {
    this.target = target;
    this.opts = {
      wordsPerSec: 20, // reading cadence while visible
      maxLagWords: 40, // backlog past this releases multiple words/tick to catch up
      onAppend: null,
      ...opts
    };
    this.reset();
  }

  /** Halt pacing AND wipe the target. Used on construction and for a hard reset. */
  reset() {
    this.stop();
    this._consumed = 0;
    this.target.textContent = '';
  }

  /** Halt pacing but leave already-revealed DOM intact (used when finalizing). */
  stop() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    this._scheduled = false;
    this._queue = [];
    this._pending = '';
    this._resolveIdle();
  }

  /** Call with the FULL accumulated text whenever new data arrives. */
  setText(fullText) {
    if (fullText.length < this._consumed) this.reset(); // new/replaced message
    const fresh = fullText.slice(this._consumed);
    this._consumed = fullText.length;
    if (fresh) {
      this._pending += fresh;
      this._drainPending(false);
      this._schedule();
    }
  }

  /** Push any held-back partial word and let the queue finish draining. */
  flush() {
    this._drainPending(true);
    this._schedule();
  }

  /** Resolves once every queued word has been appended to the DOM. */
  idle() {
    if (!this._queue.length && !this._scheduled) return Promise.resolve();
    return new Promise(res => (this._idle ||= []).push(res));
  }

  _resolveIdle() {
    if (this._idle) this._idle.splice(0).forEach(r => r());
  }

  // Emit whole words only; hold a trailing partial word until more text arrives,
  // so a word split across two SSE chunks ("wor" + "ld") becomes one faded span.
  _drainPending(flushTail) {
    const re = /\S+\s*/g;
    let lastEnd = 0;
    let m;
    while ((m = re.exec(this._pending))) {
      const isTail = re.lastIndex === this._pending.length && !/\s$/.test(m[0]);
      if (isTail && !flushTail) break;
      this._queue.push(m[0]);
      lastEnd = re.lastIndex;
    }
    this._pending = this._pending.slice(lastEnd);
  }

  _hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  _schedule() {
    if (this._scheduled || !this._queue.length) return;
    this._scheduled = true;
    // Hidden: drain ASAP (fade isn't visible). Visible: pace at wordsPerSec.
    const delay = this._hidden() ? 0 : 1000 / this.opts.wordsPerSec;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._scheduled = false;
      this._tick();
    }, delay);
  }

  _tick() {
    const backlog = this._queue.length;
    if (!backlog) return;

    let n;
    if (this._hidden()) {
      n = backlog; // off-screen: reveal everything at once
    } else if (backlog > this.opts.maxLagWords) {
      n = Math.ceil(backlog / this.opts.maxLagWords); // behind: catch up
    } else {
      n = 1; // steady reading cadence: one word per tick
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < n && this._queue.length; i++) {
      const span = document.createElement('span');
      span.className = CSS_CLASSES.STREAM_WORD;
      span.textContent = this._queue.shift();
      frag.appendChild(span);
    }
    this.target.appendChild(frag);
    this.opts.onAppend?.();

    if (!this._queue.length) this._resolveIdle();
    this._schedule();
  }
}
