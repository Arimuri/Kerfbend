(function (root) {
  'use strict';

  // GLITCH edits the summed non-drum parts after rendering. On a few eighth
  // notes it repeats a tiny piece of that mix (1/16 to 1/64 of a note),
  // sometimes reversing every other repeat or zipping the pitch up or down,
  // with optional bit and sample-rate crush. Drums pass through untouched.
  const DIVISIONS = Object.freeze([1, 0.5, 0.25]);

  function number(value, fallback) {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalize(settings) {
    const input = settings || {};
    return {
      amount: clamp(number(input.glitchAmount, 0), 0, 100),
      size: clamp(number(input.glitchSize, 50), 0, 100),
      crush: clamp(number(input.glitchCrush, 0), 0, 100),
      seed: typeof input.glitchSeed === 'string' ? input.glitchSeed.slice(0, 32) : '',
    };
  }

  // FNV-1a seeds Mulberry32 (Tommy Ettinger; bryc's public-domain JS form).
  // See THIRD_PARTY_NOTICES.md.
  function randomFor(text) {
    let state = 2166136261;
    for (let index = 0; index < text.length; index++) state = Math.imul(state ^ text.charCodeAt(index), 16777619);
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Where to glitch depends only on the loop length, the phrase SEED and the
  // re-roll seed. Every eighth draws the same values whatever the controls,
  // so raising the amount adds edits around the ones already heard.
  function plan(settings, phraseSeed) {
    const params = normalize(settings);
    const bars = Math.round(clamp(number(settings && settings.bars, 4), 1, 16));
    const total = bars * 16;
    const random = randomFor(JSON.stringify(['kerfbend-glitch-v1', String(phraseSeed == null ? '' : phraseSeed), params.seed]));
    const regions = [];
    let free = 0;
    for (let step = 0; step < total; step += 2) {
      const chance = random();
      const length = random();
      const fineness = random();
      const style = random();
      const direction = random();
      // Phrase ends glitch most and downbeats least, so the groove keeps its anchor.
      const ending = step % 32 >= 28;
      const weight = ending ? 2 : step % 16 === 0 ? 0.4 : step % 4 === 0 ? 0.8 : 1;
      if (step < free || chance >= params.amount / 100 * 0.3 * weight) continue;
      const steps = Math.min(total - step, ending ? (length < 0.5 ? 4 : 2) : (length < 0.7 ? 2 : 4));
      // FINENESS moves the repeated piece from a sixteenth towards a 64th.
      const position = params.size / 50;
      const index = Math.min(2, Math.floor(position) + (fineness < position - Math.floor(position) ? 1 : 0));
      regions.push({
        step, steps, division: DIVISIONS[index],
        mode: style < 0.5 ? 'repeat' : style < 0.78 ? 'pitch' : 'reverse',
        direction: direction < 0.5 ? -1 : 1,
      });
      free = step + steps;
    }
    return { amount: params.amount, crush: params.crush, regions: params.amount ? regions : [] };
  }

  // Rewrites the regions of a stereo mix in place. The first repeat continues
  // the dry signal, later repeats fade in and out over 1.5 ms so the edit is
  // rhythmic rather than clicky, and the dry mix fades back in after it.
  function apply(channels, sampleRate, stepSeconds, glitch) {
    if (!glitch || !glitch.regions || !glitch.regions.length || !Array.isArray(channels) || !channels.length) return channels;
    const frames = channels[0].length;
    const rate = clamp(number(sampleRate, 44100), 8000, 192000);
    const step = Math.max(1e-4, number(stepSeconds, 0.125));
    const crush = clamp(number(glitch.crush, 0), 0, 100) / 100;
    const hold = 1 + Math.round(crush * 11);
    const levels = Math.pow(2, 15 - crush * 11);
    const fade = Math.max(1, Math.round(0.0015 * rate));
    const dry = channels.map(function (channel) { return Float32Array.from(channel); });
    glitch.regions.forEach(function (region) {
      const start = Math.round(region.step * step * rate);
      const end = Math.min(frames, Math.round((region.step + region.steps) * step * rate));
      const unit = Math.max(16, Math.round(region.division * step * rate));
      const edge = Math.max(1, Math.min(fade, Math.floor(unit / 4)));
      if (start >= end) return;
      channels.forEach(function (channel, index) {
        const source = dry[index];
        let held = 0;
        for (let frame = start; frame < end; frame++) {
          const offset = frame - start;
          const repeat = Math.floor(offset / unit);
          const within = offset - repeat * unit;
          let position = within;
          if (region.mode === 'reverse' && repeat % 2) position = unit - 1 - within;
          else if (region.mode === 'pitch') position = within * Math.pow(2, clamp(region.direction * repeat, -12, 12) / 12);
          const read = Math.min(frames - 1, start + position);
          const lower = Math.floor(read);
          const next = Math.min(frames - 1, lower + 1);
          let sample = source[lower] + (source[next] - source[lower]) * (read - lower);
          const fadeIn = repeat ? Math.min(1, (within + 1) / edge) : 1;
          const fadeOut = Math.min(1, (unit - within) / edge, (end - frame) / edge);
          sample *= Math.min(fadeIn, fadeOut);
          if (crush > 0) {
            if (offset % hold === 0) held = Math.round(sample * levels) / levels;
            sample = held;
          }
          channel[frame] = sample;
        }
        for (let frame = end; frame < Math.min(frames, end + edge); frame++) {
          channel[frame] = source[frame] * (frame - end + 1) / (edge + 1);
        }
      });
    });
    return channels;
  }

  root.BlueLoopGlitch = Object.freeze({ normalize, plan, apply, divisions: DIVISIONS });
})(typeof window !== 'undefined' ? window : globalThis);
