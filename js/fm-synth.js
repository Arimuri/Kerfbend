(function (root) {
  'use strict';

  const SAMPLE_RATE = 44100;
  const TAU = Math.PI * 2;
  const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];

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
      seed: String(input.seed == null ? 'FM-001' : input.seed).trim().slice(0, 256) || 'FM-001'
    };
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
    const motif = [];
    let degree = 0;

    // Make a two-bar call and answer. Draw every candidate's values so density
    // only removes or adds notes; changing the timbre never rerolls the phrase.
    for (let step = 0; step < 32; step++) {
      const chance = random();
      const direction = random();
      const gate = [1, 2, 2, 3, 4, 6, 8][Math.floor(random() * 7)];
      const velocity = 0.66 + random() * 0.23 + (step % 4 === 0 ? 0.08 : 0);
      const weight = step % 4 === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.38;
      if (step % 16 === 0) degree = step === 0 ? 0 : direction < 0.55 ? 0 : 4;
      else degree = Math.max(0, Math.min(7, degree + (direction < 0.23 ? -2 : direction < 0.49 ? -1 : direction < 0.65 ? 0 : direction < 0.9 ? 1 : 2)));
      if (step % 16 === 0 || chance < settings.density / 100 * weight) {
        motif.push({ step, degree, gate, velocity });
      }
    }

    const candidates = [];
    for (let cycle = 0; cycle < settings.bars / 2; cycle++) {
      motif.forEach(function (note) {
        const variation = random();
        let degree = note.degree;
        // Preserve the call; occasionally move one scale step in the answer.
        if (cycle > 0 && note.step > 16 && variation < 0.3) {
          degree = Math.max(0, Math.min(7, degree + (variation < 0.15 ? -1 : 1)));
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
        midi: base + MAJOR[note.degree],
        velocity: note.velocity,
        step: note.step,
        steps,
        degree: note.degree
      };
    });
    return { settings, duration: totalSteps * stepSeconds, notes };
  }

  // Each synthesized note starts and ends at silence, so its boundaries are
  // natural cut points. Lanes keep them to chop one note or a short run.
  function noteSegments(result) {
    const duration = Number(result && result.duration);
    const notes = result && Array.isArray(result.notes) ? result.notes : [];
    if (!(duration > 0)) return { segments: [], segmentsDuration: 0 };
    return {
      segmentsDuration: duration,
      segments: notes.map(function (note) {
        return { start: note.start, end: note.start + note.duration, step: note.step, midi: note.midi, degree: note.degree };
      })
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
      const attack = Math.max(1, Math.min(Math.round(0.004 * SAMPLE_RATE), Math.floor(frames / 4)));
      const release = Math.max(1, Math.min(Math.round(0.012 * SAMPLE_RATE), Math.floor(frames / 4)));

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

  root.BlueLoopFMSynth = Object.freeze({ normalize, phrase, synthesize, noteSegments });
})(typeof window !== 'undefined' ? window : globalThis);
