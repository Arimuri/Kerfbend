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

    const sixteenth = 60 / 120 / 4;
    const noteSteps = [[0, 2], [2, 1], [3, 3], [6, 2], [8, 3], [11, 1], [12, 2], [14, 2], [16, 4], [20, 3], [23, 1], [24, 2], [26, 2], [28, 4]];
    const noteLane = {
      id: 'fm-notes', segmentsDuration: 32 * sixteenth,
      segments: noteSteps.map(function (note, index) {
        return { start: note[0] * sixteenth, end: (note[0] + note[1]) * sixteenth - (index % 3 ? 0 : sixteenth / 2), step: note[0], midi: 48 + index, degree: index % 7 };
      })
    };
    function noteRuns(events) {
      return events.every(function (event) {
        const first = noteLane.segments[event.sliceIndex];
        const last = noteLane.segments[event.sliceIndex + event.segmentCount - 1];
        return first && last && event.startRatio === first.start / noteLane.segmentsDuration &&
          event.lengthRatio === (last.end - first.start) / noteLane.segmentsDuration &&
          event.sourceChop === noteLane.segments.length && Number.isInteger(event.step) && event.durationSteps >= 1;
      });
    }
    [[0, 1, 1], [50, 1, 2], [100, 2, 3]].forEach(function (values) {
      const size = values[0];
      [2, 4, 8].forEach(function (bars) {
        const events = generator.generate([noteLane], Object.assign({}, settings, { size, bars, density: 100, breaks: 0 }), 'NOTE-RUNS');
        assert(events.length >= bars && noteRuns(events), 'Note cuts start and end on note boundaries at size ' + size + ' / ' + bars + ' bars');
        assert(events.every(function (event) {
          return event.segmentCount <= values[2] && (event.segmentCount >= values[1] || event.sliceIndex + event.segmentCount === noteLane.segments.length);
        }), 'Size ' + size + ' keeps runs of ' + values[1] + '–' + values[2] + ' notes');
        assert(events.every(function (event, index) {
          return event.step + event.durationSteps <= (index + 1 < events.length ? events[index + 1].step : bars * 16);
        }), 'Note runs never overlap within the lane at size ' + size + ' / ' + bars + ' bars');
        const whole = events.filter(function (event) {
          return event.durationSteps === Math.max(1, Math.round(event.lengthRatio * noteLane.segmentsDuration / sixteenth));
        });
        assert(whole.length / events.length > 0.7, 'Most runs play every note to its end at size ' + size + ' / ' + bars + ' bars');
      });
    });
    const noteSettings = Object.assign({}, settings, { bars: 8, density: 100, breaks: 0 });
    const notePair = generator.generate([noteLane, lanes[0]], noteSettings, 'NOTE-MACROS');
    assert(JSON.stringify(notePair) === JSON.stringify(generator.generate([noteLane, lanes[0]], noteSettings, 'NOTE-MACROS')), 'Note cuts are deterministic');
    const answeringNotes = generator.generate([Object.assign({ role: 'fill' }, noteLane), lanes[0]], noteSettings, 'NOTE-MACROS');
    assert(JSON.stringify(answeringNotes.filter(function (event) { return event.laneId === 'voice'; })) === JSON.stringify(generator.generate([lanes[0]], noteSettings, 'NOTE-MACROS')), 'An answering note-cut lane does not change the lead');
    [0, 100].forEach(function (octave) {
      assert(omit(generator.generate([noteLane], Object.assign({}, noteSettings, { octave }), 'NOTE-MACROS'), 'semitones') === omit(notePair.filter(function (event) { return event.laneId === 'fm-notes'; }), 'semitones'), 'Octave ' + octave + ' changes only pitch in note cuts');
    });
    [0, 100].forEach(function (motion) {
      assert(omit(generator.generate([noteLane], Object.assign({}, noteSettings, { motion }), 'NOTE-MACROS'), 'reverse') === omit(notePair.filter(function (event) { return event.laneId === 'fm-notes'; }), 'reverse'), 'Motion ' + motion + ' changes only reverse in note cuts');
    });
    [{ segments: [], segmentsDuration: 4 }, { segments: noteLane.segments, segmentsDuration: 0 }, { segments: [{ start: 1, end: 0.5 }], segmentsDuration: 4 }].forEach(function (invalid, index) {
      const fallback = generator.generate([Object.assign({ id: 'fallback' }, invalid)], settings, 'FALLBACK');
      assert(JSON.stringify(fallback) === JSON.stringify(generator.generate([{ id: 'fallback' }], settings, 'FALLBACK')), 'Unusable note data falls back to equal slices: ' + index);
    });
    const lockedNotes = generator.generate([Object.assign({}, noteLane, { locked: true, events: notePair.filter(function (event) { return event.laneId === 'fm-notes'; }) })], Object.assign({}, noteSettings, { size: 0 }), 'OTHER');
    assert(JSON.stringify(lockedNotes) === JSON.stringify(notePair.filter(function (event) { return event.laneId === 'fm-notes'; })), 'Locked note cuts keep their runs through size and seed changes');
    function barOf(events, index) {
      return events.filter(function (event) { return event.step >= index * 16 && event.step < index * 16 + 16; }).map(function (event) {
        return Object.assign({}, event, { step: event.step - index * 16 });
      });
    }
    function shape(events, withDuration) {
      return JSON.stringify(events.map(function (event) {
        const copy = Object.assign({}, event);
        if (!withDuration) delete copy.durationSteps;
        return copy;
      }));
    }
    function before(events, step) { return events.filter(function (event) { return event.step < step; }); }
    function after(events, step) { return events.filter(function (event) { return event.step >= step; }); }
    const formSettings = Object.assign({}, settings, { breaks: 0, density: 70 });
    let newEndings = 0;
    let contrasts = 0;
    let forms = 0;
    for (let index = 0; index < 30; index += 1) {
      [{ id: 'form-voice' }, noteLane].forEach(function (lane) {
        const seed = 'FORM-' + index;
        const four = generator.generate([lane], formSettings, seed);
        const a = barOf(four, 0);
        const answer = barOf(four, 1);
        const b = barOf(four, 2);
        assert(shape(barOf(four, 3), true) === shape(a, true), 'Bar 4 returns exactly to bar 1 (A): ' + lane.id + ' / ' + seed);
        assert(shape(before(answer, 12)) === shape(before(a, 12)) && after(answer, 12).length > 0, 'Bar 2 keeps the first three beats of A and adds its own ending: ' + lane.id + ' / ' + seed);
        if (shape(after(answer, 12)) !== shape(after(a, 12))) newEndings += 1;
        if (shape(b) !== shape(a)) contrasts += 1;
        forms += 1;
        const two = generator.generate([lane], Object.assign({}, formSettings, { bars: 2 }), seed);
        assert(shape(barOf(two, 0), true) === shape(a, true) && shape(barOf(two, 1)) === shape(answer), 'Two-bar loops play A and its answer: ' + lane.id + ' / ' + seed);
        const eight = generator.generate([lane], Object.assign({}, formSettings, { bars: 8 }), seed);
        assert([0, 1, 2, 3, 4, 5].every(function (bar) { return shape(barOf(eight, bar)) === shape(barOf(four, bar % 4)); }) &&
          shape(before(barOf(eight, 6), 12)) === shape(before(b, 12)) && shape(barOf(eight, 7)) === shape(answer),
        'Eight-bar loops repeat the form, vary the second B and close with the answer: ' + lane.id + ' / ' + seed);
        assert([0, 1, 2, 3].every(function (bar) { return barOf(four, bar).length <= 8; }), 'Each bar of the form keeps at most eight onsets: ' + lane.id + ' / ' + seed);
      });
    }
    assert(newEndings === forms, 'The answer bar always changes the ending of A');
    assert(contrasts / forms > 0.95, 'The B bar contrasts with A: ' + contrasts + '/' + forms);
    const band = [
      { id: 'vox', kind: 'voice', name: 'GLASS VOICE' }, { id: 'pad', kind: 'keys', name: 'SOFT KEYS' },
      { id: 'low', kind: 'bass', name: 'ROUND BASS' }, { id: 'kit', kind: 'drums', category: 'drums', name: 'DUST DRUMS' }
    ];
    const auto = generator.roles(band);
    assert(auto.vox === 'lead' && auto.pad === 'fill' && auto.low === 'bass' && auto.kit === 'drums', 'Automatic roles find the lead, bass, answering part and drums');
    const named = generator.roles([
      { id: 'a', name: 'Pad Swell' }, { id: 'b', filename: '808_sub_C1.wav' }, { id: 'c', filename: 'VocalChop_F#min.wav' },
      { id: 'd', kind: 'fm', synthSettings: { octave: 4 } }, { id: 'e', kind: 'fm', synthSettings: { octave: 2 } }
    ]);
    assert(named.a === 'fill' && named.b === 'bass' && named.c === 'lead' && named.d === 'fill' && named.e === 'fill', 'Names pick one bass and one lead; other parts answer: ' + JSON.stringify(named));
    assert(generator.roles([{ id: 'x' }, { id: 'y' }]).x === 'lead' && generator.roles([{ id: 'x' }, { id: 'y' }]).y === 'fill', 'Without hints the first part leads');
    const manual = generator.roles([Object.assign({}, band[0], { role: 'fill' }), Object.assign({}, band[1], { role: 'lead' }), band[2], Object.assign({}, band[3], { role: 'bass' })]);
    assert(manual.vox === 'fill' && manual.pad === 'lead' && manual.low === 'fill' && manual.kit === 'bass', 'Manual roles override names, categories and the automatic picks: ' + JSON.stringify(manual));
    assert(JSON.stringify(generator.roles(band.map(function (lane) { return Object.assign({ muted: true, solo: true, volume: 0, locked: true }, lane); }))) === JSON.stringify(auto), 'Mixer state and locks never change roles');
    assert(generator.roles([Object.assign({ role: 'drums' }, band[0])]).vox === 'lead', 'Unknown manual roles fall back to automatic roles');

    const bandSettings = Object.assign({}, settings, { breaks: 0, density: 80, octave: 100 });
    let inside = 0;
    let insideSteps = 0;
    let outside = 0;
    let outsideSteps = 0;
    for (let index = 0; index < 24; index += 1) {
      const seed = 'BAND-' + index;
      const events = generator.generate(band, bandSettings, seed);
      const lead = events.filter(function (event) { return event.laneId === 'vox'; });
      const fill = events.filter(function (event) { return event.laneId === 'pad'; });
      const bass = events.filter(function (event) { return event.laneId === 'low'; });
      const sounding = new Uint8Array(64);
      lead.forEach(function (event) { for (let step = event.step; step < event.step + event.durationSteps; step += 1) sounding[step] = 1; });
      sounding.forEach(function (on) { if (on) insideSteps += 1; else outsideSteps += 1; });
      fill.forEach(function (event) { if (sounding[event.step]) inside += 1; else outside += 1; });
      assert(JSON.stringify(lead) === JSON.stringify(generator.generate([band[0]], bandSettings, seed)) &&
        JSON.stringify(lead) === JSON.stringify(generator.generate([band[0], band[2]], bandSettings, seed).filter(function (event) { return event.laneId === 'vox'; })),
      'Adding or removing other parts never changes the lead: ' + seed);
      assert(bass.length > 0 && bass.every(function (event) { return event.semitones <= 0; }), 'The bass never jumps an octave up: ' + seed);
      const bassCells = [[0, 3, 6, 8, 11, 14], [0, 6, 8, 13], [0, 2, 8, 10, 12], [0, 7, 8, 12, 15]];
      assert([0, 16, 32, 48].every(function (downbeat) { return bass.some(function (event) { return event.step === downbeat; }); }) &&
        bass.every(function (event) { return bassCells.some(function (cell) { return cell.includes(event.step % 16); }); }), 'The bass lands on every downbeat and plays bass cells: ' + seed);
      assert(shape(barOf(fill, 3)) === shape(barOf(fill, 0)), 'An answering part repeats with the returning A: ' + seed);
      const lockedLead = Object.assign({}, band[0], { locked: true, events: lead });
      assert(JSON.stringify(generator.generate([lockedLead, band[1]], bandSettings, 'ANOTHER-SEED').filter(function (event) { return event.laneId === 'pad'; })) !==
        JSON.stringify(generator.generate([band[1]], bandSettings, 'ANOTHER-SEED')) || fill.length === 0, 'An answering part follows a locked lead: ' + seed);
    }
    assert(inside / insideSteps < 0.5 * (outside / outsideSteps), 'Answering parts play mostly in the lead\'s gaps: ' + (inside / insideSteps).toFixed(3) + ' vs ' + (outside / outsideSteps).toFixed(3));
    assert(generator.roleNames.join(',') === 'lead,bass,fill', 'Role names are lead, bass and fill');
    function cutOf(event) {
      return JSON.stringify([event.sliceIndex, event.startRatio, event.sourceChop, event.segmentCount, event.lengthRatio]);
    }
    let fillsSeen = 0;
    let restsSeen = 0;
    let landingsSeen = 0;
    for (let index = 0; index < 16; index += 1) {
      [[1, 15], [2, 15], [4, 15], [8, 15], [4, 60], [8, 100], [4, 0]].forEach(function (values) {
        const bars = values[0];
        const breaks = values[1];
        const total = bars * 16;
        const seed = 'ENDS-' + index;
        const endSettings = Object.assign({}, settings, { bars, breaks, density: 80 });
        const plan = generator.phraseEnds(endSettings, seed);
        const events = generator.generate(band, endSettings, seed);
        const own = function (id) { return events.filter(function (event) { return event.laneId === id; }); };
        const label = bars + ' bars / breaks ' + breaks + ' / ' + seed;
        const raw = total * 0.5 * breaks / 100;
        const restLength = raw < 2 ? 0 : Math.min(total / 2, Math.max(4, Math.round(raw / 4) * 4));
        const span = bars >= 4 ? 32 : 16;
        if (breaks === 0) {
          assert(plan.rest === null && plan.fills.length === 0 && plan.landings.length === 0, 'BREAKS 0 keeps a continuous loop without rests or fills: ' + label);
          return;
        }
        assert(restLength === 0 ? plan.rest === null : plan.rest.end - plan.rest.start === restLength && plan.rest.start % 4 === 0 && plan.rest.end % span === 0,
          'BREAKS sets a beat-aligned rest that ends on a phrase boundary: ' + label);
        if (plan.rest) {
          restsSeen += 1;
          assert(events.every(function (event) {
            return event.step + event.durationSteps <= plan.rest.start || event.step >= plan.rest.end;
          }), 'Every part is silent through the shared rest: ' + label);
        }
        assert(plan.fills.every(function (end) { return (end % 64 === 0 || end === total) && (!plan.rest || end !== plan.rest.end); }), 'Fills close four-bar phrases or the loop, never where the rest ends: ' + label);
        plan.fills.forEach(function (end) {
          if (plan.rest && end > plan.rest.start && end - 4 < plan.rest.end) return;
          fillsSeen += 1;
          const roll = own('kit').filter(function (event) { return event.step >= end - 4 && event.step < end; });
          assert(roll.length === 4 && roll.every(function (event, position) {
            return event.step === end - 4 + position && event.durationSteps === 1 && cutOf(event) === cutOf(roll[0]) && (!position || event.velocity > roll[position - 1].velocity);
          }), 'Drums roll sixteenths with rising velocity through the fill beat: ' + label);
          const stutter = own('vox').filter(function (event) { return event.step >= end - 4 && event.step < end; });
          assert(stutter.length === 3 && stutter.every(function (event, position) {
            return event.step === end - 4 + position && cutOf(event) === cutOf(stutter[0]) && !event.reverse;
          }), 'The lead stutters three sixteenths and leaves the last one open: ' + label);
          ['low', 'pad'].forEach(function (id) {
            assert(own(id).every(function (event) { return event.step + event.durationSteps <= end - 4 || event.step >= end; }), 'Bass and answering parts drop out for the fill: ' + id + ' / ' + label);
          });
        });
        plan.landings.forEach(function (step) {
          if (plan.rest && step >= plan.rest.start && step < plan.rest.end) return;
          landingsSeen += 1;
          ['vox', 'low', 'kit'].forEach(function (id) {
            const lane = own(id);
            const landing = lane.find(function (event) { return event.step === step; });
            const home = lane.find(function (event) { return event.step === 0; }) || landing;
            assert(landing && cutOf(landing) === cutOf(home) && landing.semitones === 0 && !landing.reverse && landing.velocity >= 0.9,
              'The next downbeat lands on the home cut without octave or reverse: ' + id + ' / ' + label);
          });
        });
      });
    }
    assert(fillsSeen > 20 && restsSeen > 20 && landingsSeen > 20, 'Fills, rests and landings all occur: ' + [fillsSeen, restsSeen, landingsSeen].join('/'));
    assert(JSON.stringify(generator.phraseEnds(Object.assign({}, settings, { breaks: 30 }), 'SAME')) === JSON.stringify(generator.phraseEnds(Object.assign({}, settings, { breaks: 30, density: 10, size: 90 }), 'SAME')), 'Phrase ends depend only on bars, BREAKS and SEED');
    const synth = root.BlueLoopFMSynth;
    if (synth) {
      const fmLane = function (id, octave, progression, seed) {
        const phrase = synth.phrase({ seed, bars: 4, octave, density: 70, progression });
        return Object.assign({ id, kind: 'fm', name: 'SINE', synthSettings: phrase.settings }, synth.noteSegments(phrase));
      };
      const position = function (degree, root) { return (((degree - root) % 7) + 7) % 7; };
      let followed = 0;
      ['I-IV', 'vi-IV-V-I', 'IV-V-iii-vi'].forEach(function (progression) {
        for (let index = 0; index < 10; index += 1) {
          const lead = fmLane('fm-lead', 4, progression, 'LEAD-' + index);
          const bassLane = fmLane('fm-bass', 2, progression, 'BASS-' + index);
          [4, 8].forEach(function (bars) {
            [0, 15].forEach(function (breaks) {
              const loop = Object.assign({}, settings, { bars, breaks, density: 80 });
              const seed = 'CHORDS-' + index;
              const events = generator.generate([lead, bassLane], loop, seed);
              const parts = generator.roles([lead, bassLane]);
              const label = progression + ' / ' + bars + ' bars / breaks ' + breaks + ' / ' + seed;
              assert(parts['fm-lead'] === 'lead' && parts['fm-bass'] === 'bass', 'Low FM phrases play bass and higher ones lead: ' + label);
              events.forEach(function (event) {
                const lane = event.laneId === 'fm-lead' ? lead : bassLane;
                const note = lane.segments[event.sliceIndex];
                const chord = lead.chords[Math.floor(event.step / 16) % lead.chords.length];
                const rooted = (event.laneId === 'fm-bass' && event.step % 16 === 0) || generator.phraseEnds(loop, seed).landings.includes(event.step);
                assert(rooted ? [0, 2, 4].includes(position(note.degree, chord)) || note.chord === chord : note.chord === chord,
                  'A cut plays a note written over (or, for roots, belonging to) the chord of the bar it lands in: ' + label + ' @' + event.step);
                followed += 1;
              });
              const landings = generator.phraseEnds(loop, seed).landings;
              const rootOf = function (lane, step) {
                const chord = lead.chords[Math.floor(step / 16) % lead.chords.length];
                return { chord, available: lane.segments.some(function (note) { return position(note.degree, chord) === 0; }) };
              };
              events.filter(function (event) { return event.laneId === 'fm-bass' && event.step % 16 === 0; }).forEach(function (event) {
                const target = rootOf(bassLane, event.step);
                const note = bassLane.segments[event.sliceIndex];
                assert(!target.available || position(note.degree, target.chord) === 0, 'The bass plays the chord root on every downbeat: ' + label + ' @' + event.step);
              });
              landings.forEach(function (step) {
                const landing = events.find(function (event) { return event.laneId === 'fm-lead' && event.step === step; });
                const target = rootOf(lead, step);
                if (landing && target.available) assert(position(lead.segments[landing.sliceIndex].degree, target.chord) === 0, 'The lead lands on the chord root: ' + label);
              });
              assert(JSON.stringify(events) === JSON.stringify(generator.generate([lead, bassLane], loop, seed)), 'Chord following is deterministic: ' + label);
            });
          });
        }
      });
      assert(followed > 1000, 'Enough cuts were checked against the chords: ' + followed);
      const lead = fmLane('fm-lead', 4, 'I-IV', 'LEAD-X');
      const plain = Object.assign({}, lead);
      delete plain.chords;
      const withChords = generator.generate([lead], Object.assign({}, settings, { breaks: 0 }), 'CHORD-OFF');
      const without = generator.generate([plain], Object.assign({}, settings, { breaks: 0 }), 'CHORD-OFF');
      assert(withChords.length === without.length && withChords.every(function (event, index) {
        return event.step === without[index].step && event.velocity === without[index].velocity && event.semitones === without[index].semitones;
      }), 'Following chords changes which notes play, never the rhythm, octave or dynamics');
    }
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
