/**
 * The voice call's orb: a glowing sphere in the widget's brand color that
 * breathes while idle, swells and ripples with the live audio level (the
 * visitor's microphone while they talk, the agent's voice while it speaks),
 * and slowly swirls while the agent thinks. Drawn on a canvas each frame;
 * with reduced motion it only grows and shrinks gently.
 */

export type OrbMode = 'idle' | 'listening' | 'thinking' | 'speaking';

type Rgb = [number, number, number];

/** Points around the edge; enough for a smooth outline. */
const EDGE_POINTS = 72;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const FALLBACK: Rgb = [79, 70, 229];

const mix = (color: Rgb, target: Rgb, amount: number): Rgb =>
  color.map((channel, index) => Math.round(channel + (target[index] - channel) * amount)) as Rgb;
const rgba = ([r, g, b]: Rgb, alpha: number): string => `rgba(${r}, ${g}, ${b}, ${alpha})`;

/** Turns any CSS color (hex, rgb, oklch, color-mix…) into RGB by painting one pixel. */
function toRgb(color: string): Rgb | null {
  if (!color) return null;

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) return null;

  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;

  return [r, g, b];
}

export class VoiceOrb {
  level = 0;
  mode: OrbMode = 'idle';
  dimmed = false;

  private readonly canvas: HTMLCanvasElement;
  private frame: number | null = null;
  private time = 0;
  private last = 0;
  private smooth = 0;
  private base: Rgb = FALLBACK;
  private readonly reducedMotion: boolean;
  private readonly readLevel: () => number;

  /**
   * @param readLevel  called every frame for the current loudness (0–1)
   */
  constructor(canvas: HTMLCanvasElement, readLevel: () => number) {
    this.canvas = canvas;
    this.readLevel = readLevel;
    this.reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  start(): void {
    const primary = getComputedStyle(this.canvas).getPropertyValue('--chat-primary').trim();
    this.base = toRgb(primary) ?? FALLBACK;
    this.resize();
    window.addEventListener('resize', this.resize);
    this.frame = requestAnimationFrame(this.draw);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    window.removeEventListener('resize', this.resize);
  }

  private resize = (): void => {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
  };

  /** The orb's outline: a circle pushed out by a few travelling waves. */
  private outline(
    context: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    wobble: number,
    phase: number
  ): void {
    const points: [number, number][] = [];

    for (let i = 0; i < EDGE_POINTS; i++) {
      const angle = (i / EDGE_POINTS) * Math.PI * 2;
      const wave =
        0.5 * Math.sin(3 * angle + phase * 1.3) +
        0.3 * Math.sin(5 * angle - phase * 1.7) +
        0.2 * Math.sin(8 * angle + phase * 2.3);
      const r = radius * (1 + wobble * wave);
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }

    context.beginPath();
    const last = points[points.length - 1];
    context.moveTo((last[0] + points[0][0]) / 2, (last[1] + points[0][1]) / 2);

    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      const [nx, ny] = points[(i + 1) % points.length];
      context.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }

    context.closePath();
  }

  private draw = (timestamp: number): void => {
    const context = this.canvas.getContext('2d');
    if (!context) return;

    const delta = this.last ? Math.min(0.05, (timestamp - this.last) / 1000) : 0.016;
    this.last = timestamp;

    const target = this.dimmed ? 0 : Math.min(1, this.readLevel() * 2.2);
    // Rise fast, fall slowly, so the orb follows speech without flicker.
    this.smooth += (target - this.smooth) * (target > this.smooth ? 0.35 : 0.08);

    const thinking = this.mode === 'thinking';
    const speaking = this.mode === 'speaking';
    this.time += delta * (this.reducedMotion ? 0 : thinking ? 1.8 : 1 + this.smooth * 2.5);
    const time = this.time;
    const level = this.smooth;

    const { width, height } = this.canvas;
    const size = Math.min(width, height);
    const cx = width / 2;
    const cy = height / 2;

    const breathing = this.reducedMotion
      ? 0
      : Math.sin(time * (thinking ? 2.2 : 1.1)) * (thinking ? 0.035 : 0.02);
    // Sized so the halo fades out inside the canvas at full volume.
    const radius = size * 0.27 * (1 + breathing + level * 0.18);
    const wobble = this.reducedMotion ? 0 : 0.012 + level * 0.07 + (thinking ? 0.015 : 0);

    const color = speaking ? mix(this.base, WHITE, 0.18) : this.base;
    const light = mix(color, WHITE, 0.55);
    const dark = mix(color, BLACK, 0.25);

    context.clearRect(0, 0, width, height);
    context.globalAlpha = this.dimmed ? 0.45 : 1;

    // Soft halo behind the orb.
    const halo = context.createRadialGradient(cx, cy, radius * 0.8, cx, cy, size * 0.5);
    halo.addColorStop(0, rgba(color, 0.28 + level * 0.3));
    halo.addColorStop(1, rgba(color, 0));
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);

    // The body: a light core drifting around the centre, deeper at the edge.
    const drift = radius * 0.28;
    const gx = cx + Math.cos(time * 0.7) * drift;
    const gy = cy + Math.sin(time * 0.9) * drift - radius * 0.15;
    const body = context.createRadialGradient(gx, gy, radius * 0.05, cx, cy, radius * 1.15);
    body.addColorStop(0, rgba(light, 1));
    body.addColorStop(0.55, rgba(color, 1));
    body.addColorStop(1, rgba(dark, 1));

    context.save();
    context.shadowColor = rgba(color, 0.55);
    context.shadowBlur = size * (0.05 + level * 0.08);
    this.outline(context, cx, cy, radius, wobble, time);
    context.fillStyle = body;
    context.fill();
    context.restore();

    // A soft inner glow that swirls, for depth.
    const sx = cx + Math.cos(time * 1.3) * radius * 0.12;
    const sy = cy + Math.sin(time * 1.1) * radius * 0.12;
    const swirl = context.createRadialGradient(sx, sy, 0, sx, sy, radius * 0.7);
    swirl.addColorStop(0, rgba(light, 0.3 + level * 0.25));
    swirl.addColorStop(1, rgba(light, 0));
    this.outline(context, sx, sy, radius * 0.7, wobble * 1.4, -time * 1.4);
    context.fillStyle = swirl;
    context.fill();

    // A small gloss highlight.
    const gloss = context.createRadialGradient(
      cx - radius * 0.35,
      cy - radius * 0.4,
      0,
      cx - radius * 0.35,
      cy - radius * 0.4,
      radius * 0.45
    );
    gloss.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gloss;
    this.outline(context, cx, cy, radius, wobble, time);
    context.fill();

    context.globalAlpha = 1;
    this.frame = requestAnimationFrame(this.draw);
  };
}
