// All sound is synthesised with the Web Audio API. No audio files ship with the
// game, so there is nothing to download, nothing to license, and it works
// offline. Exposes a single global: window.WavelengthAudio.
(function () {
    "use strict";

    const SFX_KEY = "wavelengthSfxEnabled";
    const MUSIC_KEY = "wavelengthMusicEnabled";

    let context = null;
    let masterGain = null;
    let musicGain = null;
    let musicTimer = null;
    let musicStep = 0;

    function readFlag(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            return raw === "true";
        } catch (error) {
            return fallback;
        }
    }

    function writeFlag(key, value) {
        try {
            localStorage.setItem(key, value ? "true" : "false");
        } catch (error) {
            /* Storage unavailable — the setting just will not persist. */
        }
    }

    // Both default on. Nothing plays until the first tap regardless: browsers
    // block audio before a user gesture, and the game starts with one.
    let sfxEnabled = readFlag(SFX_KEY, true);
    let musicEnabled = readFlag(MUSIC_KEY, true);

    // Browsers refuse to start audio until the user interacts with the page, so
    // the context is created lazily on the first sound rather than at load.
    function ensureContext() {
        if (context) {
            if (context.state === "suspended") context.resume();
            return context;
        }
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;

        context = new Ctor();
        masterGain = context.createGain();
        masterGain.gain.value = 0.35;
        masterGain.connect(context.destination);

        musicGain = context.createGain();
        musicGain.gain.value = 0;
        musicGain.connect(masterGain);

        return context;
    }

    // One synth voice: an oscillator through its own envelope.
    function tone(options) {
        const ctx = ensureContext();
        if (!ctx) return;

        const {
            frequency,
            endFrequency,
            type = "sine",
            duration = 0.2,
            attack = 0.005,
            peak = 0.5,
            delay = 0,
            destination = masterGain
        } = options;

        const startAt = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, startAt);
        if (endFrequency && endFrequency !== frequency) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), startAt + duration);
        }

        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(peak, startAt + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        osc.connect(gain);
        gain.connect(destination);
        osc.start(startAt);
        osc.stop(startAt + duration + 0.02);
    }

    // Filtered white noise, for the dial sweep and the miss sound.
    function noise(options) {
        const ctx = ensureContext();
        if (!ctx) return;

        const { duration = 0.3, peak = 0.2, filterFrequency = 1200, filterType = "bandpass" } = options || {};
        const frames = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < frames; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = filterFrequency;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(peak, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        source.start();
    }

    const effects = {
        // Soft click as the needle passes each degree of the dial.
        tick() {
            tone({ frequency: 900, endFrequency: 600, type: "square", duration: 0.03, peak: 0.06 });
        },
        // Picking up the needle.
        grab() {
            tone({ frequency: 220, endFrequency: 340, type: "sine", duration: 0.12, peak: 0.25 });
        },
        // Hiding the target from the guessers: a sliding hatch.
        hide() {
            noise({ duration: 0.35, peak: 0.18, filterFrequency: 800, filterType: "lowpass" });
            tone({ frequency: 300, endFrequency: 120, type: "sine", duration: 0.3, peak: 0.3 });
        },
        // Opening the hatch to reveal where the target actually was.
        reveal() {
            noise({ duration: 0.4, peak: 0.15, filterFrequency: 1600, filterType: "bandpass" });
            tone({ frequency: 200, endFrequency: 700, type: "triangle", duration: 0.35, peak: 0.3 });
        },
        // A rising arpeggio whose length and brightness scale with the score.
        score(points) {
            if (points <= 0) {
                tone({ frequency: 200, endFrequency: 90, type: "sawtooth", duration: 0.4, peak: 0.25 });
                noise({ duration: 0.3, peak: 0.12, filterFrequency: 400, filterType: "lowpass" });
                return;
            }
            const scales = {
                1: [392.0],
                3: [392.0, 493.88, 587.33],
                5: [392.0, 493.88, 587.33, 783.99, 987.77]
            };
            const notes = scales[points] || scales[1];
            notes.forEach((frequency, index) => {
                tone({
                    frequency,
                    type: "triangle",
                    duration: 0.25,
                    peak: 0.32,
                    delay: index * 0.075
                });
            });
        },
        // Bull's-eye fanfare, played on top of the score arpeggio.
        fanfare() {
            [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
                tone({ frequency, type: "square", duration: 0.5, peak: 0.16, delay: 0.35 + index * 0.09 });
            });
        },
        // Advancing to a new round.
        newRound() {
            tone({ frequency: 587.33, type: "sine", duration: 0.18, peak: 0.25 });
            tone({ frequency: 880.0, type: "sine", duration: 0.22, peak: 0.22, delay: 0.09 });
        },
        // Starting over.
        newGame() {
            [261.63, 329.63, 392.0, 523.25].forEach((frequency, index) => {
                tone({ frequency, type: "triangle", duration: 0.3, peak: 0.2, delay: index * 0.06 });
            });
        },
        button() {
            tone({ frequency: 660, endFrequency: 880, type: "sine", duration: 0.07, peak: 0.14 });
        }
    };

    // A slow four-chord pad that loops. Deliberately sparse so it sits under
    // conversation rather than competing with it.
    const CHORDS = [
        [220.0, 277.18, 329.63],
        [196.0, 246.94, 293.66],
        [174.61, 220.0, 261.63],
        [196.0, 261.63, 311.13]
    ];

    function playChord() {
        const ctx = ensureContext();
        if (!ctx || !musicEnabled) return;

        CHORDS[musicStep % CHORDS.length].forEach((frequency) => {
            tone({
                frequency,
                type: "sine",
                duration: 3.6,
                attack: 1.2,
                peak: 0.09,
                destination: musicGain
            });
        });
        musicStep++;
    }

    function startMusic() {
        const ctx = ensureContext();
        if (!ctx || musicTimer) return;
        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.setTargetAtTime(1, ctx.currentTime, 0.5);
        playChord();
        musicTimer = setInterval(playChord, 4000);
    }

    function stopMusic() {
        if (musicTimer) {
            clearInterval(musicTimer);
            musicTimer = null;
        }
        if (context && musicGain) {
            musicGain.gain.setTargetAtTime(0, context.currentTime, 0.4);
        }
    }

    window.WavelengthAudio = {
        play(name, argument) {
            if (!sfxEnabled) return;
            const effect = effects[name];
            if (effect) effect(argument);
        },

        isSfxEnabled() {
            return sfxEnabled;
        },

        isMusicEnabled() {
            return musicEnabled;
        },

        setSfxEnabled(value) {
            sfxEnabled = Boolean(value);
            writeFlag(SFX_KEY, sfxEnabled);
            if (sfxEnabled) effects.button();
        },

        setMusicEnabled(value) {
            musicEnabled = Boolean(value);
            writeFlag(MUSIC_KEY, musicEnabled);
            if (musicEnabled) startMusic();
            else stopMusic();
        },

        // Called after the first real interaction, when autoplay is allowed.
        resumeIfEnabled() {
            if (musicEnabled) startMusic();
            else ensureContext();
        }
    };
})();
