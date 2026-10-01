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
  // Bass cells lean on beats one and three with a few pushes; each has its
  // own last-beat pattern, so an answer bar always ends differently.
  const bassRhythms = [
    [0, 3, 6, 8, 11, 14],
    [0, 6, 8, 13],
    [0, 2, 8, 10, 12],
    [0, 7, 8, 12, 15],
  ];
  const roleNames = Object.freeze(['lead', 'bass', 'fill']);
  // How each part moves: a bass repeats its cuts, holds notes and never jumps
  // an octave up; answering parts start busier and are thinned around the lead.
  const roleStyles = Object.freeze({
    lead: { rhythms, jump: 0.315, stay: 0.26, reverse: 1, rise: true, force: true, density: 1, sustain: 0 },
    drums: { rhythms, jump: 0.315, stay: 0.26, reverse: 1, rise: true, force: true, density: 1, sustain: 0 },
    fill: { rhythms, jump: 0.315, stay: 0.26, reverse: 1, rise: true, force: false, density: 1.3, sustain: 0 },
    bass: { rhythms: bassRhythms, jump: 0.15, stay: 0.55, reverse: 0.5, rise: false, force: true, density: 1, sustain: 2 },
  });
  const ANSWER_INSIDE = 0.3;
  const ANSWER_OUTSIDE = 0.85;

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

  function isDrumLane(lane) {
    return lane.category === 'drums' || (lane.category !== 'other' && lane.kind === 'drums');
  }

  // Names and generated material suggest a part; unclear sources stay neutral.
  function roleHint(lane) {
    const text = [lane.name, lane.filename].filter(function (value) { return typeof value === 'string'; }).join(' ').normalize('NFKC');
    const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const settings = lane.synthSettings || {};
    if (lane.kind === 'bass' || (lane.kind === 'fm' && Number(settings.octave) <= 2) ||
      /(?:^|[^a-z0-9])(?:bass(?:es|line)?|808s?|sub(?:s|bass)?)(?=$|[^a-z])/.test(words) || /ベース/.test(text)) return 'bass';
    if (lane.kind === 'voice' || /(?:^|[^a-z0-9])(?:vox|vocals?|voices?|leads?|melod(?:y|ies)|hooks?|chops?|toplines?)(?=$|[^a-z])/.test(words) ||
      /(?:ボーカル|ボイス|ヴォーカル|歌|メロ)/.test(text)) return 'lead';
    return null;
  }

  // Manual roles win; drums keep their own role; then one bass and one lead
  // are chosen automatically and every other part answers the lead.
  function roles(lanes) {
    const list = (lanes || []).filter(function (lane) { return lane && lane.id != null; });
    const result = {};
    list.forEach(function (lane) {
      if (roleNames.includes(lane.role)) result[lane.id] = lane.role;
      else if (isDrumLane(lane)) result[lane.id] = 'drums';
    });
    const open = list.filter(function (lane) { return !result[lane.id]; });
    const has = function (role) { return list.some(function (lane) { return result[lane.id] === role; }); };
    if (!has('bass')) {
      const bass = open.find(function (lane) { return roleHint(lane) === 'bass'; });
      if (bass) result[bass.id] = 'bass';
    }
    if (!has('lead')) {
      const free = open.filter(function (lane) { return !result[lane.id]; });
      const lead = free.find(function (lane) { return roleHint(lane) === 'lead'; }) || free[0];
      if (lead) result[lead.id] = 'lead';
    }
    open.forEach(function (lane) { if (!result[lane.id]) result[lane.id] = 'fill'; });
    return result;
  }

  function shift(semitones, rise) {
    return rise || semitones <= 0 ? semitones : 0;
  }

  // Sources that know their note boundaries (generated FM phrases) are cut
  // into runs of whole notes instead of equal slices.
  function segmentPlan(lane) {
    const duration = Number(lane && lane.segmentsDuration);
    if (!Array.isArray(lane && lane.segments) || !(duration > 0)) return null;
    const notes = lane.segments.filter(function (note) {
      return note && Number.isFinite(note.start) && Number.isFinite(note.end) &&
        note.start >= 0 && note.end > note.start && note.end <= duration + 1e-9;
    }).sort(function (first, second) { return first.start - second.start; });
    return notes.length ? { duration, notes } : null;
  }

  // SIZE picks how many neighbouring notes stay together in one cut.
  function noteGroup(size) {
    if (size < 25) return [1, 1];
    if (size < 75) return [1, 2];
    return [2, 3];
  }

  function noteCut(plan, first, count, stepSeconds) {
    const last = Math.min(plan.notes.length - 1, first + count - 1);
    const start = plan.notes[first].start;
    const length = plan.notes[last].end - start;
    return {
      sliceIndex: first, segmentCount: last - first + 1,
      startRatio: start / plan.duration, lengthRatio: length / plan.duration,
      sourceChop: plan.notes.length, durationSteps: Math.max(1, Math.round(length / stepSeconds)),
    };
  }

  // A jump lands on a note that sat on the same part of the beat in the
  // source, so moved runs keep their original push or pull.
  function noteAt(plan, position, draw, avoidBar) {
    let notes = plan.notes.map(function (note, index) { return { note, index }; });
    const elsewhere = notes.filter(function (entry) { return Math.floor(entry.note.step / 16) !== avoidBar; });
    if (avoidBar != null && elsewhere.length) notes = elsewhere;
    const beat = notes.filter(function (entry) { return Number.isInteger(entry.note.step) && entry.note.step % 4 === position % 4; });
    const parity = notes.filter(function (entry) { return Number.isInteger(entry.note.step) && entry.note.step % 2 === position % 2; });
    const pool = beat.length ? beat : parity.length ? parity : notes;
    return pool[Math.floor(draw * pool.length)].index;
  }

  // Lanes build one-bar units and lay them out as a small form, so a phrase
  // returns recognisably: A, A with a new ending, a contrasting B, then A.
  const ENDING = 12;

  function formUnit(bar, bars) {
    if (bars >= 8 && bar === bars - 1) return 'A2';
    const unit = ['A', 'A2', 'B', 'A'][bar % 4];
    return unit === 'B' && Math.floor(bar / 4) % 2 ? 'B2' : unit;
  }

  function otherRhythm(random, index, count) {
    return (index + 1 + Math.floor(random() * (count - 1))) % count;
  }

  // The answer keeps the first three beats and replaces only the last beat.
  function withEnding(events, ending) {
    return events.filter(function (event) { return event.step < ENDING; }).map(function (event) {
      return Object.assign({}, event, { durationSteps: Math.min(event.durationSteps, ENDING - event.step) });
    }).concat(ending.events.length ? ending.events : ending.first ? [ending.first] : []);
  }

  function sliceUnit(context, rhythm, from, slice, force) {
    const settings = context.settings;
    const random = context.random;
    const events = [];
    let first = null;
    rhythm.forEach(function (position) {
      if (position < from) return;
      // Beat one and beat three supply an anchor; the other cuts leave more room.
      const anchor = position === 0 || position === 8;
      const keep = random() < Math.min(1, context.density * (anchor ? 1.25 : 0.92));
      if (random() < context.style.jump) slice = Math.floor(random() * settings.chop);
      else slice = (slice + (random() < context.style.stay ? 0 : 1)) % settings.chop;
      const event = {
        laneId: context.lane.id,
        step: position,
        sliceIndex: slice,
        startRatio: slice / settings.chop,
        sourceChop: settings.chop,
        durationSteps: context.minimumLength + Math.floor(random() * (context.maximumLength - context.minimumLength + 1)) + context.style.sustain,
        semitones: shift(octave(random, context.octave), context.style.rise),
        reverse: random() < context.motion * 0.19 * context.style.reverse,
        velocity: Number((0.65 + random() * 0.27 + (anchor ? 0.06 : 0)).toFixed(3)),
      };
      if (!first) first = event;
      if (keep || position === force) events.push(event);
    });
    return { events, slice, first };
  }

  function sliceUnits(context) {
    const random = context.random;
    const chop = context.settings.chop;
    const cells = context.style.rhythms;
    const force = context.style.force ? 0 : null;
    const rhythmA = Math.floor(random() * cells.length);
    const start = Math.floor(random() * chop);
    const a = sliceUnit(context, cells[rhythmA], 0, start, force);
    const answer = sliceUnit(context, cells[otherRhythm(random, rhythmA, cells.length)], ENDING, a.slice, null);
    // B takes another rhythm from the other half of the source.
    const rhythmB = otherRhythm(random, rhythmA, cells.length);
    const b = sliceUnit(context, cells[rhythmB], 0, (start + Math.floor(chop / 2)) % chop, force);
    const turn = sliceUnit(context, cells[otherRhythm(random, rhythmB, cells.length)], ENDING, b.slice, null);
    return { A: a.events, A2: withEnding(a.events, answer), B: b.events, B2: withEnding(b.events, turn) };
  }

  function noteUnit(context, rhythm, from, state, force, avoidBar) {
    const random = context.random;
    const plan = context.plan;
    const events = [];
    let first = null;
    rhythm.forEach(function (position) {
      if (position < from) return;
      const anchor = position === 0 || position === 8;
      // Draw everything first so OCTAVE and MOTION never shift other choices.
      const keep = random() < Math.min(1, context.density * (anchor ? 1.25 : 0.92));
      const jump = random();
      const pick = random();
      const size = random();
      const semitones = shift(octave(random, context.octave), context.style.rise);
      const reverse = random() < context.motion * 0.19 * context.style.reverse;
      const velocity = Number((0.65 + random() * 0.27 + (anchor ? 0.06 : 0)).toFixed(3));
      // A run keeps sounding until its last note ends.
      if (position < state.busyUntil) return;
      const start = !state.previous || jump < context.style.jump
        ? noteAt(plan, position, pick, state.previous ? null : avoidBar)
        : (state.previous.sliceIndex + state.previous.segmentCount) % plan.notes.length;
      const cut = noteCut(plan, start, context.group[0] + Math.floor(size * (context.group[1] - context.group[0] + 1)), context.stepSeconds);
      const event = Object.assign({ laneId: context.lane.id, step: position }, cut, { semitones, reverse, velocity });
      if (!first) first = event;
      if (!(keep || position === force)) return;
      events.push(event);
      state.previous = event;
      state.busyUntil = position + event.durationSteps;
    });
    return { events, first };
  }

  function noteUnits(context) {
    const random = context.random;
    const lastBefore = function (events) {
      return events.filter(function (event) { return event.step < ENDING; }).pop() || null;
    };
    const cells = context.style.rhythms;
    const force = context.style.force ? 0 : null;
    const rhythmA = Math.floor(random() * cells.length);
    const a = noteUnit(context, cells[rhythmA], 0, { previous: null, busyUntil: 0 }, force, null);
    const answer = noteUnit(context, cells[otherRhythm(random, rhythmA, cells.length)], ENDING, { previous: lastBefore(a.events), busyUntil: ENDING }, null, null);
    // B opens with notes from another bar of the source phrase.
    const rhythmB = otherRhythm(random, rhythmA, cells.length);
    const opening = a.events.length ? Math.floor(context.plan.notes[a.events[0].sliceIndex].step / 16) : null;
    const b = noteUnit(context, cells[rhythmB], 0, { previous: null, busyUntil: 0 }, force, Number.isInteger(opening) ? opening : null);
    const turn = noteUnit(context, cells[otherRhythm(random, rhythmB, cells.length)], ENDING, { previous: lastBefore(b.events), busyUntil: ENDING }, null, null);
    return { A: a.events, A2: withEnding(a.events, answer), B: b.events, B2: withEnding(b.events, turn) };
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

  // An answering part plays sparingly while the lead sounds and freely in
  // its gaps. Draws depend on the unit, so repeated bars answer alike.
  function answerLead(events, lane, settings, seed, occupancy) {
    return events.filter(function (event) {
      const bar = Math.floor(event.step / 16);
      const position = event.step % 16;
      const unit = formUnit(bar, settings.bars);
      const source = position < ENDING ? unit.charAt(0) : unit;
      const draw = randomFor(seed, JSON.stringify([lane.id, 'answer', source, position]))();
      return draw < (occupancy[event.step] ? ANSWER_INSIDE : ANSWER_OUTSIDE);
    });
  }

  function generateLane(lane, settings, seed, part) {
    const totalSteps = settings.bars * 16;
    if (lane.locked && Array.isArray(lane.events)) return lockedEvents(lane, totalSteps);
    if (settings.density === 0) return [];

    const plan = segmentPlan(lane);
    const role = part && roleStyles[part.role] ? part.role : 'lead';
    const style = roleStyles[role];
    const context = {
      lane, settings, plan, style, random: randomFor(seed, lane.id),
      motion: settings.motion / 100, octave: settings.octave / 100, density: Math.min(1, settings.density / 100 * style.density),
      minimumLength: 1 + Math.floor(settings.size / 50), maximumLength: 1 + Math.round(settings.size * 0.03),
      stepSeconds: 60 / settings.bpm / 4, group: noteGroup(settings.size),
    };
    // Every unit is drawn whatever the length, so A and its answer stay the
    // same when the loop grows from 2 to 4 or 8 bars.
    const units = plan ? noteUnits(context) : sliceUnits(context);
    let events = [];
    for (let bar = 0; bar < settings.bars; bar += 1) {
      units[formUnit(bar, settings.bars)].forEach(function (event) {
        events.push(Object.assign({}, event, { step: event.step + bar * 16 }));
      });
    }
    if (role === 'fill' && part.occupancy) events = answerLead(events, lane, settings, seed, part.occupancy);

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
    const list = (lanes || []).filter(function (lane) { return lane && lane.id != null; });
    const parts = roles(list);
    // Leads come first so answering parts can hear where the lead sounds.
    const occupancy = new Uint8Array(params.bars * 16);
    const byLane = new Map();
    list.filter(function (lane) { return parts[lane.id] === 'lead'; }).forEach(function (lane) {
      const events = generateLane(lane, params, seed, { role: 'lead' });
      events.forEach(function (event) {
        for (let step = event.step; step < Math.min(occupancy.length, event.step + event.durationSteps); step += 1) occupancy[step] = 1;
      });
      byLane.set(lane, events);
    });
    list.filter(function (lane) { return parts[lane.id] !== 'lead'; }).forEach(function (lane) {
      byLane.set(lane, generateLane(lane, params, seed, { role: parts[lane.id], occupancy }));
    });
    return list.reduce(function (events, lane) { return events.concat(byLane.get(lane)); }, []);
  }

  function duration(settings) {
    const params = normalize(settings);
    return params.bars * 4 * 60 / params.bpm;
  }

  root.BlueLoopGenerator = Object.freeze({ defaults, generate, duration, seedString, getChop, roles, roleNames });
})(typeof window !== 'undefined' ? window : globalThis);
