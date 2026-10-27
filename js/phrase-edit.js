(function (root) {
  'use strict';

  // Edits to a finished phrase, one lane at a time. A cut is found by its
  // step, which is unique within a lane. Every edit returns a new list in
  // step order, and a lane still plays one cut at a time as generated: each
  // cut stops where the next one starts.

  function inStep(step, totalSteps) {
    return Math.max(0, Math.min(totalSteps - 1, Math.round(Number(step) || 0)));
  }

  function ordered(events) {
    return events.slice().sort(function (first, second) { return first.step - second.step; });
  }

  function gate(events, totalSteps) {
    const list = ordered(events);
    return list.map(function (event, index) {
      const next = index + 1 < list.length ? list[index + 1].step : totalSteps;
      return Object.assign({}, event, { durationSteps: Math.max(1, Math.min(event.durationSteps, next - event.step)) });
    });
  }

  // The cut sounding at a position in steps, if any. `spanOf` gives where a
  // cut sounds ({ start, end } in steps) when that is not its whole gate.
  function at(events, position, spanOf) {
    const span = spanOf || function (event) { return { start: event.step, end: event.step + Math.max(1, event.durationSteps) }; };
    return ordered(events).filter(function (event) {
      const range = span(event);
      return range.start <= position && position < range.end;
    }).pop() || null;
  }

  // Moves the cut at `from` to `to`; a cut already there gives way. The
  // moved cut keeps its length where it fits.
  function move(events, from, to, totalSteps) {
    const event = events.find(function (candidate) { return candidate.step === from; });
    const target = inStep(to, totalSteps);
    if (!event || target === from) return events;
    const others = events.filter(function (candidate) { return candidate.step !== from && candidate.step !== target; });
    return gate(others.concat([Object.assign({}, event, { step: target })]), totalSteps);
  }

  // Sets how long the cut at `step` may sound, up to the next cut.
  function resize(events, step, length, totalSteps) {
    const list = ordered(events);
    const index = list.findIndex(function (event) { return event.step === step; });
    if (index < 0) return events;
    const next = index + 1 < list.length ? list[index + 1].step : totalSteps;
    const durationSteps = Math.max(1, Math.min(Math.round(Number(length) || 1), next - step));
    return list.map(function (event, position) { return position === index ? Object.assign({}, event, { durationSteps }) : event; });
  }

  function remove(events, step) {
    return events.filter(function (event) { return event.step !== step; });
  }

  // Adds a copy of `template` at `step`, cutting the one before it short.
  // A landing accent belongs to its own step, so the copy leaves it behind.
  function add(events, step, template, totalSteps) {
    const target = inStep(step, totalSteps);
    if (!template || events.some(function (event) { return event.step === target; })) return events;
    const event = Object.assign({}, template, { step: target });
    delete event.accent;
    return gate(events.concat([event]), totalSteps);
  }

  // Plays another piece of the source at `step`; timing, pitch and level stay.
  function swap(events, step, piece) {
    const generator = root.BlueLoopGenerator;
    return events.map(function (event) { return event.step === step ? generator.withCut(event, piece) : event; });
  }

  function startOf(cut) {
    if (Number.isFinite(cut.startRatio)) return cut.startRatio;
    return (Number(cut.sliceIndex) || 0) / (Number(cut.sourceChop) || 16);
  }

  // The piece a cut plays: the one starting where it starts, else the nearest.
  function pieceOf(pieces, event) {
    if (!pieces.length || !event) return -1;
    const start = startOf(event);
    return pieces.reduce(function (best, piece, index) {
      return Math.abs(startOf(piece) - start) < Math.abs(startOf(pieces[best]) - start) ? index : best;
    }, 0);
  }

  function endOf(piece, index, pieces) {
    if (Number(piece.lengthRatio) > 0) return startOf(piece) + piece.lengthRatio;
    return index + 1 < pieces.length ? startOf(pieces[index + 1]) : 1;
  }

  // The piece under a point of the source, given as a ratio of its length;
  // between pieces, the nearest one.
  function pieceAt(pieces, ratio) {
    if (!pieces.length) return -1;
    const inside = pieces.findIndex(function (piece, index) { return startOf(piece) <= ratio && ratio < endOf(piece, index, pieces); });
    if (inside >= 0) return inside;
    const distance = function (piece, index) { return Math.min(Math.abs(startOf(piece) - ratio), Math.abs(endOf(piece, index, pieces) - ratio)); };
    return pieces.reduce(function (best, piece, index) { return distance(piece, index) < distance(pieces[best], best) ? index : best; }, 0);
  }

  // Where a piece sits in its source, as ratios of the source length.
  function span(pieces, index) {
    const piece = pieces[index];
    return piece ? { start: startOf(piece), end: Math.min(1, endOf(piece, index, pieces)) } : null;
  }

  root.BlueLoopPhraseEdit = Object.freeze({ at, move, resize, remove, add, swap, pieceOf, pieceAt, span });
})(typeof window !== 'undefined' ? window : globalThis);
