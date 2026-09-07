// ============================================================
//  test-maptiles.js — the basemap can actually paint (dev/CI only).
//
//      node test-maptiles.js
//
//  WHY THIS EXISTS. The maps broke in production and nothing noticed, because
//  every way a basemap fails is SILENT:
//   * CARTO began defacing unkeyed tiles with "API KEY REQUIRED" painted
//     across them and still answered 200, so no error existed to catch;
//   * a host outside the CSP's img-src is blocked by the browser with no
//     console error the app can see, and the map renders as an empty box;
//   * a zoom past the provider's maximum answers 400 per tile, so the map
//     looks fine until a guest pinches in and the world goes blank.
//  None of that is reachable by a unit test of a function. What IS checkable,
//  cheaply and deterministically, is that the URL we ship is one the CSP
//  permits and the zoom we ask for is one the provider serves — so that is
//  what this asserts, plus the one-definition rule that stopped the two maps
//  disagreeing about the max zoom in the first place.
//
//  Deliberately NO NETWORK: a suite that fetches real tiles fails for reasons
//  that are nothing to do with this codebase (the tile server being slow, a
//  runner without egress), which is the same call test-ical.php makes about
//  Airbnb's feed. The live tile fetch is a thing to do by hand when changing
//  provider; the rules below are what must hold on every commit.
// ============================================================
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
const ht = fs.readFileSync(path.join(dir, 'htaccess.txt'), 'utf8');

let fail = 0;
let pass = 0;
function ok(name, cond) {
    if (cond) {
        pass++;
        console.log('  ✓ ' + name);
    } else {
        fail++;
        console.log('  ✗ ' + name);
    }
}

console.log('\n== The basemap is ONE definition ==');

// The two maps each carried their own copy and drifted (maxZoom 20 vs 19).
const tileLayerCalls = app.match(/L\.tileLayer\(/g) || [];
ok('both maps still build a tile layer', tileLayerCalls.length === 2);

// ONE DECLARATION, TWO THEME URLS. This used to assert exactly ONE tile URL
// literal, because the two maps each carried their own copy and drifted. The
// basemap now follows the theme (light_all / dark_all — the dark theme had been
// showing a white sheet on a near-black page), so there are legitimately two
// literals; what must still hold is that BOTH live in the one MAP_TILES
// declaration, differ only in the style slug, and reach the maps through the
// single mapTileUrl() picker rather than being restated at a call site.
const decl = (app.match(/const MAP_TILES = \{[\s\S]*?\n\};/) || [''])[0];
ok('found the MAP_TILES declaration', decl.length > 40);
const urlLiterals = app.match(/'https:\/\/[^']*\{z\}[^']*'/g) || [];
const declLiterals = decl.match(/'https:\/\/[^']*\{z\}[^']*'/g) || [];
ok('exactly two tile URL literals in app.js (one per theme, no third copy)', urlLiterals.length === 2);
ok('and BOTH are inside the MAP_TILES declaration (no literal loose in the file)', declLiterals.length === 2);
ok('MAP_TILES declares a light and a dark URL', /light:\s*'https:\/\/[^']*\{z\}/.test(decl) && /dark:\s*'https:\/\/[^']*\{z\}/.test(decl));

