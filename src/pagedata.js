// The structured data event pages already carry for search engines and their own front end: schema.org JSON-LD,
// Next.js's __NEXT_DATA__, and Eventbrite's window.__SERVER_DATA__. Reading these is steadier than CSS selectors,
// which break on every redesign.

/** Every schema.org object whose @type ends in "Event" (Event, MusicEvent, BusinessEvent...), in page order. */
export function jsonLdEvents(html) {
    const events = [];
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        const type = [].concat(node['@type'] ?? []).join(' ');
        if (/Event\b/.test(type)) events.push(node);
        for (const value of Object.values(node)) walk(value);
    };
    for (const match of String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
        try {
            walk(JSON.parse(match[1]));
        } catch {
            // A broken block on the page shouldn't hide the others.
        }
    }
    return events;
}

/** Next.js page data, or null. */
export function nextData(html) {
    const match = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch {
        return null;
    }
}

const BACKSLASH = String.fromCharCode(92);

/**
 * The JSON object literal that follows `marker` in a page (e.g. "window.__SERVER_DATA__ ="), found by matching
 * braces outside strings. Returns null if the marker is missing or the object doesn't parse.
 */
export function objectAfter(html, marker) {
    const text = String(html);
    const at = text.indexOf(marker);
    if (at < 0) return null;
    const start = text.indexOf('{', at);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c === BACKSLASH) escaped = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}
