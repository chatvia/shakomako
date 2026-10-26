import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { initI18n } from '../src/i18n';
import {
  createInlineCalendar,
  dayKey,
  groupSlotsByDay,
  hasNextWeek,
  readBookingResponse,
  readSlotsResponse,
  visitorTimeZone,
  weekWindow
} from '../src/calendar';
import type { CalendarArtifact, ChatMessage } from '../src/types';
import type { ChatWidget } from '../src/widget';

// calendar.ts dynamically imports ./api; intercept it so no real network call
// happens and the request shape can be asserted.
const apiMock = vi.fn();
vi.mock('../src/api', () => ({ default: (...args: unknown[]) => apiMock(...args) }));

// Only what calendar.ts reads from the widget.
const widget = {
  agentId: 'agent-1',
  sessionId: 'sess-1',
  getCurrentActiveConversationId: () => 'conv-1',
  messageHistory: [] as Partial<ChatMessage>[]
};
const host = widget as unknown as ChatWidget;

const DAY_MS = 86_400_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Tomorrow at a local hour and minute, as ISO UTC. */
function tomorrowAt(hours: number, minutes = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

function baseCalendar(overrides: Partial<CalendarArtifact> = {}): CalendarArtifact {
  const now = Date.now();
  return {
    booking_instance_id: 'bi-1',
    event_type_name: 'Intro call',
    duration: 30,
    location_kind: 'zoom_conference',
    slots: [{ start_time: tomorrowAt(14, 30) }, { start_time: tomorrowAt(14) }],
    window_start: new Date(now - 60_000).toISOString(),
    window_end: new Date(now + 8 * DAY_MS).toISOString(),
    max_days_ahead: 31,
    status: 'pending',
    booked_start_time: null,
    expires_at: null,
    ...overrides
  };
}

function timeButtons(el: HTMLElement): HTMLButtonElement[] {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('.chatvia-widget-calendar-time'));
}

function fillAndSubmit(el: HTMLElement, name = 'Jane', email = 'jane@acme.com'): void {
  el.querySelector<HTMLInputElement>('input[name="name"]')!.value = name;
  el.querySelector<HTMLInputElement>('input[name="email"]')!.value = email;
  el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

describe('calendar slot grouping', () => {
  it('groups times by day in the given timezone, in order', () => {
    const slots = [
      { start_time: '2026-10-28T15:00:00Z' },
      // 03:00 UTC is still the evening before in New York.
      { start_time: '2026-10-28T03:00:00Z' },
      { start_time: '2026-10-28T14:00:00Z' }
    ];
    const days = groupSlotsByDay(
      slots,
      'America/New_York',
      new Date('2026-10-27T00:00:00Z'),
      new Date('2026-11-03T00:00:00Z')
    );

    expect(days.map(d => d.key)).toEqual(['2026-10-27', '2026-10-28']);
    expect(days[1].slots.map(s => s.startTime)).toEqual([
      '2026-10-28T14:00:00Z',
      '2026-10-28T15:00:00Z'
    ]);
  });

  it('drops times outside the range, duplicates and junk', () => {
    const days = groupSlotsByDay(
      [
        { start_time: '2026-10-26T09:00:00Z' },
        { start_time: '2026-10-28T09:00:00Z' },
        { start_time: '2026-10-28T09:00:00.000Z' },
        { start_time: 'not a date' },
        { start_time: '2026-11-02T00:00:00Z' }
      ],
      'UTC',
      new Date('2026-10-27T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z')
    );

    expect(days).toHaveLength(1);
    expect(days[0].slots).toHaveLength(1);
  });

  it('formats a day key per timezone', () => {
    const instant = new Date('2026-10-28T23:30:00Z');
    expect(dayKey(instant, 'UTC')).toBe('2026-10-28');
    expect(dayKey(instant, 'Asia/Tokyo')).toBe('2026-10-29');
  });
});

describe('calendar weeks', () => {
  const now = new Date(2026, 9, 26, 15, 20); // local time

  it('starts the first week now and ends it at midnight a week from today', () => {
    const week = weekWindow(now, 0, 31);
    expect(week.from).toEqual(now);
    expect(week.to).toEqual(new Date(2026, 10, 2, 0, 0));
  });

  it('starts later weeks at local midnight', () => {
    expect(weekWindow(now, 1, 31).from).toEqual(new Date(2026, 10, 2, 0, 0));
  });

  it('never runs past max_days_ahead', () => {
    const limit = new Date(now.getTime() + 31 * DAY_MS);
    expect(weekWindow(now, 4, 31).to).toEqual(limit);
    expect(hasNextWeek(now, 3, 31)).toBe(true);
    expect(hasNextWeek(now, 4, 31)).toBe(false);
    expect(hasNextWeek(now, 0, 5)).toBe(false);
  });
});

describe('calendar responses', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  it('reads slots, expired, booked and unavailable', async () => {
    expect(await readSlotsResponse(json(200, { slots: [{ start_time: 'x' }] }))).toEqual({
      kind: 'slots',
      slots: [{ start_time: 'x' }]
    });
    expect((await readSlotsResponse(json(410, { status: 'expired', message: 'Gone' }))).kind).toBe(
      'expired'
    );
    expect((await readSlotsResponse(json(409, { status: 'submitted' }))).kind).toBe('booked');
    expect(await readSlotsResponse(json(503, { status: 'unavailable', message: 'Down' }))).toEqual({
      kind: 'unavailable',
      message: 'Down'
    });
  });

  it('reads a booking', async () => {
    expect(
      await readBookingResponse(
        json(200, { status: 'submitted', start_time: '2026-10-28T14:00:00Z', message: 'See you' }),
        'picked'
      )
    ).toEqual({ kind: 'booked', startTime: '2026-10-28T14:00:00Z', message: 'See you' });
  });

  it('treats an earlier booking (409 submitted) as done, without a time', async () => {
    expect(
      await readBookingResponse(json(409, { status: 'submitted', message: 'Done' }), 'p')
    ).toEqual({ kind: 'booked', startTime: null, message: 'Done' });
  });

  it('tells a taken slot apart from an earlier booking', async () => {
    expect(
      (await readBookingResponse(json(409, { status: 'slot_taken', message: 'Taken' }), 'p')).kind
    ).toBe('slot_taken');
  });

  it('keeps only an http(s) fallback link', async () => {
    const good = await readBookingResponse(
      json(422, {
        status: 'booking_not_allowed',
        message: 'Use the link',
        fallback_url: 'https://calendly.com/d/abc'
      }),
      'p'
    );
    expect(good).toEqual({
      kind: 'fallback',
      message: 'Use the link',
      url: 'https://calendly.com/d/abc'
    });

    const bad = await readBookingResponse(
      json(422, {
        status: 'booking_not_allowed',
        message: 'x',
        fallback_url: 'javascript:alert(1)'
      }),
      'p'
    );
    expect(bad.kind === 'fallback' && bad.url).toBeNull();
  });

  it('reads field errors', async () => {
    const outcome = await readBookingResponse(
      json(422, { message: 'Invalid', errors: { email: ['Bad email'], name: 'Too long' } }),
      'p'
    );
    expect(outcome).toEqual({
      kind: 'invalid',
      message: 'Invalid',
      errors: { email: ['Bad email'], name: ['Too long'] }
    });
  });

  it('reads expired and unavailable, with default text when the body has none', async () => {
    expect((await readBookingResponse(json(410, {}), 'p')).kind).toBe('expired');
    const down = await readBookingResponse(json(503, {}), 'p');
    expect(down.kind).toBe('unavailable');
    expect(down.message).not.toBe('');
  });
});

