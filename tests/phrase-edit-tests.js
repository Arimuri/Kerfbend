(function (root) {
  'use strict';

  root.runPhraseEditTests = function () {
    const edit = root.BlueLoopPhraseEdit;
    const generator = root.BlueLoopGenerator;
    if (!edit || !generator) throw new Error('Load js/generator.js and js/phrase-edit.js before phrase-edit-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Phrase edit test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    function cut(step, durationSteps, sliceIndex, extra) {
      return Object.assign({ laneId: 'lane', step, durationSteps, sliceIndex, startRatio: sliceIndex / 16, sourceChop: 16, semitones: 0, reverse: false, velocity: 0.8 }, extra);
    }
    function steps(events) {
      return events.map(function (event) { return event.step + ':' + event.durationSteps; }).join(' ');
    }
    const total = 32;
    const events = [cut(0, 2, 0, { accent: true }), cut(4, 4, 3), cut(8, 2, 5), cut(14, 2, 7)];
    const before = JSON.stringify(events);

    // Finding a cut.
    assert(edit.at(events, 0.5) === events[0] && edit.at(events, 7.9) === events[1] && edit.at(events, 2) === null && edit.at(events, 31) === null, 'A position finds the cut sounding there');
    const sounding = function (event) { return { start: event.step + 0.5, end: event.step + 1.5 }; };
    assert(edit.at(events, 4.2, sounding) === null && edit.at(events, 5.2, sounding) === events[1] && edit.at(events, 5.6, sounding) === null, 'A cut is found only where it actually sounds');

    // Moving.
    assert(steps(edit.move(events, 4, 2, total)) === '0:2 2:4 8:2 14:2', 'A moved cut keeps its length where it fits');
    assert(steps(edit.move(events, 4, 6, total)) === '0:2 6:2 8:2 14:2', 'A moved cut stops where the next one starts');
    assert(steps(edit.move(events, 0, 6, total)) === '4:2 6:2 8:2 14:2', 'The cut before a moved one is cut short where it lands');
    assert(steps(edit.move(events, 4, 8, total)) === '0:2 8:4 14:2' && edit.move(events, 4, 8, total)[1].sliceIndex === 3, 'A cut dropped on another replaces it');
    assert(steps(edit.move(events, 14, 40, total)) === '0:2 4:4 8:2 31:1' && steps(edit.move(events, 4, -3.4, total)) === '0:4 8:2 14:2', 'A cut stays inside the loop');
    assert(steps(edit.move(events, 4, 4.4, total)) === steps(events) && edit.move(events, 4, 4.4, total) === events, 'Moves snap to sixteenths');
    assert(edit.move(events, 5, 9, total) === events, 'Moving a missing cut changes nothing');
    const moved = edit.move(events, 0, 2, total).find(function (event) { return event.step === 2; });
    assert(moved.accent === true && moved.sliceIndex === 0 && moved.velocity === 0.8, 'A moved cut keeps its piece, accent and level');

    // Lengths.
    assert(steps(edit.resize(events, 4, 3, total)) === '0:2 4:3 8:2 14:2', 'A cut can be shortened');
    assert(steps(edit.resize(events, 8, 9, total)) === '0:2 4:4 8:6 14:2' && steps(edit.resize(events, 14, 99, total)) === '0:2 4:4 8:2 14:18', 'A cut grows up to the next cut or the loop end');
    assert(steps(edit.resize(events, 4, 0, total)) === '0:2 4:1 8:2 14:2' && steps(edit.resize(events, 4, 2.6, total)) === '0:2 4:3 8:2 14:2', 'Lengths are whole sixteenths of at least one');

    // Adding and removing.
    assert(steps(edit.remove(events, 8)) === '0:2 4:4 14:2', 'A cut can be removed');
    const added = edit.add(events, 6, events[1], total);
    assert(steps(added) === '0:2 4:2 6:2 8:2 14:2' && added[2].sliceIndex === 3, 'An added cut cuts the one before it short and stops at the next');
    assert(steps(edit.add(events, 10, events[1], total)) === '0:2 4:4 8:2 10:4 14:2', 'An added cut keeps its template\'s length where it fits');
    assert(!('accent' in edit.add(events, 20, events[0], total).find(function (event) { return event.step === 20; })), 'An added copy leaves the landing accent behind');
    assert(edit.add(events, 8, events[1], total) === events && edit.add(events, 9, null, total) === events, 'Nothing is added on a taken step or without a template');
    assert(steps(edit.add([], 31, cut(0, 4, 2), total)) === '31:1', 'An added cut stays inside the loop');

    // Pieces.
    const lane = { id: 'lane', events: [], playMode: 'chop' };
    const settings = Object.assign({}, generator.defaults, { size: 50 });
    const even = generator.pieces(lane, settings);
    assert(even.length === generator.getChop(settings) && even.every(function (piece, index) {
      return piece.sliceIndex === index && piece.startRatio === index / even.length && piece.sourceChop === even.length;
    }), 'An evenly chopped lane offers its equal slices');
    assert(generator.pieces(lane, Object.assign({}, settings, { size: 100 })).length === 4, 'The pieces follow SIZE');
    assert(generator.pieces(Object.assign({}, lane, { playMode: 'loop' }), settings).length === 0, 'A whole loop has no pieces to swap');
    const analysis = { duration: 4, start: 0.01, candidates: [0.5, 1, 2, 3].map(function (time) { return { time, strength: 1 }; }) };
    const onsetLane = { id: 'lane', events: [], playMode: 'onset', onsets: analysis };
    const onsetPieces = generator.pieces(onsetLane, settings);
    const onsetCuts = root.BlueLoopOnsets.cuts(analysis, 100 - settings.size);
    assert(onsetPieces.length === onsetCuts.length && onsetPieces.every(function (piece, index) {
      return piece.startRatio === onsetCuts[index].start / 4 && piece.lengthRatio === (onsetCuts[index].end - onsetCuts[index].start) / 4 && piece.sourceChop === onsetCuts.length;
    }), 'An onset lane offers its onset pieces');
    const generated = generator.generate([onsetLane], settings, 'EDIT');
    assert(generated.every(function (event) {
      const piece = onsetPieces[edit.pieceOf(onsetPieces, event)];
      return piece.startRatio === event.startRatio && piece.lengthRatio === event.lengthRatio;
    }), 'Every generated cut is found among its lane\'s pieces');
    const noteLane = { id: 'fm', events: [], segmentsDuration: 2, segmentsSteps: 16, segments: [
      { start: 0, end: 0.25, step: 0, steps: 2 }, { start: 0.25, end: 0.5, step: 2, steps: 2 }, { start: 1, end: 1.5, step: 8, steps: 4 },
    ] };
    const notes = generator.pieces(noteLane, settings);
    assert(notes.length === 3 && notes.every(function (piece, index) {
      return piece.sliceIndex === index && piece.segmentCount === 1 && piece.startRatio === noteLane.segments[index].start / 2 &&
        piece.lengthRatio === (noteLane.segments[index].end - noteLane.segments[index].start) / 2 && piece.sourceChop === 3 && !('durationSteps' in piece);
    }), 'A generated phrase offers its single notes');

    // Swapping pieces.
    const run = cut(4, 4, 0, { segmentCount: 2, startRatio: 0, lengthRatio: 0.25, sourceChop: 3, accent: true, semitones: 12 });
    const swapped = edit.swap([run], 4, notes[2])[0];
    assert(swapped.sliceIndex === 2 && swapped.segmentCount === 1 && swapped.startRatio === 0.5 && swapped.lengthRatio === 0.25 &&
      swapped.step === 4 && swapped.durationSteps === 4 && swapped.semitones === 12 && swapped.accent === true, 'A swap changes only the piece');
    const evenSwap = edit.swap([run], 4, even[5])[0];
    assert(!('segmentCount' in evenSwap) && !('lengthRatio' in evenSwap) && evenSwap.startRatio === 5 / even.length, 'A swap drops cut fields the new piece does not have');
    assert(edit.pieceOf(even, cut(0, 1, 5)) === 5 && edit.pieceOf(even, { sliceIndex: 3, sourceChop: 4 }) === even.length * 3 / 4 && edit.pieceOf([], run) === -1, 'A cut plays the piece starting where it starts');
    assert(edit.pieceOf(even, { startRatio: 0.49 }) === even.length / 2, 'A cut from another SIZE plays the nearest piece');

    // Pointing into a source.
    assert(edit.pieceAt(even, 0) === 0 && edit.pieceAt(even, 0.999) === even.length - 1 && edit.pieceAt(even, 0.5) === even.length / 2, 'A point in the source finds its piece');
    assert(edit.pieceAt(notes, 0.3) === 1 && edit.pieceAt(notes, 0.45) === 2 && edit.pieceAt(notes, 0.95) === 2 && edit.pieceAt([], 0.5) === -1, 'Between pieces, the nearest one is found');
    const spans = even.map(function (piece, index) { return edit.span(even, index); });
    assert(spans[0].start === 0 && spans[spans.length - 1].end === 1 && spans.every(function (span, index) { return index === 0 || span.start === spans[index - 1].end; }), 'Equal slices span the whole source');
    assert(edit.span(notes, 2).start === 0.5 && edit.span(notes, 2).end === 0.75 && edit.span(notes, 3) === null, 'A note spans its own length');

    assert(JSON.stringify(events) === before, 'Edits never change the list they are given');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
