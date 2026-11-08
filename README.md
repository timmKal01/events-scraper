# Events Scraper: Eventbrite, Meetup & Luma by City

For event listing sites, local newsletters, community managers and sales teams: get upcoming events in any city from Eventbrite, Meetup and Luma in one clean format, with the same event merged when it's listed on more than one site, and an only-new mode for scheduled runs.

## What you get

- **Three sites in one feed:** Eventbrite, Meetup and Luma, read in parallel, in one schema
- **Up to 10 cities per run:** type a city the way you'd say it ("Austin", "London", "Portland, Oregon"), and each site gets it in its own format
- **Times you can trust:** `startDate` and `endDate` in the event's local time with the UTC offset (`2026-11-18T18:30:00-05:00`), plus the time zone
- **Venue, organizer, price and attendees** wherever the site publishes them
- **Duplicates merged:** an event listed on two sites comes back once, and `alsoListedOn` says where else it is
- **Keyword and date filters**, and online-only events left out unless you ask for them
- **Only new events:** schedule it, and each run returns only events earlier runs didn't (skipped events aren't charged)

## Example output

Real output from a test run on 2026-11-08 (New York, keyword "tech"). A Meetup row, description shortened:

```json
{
  "rowType": "event",
  "title": "New Tech Meetup",
  "startDate": "2026-11-09T18:00:00-05:00",
  "endDate": null,
  "timezone": "America/New_York",
  "source": "meetup",
  "url": "https://www.meetup.com/ny-tech/events/317209159/",
  "venueName": "Civic Hall",
  "address": "124 E 14th St, New York, NY 10003, USA",
  "city": "New York",
  "region": "NY",
  "country": "US",
  "latitude": null,
  "longitude": null,
  "isOnline": false,
  "isCancelled": false,
  "organizer": "NY Tech Meetup",
  "organizerUrl": "https://www.meetup.com/ny-tech/",
  "isFree": false,
  "price": 20,
  "currency": "USD",
  "attendees": 6,
  "categories": [],
  "description": "**One More NY Tech Meetup Before We Close Out 2026!**\n\nWe’re wrapping up another ...",
  "imageUrl": "https://secure.meetupstatic.com/photos/event/d/4/d/0/highres_536874480.jpeg",
  "eventId": "317209159",
  "alsoListedOn": [],
  "searchLocation": "New York",
  "keyword": "tech",
  "scrapedAt": "2026-11-08T21:42:23.969Z"
}
```

An Eventbrite row from the same run has the venue's coordinates and Eventbrite's categories (`["High Tech", "Science & Technology", "Conference"]`) but no price, because Eventbrite's search results don't include one. A Luma row has the price, whether it's free, the guest count and the organizer's calendar.

`rowType` is `"event"` for events. Rows that aren't events are free: `"error"` when one site couldn't be read for a city (with the reason), and `"note"` when there's nothing to return (for example, everything was already returned by earlier runs).

## What it costs

$0.02 per event saved ($20 per 1,000). Error and note rows, events filtered out, and events skipped as already returned are free. A run with the example input (New York, all three sites) saves about 70 events, so about $1.40, and takes under a minute. To spend less, lower `maxEventsPerSource`, pick fewer sites, or set a maximum cost when you start the run: it stops there.

## Use cases

- **Event listing sites and apps:** a fresh "what's on" feed per city, without maintaining three scrapers.
- **Local newsletters:** this week's events in your city, filtered by topic and date.
- **Community and developer relations teams:** every tech meetup in the cities you care about, with organizers and attendee counts.
- **Sales and sponsorship:** find active organizers and venues, then reach them through their event pages.
- **AI agents:** one call returns clean, merged events with local times.

## Input

| Field | What it does |
|---|---|
| `locations` | Cities or areas, up to 10. Add the state or country when the name is common ("Portland, Oregon", "Manchester, UK"). Empty runs the example (New York). |
| `keyword` | Optional, e.g. `tech`, `jazz`, `startup`. Eventbrite and Meetup search for it; Luma events are kept when every word of it starts a word in the title, organizer or host names. |
| `sources` | `eventbrite`, `meetup`, `luma`, or any mix. Default: all three. |
| `maxEventsPerSource` | Events to read from each site per city, 1 to 200. Default 40. |
| `dateFrom`, `dateTo` | Optional dates (YYYY-MM-DD): events still on from `dateFrom`, starting on or before `dateTo`. |
| `includeOnlineEvents` | Also keep online-only events. Default off. |
| `onlyNew` | Skip events earlier runs returned. For scheduled runs. |
| `seenListName` | The name of the "already returned" list. Give each schedule or client its own. |

Every tech event in two cities next month:

```json
{
  "locations": ["Austin", "Denver"],
  "keyword": "tech",
  "dateFrom": "2026-12-01",
  "dateTo": "2026-12-31"
}
```

A weekly "new events" feed for one city (schedule it):

```json
{
  "locations": ["London"],
  "onlyNew": true,
  "seenListName": "london-weekly"
}
```

## How much each site gives

- **Eventbrite:** its city search, 20 events a page, up to 200 per city. Ticket prices aren't in the search results, so `price` and `isFree` are empty for Eventbrite rows.
- **Meetup:** the first page of its event search, about 20 to 30 events per city with a keyword. Without a keyword Meetup shows its recommended events for the city instead, about 10 to 15. Meetup doesn't publish venue coordinates or end times there.
- **Luma:** its city pages, about 90 cities worldwide, with their featured upcoming events (about 20 each). A city more than 75 km from a Luma city gets a free note row saying so.

When a site matches a place to somewhere else (for example a small town it doesn't know), that site is skipped for that place with a free error row, rather than returning events from the wrong city. Brooklyn and other parts of a city are searched as the city when a site does that itself.

## Related tools

- [Google Maps Leads](https://apify.com/m_ctim/local-business-leads): local businesses with phones, emails and websites, for venues and sponsors near your events
- [Blog & RSS Feed Monitor](https://apify.com/m_ctim/rss-feed-tracker): new posts from any feed, for organizers and venues that publish their events by RSS

## Notes

- It reads the public pages anyone can open, with an identifying User-Agent and at most one request every 1.5 seconds per site.
- Event details belong to their organizers. When you show them, link to the event page (`url`).
- Questions or a city that doesn't work? Open an issue on the Issues tab.
