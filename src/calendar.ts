/**
 * Inline calendar artifacts.
 *
 * The chat stream can carry a `calendar` tool artifact (built server-side by
 * the render-calendar tool): free meeting times the visitor picks from, then
 * books with their name and email. The booking itself is made server-side and
 * saved as a lead; the widget shows the times in the visitor's own timezone and
 * language and POSTs the choice to the widget calendar endpoints.
 *
 * Weeks are local days starting today, so a day never splits across two weeks.
 * The artifact carries the first week's times; later weeks are fetched.
 *
 * Security: every server-supplied string is set via textContent (never
 * innerHTML), and the fallback booking link must be http(s).
 */
import { createElement, createIcon } from './ui';
import { getCurrentLanguage, t } from './i18n';
import type { ApiHeaders } from './api';
import type { CalendarArtifact, CalendarSlot } from './types';
import type { ChatWidget } from './widget';

const DAY_MS = 86_400_000;
const DEFAULT_MAX_DAYS_AHEAD = 31;
const NOTES_MAX_LENGTH = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The free times of one day, in the visitor's timezone. */
export interface SlotDay {
  /** `YYYY-MM-DD` in the visitor's timezone. */
  key: string;
  /** The day's first free time. */
  date: Date;
  /** Each free time, as given by the server (ISO UTC) and parsed. */
  slots: { startTime: string; date: Date }[];
}

/** The range of one browsable week. */
export interface WeekWindow {
  from: Date;
  to: Date;
}

/** What a slots request came back with. */
export type SlotsOutcome =
  | { kind: 'slots'; slots: CalendarSlot[] }
  | { kind: 'booked'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'unavailable'; message: string };

/** What a booking request came back with. */
export type BookingOutcome =
  | { kind: 'booked'; startTime: string | null; message: string }
  | { kind: 'slot_taken'; message: string }
  | { kind: 'expired'; message: string }
  | { kind: 'fallback'; message: string; url: string | null }
  | { kind: 'invalid'; message: string; errors: Record<string, string[]> }
  | { kind: 'unavailable'; message: string };

/** The JSON body the calendar endpoints answer with. */
interface CalendarResponseBody {
  status?: string;
  message?: string;
  start_time?: string;
  fallback_url?: string;
  slots?: CalendarSlot[];
  errors?: Record<string, string[] | string>;
}

/** The visitor's IANA timezone, e.g. `Europe/Berlin`. */
export function visitorTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The `YYYY-MM-DD` date of an instant in a timezone. */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const part = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Group free times by day in a timezone, keeping only times in [from, to).
 * Days without a free time are left out; days and times are in order.
 */
