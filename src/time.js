// Event times in one shape: local date and time with the UTC offset ("2026-11-18T18:30:00-05:00"), so buyers see the
// time people will actually turn up, and the value still sorts and converts correctly.

/** The UTC offset ("-05:00", "+01:00") of a time zone at a moment, or null for an unknown zone. */
export function offsetAt(timeZone, utcMs) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(utcMs));
        const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        const m = name.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
        if (!m) return '+00:00'; // plain "GMT"
        return `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
    } catch {
        return null;
    }
}

const offsetMinutes = (offset) => {
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? '');
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};

/** "2026-11-18" + "18:30" in America/New_York -> "2026-11-18T18:30:00-05:00". Without a zone, no offset. */
export function localToIso(date, time, timeZone) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
    const hhmm = /^\d{2}:\d{2}/.test(time ?? '') ? time.slice(0, 5) : '00:00';
    const local = `${date}T${hhmm}:00`;
    if (!timeZone) return local;
    const naiveUtc = Date.parse(`${local}Z`);
    // The offset at the naive instant, then again at the corrected instant, so a time near a DST change is right.
    const guess = offsetAt(timeZone, naiveUtc);
    if (guess === null) return local;
    const offset = offsetAt(timeZone, naiveUtc - offsetMinutes(guess) * 60_000);
    return `${local}${offset}`;
}

/** "2026-11-08T23:00:00.000Z" in America/New_York -> "2026-11-08T18:00:00-05:00". */
export function utcToLocalIso(utc, timeZone) {
    const ms = Date.parse(utc ?? '');
    if (Number.isNaN(ms)) return null;
    if (!timeZone) return new Date(ms).toISOString().replace('.000Z', 'Z');
    const offset = offsetAt(timeZone, ms);
    if (offset === null) return new Date(ms).toISOString().replace('.000Z', 'Z');
    const local = new Date(ms + offsetMinutes(offset) * 60_000).toISOString().slice(0, 19);
    return `${local}${offset}`;
}

/** The local calendar date of an ISO time ("2026-11-18T18:30:00-05:00" -> "2026-11-18"). */
export function localDate(iso) {
    return /^\d{4}-\d{2}-\d{2}/.test(iso ?? '') ? iso.slice(0, 10) : null;
}
