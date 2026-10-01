(function (root) {
  'use strict';

  const SAMPLE_RATE = 44100;
  const TAU = Math.PI * 2;
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  // One chord per bar, written as the major-scale degree of each chord root.
  const PROGRESSIONS = Object.freeze({
    'I': Object.freeze([0]),
    'I-IV': Object.freeze([0, 3]),
    'I-V': Object.freeze([0, 4]),
    'vi-IV': Object.freeze([5, 3]),
    'IV-V-iii-vi': Object.freeze([3, 4, 2, 5]),
    'vi-IV-V-I': Object.freeze([5, 3, 4, 0]),
  });
  const LOWEST = 0;
  const HIGHEST = 9;

  function bounded(value, fallback, minimum, maximum) {
    const number = value == null ? fallback : Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
  }

  function normalize(options) {
    const input = options || {};
    const bars = bounded(input.bars, 4, 2, 8);
    return {
      bpm: bounded(input.bpm, 120, 40, 200),
      bars: bars < 3 ? 2 : bars < 6 ? 4 : 8,
      tonic: Math.round(bounded(input.tonic, 0, 0, 11)),
      octave: Math.round(bounded(input.octave, 2, 1, 5)),
      density: bounded(input.density, 60, 0, 100),
      index: bounded(input.index, 0, 0, 8),
      ratio: Math.round(bounded(input.ratio, 2, 1, 4)),
      decay: bounded(input.decay, 300, 40, 1200),
      seed: String(input.seed == null ? 'FM-001' : input.seed).trim().slice(0, 256) || 'FM-001',
      progression: Object.prototype.hasOwnProperty.call(PROGRESSIONS, input.progression) ? input.progression : 'I'
    };
  }

  function semitonesOf(degree) {
    return 12 * Math.floor(degree / 7) + SCALE[((degree % 7) + 7) % 7];
  }

  function inChord(degree, root) {
    return [0, 2, 4].includes((((degree - root) % 7) + 7) % 7);
  }

  // Strong beats move to the nearest chord tone in the drawn direction; one
  // in six may take the chord's diatonic seventh for a maj7 or m7 colour.
  function chordTone(degree, root, draw) {
    if ((draw >= 0.42 && draw < 0.5) || draw >= 0.92) {
      let colour = null;
      for (let candidate = LOWEST; candidate <= HIGHEST; candidate++) {
        if ((((candidate - root - 6) % 7) + 7) % 7) continue;
        if (colour === null || Math.abs(candidate - degree) < Math.abs(colour - degree)) colour = candidate;
      }
      if (colour !== null) return colour;
    }
    const tones = [];
    for (let candidate = LOWEST; candidate <= HIGHEST; candidate++) if (inChord(candidate, root)) tones.push(candidate);
    const above = tones.filter(function (tone) { return tone >= degree; });
    const below = tones.filter(function (tone) { return tone <= degree; });
    if (draw < 0.5) return above.length ? above[0] : below[below.length - 1];
    return below.length ? below[below.length - 1] : above[0];
  }

  // Bar downbeats sound a chord tone close to the line: a low phrase plays
  // the root, a higher one mostly the third or fifth so it does not double
  // the bass. The phrase opens on the root.
  function downbeat(degree, root, draw, first, low) {
    const offset = first || low ? 0 : draw < 0.45 ? 2 : draw < 0.8 ? 4 : 0;
    if (first) return root;
    let best = null;
    for (let candidate = LOWEST; candidate <= HIGHEST; candidate++) {
      if ((((candidate - root - offset) % 7) + 7) % 7) continue;
      if (best === null || Math.abs(candidate - degree) < Math.abs(best - degree)) best = candidate;
    }
    return best;
  }

  // The two-bar contour is realised over each cycle's chords: strong beats
  // take chord tones and the steps between them pass or turn by scale steps.
  function realize(draws, roots, low, opening) {
    const degrees = [];
    let degree = roots[0];
    draws.forEach(function (draw, step) {
      const root = roots[Math.floor(step / 16)];
      if (step % 16 === 0) degree = downbeat(degree, root, draw.direction, opening && step === 0, low);
      else if (step % 4 === 0) degree = chordTone(degree, root, draw.direction);
      else {
        const move = draw.direction < 0.3 ? -1 : draw.direction < 0.45 ? 0 : draw.direction < 0.75 ? 1 : draw.direction < 0.88 ? -2 : 2;
        // Reflect off the edges, so a line turns back instead of sitting on them.
        const next = degree + move;
        degree = next < LOWEST ? 2 * LOWEST - next : next > HIGHEST ? 2 * HIGHEST - next : next;
      }
      degrees.push(degree);
    });
    return degrees;
  }

  // FNV-1a seeds Mulberry32, also used by the loop generator.
  // The public-domain generator's attribution is in THIRD_PARTY_NOTICES.md.
  function randomFor(seed) {
    let state = 2166136261;
    const text = 'kerfbend-fm-v1:' + seed;
    for (let index = 0; index < text.length; index++) state = Math.imul(state ^ text.charCodeAt(index), 16777619);
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function phrase(options) {
    const settings = normalize(options);
    const random = randomFor(settings.seed);
    const stepSeconds = 60 / settings.bpm / 4;
    const totalSteps = settings.bars * 16;
    const base = 12 * (settings.octave + 1) + settings.tonic;
    const roots = PROGRESSIONS[settings.progression];
    const chords = Array.from({ length: settings.bars }, function (_, bar) { return roots[bar % roots.length]; });
    const draws = [];
    const motif = [];

    // Make a two-bar call and answer. Draw every candidate's values so density
    // only removes or adds notes; changing the timbre never rerolls the phrase.
    for (let step = 0; step < 32; step++) {
      const chance = random();
      const direction = random();
      const gate = [1, 2, 2, 3, 4, 6, 8][Math.floor(random() * 7)];
      const velocity = 0.66 + random() * 0.23 + (step % 4 === 0 ? 0.08 : 0);
      const weight = step % 4 === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.38;
      draws.push({ direction });
      if (step % 16 === 0 || chance < settings.density / 100 * weight) {
        motif.push({ step, gate, velocity });
      }
    }

    const candidates = [];
    for (let cycle = 0; cycle < settings.bars / 2; cycle++) {
      // Each cycle replays the rhythm and contour over its own two chords.
      const degrees = realize(draws, [chords[cycle * 2], chords[cycle * 2 + 1]], settings.octave <= 2, cycle === 0);
      motif.forEach(function (note) {
        const variation = random();
        let degree = degrees[note.step];
        // Preserve the call; occasionally move a passing note in the answer.
        if (cycle > 0 && note.step > 16 && note.step % 4 && variation < 0.3) {
          degree = Math.max(LOWEST, Math.min(HIGHEST, degree + (variation < 0.15 ? -1 : 1)));
        }
        candidates.push({ step: cycle * 32 + note.step, degree, gate: note.gate, velocity: note.velocity });
      });
    }

    const notes = candidates.map(function (note, index) {
      const nextStep = index + 1 < candidates.length ? candidates[index + 1].step : totalSteps;
      const steps = Math.min(note.gate, nextStep - note.step, totalSteps - note.step);
      return {
        start: note.step * stepSeconds,
        duration: steps * stepSeconds,
        midi: base + semitonesOf(note.degree),
        velocity: note.velocity,
        step: note.step,
        steps,
        degree: note.degree,
        chord: chords[Math.floor(note.step / 16)]
      };
    });
    return { settings, duration: totalSteps * stepSeconds, notes, chords };
  }

  // Each synthesized note starts and ends at silence, so its boundaries are
  // natural cut points. Lanes keep them to chop one note or a short run.
  function noteSegments(result) {
    const duration = Number(result && result.duration);
    const notes = result && Array.isArray(result.notes) ? result.notes : [];
    if (!(duration > 0)) return { segments: [], segmentsDuration: 0, segmentsSteps: 0, chords: [] };
    return {
      segmentsDuration: duration,
      segmentsSteps: result.settings && result.settings.bars ? result.settings.bars * 16 : Math.round(duration / (notes[0] && notes[0].steps ? notes[0].duration / notes[0].steps : 1)),
      segments: notes.map(function (note) {
        return { start: note.start, end: note.start + note.duration, step: note.step, steps: note.steps, midi: note.midi, degree: note.degree, chord: note.chord };
      }),
      chords: Array.isArray(result.chords) ? result.chords.slice() : []
    };
  }

  function synthesize(context, options) {
    if (!context || typeof context.createBuffer !== 'function') throw new Error('FM synthesis requires an audio buffer context.');
    const result = phrase(options);
    const settings = result.settings;
    const buffer = context.createBuffer(1, Math.round(result.duration * SAMPLE_RATE), SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    const decaySeconds = settings.decay / 1000;
    const amplitudeDecay = Math.exp(-3 / (decaySeconds * SAMPLE_RATE));
    const modulationDecay = Math.exp(-4 / (decaySeconds * SAMPLE_RATE));

    result.notes.forEach(function (note) {
      const first = Math.round(note.start * SAMPLE_RATE);
      const last = Math.min(data.length, Math.round((note.start + note.duration) * SAMPLE_RATE));
      const frames = last - first;
      const frequency = 440 * Math.pow(2, (note.midi - 69) / 12);
      const phaseStep = TAU * frequency / SAMPLE_RATE;
      // Reserve room for two extra sideband orders below 80% of Nyquist.
      // High registers gradually lose FM depth instead of folding strong upper
      // sidebands into the audible range. Integer ratios preserve harmonicity.
      const safeIndex = Math.max(0, (SAMPLE_RATE * 0.4 / frequency - 1) / settings.ratio - 2);
      let modulation = Math.min(settings.index, safeIndex);
      let amplitude = 0.78 * note.velocity;
      let phase = 0;
      // Fade over at least one cycle in and one and a half cycles out, so low
      // pure sines start and stop without a thump.
      const period = SAMPLE_RATE / frequency;
      const attack = Math.max(1, Math.min(Math.round(Math.max(0.004 * SAMPLE_RATE, period)), Math.floor(frames / 4)));
      const release = Math.max(1, Math.min(Math.round(Math.max(0.012 * SAMPLE_RATE, 1.5 * period)), Math.floor(frames / 4)));

      for (let frame = 0; frame < frames; frame++) {
        let window = 1;
        if (frame < attack) window *= 0.5 - 0.5 * Math.cos(Math.PI * frame / attack);
        const remaining = frames - 1 - frame;
        if (remaining < release) window *= 0.5 - 0.5 * Math.cos(Math.PI * remaining / release);
        // Sine phase modulation is the usual two-operator FM formulation:
        // with a constant index it is equivalent to sinusoidal frequency
        // modulation. The index envelope supplies the plucked brightness.
        const sample = Math.sin(phase + modulation * Math.sin(settings.ratio * phase));
        data[first + frame] = sample * amplitude * window;
        phase += phaseStep;
        amplitude *= amplitudeDecay;
        modulation *= modulationDecay;
      }
    });
    return { buffer, phrase: result };
  }

  root.BlueLoopFMSynth = Object.freeze({ normalize, phrase, synthesize, noteSegments, progressions: PROGRESSIONS, semitonesOf });
})(typeof window !== 'undefined' ? window : globalThis);
