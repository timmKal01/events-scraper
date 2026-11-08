// Meetup's public event search (meetup.com/find/?source=EVENTS). The page carries its first page of results (about
// 20 to 30 events) in its Next.js data, plus schema.org JSON-LD with end times and coordinates. robots.txt allows
// these pages; Meetup's API paths are disallowed there and aren't used.
import { getText } from '../http.js';
import { jsonLdEvents, nextData } from '../pagedata.js';
import { distanceKm } from '../geocode.js';
import { makeEvent } from '../normalize.js';

/** Meetup's location parameter: "us--ny--New York" in the US and Canada, "gb--London" elsewhere. */
export function locationParam(place) {
    const cc = String(place.countryCode ?? '').toLowerCase();
    if ((cc === 'us' || cc === 'ca') && place.stateCode) return `${cc}--${place.stateCode.toLowerCase()}--${place.city}`;
    return `${cc}--${place.city}`;
}

export function searchUrl(place, keyword) {
    const params = new URLSearchParams({ source: 'EVENTS', location: locationParam(place) });
    if (keyword) params.set('keywords', keyword);
    return `https://www.meetup.com/find/?${params}`;
}

/** The filter Meetup applied, from its cached query key: 'eventSearch:{"filter":{"city":"London",...}}'. */
function appliedFilter(key) {
    try {
        return JSON.parse(key.slice(key.indexOf('{')))?.filter ?? null;
    } catch {
        const city = /"city":"([^"]*)"/.exec(key)?.[1];
        const country = /"country":"([^"]*)"/.exec(key)?.[1];
        return city || country ? { city, country } : null;
    }
}

/**
 * The events on a find page with their group and photo resolved, or null if the page has no search data. With a
 * keyword the page holds "eventSearch" results; without one, Meetup shows "recommendedEvents" for the place instead.
 */
export function parseFindPage(html) {
    const state = nextData(html)?.props?.pageProps?.__APOLLO_STATE__;
    if (!state?.ROOT_QUERY) return null;
    const keys = Object.keys(state.ROOT_QUERY);
    const key = keys.find((k) => k.startsWith('eventSearch')) ?? keys.find((k) => k.startsWith('recommendedEvents'));
    if (!key) return { filter: null, items: [] };
    const resolve = (v) => (v && typeof v === 'object' && v.__ref ? state[v.__ref] : v) ?? null;
    const ld = new Map(jsonLdEvents(html).map((e) => [e.url, e]));
    const items = (state.ROOT_QUERY[key]?.edges ?? [])
        // Recommended events wrap each edge in its own cache entry, so the edge may be a reference too.
        .map((edge) => resolve(resolve(edge)?.node))
        .filter((ev) => ev?.__typename === 'Event')
        .map((ev) => ({
            ev,
            group: resolve(ev.group),
            venue: resolve(ev.venue),
            photo: resolve(ev.featuredEventPhoto) ?? resolve(ev.displayPhoto),
            ld: ld.get(ev.eventUrl) ?? null,
        }));
    return { filter: appliedFilter(key), items };
}

/** True when Meetup searched the city asked for (or the city it's part of, e.g. New York for Brooklyn). */
export function sameCity(filter, place) {
    if (filter?.city) {
        const names = [place.city, place.parentCity].filter(Boolean).map((n) => String(n).toLowerCase());
        return names.includes(String(filter.city).toLowerCase())
            && (!filter.country || String(filter.country).toLowerCase() === String(place.countryCode).toLowerCase());
    }
    // Recommended events carry only coordinates.
    if (Number.isFinite(filter?.lat) && Number.isFinite(filter?.lon) && Number.isFinite(place.lat)) {
        return distanceKm(filter.lat, filter.lon, place.lat, place.lon) <= 75;
    }
    return true;
}

/** Meetup's venue address often already ends with the city ("124 E 14th St, New York, NY 10003, USA"). */
export function venueAddress(venue) {
    if (!venue?.address) return [venue?.city, venue?.state].filter(Boolean).join(', ') || null;
    const hasCity = venue.city && venue.address.toLowerCase().includes(String(venue.city).toLowerCase());
    return hasCity ? venue.address : [venue.address, venue.city, venue.state].filter(Boolean).join(', ');
}

export function normalizeItem({ ev, group, venue, photo, ld }) {
    const fee = ev.feeSettings ?? null;
    // Meetup's JSON-LD has had no coordinates or end time so far; read them if it ever does.
    const geo = ld?.location?.geo ?? null;
    return makeEvent({
        source: 'meetup',
        eventId: String(ev.id ?? ''),
        title: ev.title,
        url: ev.eventUrl,
        startDate: ev.dateTime ?? ld?.startDate,
        endDate: ev.endTime ?? ld?.endDate ?? null,
        timezone: group?.timezone,
        isOnline: ev.eventType === 'ONLINE',
        venueName: venue?.name,
        address: venueAddress(venue),
        city: venue?.city,
        region: venue?.state,
        country: venue?.country,
        latitude: geo?.latitude ?? venue?.lat,
        longitude: geo?.longitude ?? venue?.lon ?? venue?.lng,
        organizer: group?.name,
        organizerUrl: group?.urlname ? `https://www.meetup.com/${group.urlname}/` : null,
        isFree: fee === null,
        price: fee === null ? 0 : fee.amount,
        currency: fee?.currency,
        attendees: ev.rsvps?.totalCount ?? ev.going?.totalCount,
        description: ev.description,
        imageUrl: photo?.highResUrl ?? photo?.standardUrl ?? (photo?.baseUrl && photo?.id ? `${photo.baseUrl}${photo.id}/676x380.webp` : null),
    });
}

/** Up to `max` events for one place (Meetup's page holds about 20 to 30). Throws with a plain reason on failure. */
export async function search({ place, keyword, max }) {
    const { body } = await getText(searchUrl(place, keyword));
    const parsed = parseFindPage(body);
    if (!parsed) throw new Error("Meetup's search page didn't contain its event data");
    if (!sameCity(parsed.filter, place)) {
        throw new Error(`Meetup searched ${parsed.filter.city ? `"${parsed.filter.city}"` : 'somewhere else'} instead of "${place.city}"`);
    }
    return { events: parsed.items.map(normalizeItem).slice(0, max), matched: parsed.filter?.city ?? null };
}
