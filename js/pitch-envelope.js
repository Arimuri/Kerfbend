(function (root) {
  'use strict';

  const QUANTUM_FRAMES = 128;

  function number(value, fallback) {
    const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // Hash only the stored cut's identity, by its place within the bar so a
  // repeated bar bends the same way. Pitch, reverse, playback settings and
  // lane locks must not reroll a slice's envelope when a finished phrase
  // changes; a re-roll seed, when set, picks a fresh pattern.
  function identityHash(event, salt, seed) {
    const item = event || {};
    const identity = JSON.stringify([
      String(item.laneId == null ? '' : item.laneId),
      number(item.step, 0) % 16, number(item.sliceIndex, 0),
      number(item.startRatio, 0), number(item.sourceChop, 16),
      number(item.velocity, 0.8)
    ].concat(salt ? [salt] : [], seed ? ['seed', seed] : []));
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index++) {
      hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    }
    return hash >>> 0;
  }

  function direction(event, seed) {
    return identityHash(event, null, seed) >>> 31 ? 1 : -1;
  }

  // One Mulberry32 step (Tommy Ettinger; bryc's public-domain JS form, see
  // THIRD_PARTY_NOTICES.md) spreads the FNV-1a identity hash over [0, 1).
  // Separate salts keep the chance, depth and time draws independent.
  function unit(event, salt, seed) {
    let state = (identityHash(event, salt, seed) + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  function create(baseRate, event, settings, startSeconds, sampleRate) {
    const params = settings || {};
    const base = clamp(number(baseRate, 1), 1 / 128, 128);
    const maximum = clamp(number(params.pitchEnvDepth, 0), 0, 24);
    const chance = clamp(number(params.pitchEnvChance, 100), 0, 100) / 100;
    const depthSpread = clamp(number(params.pitchEnvDepthRandom, 0), 0, 100) / 100;
    const timeSpread = clamp(number(params.pitchEnvTimeRandom, 0), 0, 100) / 100;
    const seed = typeof params.pitchEnvSeed === 'string' ? params.pitchEnvSeed.slice(0, 32) : '';
    // A lane's chance only switches slices on or off: raising it keeps every
    // slice that already had an envelope, with the same direction and shape.
    const selected = maximum > 0 && (chance >= 1 || unit(event, 'chance', seed) < chance);
    // The depth control is the largest swing; spread lowers individual slices
    // in whole semitones down to one, so no slice starts merely out of tune.
    const spreadDepth = Math.min(maximum, Math.max(1, Math.round(maximum * (1 - depthSpread * unit(event, 'depth', seed)))));
    const magnitude = selected ? (depthSpread > 0 ? spreadDepth : maximum) : 0;
    let decaySeconds = clamp(number(params.pitchEnvTime, 80), 5, 500) / 1000;
    if (timeSpread > 0) {
      // Time spreads evenly on a log scale, up to 4x either way, but a longer
      // return still settles within 70% of the slice's gate.
      const item = event || {};
      const gate = Math.max(0, number(item.durationSteps, 0)) * 15 / clamp(number(params.bpm, 120), 30, 300);
      const spread = decaySeconds * Math.pow(4, timeSpread * (2 * unit(event, 'time', seed) - 1));
      decaySeconds = clamp(Math.min(spread, Math.max(decaySeconds, 0.7 * gate)), 0.005, 0.5);
    }
    const depth = magnitude ? magnitude * direction(event, seed) : 0;
    const startRate = base * Math.pow(2, depth / 12);
    const points = [{ time: 0, rate: startRate }];
    const consumed = [0];

    if (depth) {
      const start = clamp(number(startSeconds, 0), 0, 86400);
      const rate = clamp(number(sampleRate, 44100), 8000, 192000);
      // BufferSource playbackRate is k-rate: use the global rendering quantum,
      // not a grid that restarts at each slice. Scheduling these same points
      // makes source consumption, note ends and the drawn waveform agree.
      let boundary = Math.floor(start * rate / QUANTUM_FRAMES) + 1;
      while (true) {
        const time = boundary++ * QUANTUM_FRAMES / rate - start;
        if (time <= 0) continue;
        const last = points[points.length - 1];
        consumed.push(consumed[consumed.length - 1] + (time - last.time) * last.rate);
        const remaining = Math.max(0, 1 - time / decaySeconds);
        points.push({ time, rate: base * Math.pow(2, depth * remaining / 12) });
        if (time >= decaySeconds) break;
      }
    }

    function indexAt(values, value, getValue) {
      let low = 0;
      let high = values.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (getValue(values[middle]) <= value) low = middle;
        else high = middle - 1;
      }
      return low;
    }

    function timeValue(point) { return point.time; }
    function identity(value) { return value; }

    function sourceSecondsAt(seconds) {
      const time = Math.max(0, number(seconds, 0));
      const index = indexAt(points, time, timeValue);
      return consumed[index] + (time - points[index].time) * points[index].rate;
    }

    function durationFor(sourceSeconds) {
      const distance = Math.max(0, number(sourceSeconds, 0));
      const index = indexAt(consumed, distance, identity);
      return points[index].time + (distance - consumed[index]) / points[index].rate;
    }

    function rateAt(seconds) {
      const time = Math.max(0, number(seconds, 0));
      return points[indexAt(points, time, timeValue)].rate;
    }

    return {
      enabled: depth !== 0, depth, baseRate: base, startRate, decaySeconds,
      points, sourceSecondsAt, durationFor, rateAt
    };
  }

  root.BlueLoopPitchEnvelope = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
