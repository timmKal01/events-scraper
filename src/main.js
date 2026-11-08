import { Actor, log } from 'apify';
import { geocode } from './geocode.js';
import * as eventbrite from './sources/eventbrite.js';
import * as meetup from './sources/meetup.js';
import * as luma from './sources/luma.js';
import { SOURCE_NAMES, byStart, dedupeEvents, makeEventFilter, seenKeys } from './normalize.js';

await Actor.init();

/** Must match the event name in this Actor's pay-per-event pricing on Apify. */
const EVENT_SAVED = 'event';
const SOURCES = { eventbrite, meetup, luma };
const EXAMPLE_LOCATIONS = ['New York'];
const MAX_LOCATIONS = 10;
const MAX_KEYWORD = 80;
const DEFAULT_MAX_PER_SOURCE = 40;
const MAX_PER_SOURCE = 200;
const DEFAULT_SEEN_LIST = 'events-scraper-seen';
const SEEN_KEY = 'event-urls';
const SEEN_LIMIT = 50_000;
const LIST_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const scrapedAt = new Date().toISOString();

/** The input as options, or { error } with what to change. */
function readInput(input) {
    const seenNames = new Set();
    const locations = (Array.isArray(input.locations) ? input.locations : [input.locations])
        .map((l) => String(l ?? '').trim().replace(/\s+/g, ' '))
        .filter((l) => l && !seenNames.has(l.toLowerCase()) && seenNames.add(l.toLowerCase()));
    if (locations.length > MAX_LOCATIONS) return { error: `Give up to ${MAX_LOCATIONS} cities per run (got ${locations.length}).` };

    const keyword = String(input.keyword ?? '').trim().replace(/\s+/g, ' ');
    if (keyword.length > MAX_KEYWORD) return { error: `Keep the keyword under ${MAX_KEYWORD} characters.` };

    const requested = (Array.isArray(input.sources) ? input.sources : []).map((s) => String(s).toLowerCase().trim()).filter(Boolean);
    const unknown = requested.filter((s) => !SOURCES[s]);
    if (unknown.length) return { error: `Unknown source "${unknown.join('", "')}". Use any of: ${Object.keys(SOURCES).join(', ')}.` };
    const sources = requested.length ? [...new Set(requested)] : Object.keys(SOURCES);

    const max = input.maxEventsPerSource ?? DEFAULT_MAX_PER_SOURCE;
    if (!Number.isInteger(max) || max < 1 || max > MAX_PER_SOURCE) {
        return { error: `maxEventsPerSource must be a whole number from 1 to ${MAX_PER_SOURCE}.` };
    }

    const dateFrom = String(input.dateFrom ?? '').trim().slice(0, 10) || null;
    const dateTo = String(input.dateTo ?? '').trim().slice(0, 10) || null;
    for (const [name, value] of [['dateFrom', dateFrom], ['dateTo', dateTo]]) {
        if (value && !DATE_RE.test(value)) return { error: `${name} must be a date like 2026-12-01.` };
    }
    if (dateFrom && dateTo && dateFrom > dateTo) return { error: 'dateFrom is after dateTo.' };

    const seenListName = String(input.seenListName ?? '').trim() || DEFAULT_SEEN_LIST;
    if (input.onlyNew && !LIST_NAME_RE.test(seenListName)) {
        return { error: 'seenListName must be 3 to 63 characters: lowercase letters, digits and hyphens, starting and ending with a letter or digit.' };
    }

    return {
        locations: locations.length ? locations : EXAMPLE_LOCATIONS,
        usedExample: locations.length === 0,
        keyword,
        sources,
        max,
        dateFrom,
        dateTo,
        includeOnlineEvents: input.includeOnlineEvents === true,
        onlyNew: input.onlyNew === true,
        seenListName,
    };
}

const input = (await Actor.getInput()) ?? {};
const options = readInput(input);
if (options.error) {
    // Input that can't be used ends with one uncharged row saying what to change, not a failed run.
    await Actor.pushData({ rowType: 'error', title: "Couldn't start the search (not charged)", error: options.error, scrapedAt });
    await Actor.setStatusMessage(`Nothing searched or charged: ${options.error}`, { isStatusMessageTerminal: true });
    await Actor.exit();
}

const { locations, keyword, sources, max, onlyNew, seenListName } = options;
log.info('Searching events', { locations, keyword, sources, maxEventsPerSource: max, dateFrom: options.dateFrom, dateTo: options.dateTo, includeOnlineEvents: options.includeOnlineEvents, onlyNew });
if (options.usedExample) log.info(`No cities given, so this run uses the example: ${EXAMPLE_LOCATIONS.join(', ')}.`);

