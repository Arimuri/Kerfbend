(function (root) {
  'use strict';

  const defaults = Object.freeze({
    bpm: 120, bars: 4, density: 60, breaks: 15, size: 50, motion: 25, octave: 12, swing: 0, chop: 16,
  });
  const rhythms = [
    [0, 2, 5, 6, 8, 10, 13, 14],
    [0, 3, 4, 7, 8, 11, 12, 14],
    [0, 2, 4, 6, 8, 10, 12, 15],
    [0, 3, 6, 7, 8, 10, 13, 15],
  ];

  function bounded(value, fallback, min, max) {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
  }

  function normalize(settings) {
    const input = settings || {};
    return {
      bpm: bounded(input.bpm, defaults.bpm, 30, 240),
      bars: Math.round(bounded(input.bars, defaults.bars, 1, 16)),
      chop: getChop(input),
      density: bounded(input.density, defaults.density, 0, 100),
      breaks: bounded(input.breaks, defaults.breaks, 0, 100),
      size: bounded(input.size, defaults.size, 0, 100),
      motion: bounded(input.motion, defaults.motion, 0, 100),
      octave: bounded(input.octave, defaults.octave, 0, 100),
      swing: bounded(input.swing, defaults.swing, 0, 50),
    };
  }

  function getChop(settings) {
    const input = settings || {};
    if (input.size != null && Number.isFinite(Number(input.size))) {
      return [32, 24, 16, 8, 4][Math.round(bounded(input.size, defaults.size, 0, 100) / 25)];
    }
    return Math.round(bounded(input.chop, defaults.chop, 1, 64));
  }

  function seedString(seed) {
    return String(seed == null ? 'BLUE-001' : seed).trim() || 'BLUE-001';
  }

  // FNV-1a seeds Mulberry32 (Tommy Ettinger; bryc's public-domain JS form).
  // See THIRD_PARTY_NOTICES.md. Each lane has an independent stream.
  function randomFor(seed, laneId) {
    const value = JSON.stringify(['blue-loop-v1', seedString(seed), String(laneId)]);
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    let state = hash >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) | 0;
      let next = Math.imul(state ^ (state >>> 15), 1 | state);
      next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }

  function octave(random, probability) {
    const chance = random();
    if (chance < probability * 0.25) return -12;
    if (chance < probability) return 12;
    return 0;
  }

  function lockedEvents(lane, totalSteps) {
    return lane.events.filter(function (event) {
      return event && Number.isFinite(event.step) && event.step >= 0 && event.step < totalSteps;
    }).map(function (event) {
      return Object.assign({}, event, {
        laneId: lane.id,
        durationSteps: Math.min(event.durationSteps, totalSteps - event.step),
      });
    });
  }

  function generateLane(lane, settings, seed) {
    const totalSteps = settings.bars * 16;
    if (lane.locked && Array.isArray(lane.events)) return lockedEvents(lane, totalSteps);
    if (settings.density === 0) return [];

    const random = randomFor(seed, lane.id);
    const scatter = 0.45;
    const motion = settings.motion / 100;
    const octaveProbability = settings.octave / 100;
    const density = settings.density / 100;
    const minimumLength = 1 + Math.floor(settings.size / 50);
    const maximumLength = 1 + Math.round(settings.size * 0.03);
    const motifSteps = Math.min(totalSteps, 32);
    const motif = [];
    let slice = Math.floor(random() * settings.chop);

    for (let bar = 0; bar < motifSteps / 16; bar += 1) {
      const rhythm = rhythms[Math.floor(random() * rhythms.length)];
      rhythm.forEach(function (position) {
        // Beat one and beat three supply an anchor; the other cuts leave more room.
        const anchor = position === 0 || position === 8;
        const keep = random() < Math.min(1, density * (anchor ? 1.25 : 0.92));
        const jump = random();
        if (jump < scatter * 0.7) {
          slice = Math.floor(random() * settings.chop);
        } else {
          slice = (slice + (random() < 0.26 ? 0 : 1)) % settings.chop;
        }
        const event = {
          laneId: lane.id,
          step: bar * 16 + position,
          sliceIndex: slice,
          startRatio: slice / settings.chop,
          sourceChop: settings.chop,
          durationSteps: minimumLength + Math.floor(random() * (maximumLength - minimumLength + 1)),
          semitones: octave(random, octaveProbability),
          reverse: random() < motion * 0.19,
          velocity: Number((0.65 + random() * 0.27 + (anchor ? 0.06 : 0)).toFixed(3)),
        };
        if (keep || (bar === 0 && position === 0)) motif.push(event);
      });
    }

    const events = [];
    for (let cycle = 0; cycle * motifSteps < totalSteps; cycle += 1) {
      motif.forEach(function (original) {
        const event = Object.assign({}, original, { step: original.step + cycle * motifSteps });
        if (event.step >= totalSteps) return;
        // The opening bar of each repeated motif stays recognizable. Change the answer.
        const answer = cycle > 0 && original.step >= 16;
        if (answer && random() < scatter * 0.23) {
          event.sliceIndex = Math.floor(random() * settings.chop);
          event.startRatio = event.sliceIndex / settings.chop;
          event.semitones = octave(random, octaveProbability);
          event.reverse = random() < motion * 0.19;
        }
        events.push(event);
      });
    }

    // A single empty span makes BREAKS audibly different from lowering density.
    const breakLength = Math.floor(totalSteps * 0.5 * settings.breaks / 100);
    // Share the gap across lanes so the whole phrase can breathe.
    const breakStart = Math.floor(randomFor(seed, '__phrase-break__')() * (totalSteps - breakLength + 1));
    const breakEnd = breakStart + breakLength;
    const audibleEvents = events.filter(function (event) {
      return breakLength === 0 || event.step < breakStart || event.step >= breakEnd;
    });

    // Gate before the next onset and at the silence boundary, avoiding piled-up cuts.
    audibleEvents.forEach(function (event, index) {
      const nextStep = index + 1 < audibleEvents.length ? audibleEvents[index + 1].step : totalSteps;
      const boundary = breakLength > 0 && event.step < breakStart ? breakStart : totalSteps;
      event.durationSteps = Math.min(event.durationSteps, nextStep - event.step, boundary - event.step);
    });
    return audibleEvents;
  }

  function generate(lanes, settings, seed) {
    const params = normalize(settings);
    return (lanes || []).reduce(function (events, lane) {
      if (!lane || lane.id == null) return events;
      return events.concat(generateLane(lane, params, seed));
    }, []);
  }

  function duration(settings) {
    const params = normalize(settings);
    return params.bars * 4 * 60 / params.bpm;
  }

  root.BlueLoopGenerator = Object.freeze({ defaults, generate, duration, seedString, getChop });
})(typeof window !== 'undefined' ? window : globalThis);
