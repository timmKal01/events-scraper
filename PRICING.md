# Pricing

**$0.02 per `event`** (the user's price, 2026-11-09), flat, no tiers, like Google Maps Leads. One charge per event row
saved. Error rows, note rows, events removed by filters and events skipped as already returned (`onlyNew`) are never
charged. The charge is made with `Actor.pushData(row, 'event')`, which also stops the run when the buyer's maximum
cost is reached.

Do not add Apify's synthetic `apify-default-dataset-item` event: it would charge every row a second time.

I had proposed $0.002. The user chose $0.02. A cut can take effect within about a minute, while a raise waits about
14 days, so starting at the higher price keeps both directions open.

## The market on 2026-11-09 (Free tier, per result)

| Actor | Users, last 30 days | Price |
|---|---|---|
| aitorsm/eventbrite | 94 | $0.02 |
| solidcode/luma-scraper | 82 | $0.003 |
| filip_cicvarek/meetup-scraper | 80 | $0.001 |
| zen-studio/10times-events-scraper | 95 | $0.0035 |

None of those four reads more than one site. Two others do, found after launch (2026-11-09): memo23/eventbrite-scraper
("Eventbrite, Lu.ma & Meetup [$0.99] Events + Organizer Leads", 40 users a month) charges $0.025 a run plus $0.00099 an
event, and seemuapps/eventbrite-meetup-events-scraper (1 user) covers Eventbrite and Meetup. At $0.02 an event this
actor is about 20 times memo23's price per event.

## Cost to run

No proxy. A run reads one page per site per city (Eventbrite: one per 20 events), at 512 MB. The example input (New
York, three sites, 69 events) took about 20 seconds locally, well under a cent of compute.

If Apify's datacenter IPs turn out to be blocked by a site, a residential proxy would cost about $8/GB. Each search page
is 0.4 to 0.8 MB, so about $0.005 a page, or roughly $0.0003 per Eventbrite event.
