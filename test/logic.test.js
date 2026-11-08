import test from 'node:test';
import assert from 'node:assert/strict';
import { localToIso, utcToLocalIso, localDate } from '../src/time.js';
import { cityName, placeFromNominatim, distanceKm } from '../src/geocode.js';
import { slugify, makeEvent, matchesKeyword, makeEventFilter, dedupeEvents, eventKey, seenKeys, byStart } from '../src/normalize.js';
import { jsonLdEvents, objectAfter, nextData } from '../src/pagedata.js';
import * as eventbrite from '../src/sources/eventbrite.js';
import * as meetup from '../src/sources/meetup.js';
import * as luma from '../src/sources/luma.js';

const BS = String.fromCharCode(92);

test('local times get the zone offset, including across a DST change', () => {
    assert.equal(localToIso('2026-11-18', '18:30', 'America/New_York'), '2026-11-18T18:30:00-05:00');
    assert.equal(localToIso('2026-07-01', '09:00', 'America/New_York'), '2026-07-01T09:00:00-04:00');
    assert.equal(localToIso('2026-11-18', '18:30', 'Europe/London'), '2026-11-18T18:30:00+00:00');
    assert.equal(localToIso('2026-11-18', '18:30', 'Asia/Kolkata'), '2026-11-18T18:30:00+05:30');
    assert.equal(localToIso('2026-11-18', null, null), '2026-11-18T00:00:00');
    assert.equal(localToIso('', '18:30', 'UTC'), null);
});

test('UTC times convert to local time with the offset', () => {
    assert.equal(utcToLocalIso('2026-11-08T23:00:00.000Z', 'America/New_York'), '2026-11-08T18:00:00-05:00');
    assert.equal(utcToLocalIso('2026-11-08T23:00:00.000Z', 'Africa/Nairobi'), '2026-11-09T02:00:00+03:00');
    assert.equal(utcToLocalIso('nope', 'UTC'), null);
    assert.equal(localDate('2026-11-08T18:00:00-05:00'), '2026-11-08');
});

test('the typed city name wins over the map name that contains it', () => {
    assert.equal(cityName('London', 'Greater London'), 'London');
    assert.equal(cityName('london', 'Greater London'), 'London');
    assert.equal(cityName('New York', 'City of New York'), 'New York');
    assert.equal(cityName('nyc', 'New York'), 'New York');
    assert.equal(cityName('Manchester, UK', 'Manchester'), 'Manchester');
    assert.equal(cityName('York', 'New York'), 'New York');
});

test('a Nominatim hit becomes a place with ISO state code', () => {
    const place = placeFromNominatim({
        name: 'Portland', addresstype: 'city', lat: '45.5', lon: '-122.6', display_name: 'Portland, Oregon, United States',
        address: { city: 'Portland', state: 'Oregon', 'ISO3166-2-lvl4': 'US-OR', country: 'United States', country_code: 'us' },
    }, 'Portland, Oregon');
    assert.deepEqual([place.city, place.stateCode, place.countryCode, place.countryName], ['Portland', 'OR', 'US', 'United States']);
    assert.equal(placeFromNominatim(undefined, 'x'), null);
    const brooklyn = placeFromNominatim({ name: 'Brooklyn', addresstype: 'suburb', lat: '40.65', lon: '-73.95', address: { suburb: 'Brooklyn', city: 'City of New York', 'ISO3166-2-lvl4': 'US-NY', country_code: 'us' } }, 'Brooklyn');
    assert.deepEqual([brooklyn.city, brooklyn.parentCity], ['Brooklyn', 'New York']);
    assert.ok(eventbrite.sameCity('ny--new-york', brooklyn));
    const london = placeFromNominatim({ name: 'Greater London', addresstype: 'city', lat: '51.5', lon: '-0.1', address: { city: 'Greater London', country_code: 'gb' } }, 'London');
    assert.deepEqual([london.city, london.parentCity], ['London', null]);
    assert.ok(Math.abs(distanceKm(40.71, -74.0, 51.5, -0.12) - 5570) < 30);
});

test('slugs are plain ASCII', () => {
    assert.equal(slugify('São Paulo'), 'sao-paulo');
    assert.equal(slugify('United Kingdom'), 'united-kingdom');
    assert.equal(slugify('  AI & ML  '), 'ai-and-ml');
    assert.equal(slugify(''), '');
});

test('keywords match word starts, not inside words', () => {
    assert.ok(matchesKeyword('AI Founders Meetup', 'ai meetup'));
    assert.ok(matchesKeyword('Technology night', 'tech'));
    assert.ok(!matchesKeyword('He said hello', 'ai'));
    assert.ok(matchesKeyword('anything', ''));
});

const ev = (over) => makeEvent({ source: 'eventbrite', title: 'Tech Night', url: 'https://e/1', startDate: '2026-12-01T18:00:00-05:00', ...over });

