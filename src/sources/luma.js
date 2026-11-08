// Luma's public city pages (luma.com/nyc, luma.com/london...). Luma covers about 90 cities; each page carries its
// featured upcoming events (about 20) in its Next.js data. The city list comes from luma.com/discover. Luma's
// robots.txt only has rules for Googlebot. Only public pages are read, never Luma's internal API.
import { getText } from '../http.js';
import { nextData } from '../pagedata.js';
import { distanceKm } from '../geocode.js';
import { utcToLocalIso } from '../time.js';
import { makeEvent, matchesKeyword } from '../normalize.js';

export const MAX_DISTANCE_KM = 75;
let placesCache = null;

/** Luma's cities from its discover page's data. */
export function parsePlaces(html) {
    const places = nextData(html)?.props?.pageProps?.initialData?.places ?? [];
    return places
        .map((p) => p?.place ?? p)
        .map((p) => ({ slug: p?.slug, name: p?.name ?? p?.slug, lat: p?.coordinate?.latitude, lon: p?.coordinate?.longitude }))
        .filter((p) => p.slug && Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

async function lumaPlaces() {
    if (placesCache) return placesCache;
    const { body } = await getText('https://luma.com/discover');
    const places = parsePlaces(body);
    if (!places.length) throw new Error("Luma's city list couldn't be read");
    placesCache = places;
    return places;
}

/** The nearest Luma city within MAX_DISTANCE_KM, or null. */
export function nearestPlace(places, place) {
    let best = null;
    for (const p of places) {
        const km = distanceKm(place.lat, place.lon, p.lat, p.lon);
        if (km <= MAX_DISTANCE_KM && (!best || km < best.km)) best = { ...p, km };
    }
    return best;
}

export function parseCityPage(html) {
    const data = nextData(html)?.props?.pageProps?.initialData?.data;
    if (!data || !Array.isArray(data.events)) return null;
    return { place: data.place ?? null, entries: data.events };
}

export function normalizeEntry(entry) {
    const ev = entry.event ?? {};
    const geo = ev.geo_address_info ?? {};
    const price = entry.ticket_info?.price;
    const isFree = typeof entry.ticket_info?.is_free === 'boolean' ? entry.ticket_info.is_free : null;
    const hosts = (entry.hosts ?? []).map((h) => h?.name).filter(Boolean);
    return makeEvent({
        source: 'luma',
        eventId: ev.api_id ?? entry.api_id,
        title: ev.name,
        url: ev.url ? `https://luma.com/${ev.url}` : null,
        startDate: utcToLocalIso(ev.start_at ?? entry.start_at, ev.timezone),
        endDate: utcToLocalIso(ev.end_at, ev.timezone),
        timezone: ev.timezone,
        isOnline: ev.location_type === 'online' || ev.location_type === 'zoom',
        venueName: geo.address,
        address: geo.full_address ?? geo.short_address,
        city: geo.city,
        region: geo.region,
        country: geo.country_code,
        latitude: ev.coordinate?.latitude ?? geo.place_coordinate?.latitude,
        longitude: ev.coordinate?.longitude ?? geo.place_coordinate?.longitude,
        organizer: entry.calendar?.name ?? hosts[0],
        organizerUrl: entry.calendar?.slug ? `https://luma.com/${entry.calendar.slug}` : null,
        isFree,
        price: isFree ? 0 : (Number.isFinite(price?.cents) ? price.cents / 100 : null),
        currency: price?.currency,
        attendees: entry.guest_count,
        description: hosts.length ? `Hosted by ${hosts.join(', ')}` : null,
        imageUrl: ev.cover_url,
    });
}

/**
 * Up to `max` events for one place. Luma's city pages have no search box, so a keyword filters titles, organizers
 * and hosts here. Returns a note instead of events when Luma has no city near the place.
 */
export async function search({ place, keyword, max }) {
    const near = nearestPlace(await lumaPlaces(), place);
    if (!near) return { events: [], matched: null, note: `Luma has no city page within ${MAX_DISTANCE_KM} km of ${place.city}.` };
    const { body } = await getText(`https://luma.com/${near.slug}`);
    const parsed = parseCityPage(body);
    if (!parsed) throw new Error("Luma's city page didn't contain its event data");
    let events = parsed.entries.map(normalizeEntry);
    if (keyword) events = events.filter((e) => matchesKeyword(`${e.title} ${e.organizer ?? ''} ${e.description ?? ''}`, keyword));
    return { events: events.slice(0, max), matched: near.name };
}