export function groupSlotsByDay(
  slots: CalendarSlot[],
  timeZone: string,
  from: Date,
  to: Date
): SlotDay[] {
  const seen = new Set<number>();
  const times = (Array.isArray(slots) ? slots : [])
    .map(slot => ({ startTime: String(slot?.start_time ?? ''), date: new Date(slot?.start_time) }))
    .filter(({ date }) => {
      const ms = date.getTime();
      if (Number.isNaN(ms) || ms < from.getTime() || ms >= to.getTime() || seen.has(ms)) {
        return false;
      }
      seen.add(ms);
      return true;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const days: SlotDay[] = [];
  for (const time of times) {
    const key = dayKey(time.date, timeZone);
    const last = days[days.length - 1];
    if (last && last.key === key) last.slots.push(time);
    else days.push({ key, date: time.date, slots: [time] });
  }
  return days;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * The `index`-th week (0 = this week) of local days starting today. It never
 * starts before `now` and never runs past `maxDaysAhead` days from `now`.
 */
export function weekWindow(now: Date, index: number, maxDaysAhead: number): WeekWindow {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = addDays(today, 7 * index);
  const end = addDays(today, 7 * (index + 1));
  const limit = new Date(now.getTime() + maxDaysAhead * DAY_MS);
  return {
    from: start < now ? new Date(now) : start,
    to: end > limit ? limit : end
  };
}

/** Whether the week after `index` still starts before the `maxDaysAhead` limit. */
export function hasNextWeek(now: Date, index: number, maxDaysAhead: number): boolean {
  const next = weekWindow(now, index + 1, maxDaysAhead);
  return next.from < next.to;
}

/** An http(s) URL, or null for anything else (javascript:, data:, junk). */
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

async function readBody(response: Response): Promise<CalendarResponseBody> {
  const body: unknown = await response.json().catch(() => ({}));
  return body && typeof body === 'object' ? (body as CalendarResponseBody) : {};
}

/** Interpret a `GET …/slots` response. */
export async function readSlotsResponse(response: Response): Promise<SlotsOutcome> {
  const body = await readBody(response);
  if (response.ok) {
    return { kind: 'slots', slots: Array.isArray(body.slots) ? body.slots : [] };
  }
  if (response.status === 409) {
    return { kind: 'booked', message: body.message || '' };
  }
  if (response.status === 410) {
    return { kind: 'expired', message: body.message || t('calendar.expired') };
  }
  return { kind: 'unavailable', message: body.message || t('calendar.unavailable') };
}

/** Field errors as `{field: [message, …]}`, whatever shape each value came in. */
function fieldErrors(errors: CalendarResponseBody['errors']): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!errors || typeof errors !== 'object') return result;
  for (const [field, messages] of Object.entries(errors)) {
    const list = (Array.isArray(messages) ? messages : [messages]).map(String).filter(Boolean);
    if (list.length > 0) result[field] = list;
  }
  return result;
}

/**
 * Interpret a `POST …/book` response.
 *
 * @param requestedStart - the time the visitor picked, shown when a 200 omits it
 */
export async function readBookingResponse(
  response: Response,
  requestedStart: string
): Promise<BookingOutcome> {
  const body = await readBody(response);
  if (response.ok) {
    return {
      kind: 'booked',
      startTime: body.start_time || requestedStart,
      message: body.message || ''
    };
  }
  if (response.status === 409) {
    if (body.status === 'slot_taken') {
      return { kind: 'slot_taken', message: body.message || t('calendar.slot_taken') };
    }
    // Already booked (a second tab, a double submit): done, but not
    // necessarily at the time picked here, so no time is shown.
    return { kind: 'booked', startTime: null, message: body.message || '' };
  }
  if (response.status === 410) {
    return { kind: 'expired', message: body.message || t('calendar.expired') };
  }
  if (response.status === 422 && body.status === 'booking_not_allowed') {
    return {
      kind: 'fallback',
      message: body.message || t('calendar.fallback'),
      url: safeHttpUrl(body.fallback_url)
    };
  }
  if (response.status === 422) {
    return {
      kind: 'invalid',
      message: body.message || t('calendar.failed'),
      errors: fieldErrors(body.errors)
    };
  }
  return { kind: 'unavailable', message: body.message || t('calendar.unavailable') };
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const zoned = { ...options, timeZone: visitorTimeZone() };
  try {
    return new Intl.DateTimeFormat(getCurrentLanguage(), zoned);
  } catch {
    return new Intl.DateTimeFormat(undefined, zoned);
  }
}

/** "Tuesday, October 28, 10:00 AM" in the visitor's language and timezone. */
function formatFullDateTime(date: Date): string {
  return dateFormat({
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

/** A rough label for the meeting's location kind; null when unknown. */
function locationLabel(kind: string | null): string | null {
  const value = (kind || '').toLowerCase();
  if (!value) return null;
  if (/conference|zoom|meet|teams|webex|video/.test(value)) return t('calendar.location_video');
  if (/call|phone/.test(value)) return t('calendar.location_phone');
  if (/physical|in_person|address/.test(value)) return t('calendar.location_in_person');
  return null;
}

/**
 * Flip the stored in-memory artifact so an in-session re-render (conversation
 * switch) shows the final state without a round trip. A page reload reads the
 * authoritative status from the server instead.
 */
function markStoredArtifact(
  widget: ChatWidget,
  messageId: string | null | undefined,
  instanceId: string,
  patch: Partial<Pick<CalendarArtifact, 'status' | 'booked_start_time'>>
): void {
  const message = widget.messageHistory?.find(m => m.id === messageId);
  const artifacts = message?.metadata?.artifacts;
  if (!Array.isArray(artifacts)) return;
  for (const a of artifacts) {
    if (a?.kind === 'calendar' && a.data?.booking_instance_id === instanceId) {
      Object.assign(a.data, patch);
    }
  }
}

// Unique ids that tie each label and error message to its control.
let fieldCount = 0;

/** A labelled input with its error line, built like the inline form fields. */
function textField(
  name: string,
  label: string,
  control: HTMLInputElement | HTMLTextAreaElement,
  required: boolean
): { wrapper: HTMLElement; control: HTMLInputElement | HTMLTextAreaElement; error: HTMLElement } {
  const id = `chatvia-widget-calendar-${name}-${++fieldCount}`;
  const wrapper = createElement('div', { className: 'chatvia-widget-form-field' });
  const labelEl = createElement('label', {
    className: 'chatvia-widget-form-label',
    for: id,
    textContent: label
  });
  if (required) {
    labelEl.appendChild(
      createElement('span', { className: 'chatvia-widget-form-req', textContent: ' *' })
    );
  }
  control.id = id;
  control.name = name;
  control.className = 'chatvia-widget-form-input';
  if (required) control.required = true;

  const error = createElement('div', {
    className: 'chatvia-widget-form-field-error',
    id: `${id}-error`
  });
  error.style.display = 'none';
  control.setAttribute('aria-describedby', error.id);

  wrapper.append(labelEl, control, error);
  return { wrapper, control, error };
}

function setFieldError(
  field: { control: HTMLElement; error: HTMLElement },
  message: string | null
): void {
  field.error.textContent = message || '';
  field.error.style.display = message ? '' : 'none';
  field.control.setAttribute('aria-invalid', String(!!message));
}

/**
 * Render an inline calendar artifact as a DOM node bound to one assistant message.
 *
 * @param calendar - the artifact `data` (booking_instance_id, slots, …)
 * @param messageId - the assistant message this calendar belongs to
 */
export function createInlineCalendar(
  widget: ChatWidget,
  calendar: CalendarArtifact,
  messageId: string | null | undefined
): HTMLElement {
  const instanceId = String(calendar.booking_instance_id || '');
  const timeZone = visitorTimeZone();
  const maxDaysAhead =
    Number.isFinite(calendar.max_days_ahead) && calendar.max_days_ahead > 0
      ? calendar.max_days_ahead
      : DEFAULT_MAX_DAYS_AHEAD;
  // Fixed at render, so the weeks don't shift while the visitor browses.
  const now = new Date();

  const card = createElement('div', {
    className: 'chatvia-widget-calendar',
    role: 'group',
    'aria-label': calendar.event_type_name || t('calendar.title')
  });
  card.setAttribute('data-booking-instance', instanceId);

  const header = createElement('div', { className: 'chatvia-widget-calendar-header' });
  header.appendChild(
    createElement('div', {
      className: 'chatvia-widget-calendar-title',
      textContent: calendar.event_type_name || t('calendar.title')
    })
  );
  const meta = [
    Number(calendar.duration) > 0 ? t('calendar.duration', { minutes: calendar.duration }) : '',
    locationLabel(calendar.location_kind) ?? ''
  ].filter(Boolean);
  if (meta.length > 0) {
    header.appendChild(
      createElement('div', {
        className: 'chatvia-widget-calendar-meta',
        textContent: meta.join(' · ')
      })
    );
  }

  const body = createElement('div', { className: 'chatvia-widget-calendar-body' });
  const status = createElement('div', {
    className: 'chatvia-widget-calendar-status',
    role: 'status',
    'aria-live': 'polite'
  });
  card.append(header, body, status);

  function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('chatvia-widget-calendar-status-error', isError);
  }

  /** Replace everything under the header with a final view and announce it. */
  function showFinal(view: HTMLElement): void {
    setStatus('');
    view.tabIndex = -1;
    body.replaceChildren(view);
    view.focus({ preventScroll: true });
  }

  function showBooked(startTime: string | null, message: string): void {
    markStoredArtifact(widget, messageId, instanceId, {
      status: 'submitted',
      ...(startTime ? { booked_start_time: startTime } : {})
    });
    showFinal(bookedView(startTime, message));
  }

  function showExpired(message: string): void {
    markStoredArtifact(widget, messageId, instanceId, { status: 'expired' });
    showFinal(expiredView(message));
  }

  if (calendar.status === 'submitted') {
    body.appendChild(bookedView(calendar.booked_start_time, ''));
    return card;
  }
  if (calendar.status === 'expired') {
    body.appendChild(expiredView(''));
    return card;
  }

  // ── Slots view ────────────────────────────────────────────────────────────
  let weekIndex = 0;
  let days: SlotDay[] = [];
  let selectedDay: string | null = null;
  let selectedTime: string | null = null;
  let loading = false;
  // Guards against a slow response for a week the visitor already left.
  let requestId = 0;
  const weekSlots = new Map<number, CalendarSlot[]>();

  // The artifact's own slots serve the first week when they still cover it
  // (a reload days later fetches fresh ones instead).
  const firstWeek = weekWindow(now, 0, maxDaysAhead);
  if (
    Date.parse(calendar.window_start) <= firstWeek.from.getTime() &&
    Date.parse(calendar.window_end) >= firstWeek.to.getTime()
  ) {
    weekSlots.set(0, Array.isArray(calendar.slots) ? calendar.slots : []);
  }

  const slotsView = createElement('div', { className: 'chatvia-widget-calendar-slots' });
  const nav = createElement('div', { className: 'chatvia-widget-calendar-nav' });
  const prevBtn = createElement('button', {
    type: 'button',
    className: 'chatvia-widget-calendar-nav-btn',
    'aria-label': t('calendar.previous_week')
  });
  prevBtn.appendChild(createIcon('chevron-left'));
  const nextBtn = createElement('button', {
    type: 'button',
    className: 'chatvia-widget-calendar-nav-btn',
    'aria-label': t('calendar.next_week')
  });
  nextBtn.appendChild(createIcon('chevron-right'));
  const rangeLabel = createElement('div', { className: 'chatvia-widget-calendar-range' });
  nav.append(prevBtn, rangeLabel, nextBtn);
  const dayList = createElement('div', {
    className: 'chatvia-widget-calendar-days',
    role: 'group',
    'aria-label': t('calendar.days_label')
  });
  const timeList = createElement('div', {
    className: 'chatvia-widget-calendar-times',
    role: 'group'
  });
  slotsView.append(nav, dayList, timeList);

  prevBtn.addEventListener('click', () => goToWeek(weekIndex - 1));
  nextBtn.addEventListener('click', () => goToWeek(weekIndex + 1));

  function updateNav(): void {
    const week = weekWindow(now, weekIndex, maxDaysAhead);
    const short = dateFormat({ month: 'short', day: 'numeric' });
    // `to` is exclusive: the label names the week's last day.
    rangeLabel.textContent = `${short.format(week.from)} – ${short.format(new Date(week.to.getTime() - 1))}`;
    const hadFocus = document.activeElement;
    prevBtn.disabled = weekIndex === 0;
    nextBtn.disabled = !hasNextWeek(now, weekIndex, maxDaysAhead);
    // A nav button that just became disabled drops focus; hand it to the other.
    if (hadFocus === prevBtn && prevBtn.disabled && !nextBtn.disabled) nextBtn.focus();
    if (hadFocus === nextBtn && nextBtn.disabled && !prevBtn.disabled) prevBtn.focus();
  }

  function renderDays(): void {
    dayList.replaceChildren();
    timeList.replaceChildren();
    if (loading) return;

    if (days.length === 0) {
      timeList.appendChild(
        createElement('div', {
          className: 'chatvia-widget-calendar-empty',
          textContent: t('calendar.no_times_week')
        })
      );
      return;
    }

    const weekday = dateFormat({ weekday: 'short' });
    const dayNumber = dateFormat({ day: 'numeric' });
    const longDay = dateFormat({ weekday: 'long', month: 'long', day: 'numeric' });
    for (const day of days) {
      const active = day.key === selectedDay;
      const btn = createElement('button', {
        type: 'button',
        className: 'chatvia-widget-calendar-day',
        'aria-pressed': String(active),
        'aria-label': longDay.format(day.date)
      });
      btn.append(
        createElement('span', {
          className: 'chatvia-widget-calendar-day-name',
          textContent: weekday.format(day.date)
        }),
        createElement('span', {
          className: 'chatvia-widget-calendar-day-number',
          textContent: dayNumber.format(day.date)
        })
      );
      btn.addEventListener('click', () => {
        selectedDay = day.key;
        renderDays();
        dayList.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
      });
      dayList.appendChild(btn);
    }

    const day = days.find(d => d.key === selectedDay) ?? days[0];
    const time = dateFormat({ hour: 'numeric', minute: '2-digit' });
    timeList.setAttribute(
      'aria-label',
      t('calendar.times_label', { day: longDay.format(day.date) })
    );
    for (const slot of day.slots) {
      const btn = createElement('button', {
        type: 'button',
        className: 'chatvia-widget-calendar-time',
        'aria-label': formatFullDateTime(slot.date),
        textContent: time.format(slot.date)
      });
      btn.setAttribute('data-start-time', slot.startTime);
      btn.addEventListener('click', () => showForm(slot));
      timeList.appendChild(btn);
    }
  }

  function applyWeek(slots: CalendarSlot[]): void {
    const week = weekWindow(now, weekIndex, maxDaysAhead);
    // Times already past (the render was a while ago) are not offered.
    const from = new Date(Math.max(week.from.getTime(), Date.now()));
    days = groupSlotsByDay(slots, timeZone, from, week.to);
    if (!days.some(d => d.key === selectedDay)) selectedDay = days[0]?.key ?? null;
  }

  function showSlots(focusTarget?: () => HTMLElement | null | undefined): void {
    body.replaceChildren(slotsView);
    updateNav();
    renderDays();
    focusTarget?.()?.focus();
  }

  async function loadWeek(): Promise<void> {
    const cached = weekSlots.get(weekIndex);
    if (cached) {
      loading = false;
      applyWeek(cached);
      renderDays();
      return;
    }

    const id = ++requestId;
    const index = weekIndex;
    loading = true;
    days = [];
    renderDays();
    setStatus(t('calendar.loading'));
    const week = weekWindow(now, index, maxDaysAhead);
    const query = new URLSearchParams({
      from: week.from.toISOString(),
      to: week.to.toISOString()
    });

    let outcome: SlotsOutcome;
    try {
      const api = (await import('./api')).default;
      const response = await api({
        endpoint: `calendar/${encodeURIComponent(instanceId)}/slots?${query.toString()}`,
        method: 'GET',
        headers: calendarHeaders()
      });
      outcome = await readSlotsResponse(response);
    } catch {
      outcome = { kind: 'unavailable', message: t('calendar.unavailable') };
    }
    if (id !== requestId) return;
    loading = false;

    if (outcome.kind === 'booked') {
      showBooked(null, outcome.message);
      return;
    }
    if (outcome.kind === 'expired') {
      showExpired(outcome.message);
      return;
    }
    if (outcome.kind === 'unavailable') {
      setStatus(outcome.message, true);
      const retry = createElement('button', {
        type: 'button',
        className: 'chatvia-widget-calendar-secondary',
        textContent: t('calendar.retry')
      });
      retry.addEventListener('click', () => {
        void loadWeek();
      });
      timeList.replaceChildren(retry);
      return;
    }

    setStatus('');
    weekSlots.set(index, outcome.slots);
    applyWeek(outcome.slots);
    renderDays();
  }

  function goToWeek(index: number): void {
    if (index < 0 || (index > weekIndex && !hasNextWeek(now, weekIndex, maxDaysAhead))) return;
    weekIndex = index;
    selectedDay = null;
    setStatus('');
    updateNav();
    void loadWeek();
  }

  function calendarHeaders(): ApiHeaders {
    return {
      'X-AGENT-ID': widget.agentId,
      'X-SESSION-ID': widget.sessionId,
      'X-CONVERSATION-ID': widget.getCurrentActiveConversationId()
    };
  }

  // ── Booking form ──────────────────────────────────────────────────────────
  function showForm(slot: { startTime: string; date: Date }): void {
    selectedTime = slot.startTime;
    setStatus('');

    const view = createElement('form', { className: 'chatvia-widget-calendar-form' });
    view.noValidate = true;
    const summary = createElement('div', { className: 'chatvia-widget-calendar-summary' });
    summary.appendChild(
      createElement('div', {
        className: 'chatvia-widget-calendar-summary-time',
        textContent: formatFullDateTime(slot.date)
      })
    );
    summary.appendChild(
      createElement('div', {
        className: 'chatvia-widget-calendar-summary-zone',
        textContent: t('calendar.timezone', { zone: timeZone })
      })
    );

    const name = textField('name', t('calendar.name'), createElement('input'), true);
    name.control.setAttribute('type', 'text');
    name.control.setAttribute('autocomplete', 'name');
    const email = textField('email', t('calendar.email'), createElement('input'), true);
    email.control.setAttribute('type', 'email');
    email.control.setAttribute('autocomplete', 'email');
    const notes = textField('notes', t('calendar.notes'), createElement('textarea'), false);
    notes.control.setAttribute('rows', '3');
    notes.control.maxLength = NOTES_MAX_LENGTH;

    const actions = createElement('div', { className: 'chatvia-widget-calendar-actions' });
    const backBtn = createElement('button', {
      type: 'button',
      className: 'chatvia-widget-calendar-secondary',
      textContent: t('calendar.back')
    });
    const bookBtn = createElement('button', {
      type: 'submit',
      className: 'chatvia-widget-form-submit',
      textContent: t('calendar.book')
    });
    actions.append(backBtn, bookBtn);

    const errorEl = createElement('div', {
      className: 'chatvia-widget-form-error',
      role: 'alert'
    });
    errorEl.style.display = 'none';

    view.append(summary, name.wrapper, email.wrapper, notes.wrapper, actions, errorEl);
    const fields = { name, email, notes };

    backBtn.addEventListener('click', () => {
      showSlots(() => {
        const buttons = Array.from(timeList.querySelectorAll<HTMLElement>('button'));
        return buttons.find(b => b.dataset.startTime === selectedTime) ?? buttons[0];
      });
    });

    view.addEventListener('submit', e => {
      e.preventDefault();
      const nameValue = name.control.value.trim();
      const emailValue = email.control.value.trim();
      setFieldError(name, nameValue ? null : t('calendar.required'));
      setFieldError(
        email,
        !emailValue
          ? t('calendar.required')
          : EMAIL_PATTERN.test(emailValue)
            ? null
            : t('calendar.invalid_email')
      );
      setFieldError(notes, null);
      errorEl.style.display = 'none';
      if (!nameValue) {
        name.control.focus();
        return;
      }
      if (!emailValue || !EMAIL_PATTERN.test(emailValue)) {
        email.control.focus();
        return;
      }
      void book(slot.startTime, {
        name: nameValue,
        email: emailValue,
        notes: notes.control.value.trim()
      });
    });

    async function book(
      startTime: string,
      answers: { name: string; email: string; notes: string }
    ): Promise<void> {
      bookBtn.disabled = true;
      backBtn.disabled = true;
      bookBtn.textContent = t('calendar.booking');

      let outcome: BookingOutcome;
      try {
        const api = (await import('./api')).default;
        const response = await api({
          endpoint: `calendar/${encodeURIComponent(instanceId)}/book`,
          method: 'POST',
          headers: calendarHeaders(),
          body: JSON.stringify({
            start_time: startTime,
            name: answers.name,
            email: answers.email,
            timezone: timeZone,
            ...(answers.notes ? { notes: answers.notes } : {}),
            ...(messageId ? { assistant_message_id: messageId } : {})
          })
        });
        outcome = await readBookingResponse(response, startTime);
      } catch {
        outcome = { kind: 'unavailable', message: t('calendar.failed') };
      }

      bookBtn.disabled = false;
      backBtn.disabled = false;
      bookBtn.textContent = t('calendar.book');

      switch (outcome.kind) {
        case 'booked':
          showBooked(outcome.startTime, outcome.message);
          return;
        case 'expired':
          showExpired(outcome.message);
          return;
        case 'fallback':
          showFinal(fallbackView(outcome.message, outcome.url));
          return;
        case 'slot_taken':
          // The week's times are stale: drop them and fetch fresh ones.
          weekSlots.delete(weekIndex);
          showSlots();
          await loadWeek();
          // Unless the reload ended on a final view (booked elsewhere, expired).
          if (body.contains(slotsView)) {
            setStatus(outcome.message, true);
            timeList.querySelector<HTMLElement>('button')?.focus();
          }
          return;
        case 'invalid': {
          let shown = false;
          for (const [field, messages] of Object.entries(outcome.errors)) {
            const target = fields[field as keyof typeof fields];
            if (target) {
              setFieldError(target, messages[0]);
              if (!shown) target.control.focus();
              shown = true;
            }
          }
          if (!shown) {
            const first = Object.values(outcome.errors)[0]?.[0];
            errorEl.textContent = first || outcome.message;
            errorEl.style.display = '';
          }
          return;
        }
        default:
          errorEl.textContent = outcome.message;
          errorEl.style.display = '';
      }
    }

    body.replaceChildren(view);
    name.control.focus();
  }

  // With the artifact's own slots cached this renders the week synchronously.
  showSlots();
  void loadWeek();
  return card;
}

function bookedView(startTime: string | null, message: string): HTMLElement {
  const box = createElement('div', {
    className: 'chatvia-widget-calendar-booked',
    role: 'status'
  });
  const line = createElement('div', { className: 'chatvia-widget-form-success' });
  line.append(
    createElement('span', { className: 'chatvia-widget-form-check', textContent: '✓' }),
    createElement('span', { textContent: t('calendar.booked') })
  );
  box.appendChild(line);

  const date = startTime ? new Date(startTime) : null;
  if (date && !Number.isNaN(date.getTime())) {
    box.appendChild(
      createElement('div', {
        className: 'chatvia-widget-calendar-booked-time',
        textContent: formatFullDateTime(date)
      })
    );
  }
  if (message) {
    box.appendChild(
      createElement('div', {
        className: 'chatvia-widget-calendar-booked-message',
        textContent: message
      })
    );
  }
  return box;
}

function expiredView(message: string): HTMLElement {
  return createElement('div', {
    className: 'chatvia-widget-form-expired',
    role: 'status',
    textContent: message || t('calendar.expired')
  });
}

function fallbackView(message: string, url: string | null): HTMLElement {
  const box = createElement('div', {
    className: 'chatvia-widget-calendar-fallback',
    role: 'status'
  });
  box.appendChild(
    createElement('div', {
      className: 'chatvia-widget-calendar-fallback-message',
      textContent: message
    })
  );
  if (url) {
    box.appendChild(
      createElement('a', {
        className: 'chatvia-widget-form-submit chatvia-widget-calendar-fallback-link',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
        textContent: t('calendar.open_booking_page')
      })
    );
  }
  return box;
}
