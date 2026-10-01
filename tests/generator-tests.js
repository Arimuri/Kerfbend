(function (root) {
  'use strict';

  // Load js/generator.js first, then call runGeneratorTests() from a browser console.
  root.runGeneratorTests = function () {
    const generator = root.BlueLoopGenerator;
    if (!generator) throw new Error('Load js/generator.js before generator-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Generator test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    const settings = Object.assign({}, generator.defaults);
    const lanes = [{ id: 'voice', events: [] }, { id: 'keys', events: [] }];
    const first = generator.generate(lanes, settings, 'BLUE-123');
    const repeat = generator.generate(lanes, settings, 'BLUE-123');
    assert(first.length > 0, 'Generation produces playable events');
    assert(JSON.stringify(first) === JSON.stringify(repeat), 'Same seed and settings reproduce the complete phrase');
    assert(JSON.stringify(first) !== JSON.stringify(generator.generate(lanes, settings, 'BLUE-124')), 'Changing the seed changes the phrase');
    assert(JSON.stringify(lanes) === JSON.stringify([{ id: 'voice', events: [] }, { id: 'keys', events: [] }]), 'Generation does not mutate input lanes');

    const onlyVoice = generator.generate([lanes[0]], settings, 'BLUE-123');
    assert(JSON.stringify(onlyVoice) === JSON.stringify(first.filter(function (event) { return event.laneId === 'voice'; })), 'Removing another lane does not change a lane’s phrase');
    const mixedState = [{ id: 'voice', events: [], muted: true, solo: true, volume: 0.2 }];
    assert(JSON.stringify(onlyVoice) === JSON.stringify(generator.generate(mixedState, settings, 'BLUE-123')), 'Mixer settings do not change the composition');

    [1, 2, 4, 8].forEach(function (bars) {
      [0, 50, 100].forEach(function (size) {
        const edgeSettings = Object.assign({}, settings, { bars, size, density: 100, motion: 100, breaks: 0 });
        const chop = generator.getChop(edgeSettings);
        const events = generator.generate(lanes, edgeSettings, 'BOUNDARIES');
        assert(events.every(function (event) {
          return Number.isInteger(event.step) && event.step >= 0 && event.step < bars * 16 &&
            event.durationSteps >= 1 && event.durationSteps <= 4 && event.step + event.durationSteps <= bars * 16 &&
            Number.isInteger(event.sliceIndex) && event.sliceIndex >= 0 && event.sliceIndex < chop &&
            event.startRatio === event.sliceIndex / chop && event.sourceChop === chop && [-12, 0, 12].includes(event.semitones) &&
            typeof event.reverse === 'boolean' && event.velocity > 0 && event.velocity <= 1;
        }), 'Events fit source and timeline constraints: ' + bars + ' bars / ' + chop + ' slices');
        assert(events.length <= bars * 8 * lanes.length, 'Rhythm keeps a maximum of eight onsets per bar per lane');
      });
    });

    const voiceSnapshot = onlyVoice.map(function (event) { return Object.assign({}, event); });
    const locked = [{ id: 'voice', locked: true, events: voiceSnapshot }];
    const previousSnapshot = JSON.stringify(voiceSnapshot);
    const regenerated = generator.generate(locked, Object.assign({}, settings, { size: 0, density: 100, motion: 100, breaks: 100 }), 'A-NEW-SEED');
    assert(JSON.stringify(regenerated) === previousSnapshot, 'A locked lane retains exact cuts through seed and macro changes');
    const shortened = generator.generate(locked, Object.assign({}, settings, { bars: 1 }), 'A-NEW-SEED');
    assert(shortened.every(function (event) { return event.step < 16 && event.step + event.durationSteps <= 16; }), 'Shortening the loop trims incompatible locked events');
    assert(JSON.stringify(voiceSnapshot) === previousSnapshot, 'Lock trimming does not mutate the stored phrase');
    assert(generator.generate([{ id: 'silent', locked: true, events: [] }], settings, 'BLUE').length === 0, 'An intentionally empty locked lane stays empty');

    const motif = generator.generate([{ id: 'motif' }], Object.assign({}, settings, { breaks: 0 }), 'REPEAT');
    const opening = motif.filter(function (event) { return event.step < 16; });
    const closing = motif.filter(function (event) { return event.step >= 32 && event.step < 48; }).map(function (event) {
      return Object.assign({}, event, { step: event.step - 32 });
    });
    assert(JSON.stringify(opening) === JSON.stringify(closing), 'The opening bar of a two-bar motif repeats unchanged');
    assert(generator.generate(lanes, Object.assign({}, settings, { density: 0 }), 'SILENCE').length === 0, 'Density zero creates silence');
    assert([0, 25, 50, 75, 100].map(function (size) { return generator.getChop({ size }); }).join(',') === '32,24,16,8,4', 'Size selects the expected source subdivisions');
    const withoutMotion = generator.generate(lanes, Object.assign({}, settings, { motion: 0 }), 'STILL');
    assert(withoutMotion.every(function (event) { return event.semitones === 0 && !event.reverse; }), 'Motion zero removes octave and reverse effects');
    const broken = generator.generate([{ id: 'break-test' }, { id: 'break-test-2' }], Object.assign({}, settings, { density: 100, breaks: 100 }), 'SILENT-SPAN');
    const occupied = new Set();
    broken.forEach(function (event) {
      for (let step = event.step; step < event.step + event.durationSteps; step += 1) occupied.add(step);
    });
    let longestSilence = 0;
    let currentSilence = 0;
    for (let step = 0; step < 64; step += 1) {
      currentSilence = occupied.has(step) ? 0 : currentSilence + 1;
      longestSilence = Math.max(longestSilence, currentSilence);
    }
    assert(longestSilence >= 32, 'Breaks at maximum creates half a phrase of contiguous silence across lanes');
    assert(generator.duration({ bpm: 120, bars: 4 }) === 8, 'Duration is exact in musical bars');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
