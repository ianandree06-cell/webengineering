// Lädt einmalig alle Defibrillatoren in Deutschland von der Overpass-API und
// speichert sie als statische JSON-Kacheln (1° x 1°) unter public/defis/.
// Aufruf: npm run defis
//
// Ergebnis:
//   public/defis/index.json        -> { stand, anzahl, kacheln: ["49_8", ...] }
//   public/defis/<lat>_<lon>.json  -> Liste von Elementen im Overpass-Format
//                                     (type, id, lat, lon, tags) – nur die benötigten Tags
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ZIEL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "defis");

const OVERPASS_SERVER = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];

const ABFRAGE = `[out:json][timeout:300];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(node["emergency"="defibrillator"](area.de);way["emergency"="defibrillator"](area.de););
out center tags;`;

// Nur diese Tags werden in karte.js (aufbereiten) verwendet
const TAGS = [
    "name", "operator",
    "addr:street", "addr:housenumber", "addr:postcode", "addr:city",
    "opening_hours", "access",
    "defibrillator:location", "defibrillator:location:de",
    "description", "level", "indoor",
    "phone", "contact:phone",
];

async function ladeVonOverpass() {
    for (const server of OVERPASS_SERVER) {
        try {
            console.log("Frage " + server + " …");
            const antwort = await fetch(server, {
                method: "POST",
                body: "data=" + encodeURIComponent(ABFRAGE),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "AED-Finder-Datenexport/1.0",
                },
                signal: AbortSignal.timeout(360000),
            });
            if (!antwort.ok) throw new Error("HTTP " + antwort.status);
            const daten = await antwort.json();
            if (!Array.isArray(daten.elements)) throw new Error("Unerwartete Antwort");
            return daten.elements;
        } catch (fehler) {
            console.warn("  fehlgeschlagen: " + fehler.message);
        }
    }
    throw new Error("Kein Overpass-Server hat geantwortet.");
}

function verkleinern(element) {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (lat === undefined || lon === undefined) return null;

    const tags = {};
    for (const schluessel of TAGS) {
        if (element.tags?.[schluessel] !== undefined) tags[schluessel] = element.tags[schluessel];
    }
    return {
        type: element.type,
        id: element.id,
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
        tags,
    };
}

const elemente = (await ladeVonOverpass()).map(verkleinern).filter(Boolean);
console.log(elemente.length + " Defibrillatoren geladen.");

const kacheln = new Map();
for (const e of elemente) {
    const name = Math.floor(e.lat) + "_" + Math.floor(e.lon);
    if (!kacheln.has(name)) kacheln.set(name, []);
    kacheln.get(name).push(e);
}

await rm(ZIEL, { recursive: true, force: true });
await mkdir(ZIEL, { recursive: true });
for (const [name, liste] of kacheln) {
    await writeFile(resolve(ZIEL, name + ".json"), JSON.stringify(liste));
}
await writeFile(resolve(ZIEL, "index.json"), JSON.stringify({
    stand: new Date().toISOString(),
    anzahl: elemente.length,
    kacheln: [...kacheln.keys()].sort(),
}, null, 2));

console.log(kacheln.size + " Kacheln nach " + ZIEL + " geschrieben.");
