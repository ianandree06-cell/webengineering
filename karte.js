// Defi-Karte (nur auf karte.html): Standort ermitteln, Defis aus den eigenen
// OSM-Kacheln (public/defis/, Fallback: Overpass-API) laden und als Karte +
// nach Entfernung sortierte Liste anzeigen.
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const kartenElement = document.getElementById("defiKarte");

if (kartenElement) {
    // Öffentliche Overpass-Server; ist einer überlastet (z. B. 502/504/429), wird der nächste gefragt
    const OVERPASS_SERVER = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ];
    const START_MITTE = [49.0094, 8.4044]; // Karlsruhe, falls kein Standort verfügbar ist
    const MAX_EINTRAEGE = 50;

    const statusZeile = document.getElementById("karteStatus");
    const liste = document.getElementById("defiListe");
    const anzahl = document.getElementById("defiAnzahl");
    const standortKnopf = document.getElementById("standortKnopf");
    const bereichKnopf = document.getElementById("bereichKnopf");
    const radiusAuswahl = document.getElementById("radiusAuswahl");

    // Der eine Zustand der Seite
    const zustand = {
        standort: null,   // [lat, lon] des Nutzers, falls freigegeben
        suchMitte: null,  // [lat, lon], um den gesucht wurde
        defis: [],        // nach Entfernung sortiert
        aktivId: null,
    };
    let laufendeAnfrage = null;

    // --- Karte ---------------------------------------------------------------
    const karte = L.map(kartenElement, { zoomControl: true }).setView(START_MITTE, 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende',
    }).addTo(karte);

    const markerGruppe = L.layerGroup().addTo(karte);
    const marker = new Map(); // id -> Leaflet-Marker
    let standortMarker = null;
    let suchMarker = null;   // verschiebbarer Suchpunkt, um den gesucht wird
    let radiusKreis = null;

    const suchIcon = L.divIcon({
        className: "suchpunkt-marker",
        html: '<svg viewBox="0 0 24 36" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#1f2d2d"/><circle cx="12" cy="12" r="5" fill="#fff"/></svg>',
        iconSize: [30, 44],
        iconAnchor: [15, 44],
    });

    const defiIcon = L.divIcon({
        className: "defi-marker",
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.1 5.4 3 1.8-1.9 3.3-3 5.4-3 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z" fill="#fff"/><path d="M13 7.5l-3.5 5.5h2.6l-1.1 4.5 3.9-6h-2.7z" fill="#c0392b"/></svg>',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -16],
    });

    // --- Hilfsfunktionen -----------------------------------------------------
    function setzeStatus(text, istFehler = false) {
        statusZeile.textContent = text;
        statusZeile.classList.toggle("fehler", istFehler);
    }

    // Luftlinie in Metern (Haversine-Formel)
    function entfernung([lat1, lon1], [lat2, lon2]) {
        const r = 6371000;
        const rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad;
        const dLon = (lon2 - lon1) * rad;
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * r * Math.asin(Math.sqrt(a));
    }

    function formatEntfernung(meter) {
        if (meter < 1000) return Math.round(meter / 10) * 10 + " m";
        return (meter / 1000).toFixed(1).replace(".", ",") + " km";
    }

    // Grobe Gehzeit bei ca. 5 km/h
    function gehzeit(meter) {
        const min = Math.max(1, Math.round(meter / 83));
        return "ca. " + min + " Min. zu Fuß";
    }

    function routenLink(defi) {
        const ziel = defi.lat + "," + defi.lon;
        let url = "https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=" + ziel;
        if (zustand.standort) url += "&origin=" + zustand.standort.join(",");
        return url;
    }

    // Wandelt die OSM-Tags in lesbare Angaben um
    function aufbereiten(element) {
        const t = element.tags || {};
        const lat = element.lat ?? element.center?.lat;
        const lon = element.lon ?? element.center?.lon;

        const adresse = [
            [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "),
            [t["addr:postcode"], t["addr:city"]].filter(Boolean).join(" "),
        ].filter(Boolean).join(", ");

        let verfuegbarkeit;
        const zeiten = (t.opening_hours || "").trim();
        if (zeiten === "24/7") {
            verfuegbarkeit = { text: "Rund um die Uhr zugänglich", art: "gut" };
        } else if (zeiten) {
            verfuegbarkeit = { text: "Zugänglich: " + zeiten, art: "mittel" };
        } else {
            verfuegbarkeit = { text: "Zugangszeiten unbekannt", art: "unbekannt" };
        }

        const zugangTexte = {
            yes: ["Öffentlich zugänglich", "gut"],
            public: ["Öffentlich zugänglich", "gut"],
            permissive: ["Öffentlich zugänglich (geduldet)", "gut"],
            customers: ["Nur für Kunden/Besucher", "mittel"],
            private: ["Nicht öffentlich (privat)", "schlecht"],
            no: ["Nicht öffentlich", "schlecht"],
        };
        const zugang = zugangTexte[t.access] || null;

        const lage = [];
        if (t["defibrillator:location"]) lage.push(t["defibrillator:location"]);
        else if (t["defibrillator:location:de"]) lage.push(t["defibrillator:location:de"]);
        if (t.description && !lage.includes(t.description)) lage.push(t.description);
        if (t.level !== undefined) lage.push(t.level === "0" ? "Erdgeschoss" : "Etage " + t.level);
        if (t.indoor === "yes") lage.push("Innen");
        if (t.indoor === "no") lage.push("Außen");

        return {
            id: element.type + "/" + element.id,
            lat,
            lon,
            name: t.name || t.operator || "Defibrillator",
            betreiber: t.name && t.operator ? t.operator : "",
            adresse,
            lage,
            verfuegbarkeit,
            zugang: zugang ? { text: zugang[0], art: zugang[1] } : null,
            telefon: t.phone || t["contact:phone"] || "",
            osmLink: "https://www.openstreetmap.org/" + element.type + "/" + element.id,
        };
    }

    // --- Eigene Defi-Daten (statische Kacheln aus scripts/defis-erstellen.mjs) ---
    // public/defis/<lat>_<lon>.json enthält alle Defis einer 1°x1°-Kachel in Deutschland.
    const DATEN_PFAD = import.meta.env.BASE_URL + "defis/";
    const kachelCache = new Map(); // Name -> Promise<Elemente>
    let kachelIndex = null;        // Promise<Set<Name>>

    function ladeJson(url, signal) {
        return fetch(url, { signal }).then((antwort) => {
            if (!antwort.ok) throw new Error("HTTP " + antwort.status + " für " + url);
            return antwort.json();
        });
    }

    function ladeIndex() {
        kachelIndex ??= ladeJson(DATEN_PFAD + "index.json")
            .then((index) => new Set(index.kacheln))
            .catch((fehler) => { kachelIndex = null; throw fehler; });
        return kachelIndex;
    }

    function ladeKachel(name) {
        if (!kachelCache.has(name)) {
            kachelCache.set(name, ladeJson(DATEN_PFAD + name + ".json")
                .catch((fehler) => { kachelCache.delete(name); throw fehler; }));
        }
        return kachelCache.get(name);
    }

    // Liefert die Elemente aus den eigenen Kacheln oder null, wenn der Bereich
    // nicht (vollständig) abgedeckt ist, z. B. außerhalb Deutschlands.
    async function ladeAusKacheln([minLat, minLon, maxLat, maxLon]) {
        const vorhanden = await ladeIndex();
        const namen = [];
        for (let la = Math.floor(minLat); la <= Math.floor(maxLat); la++) {
            for (let lo = Math.floor(minLon); lo <= Math.floor(maxLon); lo++) {
                namen.push(la + "_" + lo);
            }
        }
        // Die Mitte muss in einer vorhandenen Kachel liegen, sonst ist der Bereich nicht abgedeckt.
        // Am Rand fehlende Kacheln (Ausland/Meer) werden einfach ignoriert.
        const mitte = Math.floor((minLat + maxLat) / 2) + "_" + Math.floor((minLon + maxLon) / 2);
        if (!vorhanden.has(mitte)) return null;

        const listen = await Promise.all(namen.filter((n) => vorhanden.has(n)).map(ladeKachel));
        return listen.flat();
    }

    // --- Overpass-Abfrage (Fallback) -----------------------------------------
    const SERVER_ZEITLIMIT = 8000; // ms, danach wird der nächste Server gefragt
    const cache = new Map();       // bereits geladene Bereiche, z. B. beim Umkreis-Wechsel

    async function ladeDefis(mitte, radius, signal) {
        const [lat, lon] = mitte;
        const schluessel = lat.toFixed(4) + "," + lon.toFixed(4) + "," + radius;
        if (cache.has(schluessel)) return cache.get(schluessel);

        // Rechteck (bbox) statt "around": deutlich schneller für den Server,
        // die Ecken außerhalb des Kreises werden danach in suche() aussortiert
        const dLat = radius / 111320;
        const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
        const grenzen = [lat - dLat, lon - dLon, lat + dLat, lon + dLon];

        let eigene = null;
        try {
            eigene = await ladeAusKacheln(grenzen);
        } catch (fehler) {
            console.warn("Eigene Defi-Daten nicht verfügbar, nutze Overpass.", fehler);
        }
        // Nutzer hat inzwischen neu gesucht: altes Ergebnis verwerfen
        if (signal.aborted) throw new DOMException("Abgebrochen", "AbortError");
        if (eigene) return eigene;

        const bbox = grenzen.map((z) => z.toFixed(6)).join(",");
        const abfrage = `[out:json][timeout:15][bbox:${bbox}];
(node["emergency"="defibrillator"];way["emergency"="defibrillator"];);
out center tags;`;

        let letzterFehler;
        for (const server of OVERPASS_SERVER) {
            // Eigener Abbruch pro Server: Zeitlimit oder neue Suche des Nutzers
            const steuerung = new AbortController();
            const abbrechen = () => steuerung.abort();
            signal.addEventListener("abort", abbrechen, { once: true });
            const timer = setTimeout(abbrechen, SERVER_ZEITLIMIT);
            try {
                const antwort = await fetch(server, {
                    method: "POST",
                    body: "data=" + encodeURIComponent(abfrage),
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    signal: steuerung.signal,
                });
                if (!antwort.ok) throw new Error("HTTP " + antwort.status);
                const daten = await antwort.json();
                cache.set(schluessel, daten.elements);
                return daten.elements;
            } catch (fehler) {
                if (signal.aborted) throw fehler; // Nutzer hat neu gesucht
                letzterFehler = fehler;           // Zeitlimit/Fehler: nächster Server
            } finally {
                clearTimeout(timer);
                signal.removeEventListener("abort", abbrechen);
            }
        }
        throw letzterFehler;
    }

    // --- Suchpunkt -----------------------------------------------------------
    // Setzt (oder verschiebt) den Suchpunkt und sucht im gewählten Umkreis um ihn herum.
    function setzeSuchpunkt(mitte, vorspann = "") {
        if (!suchMarker) {
            suchMarker = L.marker(mitte, {
                icon: suchIcon,
                draggable: true,
                autoPan: true,
                zIndexOffset: 1000,
                title: "Suchpunkt – zum Verschieben ziehen",
                alt: "Suchpunkt",
                keyboard: false,
            }).addTo(karte);
            // Beim Ziehen wandert der Umkreis mit, gesucht wird beim Loslassen
            suchMarker.on("drag", (e) => radiusKreis?.setLatLng(e.target.getLatLng()));
            suchMarker.on("dragend", (e) => {
                const p = e.target.getLatLng();
                suche([p.lat, p.lng]);
            });
        } else {
            suchMarker.setLatLng(mitte);
        }
        suche(mitte, vorspann);
    }

    function zeichneUmkreis(mitte, radius) {
        if (!radiusKreis) {
            radiusKreis = L.circle(mitte, {
                radius,
                color: "#c0392b",
                weight: 1,
                fillOpacity: 0.06,
                interactive: false,
            }).addTo(karte);
        } else {
            radiusKreis.setLatLng(mitte).setRadius(radius);
        }
        // Nur zoomen/verschieben, wenn der Umkreis nicht schon ganz sichtbar ist
        const grenzen = radiusKreis.getBounds();
        if (!karte.getBounds().contains(grenzen)) {
            karte.fitBounds(grenzen, { padding: [20, 20] });
        }
    }

    // vorspann: optionaler Hinweis, der vor die Statusmeldung gestellt wird
    async function suche(mitte, vorspann = "") {
        const radius = Number(radiusAuswahl.value);
        zustand.suchMitte = mitte;

        if (laufendeAnfrage) laufendeAnfrage.abort();
        laufendeAnfrage = new AbortController();

        zeichneUmkreis(mitte, radius);

        setzeStatus("Suche Defibrillatoren im Umkreis von " + formatEntfernung(radius) + " …");

        try {
            const elemente = await ladeDefis(mitte, radius, laufendeAnfrage.signal);
            const amStandort = zustand.standort
                && mitte[0] === zustand.standort[0] && mitte[1] === zustand.standort[1];
            zustand.defis = elemente
                .map(aufbereiten)
                .filter((d) => d.lat !== undefined && d.lon !== undefined)
                .map((d) => ({ ...d, entfernung: entfernung(mitte, [d.lat, d.lon]) }))
                .filter((d) => d.entfernung <= radius + 50)
                .sort((a, b) => a.entfernung - b.entfernung)
                .slice(0, MAX_EINTRAEGE);
            zustand.aktivId = null;

            if (zustand.defis.length === 0) {
                setzeStatus(vorspann + "Keine Defibrillatoren in diesem Umkreis eingetragen. Vergrößere den Umkreis oder setze den Suchpunkt woanders hin.", !!vorspann);
            } else {
                const ab = amStandort ? "deinem Standort" : "dem Suchpunkt";
                setzeStatus(vorspann + zustand.defis.length + " Defibrillator(en) gefunden – sortiert nach Entfernung zu " + ab + ".", !!vorspann);
            }
            render();
        } catch (fehler) {
            if (fehler.name === "AbortError") return;
            console.error(fehler);
            setzeStatus("Die Defi-Daten konnten nicht geladen werden. Bitte versuche es gleich noch einmal.", true);
        }
    }

    // --- Standort ------------------------------------------------------------
    function ermittleStandort() {
        if (!("geolocation" in navigator)) {
            setzeSuchpunkt(START_MITTE, "Dein Browser unterstützt keine Standortabfrage. ");
            return;
        }
        setzeStatus("Ermittle deinen Standort …");
        standortKnopf.disabled = true;

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                standortKnopf.disabled = false;
                zustand.standort = [pos.coords.latitude, pos.coords.longitude];
                if (standortMarker) standortMarker.remove();
                standortMarker = L.circleMarker(zustand.standort, {
                    radius: 8,
                    color: "#fff",
                    weight: 3,
                    fillColor: "#1a73e8",
                    fillOpacity: 1,
                }).addTo(karte).bindTooltip("Dein Standort");
                setzeSuchpunkt(zustand.standort);
            },
            (fehler) => {
                standortKnopf.disabled = false;
                const gruende = {
                    1: "Standortzugriff wurde nicht erlaubt.",
                    2: "Standort konnte nicht bestimmt werden.",
                    3: "Standortabfrage hat zu lange gedauert.",
                };
                const grund = (gruende[fehler.code] || "Standort nicht verfügbar.")
                    + " Tippe auf die Karte, um einen Suchpunkt zu setzen.";
                setzeStatus(grund, true);
                if (!zustand.suchMitte) setzeSuchpunkt(START_MITTE, grund + " ");
            },
            // Ohne GPS-Genauigkeit: am PC/WLAN viel schneller, für die Defi-Suche genau genug
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
        );
    }

    // --- Darstellung ---------------------------------------------------------
    function element(tag, klasse, text) {
        const el = document.createElement(tag);
        if (klasse) el.className = klasse;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    function badge(info) {
        return element("span", "defi-badge " + info.art, info.text);
    }

    function routenKnopf(defi) {
        const a = element("a", "button-link defi-route", "Route in Google Maps");
        a.href = routenLink(defi);
        a.target = "_blank";
        a.rel = "noopener";
        return a;
    }

    // Inhalt für Popup und Listeneintrag
    function details(defi, mitRoute) {
        const box = element("div", "defi-details");

        const badges = element("div", "defi-badges");
        badges.append(badge(defi.verfuegbarkeit));
        if (defi.zugang) badges.append(badge(defi.zugang));
        box.append(badges);

        const dl = element("dl", "defi-infos");
        function zeile(titel, wert) {
            if (!wert) return;
            dl.append(element("dt", "", titel), element("dd", "", wert));
        }
        zeile("Wo genau", defi.lage.join(" · ") || "Keine genaue Beschreibung eingetragen");
        zeile("Adresse", defi.adresse);
        zeile("Betreiber", defi.betreiber);
        if (defi.telefon) {
            const dd = element("dd");
            const tel = element("a", "", defi.telefon);
            tel.href = "tel:" + defi.telefon.replace(/[^\d+]/g, "");
            dd.append(tel);
            dl.append(element("dt", "", "Telefon"), dd);
        }
        box.append(dl);

        if (mitRoute) box.append(routenKnopf(defi));
        return box;
    }

    function popupInhalt(defi) {
        const box = element("div", "defi-popup");
        box.append(element("strong", "", defi.name));
        box.append(element("div", "defi-entfernung", formatEntfernung(defi.entfernung) + " · " + gehzeit(defi.entfernung)));
        box.append(details(defi, true));
        return box;
    }

    function waehle(id, { vonKarte = false } = {}) {
        zustand.aktivId = id;
        const defi = zustand.defis.find((d) => d.id === id);
        const m = marker.get(id);
        if (!defi || !m) return;

        if (!vonKarte) {
            karte.setView([defi.lat, defi.lon], Math.max(karte.getZoom(), 17));
            m.openPopup();
        }
        for (const li of liste.children) {
            const aktiv = li.dataset.id === id;
            li.classList.toggle("aktiv", aktiv);
            li.querySelector(".defi-eintrag-knopf")?.setAttribute("aria-expanded", String(aktiv));
            if (aktiv && vonKarte) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }

    function render() {
        markerGruppe.clearLayers();
        marker.clear();
        liste.replaceChildren();
        anzahl.textContent = zustand.defis.length;

        if (zustand.defis.length === 0) {
            liste.append(element("li", "defi-leer", "Keine Defibrillatoren gefunden."));
            return;
        }

        zustand.defis.forEach((defi, i) => {
            const m = L.marker([defi.lat, defi.lon], { icon: defiIcon, title: defi.name, alt: defi.name })
                .bindPopup(popupInhalt(defi), { maxWidth: 280 })
                .on("click", () => waehle(defi.id, { vonKarte: true }));
            m.addTo(markerGruppe);
            marker.set(defi.id, m);

            const li = element("li", "defi-eintrag");
            li.dataset.id = defi.id;

            const knopf = element("button", "defi-eintrag-knopf");
            knopf.type = "button";
            knopf.setAttribute("aria-expanded", "false");
            const nr = element("span", "defi-nummer", String(i + 1));
            const text = element("span", "defi-eintrag-text");
            text.append(
                element("span", "defi-name", defi.name),
                element("span", "defi-entfernung", formatEntfernung(defi.entfernung) + " · " + gehzeit(defi.entfernung)),
            );
            knopf.append(nr, text);
            knopf.addEventListener("click", () => waehle(defi.id));

            li.append(knopf, details(defi, true));
            liste.append(li);
        });
    }

    // --- Ereignisse ----------------------------------------------------------
    standortKnopf.addEventListener("click", ermittleStandort);
    // Klick/Tipp auf die Karte setzt den Suchpunkt (Klicks auf Defi-Marker zählen nicht)
    karte.on("click", (e) => setzeSuchpunkt([e.latlng.lat, e.latlng.lng]));
    // Alternative ohne Maus (Tastatur): Suchpunkt in die Kartenmitte setzen
    bereichKnopf.addEventListener("click", () => {
        const c = karte.getCenter();
        setzeSuchpunkt([c.lat, c.lng]);
    });
    radiusAuswahl.addEventListener("change", () => {
        if (zustand.suchMitte) suche(zustand.suchMitte);
    });

    ermittleStandort();
}
