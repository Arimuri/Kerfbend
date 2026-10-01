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
    const regenerated = generator.generate(locked, Object.assign({}, settings, { size: 0, density: 100, motion: 100, octave: 100, breaks: 100 }), 'A-NEW-SEED');
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
    assert(withoutMotion.every(function (event) { return !event.reverse; }), 'Motion zero removes reverse effects');

    function omit(events, field) {
      return JSON.stringify(events.map(function (event) {
        const copy = Object.assign({}, event);
        delete copy[field];
        return copy;
      }));
    }
    const independenceSettings = Object.assign({}, settings, { bars: 16, density: 100, breaks: 0 });
    const independenceEvents = generator.generate(lanes, independenceSettings, 'INDEPENDENT-MACROS');
    [0, 12, 50, 100].forEach(function (octave) {
      const events = generator.generate(lanes, Object.assign({}, independenceSettings, { octave }), 'INDEPENDENT-MACROS');
      assert(omit(events, 'semitones') === omit(independenceEvents, 'semitones'), 'Octave ' + octave + ' changes only pitch, including repeated motif variations');
      assert(JSON.stringify(events) === JSON.stringify(generator.generate(lanes, Object.assign({}, independenceSettings, { octave }), 'INDEPENDENT-MACROS')), 'Octave ' + octave + ' is deterministic');
      if (octave === 0) assert(events.every(function (event) { return event.semitones === 0; }), 'Octave zero removes every octave shift');
      if (octave === 100) {
        assert(events.every(function (event) { return Math.abs(event.semitones) === 12; }), 'Octave 100 shifts every event');
        assert(events.some(function (event) { return event.semitones === -12; }) && events.some(function (event) { return event.semitones === 12; }), 'Octave 100 includes both up and down shifts');
      }
    });
    [0, 25, 100].forEach(function (motion) {
      const events = generator.generate(lanes, Object.assign({}, independenceSettings, { motion }), 'INDEPENDENT-MACROS');
      assert(omit(events, 'reverse') === omit(independenceEvents, 'reverse'), 'Motion ' + motion + ' changes only reverse, preserving octave shifts');
    });
    const noOctaveSetting = Object.assign({}, independenceSettings);
    delete noOctaveSetting.octave;
    assert(generator.defaults.octave === 12, 'Default octave probability is 12 percent');
    assert(JSON.stringify(generator.generate(lanes, noOctaveSetting, 'INDEPENDENT-MACROS')) === JSON.stringify(independenceEvents), 'Missing octave setting uses the default probability');
    [[-50, 0], [150, 100], [NaN, 12], ['invalid', 12]].forEach(function (values) {
      const actual = generator.generate(lanes, Object.assign({}, independenceSettings, { octave: values[0] }), 'OCTAVE-BOUNDS');
      const expected = generator.generate(lanes, Object.assign({}, independenceSettings, { octave: values[1] }), 'OCTAVE-BOUNDS');
      assert(JSON.stringify(actual) === JSON.stringify(expected), 'Octave normalizes ' + String(values[0]) + ' to ' + values[1]);
    });

    const probabilityLanes = Array.from({ length: 160 }, function (_, index) { return { id: 'probability-' + index }; });
    const probabilityEvents = generator.generate(probabilityLanes, Object.assign({}, settings, { bars: 2, density: 100, breaks: 0, octave: 40 }), 'OCTAVE-PROBABILITY');
    const shifted = probabilityEvents.filter(function (event) { return event.semitones !== 0; });
    const downward = shifted.filter(function (event) { return event.semitones === -12; });
    assert(shifted.length / probabilityEvents.length > 0.35 && shifted.length / probabilityEvents.length < 0.45, 'Octave 40 gives approximately 40 percent shifted events');
    assert(downward.length / shifted.length > 0.20 && downward.length / shifted.length < 0.30, 'Octave shifts retain the one-down-to-three-up balance');
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
