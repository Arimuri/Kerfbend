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

  function direction(event) {
    const item = event || {};
    // Hash only the stored cut's identity. Pitch, reverse, playback settings and
    // lane locks must not reroll its direction when a finished phrase changes.
    const identity = JSON.stringify([
      String(item.laneId == null ? '' : item.laneId),
      number(item.step, 0), number(item.sliceIndex, 0),
      number(item.startRatio, 0), number(item.sourceChop, 16),
      number(item.velocity, 0.8)
    ]);
    let hash = 2166136261;
    for (let index = 0; index < identity.length; index++) {
      hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
    }
    return hash >>> 31 ? 1 : -1;
  }

  function create(baseRate, event, settings, startSeconds, sampleRate) {
    const params = settings || {};
    const base = clamp(number(baseRate, 1), 1 / 128, 128);
    const magnitude = clamp(number(params.pitchEnvDepth, 0), 0, 24);
    const decaySeconds = clamp(number(params.pitchEnvTime, 80), 5, 500) / 1000;
    const depth = magnitude ? magnitude * direction(event) : 0;
    const startRate = base * Math.pow(2, depth / 12);
    const points = [{ time: 0, rate: startRate }];
    const consumed = [0];

    if (magnitude) {
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
      enabled: magnitude > 0, depth, baseRate: base, startRate, decaySeconds,
      points, sourceSecondsAt, durationFor, rateAt
    };
  }

  root.BlueLoopPitchEnvelope = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