let seenStore = null;
let seen = new Set();
if (onlyNew) {
    seenStore = await Actor.openKeyValueStore(seenListName);
    seen = new Set((await seenStore.getValue(SEEN_KEY)) ?? []);
    log.info(`Only new events: ${seen.size} event links remembered in "${seenListName}".`);
}

const keep = makeEventFilter({ dateFrom: options.dateFrom, dateTo: options.dateTo, includeOnlineEvents: options.includeOnlineEvents });
const summary = { locations: [], saved: 0, fetched: 0, afterFilters: 0, skippedAsSeen: 0, problems: 0 };
const delivered = [];
let stopped = false;

/** One uncharged row explaining why a source gave nothing for a place. */
async function pushProblem(kind, location, source, message) {
    summary.problems++;
    const who = source ? SOURCE_NAMES[source] : 'This place';
    await Actor.pushData({
        rowType: kind,
        title: source ? `${who}: nothing for ${location} (not charged)` : `${location}: skipped (not charged)`,
        source: source ?? null,
        searchLocation: location,
        [kind === 'error' ? 'error' : 'note']: message,
        scrapedAt,
    });
}

for (const location of locations) {
    if (stopped) break;
    const stats = { location, place: null, fetched: {}, matched: {}, saved: 0 };
    summary.locations.push(stats);

    let place;
    try {
        place = await geocode(location);
    } catch (err) {
        await pushProblem('error', location, null, err.message);
        continue;
    }
    if (!place) {
        await pushProblem('error', location, null, `No place called "${location}" was found. Add the country, e.g. "${location}, UK".`);
        continue;
    }
    stats.place = { city: place.city, state: place.state, country: place.countryCode };

    // The sites are read in parallel; one that fails is reported and the others still count.
    const results = await Promise.all(sources.map(async (id) => {
        try {
            return { id, ...(await SOURCES[id].search({ place, keyword, max })) };
        } catch (err) {
            return { id, error: err.message };
        }
    }));

    const found = [];
    for (const r of results) {
        if (r.error) {
            log.warning(`${SOURCE_NAMES[r.id]} couldn't be read for ${location}: ${r.error}`);
            await pushProblem('error', location, r.id, r.error);
            continue;
        }
        if (r.note) await pushProblem('note', location, r.id, r.note);
        stats.fetched[r.id] = r.events.length;
        stats.matched[r.id] = r.matched ?? null;
        found.push(...r.events);
    }
    summary.fetched += found.length;

    let events = dedupeEvents(found.filter(keep)).sort(byStart);
    summary.afterFilters += events.length;
    if (onlyNew) {
        const before = events.length;
        events = events.filter((e) => !seenKeys(e).some((k) => seen.has(k)));
        summary.skippedAsSeen += before - events.length;
    }

    for (const event of events) {
        const result = await Actor.pushData({ rowType: 'event', ...event, searchLocation: location, keyword: keyword || null, scrapedAt }, EVENT_SAVED);
        stats.saved++;
        summary.saved++;
        if (onlyNew) delivered.push(...seenKeys(event));
        if (result?.eventChargeLimitReached) {
            stopped = true;
            log.warning('The run reached its maximum cost (set by the user), so it stopped here.');
            break;
        }
    }
    log.info(`${location}: ${stats.saved} event(s) saved`, { fetched: stats.fetched, matched: stats.matched });
}

if (onlyNew && delivered.length) {
    // Newest last, so the oldest links drop off first once the list is full.
    const merged = [...seen, ...delivered.filter((k) => !seen.has(k))];
    await seenStore.setValue(SEEN_KEY, merged.slice(-SEEN_LIMIT));
}

if (summary.saved === 0) {
    // An empty dataset looks the same as a broken run, so say why nothing came back.
    const reason = onlyNew && summary.skippedAsSeen > 0
        ? `All ${summary.skippedAsSeen} events found were returned by earlier runs (list "${seenListName}").`
        : summary.fetched === 0
            ? 'No site returned events for these places. See the rows above for each site.'
            : `${summary.fetched} events were found, but none matched the dates, online and cancelled filters.`;
    await Actor.pushData({ rowType: 'note', title: 'No events saved in this run (not charged)', note: reason, scrapedAt });
}

await Actor.setValue('SUMMARY', { ...summary, keyword: keyword || null, sources, onlyNew, scrapedAt });
await Actor.setStatusMessage(
    `${summary.saved} event(s) saved from ${summary.locations.length} place(s)`
    + `${summary.skippedAsSeen ? `, ${summary.skippedAsSeen} skipped as already returned` : ''}`
    + `${summary.problems ? `; ${summary.problems} site/place problem(s), see the uncharged rows` : ''}.`,
    { isStatusMessageTerminal: true },
);
await Actor.exit();
