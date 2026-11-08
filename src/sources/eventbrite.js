// Eventbrite's public city search (eventbrite.com/d/<place>/<keyword>/), 20 events a page. The page carries its own
// results as window.__SERVER_DATA__; robots.txt allows these pages. Ticket prices aren't in the search data.
import { getText } from '../http.js';
import { objectAfter } from '../pagedata.js';
import { localToIso } from '../time.js';
import { makeEvent, slugify } from '../normalize.js';

const MAX_PAGES = 10;

/** Eventbrite's place slug: "ny--new-york" in the US, "united-kingdom--london" elsewhere. */
export function locationSlug(place) {
    const city = slugify(place.city);
    if (place.countryCode === 'US' && place.stateCode) return `${place.stateCode.toLowerCase()}--${city}`;
    if (place.countryName) return `${slugify(place.countryName)}--${city}`;
    return city;
}

export function searchUrl(place, keyword, page = 1) {
    const what = slugify(keyword) || 'all-events';
    return `https://www.eventbrite.com/d/${locationSlug(place)}/${what}/${page > 1 ? `?page=${page}` : ''}`;
}

/** The results, the place Eventbrite matched and the page count, or null if the page has no search data. */
export function parseSearchPage(html) {
    const data = objectAfter(html, 'window.__SERVER_DATA__');
    const events = data?.search_data?.events;
    if (!events) return null;
    return {
        locationSlug: data.location_slug ?? null,
        pageCount: Number(events.pagination?.page_count ?? data.page_count ?? 1) || 1,
        results: Array.isArray(events.results) ? events.results : [],
    };
}

/** True when Eventbrite searched the city asked for, or the city it's part of (New York for Brooklyn). */
export function sameCity(matchedSlug, place) {
    if (!matchedSlug) return true;
    return [place.city, place.parentCity].filter(Boolean).map(slugify)
        .some((city) => matchedSlug === city || matchedSlug.endsWith(`--${city}`));
}

export function normalizeResult(r) {
    const venue = r.primary_venue ?? {};
    const address = venue.address ?? {};
    const categories = (r.tags ?? [])
        .filter((t) => /^Eventbrite(Category|SubCategory|Format)$/.test(t.prefix ?? ''))
        .map((t) => t.localized?.display_name ?? t.display_name);
    return makeEvent({
        source: 'eventbrite',
        eventId: String(r.id ?? r.eid ?? ''),
        title: r.name,
        url: r.url,
        startDate: localToIso(r.start_date, r.start_time, r.timezone),
        endDate: localToIso(r.end_date, r.end_time, r.timezone),
        timezone: r.timezone,
        isOnline: r.is_online_event === true,
        isCancelled: r.is_cancelled === true,
        venueName: venue.name,
        address: address.localized_address_display ?? [address.address_1, address.city].filter(Boolean).join(', '),
        city: address.city,
        region: address.region,
        country: address.country,
        latitude: address.latitude,
        longitude: address.longitude,
        categories,
        description: r.summary,
        imageUrl: r.image?.url ?? r.image?.original?.url,
    });
}

/** Up to `max` events for one place. Throws with a plain reason when Eventbrite can't be read for it. */
export async function search({ place, keyword, max }) {
    const events = [];
    let matched = null;
    for (let page = 1; page <= MAX_PAGES && events.length < max; page++) {
        const { body } = await getText(searchUrl(place, keyword, page));
        const parsed = parseSearchPage(body);
        if (!parsed) throw new Error("Eventbrite's search page didn't contain its event data");
        if (page === 1) {
            matched = parsed.locationSlug;
            if (!sameCity(matched, place)) throw new Error(`Eventbrite matched "${place.query}" to "${matched}", a different place`);
        }
        for (const r of parsed.results) events.push(normalizeResult(r));
        if (page >= parsed.pageCount || parsed.results.length === 0) break;
    }
    return { events: events.slice(0, max), matched };
}
