(function (root) {
  'use strict';

  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function capacity(value) {
    return value == null ? Infinity : Math.max(1, Math.min(8, Math.round(number(value, 8))));
  }

  function selectVoices(candidates, laneCount, limit) {
    if (!Number.isFinite(limit)) return candidates;
    // Each category has its own reservations and rotation cursor. A drum can
    // never take a voice or alter tied-onset priority in the other category.
    let active = [];
    let cursor = 0;
    const selected = [];
    for (let index = 0; index < candidates.length;) {
      const start = candidates[index].start;
      active = active.filter(function (end) { return end > start; });
      const group = [];
      const occurrences = new Map();
      while (index < candidates.length && candidates[index].start === start) {
        const item = candidates[index++];
        item.occurrence = occurrences.get(item.lane) || 0;
        occurrences.set(item.lane, item.occurrence + 1);
        group.push(item);
      }
      // Rotate tied onsets across lanes, with one slice per lane before taking
      // another from the same lane. Existing notes retain their reserved voices.
      group.sort(function (first, second) {
        const firstRank = (first.lane - cursor + laneCount) % laneCount;
        const secondRank = (second.lane - cursor + laneCount) % laneCount;
        return first.occurrence - second.occurrence || firstRank - secondRank || first.index - second.index;
      });
      for (const item of group) {
        if (active.length >= limit) break;
        selected.push(item);
        active.push(item.end);
        cursor = (item.lane + 1) % laneCount;
      }
    }
    return selected;
  }

  function plan(lanes, settings, events) {
    const sources = Array.isArray(lanes) ? lanes : [];
    const params = settings || {};
    const totalSteps = Math.max(1, Math.min(16, Math.round(number(params.bars, 4)))) * 16;
    const swing = Math.max(0, Math.min(50, number(params.swing, 0))) / 100;
    // Callers with the original single setting get that cap separately in both
    // categories. Omitting both limits retains the unlimited legacy behavior.
    const groups = {
      other: { capacity: capacity(params.maxVoices), laneCount: 0, candidates: [] },
      drums: { capacity: capacity(params.maxDrumVoices == null ? params.maxVoices : params.maxDrumVoices), laneCount: 0, candidates: [] }
    };
    const hasSolo = sources.some(function (lane) { return lane && lane.solo; });
    const audible = sources.filter(function (lane) {
      return lane && lane.id != null && !lane.muted && (!hasSolo || lane.solo) && number(lane.volume, 0.7) > 0;
    });
    const laneOrder = new Map(audible.map(function (lane) {
      const isDrum = lane.category === 'drums' || (lane.category !== 'other' && lane.kind === 'drums');
      const group = groups[isDrum ? 'drums' : 'other'];
      return [lane.id, { group, index: group.laneCount++ }];
    }));
    const input = Array.isArray(events) ? events : sources.flatMap(function (lane) {
      return lane && Array.isArray(lane.events) ? lane.events.map(function (event) {
        return Object.assign({}, event, { laneId: lane.id });
      }) : [];
    });
    const candidates = [];
    input.forEach(function (event, index) {
      if (!event || !laneOrder.has(event.laneId)) return;
      const step = number(event.step, -1);
      if (step < 0 || step >= totalSteps) return;
      const start = step + (Math.floor(step) % 2 ? swing : 0);
      const duration = Math.max(0, Math.min(totalSteps, number(event.durationSteps, 1)));
      const lane = laneOrder.get(event.laneId);
      const limited = Number.isFinite(lane.group.capacity);
      const gate = limited ? Math.min(duration, totalSteps - start) : duration;
      if (gate <= 0) return;
      const copy = Object.assign({}, event);
      if (limited) copy.durationSteps = gate;
      candidates.push({ event: copy, index, start, end: start + gate, lane: lane.index, group: lane.group });
    });
    candidates.sort(function (first, second) { return first.start - second.start || first.index - second.index; });
    // Reserve musical gate lengths, independent of pitch and source duration, so
    // transposing a finished phrase cannot change which slices are selected.
    candidates.forEach(function (item) { item.group.candidates.push(item); });
    const selected = Object.values(groups).flatMap(function (group) {
      return selectVoices(group.candidates, group.laneCount, group.capacity);
    });
    // Keep original order within equal starts for consistent summing and drawing.
    selected.sort(function (first, second) { return first.start - second.start || first.index - second.index; });
    return selected.map(function (item) { return item.event; });
  }

  root.BlueLoopPlayback = Object.freeze({ plan });
})(typeof window !== 'undefined' ? window : globalThis);