test('the filter drops past, cancelled, online and out-of-range events', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const keep = makeEventFilter({ now });
    assert.ok(keep(ev()));
    assert.ok(!keep(ev({ startDate: '2026-11-01T18:00:00-05:00' })));
    assert.ok(keep(ev({ startDate: '2026-11-01T18:00:00-05:00', endDate: '2026-11-30T18:00:00-05:00' })));
    assert.ok(!keep(ev({ isCancelled: true })));
    assert.ok(!keep(ev({ isOnline: true })));
    assert.ok(makeEventFilter({ now, includeOnlineEvents: true })(ev({ isOnline: true })));
    assert.ok(!makeEventFilter({ now, dateTo: '2026-11-30' })(ev()));
    assert.ok(!makeEventFilter({ now, dateFrom: '2026-12-02' })(ev()));
    assert.ok(!keep(ev({ startDate: '' })));
});

test('the same event on two sites becomes one row with alsoListedOn', () => {
    const a = ev({ source: 'meetup', url: 'https://m/1', title: 'Tech Night!', organizer: 'NY Tech' });
    const b = ev({ source: 'eventbrite', url: 'https://e/1', title: 'tech night', latitude: 40.7, longitude: -74 });
    const c = ev({ source: 'luma', url: 'https://l/1', title: 'Tech Night', startDate: '2026-12-02T18:00:00-05:00' });
    const out = dedupeEvents([a, b, c, a]);
    assert.equal(out.length, 2);
    assert.equal(out[0].source, 'meetup');
    assert.deepEqual(out[0].alsoListedOn, [{ source: 'eventbrite', url: 'https://e/1' }]);
    assert.equal(out[0].latitude, 40.7);
    assert.equal(eventKey(a), eventKey(b));
    assert.deepEqual(seenKeys(out[0]), ['https://m/1', 'https://e/1']);
    assert.deepEqual([c, a].sort(byStart).map((e) => e.source), ['meetup', 'luma']);
});

test('page data helpers read JSON-LD, Next.js data and a JS object with escapes', () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"MusicEvent","name":"A"},{"@type":"Place"}]}</script>
        <script type="application/ld+json">{broken</script>
        <script id="__NEXT_DATA__" type="application/json">{"props":{"x":1}}</script>
        <script>window.__SERVER_DATA__ = {"a":"q${BS}"}","b":{"c":[1,2]}};</script>`;
    assert.deepEqual(jsonLdEvents(html).map((e) => e.name), ['A']);
    assert.equal(nextData(html).props.x, 1);
    assert.deepEqual(objectAfter(html, 'window.__SERVER_DATA__'), { a: 'q"}', b: { c: [1, 2] } });
    assert.equal(objectAfter(html, 'missing'), null);
});

const NY = { query: 'New York', city: 'New York', stateCode: 'NY', countryCode: 'US', countryName: 'United States', lat: 40.71, lon: -74.0 };
const LONDON = { query: 'London', city: 'London', stateCode: 'ENG', countryCode: 'GB', countryName: 'United Kingdom', lat: 51.5, lon: -0.12 };

test('Eventbrite URLs, place check and result parsing', () => {
    assert.equal(eventbrite.searchUrl(NY, 'tech'), 'https://www.eventbrite.com/d/ny--new-york/tech/');
    assert.equal(eventbrite.searchUrl(LONDON, '', 3), 'https://www.eventbrite.com/d/united-kingdom--london/all-events/?page=3');
    assert.ok(eventbrite.sameCity('united-kingdom--london', LONDON));
    assert.ok(!eventbrite.sameCity('online', LONDON));
    const html = `<script>window.__SERVER_DATA__ = ${JSON.stringify({
        location_slug: 'ny--new-york',
        search_data: { events: { pagination: { page_count: 3 }, results: [{
            id: '1', name: 'AECtech', url: 'https://www.eventbrite.com/e/1', start_date: '2026-11-18', start_time: '18:30',
            end_date: '2026-11-18', end_time: '21:00', timezone: 'America/New_York', is_online_event: false, summary: 'Hi',
            tags: [{ prefix: 'EventbriteCategory', display_name: 'Science & Technology' }, { prefix: 'OrganizerTag', display_name: 'x' }],
            primary_venue: { name: 'Cornell Tech', address: { city: 'New York', region: 'NY', country: 'US', latitude: '40.75', longitude: '-73.95', localized_address_display: '2 West Loop Road, New York, NY' } },
            image: { url: 'https://img/1' },
        }] } },
    })};</script>`;
    const parsed = eventbrite.parseSearchPage(html);
    assert.equal(parsed.pageCount, 3);
    const e = eventbrite.normalizeResult(parsed.results[0]);
    assert.equal(e.startDate, '2026-11-18T18:30:00-05:00');
    assert.deepEqual(e.categories, ['Science & Technology']);
    assert.equal(e.latitude, 40.75);
    assert.equal(e.venueName, 'Cornell Tech');
    assert.equal(eventbrite.parseSearchPage('<html></html>'), null);
});

