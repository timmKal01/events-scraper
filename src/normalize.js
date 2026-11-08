// One event shape for every site, the filters, and the merge of the same event listed on more than one site.
import { localDate } from './time.js';

export const SOURCE_NAMES = { eventbrite: 'Eventbrite', meetup: 'Meetup', luma: 'Luma' };
const DESCRIPTION_MAX = 2000;

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Lowercase ASCII slug: "São Paulo" -> "sao-paulo", "United Kingdom" -> "united-kingdom". */
export function slugify(value) {
    return String(value ?? '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Every field in the same order on every row, null when a site doesn't give it. */
export function makeEvent(f) {
    const description = text(f.description);
    return {
        title: text(f.title),
        startDate: text(f.startDate),
        endDate: text(f.endDate),
        timezone: text(f.timezone),
        source: f.source,
        url: text(f.url),
        venueName: text(f.venueName),
        address: text(f.address),
        city: text(f.city),
        region: text(f.region),
        country: text(f.country)?.toUpperCase() ?? null,
        latitude: num(f.latitude),
        longitude: num(f.longitude),
        isOnline: f.isOnline === true,
        isCancelled: f.isCancelled === true,
        organizer: text(f.organizer),
        organizerUrl: text(f.organizerUrl),
        isFree: typeof f.isFree === 'boolean' ? f.isFree : null,
        price: num(f.price),
        currency: text(f.currency)?.toUpperCase() ?? null,
        attendees: num(f.attendees),
        categories: Array.isArray(f.categories) ? [...new Set(f.categories.map(text).filter(Boolean))] : [],
        description: description && description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description,
        imageUrl: text(f.imageUrl),
        eventId: text(f.eventId),
    };
}

const words = (value) => slugify(value).split('-').filter(Boolean);

/**
 * True when every word of the keyword starts a word somewhere in the text ("ai meetup" matches "AI Founders Meetup",
 * "ai" doesn't match "said"). Used for Luma, whose city pages have no search box; Eventbrite and Meetup search
 * themselves.
 */
export function matchesKeyword(textValue, keyword) {
    const wanted = words(keyword);
    if (!wanted.length) return true;
    const have = words(textValue);
    return wanted.every((w) => have.some((h) => h.startsWith(w)));
}

/**
 * The run's filters. Events that already ended (or started more than a day ago with no end) are dropped, because a
 * city page can still list today's events after they finish.
 */
export function makeEventFilter({ dateFrom = null, dateTo = null, includeOnlineEvents = false, now = new Date() } = {}) {
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    return (event) => {
        const start = localDate(event.startDate);
        const end = localDate(event.endDate) ?? start;
        if (!start) return false;
        if (end < yesterday) return false;
        if (dateFrom && end < dateFrom) return false;
        if (dateTo && start > dateTo) return false;
        if (event.isCancelled) return false;
        if (event.isOnline && !includeOnlineEvents) return false;
        return true;
    };
}

/** The same event on two sites: same title words and same local start date. */
export function eventKey(event) {
    return `${words(event.title).join(' ')}|${localDate(event.startDate)}`;
}

/**
 * Merges events listed on more than one site. The first listing (sources are read in the buyer's order) is kept, the
 * others go into alsoListedOn, and fields the first one lacks are filled from them.
 */
export function dedupeEvents(events) {
    const byKey = new Map();
    for (const event of events) {
        const key = eventKey(event);
        const kept = byKey.get(key);
        if (!kept) {
            byKey.set(key, { ...event, alsoListedOn: [] });
            continue;
        }
        if (kept.url === event.url) continue;
        if (!kept.alsoListedOn.some((l) => l.url === event.url)) kept.alsoListedOn.push({ source: event.source, url: event.url });
        for (const [field, value] of Object.entries(event)) {
            const empty = kept[field] === null || (Array.isArray(kept[field]) && kept[field].length === 0);
            if (empty && value !== null && !(Array.isArray(value) && value.length === 0)) kept[field] = value;
        }
    }
    return [...byKey.values()];
}

/** Earliest first; events without a start go last. */
export function byStart(a, b) {
    const ta = Date.parse(a.startDate ?? '') || Infinity;
    const tb = Date.parse(b.startDate ?? '') || Infinity;
    return ta - tb;
}

/** The keys an "only new" list remembers for an event: every URL it was found under. */
export function seenKeys(event) {
    return [event.url, ...(event.alsoListedOn ?? []).map((l) => l.url)].filter(Boolean);
}