// The two differ ONLY in the style slug. A second URL is a second chance to
// drift — a different host would break the CSP silently, a different key would
// deface one theme's tiles, a different {r} would drop retina on one theme.
{
    const [a, b] = declLiterals.map((l) => l.slice(1, -1));
    const strip = (u) => u.replace(/cartocdn\.com\/[a-z_]+\//, 'cartocdn.com/<style>/');
    ok('the light and dark URLs differ ONLY in the style slug (same host, key, {r}, template)', a !== b && strip(a) === strip(b));
}

// ONE PICKER. Both call sites read mapTileUrl(), which is the only place the
// theme chooses a basemap — so a map mounted now and one swapped live by
// toggleTheme cannot disagree.
ok('mapTileUrl() is the one place the theme picks a basemap', /function mapTileUrl\(\)[\s\S]{0,220}MAP_TILES\.light[\s\S]{0,60}MAP_TILES\.dark/.test(app));
const readsConst = (app.match(/L\.tileLayer\(mapTileUrl\(\),/g) || []).length;
ok('both call sites read mapTileUrl()', readsConst === 2);
ok('neither call site hardcodes a maxZoom', !/L\.tileLayer\(mapTileUrl\(\),\s*\{\s*maxZoom:\s*\d/.test(app));

// A MOUNTED MAP MUST FOLLOW THE SWITCH. Both maps outlive a theme toggle (the
// cottages pane is sticky, the cottage page's survives a nav), so without a live
// setUrl the tiles stay in the theme they were built in while the CSS controls
// flip underneath them — worse than not theming the map at all.
ok('toggleTheme swaps the live layer', /function toggleTheme\(\)[\s\S]{0,400}chbMapTheme\(\)/.test(app));
ok('and chbMapTheme setUrl()s the mounted layers', /function chbMapTheme\(\)[\s\S]{0,400}setUrl\(u\)/.test(app));

console.log('\n== The tile host is one the CSP actually permits ==');

// Parse the SHIPPED policy, the way csp-lib.php does — a host the CSP forbids
// paints nothing and logs nothing the app can read.
// NB anchor on the real `Header ... set` DIRECTIVE, not the header's name: a
// COMMENT four lines above the policy explains when to switch it to
// Report-Only, and a bare name match reads that prose as the policy and finds
// no img-src at all. Same trap as a negative source scan matching the comment
// that describes it; the vacuity guard below is what caught it.
const cspLine = (ht.match(/^\s*Header\s+(?:always\s+)?set\s+Content-Security-Policy\s+"[^\n]*/m) || [''])[0];
ok('found the Content-Security-Policy header to check against', cspLine.length > 40);
const imgSrc = (cspLine.match(/img-src ([^;]*);/) || [, ''])[1].trim().split(/\s+/);
ok('img-src has sources to check (guard: a parse that finds nothing proves nothing)', imgSrc.length >= 3);

const tileUrl = declLiterals.length ? declLiterals[0].slice(1, -1) : '';
ok('read the shipped tile URL', /^https:\/\/\S+\{z\}/.test(tileUrl));

// Resolve {s} to a real subdomain exactly as Leaflet does before requesting.
const subs = (decl.match(/subdomains: '([^']+)'/) || [, ''])[1];
ok('a subdomain set is declared', subs.length >= 1);
const host = tileUrl.replace('{s}', subs[0]).split('/')[2];

// A CSP wildcard matches SUBDOMAINS, never the apex — the rule csp-lib.php's
// own tests pin, and the one that would have bitten here: the CSP allows
// *.tile.openstreetmap.org, so the bare apex host would render a blank map.
function cspAllows(h, sources) {
    return sources.some((s) => {
        const src = s.replace(/^https:\/\//, '').replace(/\/$/, '');
        if (src === h) return true;
        if (src.startsWith('*.')) return h.endsWith(src.slice(1)) && h !== src.slice(2);
        return false;
    });
}
ok('the tile host is permitted by img-src (a blocked host paints nothing)', cspAllows(host, imgSrc));

// Break-test the matcher itself, so a permissive bug in it cannot pass
// everything: the apex must NOT satisfy a *.sub wildcard.
ok('the wildcard matcher refuses the apex (break-test of the check above)',
    !cspAllows('tile.openstreetmap.org', ['https://*.tile.openstreetmap.org']));
ok('the wildcard matcher accepts a subdomain', cspAllows('a.tile.openstreetmap.org', ['https://*.tile.openstreetmap.org']));
ok('the wildcard matcher refuses a suffix-spoof', !cspAllows('eviltile.openstreetmap.org.attacker.com', ['https://*.tile.openstreetmap.org']));

console.log('\n== The zoom we ask for is one the provider serves ==');

// Measured per provider, because the failure is silent either way: OSM answers
// 400 above 19, and CARTO over-zooms to 22 but documents 20 as its raster max.
// Asking past a ceiling shows a guest blank tiles at full pinch, which reads as
// the map being broken. A provider not listed here fails the check ON PURPOSE —
// changing basemap means measuring the new one, not inheriting an old number.
const MAX_BY_HOST = {
    'tile.openstreetmap.org': 19,
    'basemaps.cartocdn.com': 20,
};
const maxZoom = parseInt((decl.match(/maxZoom: (\d+)/) || [, '0'])[1], 10);
ok('a maxZoom is declared', maxZoom > 0);
const baseHost = host.replace(/^[a-z]\./, '');
const known = MAX_BY_HOST[baseHost];
ok('the tile host is one whose ceiling this gate knows (add it when changing provider)', typeof known === 'number');
ok('maxZoom is within what the provider serves', typeof known === 'number' && maxZoom <= known);

// A keyed provider must actually carry its key, and carry it under the name
// that provider honours. Both failures here are SILENT: CARTO answers 200 and
// serves a watermarked tile when the key is missing, when it is wrong, AND
// when the parameter is named `api_key` — which is the obvious guess and is
// ignored outright (measured: a bogus key and no key return byte-identical
// tiles). So neither a dropped key nor a plausible-looking wrong parameter
// would show up as an error anywhere; only this check stands between them and
// "API KEY REQUIRED" painted across every guest's map again.
if (/cartocdn\.com/.test(tileUrl)) {
    console.log('\n== The keyed provider carries a key ==');
    // BOTH themes: dark_all is keyed exactly as light_all is — verified by hand,
    // a bogus key or none returns a byte-identical WATERMARKED dark tile — so an
    // unkeyed dark URL would deface the map for every default-theme visitor.
    const urls = declLiterals.map((l) => l.slice(1, -1));
    ok('every CARTO URL carries a non-empty ?key=', urls.every((u) => /[?&]key=[^&'"\s]{8,}/.test(u)));
    ok('and none uses api_key=, which CARTO silently ignores', urls.every((u) => !/[?&]api_key=/.test(u)));
}

console.log('\n== Attribution ==');

// OSM's licence requires the credit, and it must not still name a provider we
// no longer use — the attribution is the one map string a guest reads.
const attr = (decl.match(/attribution: '([^']*)'/) || [, ''])[1];
ok('attributes OpenStreetMap', /OpenStreetMap/.test(attr));
ok('does not credit a provider the tiles no longer come from', !/CARTO/i.test(attr) || /cartocdn/.test(tileUrl));

console.log('\n== Summary ==');
if (fail) {
    console.log('  ' + fail + ' CHECK(S) FAILED ❌\n');
    process.exit(1);
}
console.log('  ALL ' + pass + ' CHECKS PASSED ✅\n');
process.exit(0);
