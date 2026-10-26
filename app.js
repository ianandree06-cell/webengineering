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
