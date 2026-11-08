// A place the buyer typed ("Austin", "London, UK") -> city, country and coordinates, which each event site needs in
// its own shape. OpenStreetMap's place search (Nominatim) first, Photon (komoot, the same data) if Nominatim doesn't
// answer. One request each at most, with the actor's identifying User-Agent.
import { getJson } from './http.js';

// Photon has no ISO state codes, and Meetup needs one for the US and Canada.
const STATE_CODES = {
    US: {
        alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
        delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
        illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME',
        maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
        montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
        'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
        pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
        texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
        wisconsin: 'WI', wyoming: 'WY',
    },
    CA: {
        alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB', 'newfoundland and labrador': 'NL',
        'nova scotia': 'NS', ontario: 'ON', 'prince edward island': 'PE', quebec: 'QC', québec: 'QC', saskatchewan: 'SK',
        'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT',
    },
};

const CITY_TYPES = new Set(['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'borough', 'quarter']);

const withoutPrefix = (name) => String(name).replace(/^(greater|city of|metropolitan|metro|municipality of|town of|county of)\s+/i, '');

/**
 * The city name to search with. OpenStreetMap calls London "Greater London" and New York "City of New York", while the
 * event sites know them as London and New York, so a prefix like that is dropped when what's left is what was typed.
 */
export function cityName(typedQuery, mapName) {
    const typed = String(typedQuery ?? '').split(',')[0].trim().replace(/\s+/g, ' ');
    if (!mapName) return typed || null;
    const bare = withoutPrefix(mapName);
    // The map's own spelling, so "london" still searches "London".
    if (typed && bare.toLowerCase() === typed.toLowerCase()) return bare;
    return mapName;
}

/** Nominatim result -> place. Exported for tests. */
export function placeFromNominatim(hit, query) {
    if (!hit) return null;
    const a = hit.address ?? {};
    const countryCode = a.country_code?.toUpperCase() ?? null;
    // "New York" comes back as address.city "City of New York", so the result's own name wins when it is a town.
    const mapName = (CITY_TYPES.has(hit.addresstype) ? hit.name : null)
        ?? a.city ?? a.town ?? a.village ?? a.municipality ?? hit.name;
    const city = cityName(query, mapName);
    const iso = a['ISO3166-2-lvl4'] ?? a['ISO3166-2-lvl3'] ?? '';
    const stateCode = iso.startsWith(`${countryCode}-`) ? iso.slice(countryCode.length + 1) : null;
    // A borough or district (Brooklyn) belongs to a city (New York) that event sites may search instead.
    const parent = a.city ?? a.town ? withoutPrefix(a.city ?? a.town) : null;
    return {
        query,
        name: hit.display_name ?? city,
        city,
        parentCity: parent && parent.toLowerCase() !== String(city).toLowerCase() ? parent : null,
        state: a.state ?? null,
        stateCode,
        countryCode,
        countryName: a.country ?? null,
        lat: Number(hit.lat),
        lon: Number(hit.lon),
    };
}

/** Photon feature -> place. Exported for tests. */
export function placeFromPhoton(feature, query) {
    if (!feature) return null;
    const p = feature.properties ?? {};
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    const countryCode = p.countrycode?.toUpperCase() ?? null;
    const city = cityName(query, p.city ?? p.name);
    return {
        query,
        name: [p.name, p.city, p.state, p.country].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', '),
        city,
        state: p.state ?? null,
        stateCode: STATE_CODES[countryCode]?.[String(p.state ?? '').toLowerCase()] ?? null,
        countryCode,
        countryName: p.country ?? null,
        lat: Number(lat),
        lon: Number(lon),
    };
}

/**
 * @returns {Promise<ReturnType<typeof placeFromNominatim>>} null when neither service knows the place.
 *   Throws only when both services failed to answer.
 */
export async function geocode(query) {
    try {
        const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': 'en' });
        const [hit] = await getJson(`https://nominatim.openstreetmap.org/search?${params}`);
        return placeFromNominatim(hit, query);
    } catch (first) {
        try {
            const params = new URLSearchParams({ q: query, limit: '1', lang: 'en' });
            const { features: [feature] = [] } = await getJson(`https://photon.komoot.io/api/?${params}`);
            return placeFromPhoton(feature, query);
        } catch (second) {
            throw new Error(`The place search didn't answer (${first.message}; ${second.message})`);
        }
    }
}

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}
