/**
 * Streaming fade (ChatGPT-style): each piece of text that arrives in a
 * streaming reply fades in on its own.
 *
 * The bubble's HTML is rebuilt from markdown on every frame, which would
 * restart or cut short every fade. So the arrival time of each stretch of
 * text is remembered by its position in the text, and after every render the
 * stretches still fading are wrapped again with a negative animation delay
 * that resumes their fade where it was.
 */
import { CSS_CLASSES } from './utils';

/** How long a newly streamed piece of text takes to fade in; matches the CSS animation. */
export const STREAM_FADE_MS = 500;

interface FadingText {
  start: number;
  end: number;
  arrivedAt: number;
}

export interface StreamFade {
  /** Wraps the text still fading in `root`, which was just re-rendered. */
  apply(root: Element): void;
}

/** The bubble's text nodes in reading order, leaving out formulas (KaTeX lays out its own spans). */
function textNodes(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      node.parentElement?.closest('.katex') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  return nodes;
}

function wrapFading(text: Text, delayMs: number): void {
  const span = document.createElement('span');
  span.className = CSS_CLASSES.STREAM_FADE;
  span.style.animationDelay = `${-delayMs}ms`;
  text.replaceWith(span);
  span.appendChild(text);
}

/** One per streaming reply: it remembers what was already shown. */
export function createStreamFade(now: () => number = () => performance.now()): StreamFade {
  let fadingText: FadingText[] = [];
  let renderedLength = 0;

  return {
    apply(root: Element): void {
      const nodes = textNodes(root);
      const length = nodes.reduce((sum, node) => sum + node.data.length, 0);
      const time = now();

      // Shorter than before: an output guardrail replaced the answer.
      if (length < renderedLength) fadingText = [];
      if (length > renderedLength) {
        fadingText.push({ start: renderedLength, end: length, arrivedAt: time });
      }
      renderedLength = length;

      fadingText = fadingText.filter(stretch => time - stretch.arrivedAt < STREAM_FADE_MS);
      if (fadingText.length === 0) return;

      let offset = 0;
      for (const node of nodes) {
        const nodeStart = offset;
        const nodeEnd = offset + node.data.length;
        offset = nodeEnd;
        if (node.data.trim() === '') continue;

        // From the last stretch back, so the start of the node stays where it is.
        for (let i = fadingText.length - 1; i >= 0; i--) {
          const stretch = fadingText[i];
          const from = Math.max(stretch.start, nodeStart) - nodeStart;
          const to = Math.min(stretch.end, nodeEnd) - nodeStart;
          if (from >= to) continue;

          const fading = from > 0 ? node.splitText(from) : node;
          if (to - from < fading.data.length) fading.splitText(to - from);
          wrapFading(fading, time - stretch.arrivedAt);
        }
      }
    }
  };
}
