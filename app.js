// Taktgeber für die Herzdruckmassage (nur auf helfen.html vorhanden)
(function () {
    const trainer = document.getElementById("taktTrainer");
    if (!trainer) return;

    const TAKT_BPM = 110;
    const startKnopf = document.getElementById("taktStart");
    const lampe = document.getElementById("taktLampe");
    const druckKnopf = document.getElementById("druckKnopf");
    const bpmAnzeige = document.getElementById("taktBpm");
    const zaehlerAnzeige = document.getElementById("taktZaehler");
    const feedback = document.getElementById("taktFeedback");

    let audio = null;
    let taktTimer = null;
    let druckZeiten = [];
    let zaehler = 0;

    // Kurzer Klick-Ton über die Web Audio API
    function klick() {
        if (!audio) return;
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.25, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
        osc.connect(gain).connect(audio.destination);
        osc.start();
        osc.stop(audio.currentTime + 0.08);
    }

    function taktSchlag() {
        klick();
        lampe.classList.add("an");
        setTimeout(() => lampe.classList.remove("an"), 120);
    }

    function taktUmschalten() {
        if (taktTimer) {
            clearInterval(taktTimer);
            taktTimer = null;
            startKnopf.innerHTML = "&#9654; Takt starten (" + TAKT_BPM + "/min)";
            return;
        }
        if (!audio) {
            const AudioKontext = window.AudioContext || window.webkitAudioContext;
            if (AudioKontext) audio = new AudioKontext();
        }
        taktSchlag();
        taktTimer = setInterval(taktSchlag, 60000 / TAKT_BPM);
        startKnopf.innerHTML = "&#10074;&#10074; Takt stoppen";
    }

    function setzeFeedback(text, klasse) {
        feedback.textContent = text;
        feedback.className = "takt-feedback" + (klasse ? " " + klasse : "");
    }

    function druecken() {
        const jetzt = performance.now();

        // Nach mehr als 2 Sekunden Pause neu messen
        if (druckZeiten.length && jetzt - druckZeiten[druckZeiten.length - 1] > 2000) {
            druckZeiten = [];
        }
        druckZeiten.push(jetzt);
        if (druckZeiten.length > 8) druckZeiten.shift();

        zaehler++;
        zaehlerAnzeige.textContent = zaehler;

        if (druckZeiten.length < 4) {
            setzeFeedback("Weiter so, ich messe noch …");
            return;
        }

        const dauer = druckZeiten[druckZeiten.length - 1] - druckZeiten[0];
        const bpm = Math.round((druckZeiten.length - 1) * 60000 / dauer);
        bpmAnzeige.textContent = bpm;

        if (bpm < 100) setzeFeedback("Schneller drücken!", "falsch");
        else if (bpm > 120) setzeFeedback("Etwas langsamer!", "falsch");
        else setzeFeedback("Perfekter Rhythmus!", "gut");
    }

    startKnopf.addEventListener("click", taktUmschalten);

    druckKnopf.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        druecken();
    });

    // Leertaste als Alternative zum Klicken
    document.addEventListener("keydown", (e) => {
        if (e.code !== "Space" || e.repeat) return;
        if (e.target !== druckKnopf && e.target.closest("button, a, input, textarea")) return;
        e.preventDefault();
        druckKnopf.classList.add("gedrueckt");
        druecken();
    });

    document.addEventListener("keyup", (e) => {
        if (e.code === "Space") druckKnopf.classList.remove("gedrueckt");
    });
})();