describe('inline calendar artifact', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
  });

  beforeEach(() => {
    apiMock.mockReset();
    widget.messageHistory = [];
  });

  it('shows the header and the first day of free times from the artifact', () => {
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    expect(el.querySelector('.chatvia-widget-calendar-title')?.textContent).toBe('Intro call');
    expect(el.querySelector('.chatvia-widget-calendar-meta')?.textContent).toContain('30 min');
    expect(el.querySelectorAll('.chatvia-widget-calendar-day')).toHaveLength(1);
    // Sorted, and no request needed for the first week.
    expect(timeButtons(el).map(b => b.dataset.startTime)).toEqual([
      tomorrowAt(14),
      tomorrowAt(14, 30)
    ]);
    expect(apiMock).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLButtonElement>('[aria-label="Previous week"]')?.disabled).toBe(
      true
    );
  });

  it('shows the booked time after a reload', () => {
    const el = createInlineCalendar(
      host,
      baseCalendar({ status: 'submitted', booked_start_time: tomorrowAt(14) }),
      'msg-1'
    );

    expect(el.querySelector('.chatvia-widget-calendar-booked')).toBeTruthy();
    expect(el.querySelector('.chatvia-widget-calendar-booked-time')?.textContent).not.toBe('');
    expect(timeButtons(el)).toHaveLength(0);
  });

  it('shows the expired view', () => {
    const el = createInlineCalendar(host, baseCalendar({ status: 'expired' }), 'msg-1');
    expect(el.querySelector('.chatvia-widget-form-expired')).toBeTruthy();
  });

  it('fetches the next week', async () => {
    apiMock.mockResolvedValue(json(200, { slots: [] }));
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    el.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click();

    await vi.waitFor(() => expect(el.querySelector('.chatvia-widget-calendar-empty')).toBeTruthy());
    const req = apiMock.mock.calls[0][0];
    expect(req.method).toBe('GET');
    expect(req.endpoint).toMatch(/^calendar\/bi-1\/slots\?from=.+&to=.+/);
    expect(req.headers['X-CONVERSATION-ID']).toBe('conv-1');
    const query = new URLSearchParams(req.endpoint.split('?')[1]);
    const span = Date.parse(query.get('to')!) - Date.parse(query.get('from')!);
    expect(span).toBeLessThanOrEqual(7 * DAY_MS + 3_600_000); // a DST change adds an hour
  });

  it('fetches fresh times when the artifact is stale', async () => {
    apiMock.mockResolvedValue(json(200, { slots: [{ start_time: tomorrowAt(9) }] }));
    const el = createInlineCalendar(
      host,
      baseCalendar({
        window_start: new Date(Date.now() - 10 * DAY_MS).toISOString(),
        window_end: new Date(Date.now() - 3 * DAY_MS).toISOString()
      }),
      'msg-1'
    );

    await vi.waitFor(() => expect(timeButtons(el)).toHaveLength(1));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('blocks booking without a name or a valid email', () => {
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');
    timeButtons(el)[0].click();

    fillAndSubmit(el, '', 'jane@acme.com');
    fillAndSubmit(el, 'Jane', 'not-an-email');

    expect(apiMock).not.toHaveBeenCalled();
    expect(el.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('books the picked time and shows it', async () => {
    apiMock.mockResolvedValue(
      json(200, { status: 'submitted', start_time: tomorrowAt(14), message: 'See you then' })
    );
    widget.messageHistory = [
      { id: 'msg-1', metadata: { artifacts: [{ kind: 'calendar', data: baseCalendar() }] } }
    ];
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    timeButtons(el)[0].click();
    el.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')!.value = 'About pricing';
    fillAndSubmit(el);

    await vi.waitFor(() =>
      expect(el.querySelector('.chatvia-widget-calendar-booked')).toBeTruthy()
    );
    const req = apiMock.mock.calls[0][0];
    expect(req.endpoint).toBe('calendar/bi-1/book');
    expect(req.method).toBe('POST');
    expect(JSON.parse(req.body)).toEqual({
      start_time: tomorrowAt(14),
      name: 'Jane',
      email: 'jane@acme.com',
      timezone: visitorTimeZone(),
      notes: 'About pricing',
      assistant_message_id: 'msg-1'
    });
    expect(el.textContent).toContain('See you then');
    const stored = widget.messageHistory[0].metadata?.artifacts?.[0];
    expect(stored?.kind === 'calendar' && stored.data?.status).toBe('submitted');
    expect(stored?.kind === 'calendar' && stored.data?.booked_start_time).toBe(tomorrowAt(14));
  });

  it('reloads the week when the time was taken', async () => {
    apiMock
      .mockResolvedValueOnce(json(409, { status: 'slot_taken', message: 'Just taken' }))
      .mockResolvedValueOnce(json(200, { slots: [{ start_time: tomorrowAt(16) }] }));
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    timeButtons(el)[0].click();
    fillAndSubmit(el);

    await vi.waitFor(() =>
      expect(el.querySelector('.chatvia-widget-calendar-status')?.textContent).toBe('Just taken')
    );
    expect(apiMock.mock.calls[1][0].method).toBe('GET');
    expect(timeButtons(el).map(b => b.dataset.startTime)).toEqual([tomorrowAt(16)]);
  });

  it('offers the booking page when booking here is not allowed', async () => {
    apiMock.mockResolvedValue(
      json(422, {
        status: 'booking_not_allowed',
        message: 'Please book on Calendly',
        fallback_url: 'https://calendly.com/d/abc'
      })
    );
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    timeButtons(el)[0].click();
    fillAndSubmit(el);

    await vi.waitFor(() =>
      expect(el.querySelector('.chatvia-widget-calendar-fallback')).toBeTruthy()
    );
    const link = el.querySelector<HTMLAnchorElement>('.chatvia-widget-calendar-fallback-link')!;
    expect(link.href).toBe('https://calendly.com/d/abc');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(el.textContent).toContain('Please book on Calendly');
  });

  it('shows server field errors next to the fields', async () => {
    apiMock.mockResolvedValue(json(422, { message: 'Invalid', errors: { email: ['Bad email'] } }));
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');

    timeButtons(el)[0].click();
    fillAndSubmit(el);

    await vi.waitFor(() =>
      expect(el.querySelector('input[name="email"]')?.getAttribute('aria-invalid')).toBe('true')
    );
    expect(el.textContent).toContain('Bad email');
    expect(el.querySelector('form')).toBeTruthy();
  });

  it('goes back to the times from the form', () => {
    const el = createInlineCalendar(host, baseCalendar(), 'msg-1');
    timeButtons(el)[1].click();
    expect(el.querySelector('form')).toBeTruthy();

    Array.from(el.querySelectorAll('button'))
      .find(b => b.textContent === 'Back')!
      .click();

    expect(el.querySelector('form')).toBeNull();
    expect(timeButtons(el)).toHaveLength(2);
  });
});