test('Meetup location parameter, place check and event parsing', () => {
    assert.equal(meetup.locationParam(NY), 'us--ny--New York');
    assert.equal(meetup.locationParam(LONDON), 'gb--London');
    assert.ok(meetup.sameCity({ city: 'London', country: 'gb' }, LONDON));
    assert.ok(!meetup.sameCity({ city: 'Nairobi', country: 'ke' }, LONDON));
    const state = {
        ROOT_QUERY: { 'eventSearch:{"filter":{"city":"New York","country":"us"}}': { edges: [{ node: { __ref: 'Event:1' } }] } },
        'Event:1': {
            __typename: 'Event', id: '1', title: 'New Tech Meetup', dateTime: '2026-11-09T18:00:00-05:00', eventType: 'PHYSICAL',
            eventUrl: 'https://www.meetup.com/ny-tech/events/1/', feeSettings: { amount: 20, currency: 'USD' }, rsvps: { totalCount: 6 },
            venue: { name: 'Civic Hall', address: '124 E 14th St, New York, NY 10003, USA', city: 'New York', state: 'NY', country: 'us' },
            group: { __ref: 'Group:9' }, featuredEventPhoto: { __ref: 'PhotoInfo:3' },
        },
        'Group:9': { name: 'NY Tech Meetup', urlname: 'ny-tech', timezone: 'America/New_York' },
        'PhotoInfo:3': { highResUrl: 'https://img/3' },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: state } } })}</script>`;
    const parsed = meetup.parseFindPage(html);
    assert.equal(parsed.filter.city, 'New York');
    const e = meetup.normalizeItem(parsed.items[0]);
    assert.deepEqual([e.price, e.currency, e.isFree, e.attendees, e.organizer], [20, 'USD', false, 6, 'NY Tech Meetup']);
    assert.equal(e.address, '124 E 14th St, New York, NY 10003, USA');
    assert.equal(e.organizerUrl, 'https://www.meetup.com/ny-tech/');
    assert.equal(e.endDate, null);
    assert.equal(meetup.venueAddress({ address: '72 Spring St', city: 'New York', state: 'NY' }), '72 Spring St, New York, NY');

    // Without a keyword the page holds recommended events, with only coordinates in the filter.
    const rec = {
        ...state,
        ROOT_QUERY: { 'recommendedEvents:{"filter":{"lat":40.7,"lon":-74.0}}': { edges: [{ __ref: 'RecommendedEventsEdge:1' }] } },
        'RecommendedEventsEdge:1': { node: { __ref: 'Event:1' } },
    };
    const recParsed = meetup.parseFindPage(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: rec } } })}</script>`);
    assert.equal(recParsed.items.length, 1);
    assert.ok(meetup.sameCity(recParsed.filter, NY));
    assert.ok(!meetup.sameCity(recParsed.filter, LONDON));
});

test('Luma places, nearest city and entry parsing', () => {
    const discover = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { initialData: { places: [
        { place: { slug: 'nyc', name: 'New York', coordinate: { latitude: 40.73, longitude: -73.93 } } },
        { place: { slug: 'london', name: 'London', coordinate: { latitude: 51.5, longitude: -0.12 } } },
        { place: { slug: 'broken' } },
    ] } } } })}</script>`;
    const places = luma.parsePlaces(discover);
    assert.equal(places.length, 2);
    assert.equal(luma.nearestPlace(places, NY).slug, 'nyc');
    assert.equal(luma.nearestPlace(places, { lat: -1.28, lon: 36.82 }), null);
    const e = luma.normalizeEntry({
        event: { api_id: 'evt-1', name: 'Founder Dinner', url: 'abc', start_at: '2026-11-08T23:00:00.000Z', end_at: '2026-11-09T01:30:00.000Z',
            timezone: 'America/New_York', location_type: 'offline', cover_url: 'https://img/l', coordinate: { latitude: 40.7, longitude: -74 },
            geo_address_info: { city: 'New York', region: 'New York', country_code: 'US', address: 'Verci', full_address: 'Verci, 45 E 20th St' } },
        calendar: { name: 'Coffee Club', slug: 'coffee' },
        hosts: [{ name: 'Verci' }],
        guest_count: 12,
        ticket_info: { is_free: false, price: { cents: 1000, currency: 'usd' } },
    });
    assert.deepEqual([e.url, e.startDate, e.price, e.currency, e.isFree, e.attendees], ['https://luma.com/abc', '2026-11-08T18:00:00-05:00', 10, 'USD', false, 12]);
    assert.equal(e.organizerUrl, 'https://luma.com/coffee');
    assert.equal(luma.parseCityPage('<html></html>'), null);
});