// Feedback-Formular (nur auf feedback.html vorhanden)
(function () {
    const form = document.getElementById("feedbackForm");
    if (!form) return;

    const SPEICHER_KEY = "defiFinder.feedback.v1";
    const BEREICHE = {
        allgemein: "Allgemein",
        karte: "Karte",
        tutorial: "Wie funktioniert's?",
        helfen: "Wie helfe ich richtig?",
        mitmachen: "Mitmachen",
    };

    const meldung = document.getElementById("feedbackMeldung");
    const liste = document.getElementById("feedbackListe");
    const zaehler = document.getElementById("feedbackZaehler");

    // Der eine Zustand: alles, was die Anzeige bestimmt, steht hier drin
    const zustand = {
        eintraege: ladeEintraege(),
    };

    // Prüft, ob ein Objekt (z. B. aus localStorage) wirklich ein gültiger Eintrag ist
    function istGueltigerEintrag(e) {
        return e !== null && typeof e === "object"
            && typeof e.id === "string"
            && typeof e.name === "string" && e.name.length <= 50
            && Number.isInteger(e.bewertung) && e.bewertung >= 1 && e.bewertung <= 5
            && typeof e.bereich === "string" && e.bereich in BEREICHE
            && typeof e.nachricht === "string" && e.nachricht.length >= 5 && e.nachricht.length <= 500
            && typeof e.datum === "string";
    }

    // Bonus: beim Start lesen – kaputte oder veraltete Daten werden abgefangen
    function ladeEintraege() {
        try {
            const roh = localStorage.getItem(SPEICHER_KEY);
            if (roh === null) return [];
            const daten = JSON.parse(roh);
            if (!Array.isArray(daten)) throw new Error("Kein Array");
            return daten.filter(istGueltigerEintrag);
        } catch (fehler) {
            console.warn("Gespeichertes Feedback unlesbar, starte leer.", fehler);
            try { localStorage.removeItem(SPEICHER_KEY); } catch (_) { /* Speicher gesperrt */ }
            return [];
        }
    }

    // Bonus: bei jeder Änderung schreiben
    function speichereEintraege() {
        try {
            localStorage.setItem(SPEICHER_KEY, JSON.stringify(zustand.eintraege));
        } catch (fehler) {
            console.warn("Feedback konnte nicht gespeichert werden.", fehler);
        }
    }

    function zeigeMeldung(text, istFehler) {
        meldung.textContent = text;
        meldung.className = "mb-0 font-semibold " + (istFehler ? "text-rot" : "text-green-700");
    }

    // Die eine Zeichenfunktion: baut Liste und Zähler komplett aus dem Zustand
    function render() {
        zaehler.textContent = zustand.eintraege.length;
        liste.replaceChildren();

        if (zustand.eintraege.length === 0) {
            const leer = document.createElement("li");
            leer.className = "text-grau";
            leer.textContent = "Noch kein Feedback vorhanden.";
            liste.append(leer);
            return;
        }

        for (const eintrag of zustand.eintraege) {
            const li = document.createElement("li");
            li.className = "rounded-xl bg-hintergrund p-4";

            const kopf = document.createElement("div");
            kopf.className = "flex flex-wrap items-center justify-between gap-2";

            const titel = document.createElement("strong");
            titel.textContent = (eintrag.name || "Anonym") + " · " + BEREICHE[eintrag.bereich];

            const sterne = document.createElement("span");
            sterne.className = "text-rot";
            sterne.setAttribute("aria-label", eintrag.bewertung + " von 5 Sternen");
            sterne.textContent = "★".repeat(eintrag.bewertung) + "☆".repeat(5 - eintrag.bewertung);

            kopf.append(titel, sterne);

            const text = document.createElement("p");
            text.className = "my-2 whitespace-pre-line";
            text.textContent = eintrag.nachricht;

            const fuss = document.createElement("div");
            fuss.className = "flex items-center justify-between gap-2 text-sm text-grau";

            const datum = document.createElement("span");
            datum.textContent = new Date(eintrag.datum).toLocaleString("de-DE");

            const loeschen = document.createElement("button");
            loeschen.type = "button";
            loeschen.className = "font-semibold text-rot hover:underline";
            loeschen.textContent = "Löschen";
            loeschen.addEventListener("click", () => entferneEintrag(eintrag.id));

            fuss.append(datum, loeschen);
            li.append(kopf, text, fuss);
            liste.append(li);
        }
    }

    function entferneEintrag(id) {
        zustand.eintraege = zustand.eintraege.filter((e) => e.id !== id);
        speichereEintraege();
        render();
        zeigeMeldung("Eintrag gelöscht.", false);
    }

    // Eingaben prüfen: leer, zu lang, falscher Typ
    function pruefeEingaben(name, bewertung, bereich, nachricht) {
        if (name.length > 50) return "Der Name darf höchstens 50 Zeichen lang sein.";
        if (!Number.isInteger(bewertung) || bewertung < 1 || bewertung > 5) return "Bitte wähle eine Bewertung von 1 bis 5.";
        if (!(bereich in BEREICHE)) return "Bitte wähle einen gültigen Bereich.";
        if (nachricht.length === 0) return "Bitte schreib eine Nachricht.";
        if (nachricht.length < 5) return "Die Nachricht muss mindestens 5 Zeichen lang sein.";
        if (nachricht.length > 500) return "Die Nachricht darf höchstens 500 Zeichen lang sein.";
        return null;
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault(); // kein Neuladen, Adresszeile bleibt gleich

        const daten = new FormData(form);
        const name = String(daten.get("name") ?? "").trim();
        const bewertung = Number(daten.get("bewertung"));
        const bereich = String(daten.get("bereich") ?? "");
        const nachricht = String(daten.get("nachricht") ?? "").trim();

        const fehler = pruefeEingaben(name, bewertung, bereich, nachricht);
        if (fehler) {
            zeigeMeldung(fehler, true);
            return;
        }

        zustand.eintraege.unshift({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            name,
            bewertung,
            bereich,
            nachricht,
            datum: new Date().toISOString(),
        });
        speichereEintraege();
        render();

        form.reset();
        zeigeMeldung("Danke für dein Feedback!", false);
    });

    render();
})();
