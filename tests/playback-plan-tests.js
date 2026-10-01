(function (root) {
  'use strict';

  root.runPlaybackPlanTests = function () {
    const playback = root.BlueLoopPlayback;
    if (!playback) throw new Error('Load js/playback-plan.js before playback-plan-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Playback plan test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    function onset(event, swing) {
      return event.step + (Math.floor(event.step) % 2 ? swing / 100 : 0);
    }
    function concurrency(events, swing) {
      const boundaries = events.flatMap(function (event) {
        const start = onset(event, swing);
        return [{ time: start, delta: 1 }, { time: start + event.durationSteps, delta: -1 }];
      }).sort(function (a, b) { return a.time - b.time || a.delta - b.delta; });
      let active = 0;
      let maximum = 0;
      boundaries.forEach(function (boundary) {
        active += boundary.delta;
        maximum = Math.max(maximum, active);
      });
      return maximum;
    }
    function event(laneId, step, durationSteps, extra) {
      return Object.assign({ laneId, step, durationSteps, sliceIndex: step, startRatio: 0, sourceChop: 16, semitones: 0, reverse: false, velocity: 0.8 }, extra);
    }
    const lanes = Array.from({ length: 8 }, function (_, index) {
      return { id: 'lane-' + index, volume: 0.7, events: [], locked: index % 2 === 0 };
    });
    // Deliberately grouped by lane rather than chronology, as generator output is.
    lanes.forEach(function (lane) {
      lane.events = [event(lane.id, 0, 2), event(lane.id, 1, 3), event(lane.id, 2, 2), event(lane.id, 5, 4), event(lane.id, 8, 1), event(lane.id, 15, 2)];
    });
    const raw = lanes.flatMap(function (lane) { return lane.events; });
    const initial = JSON.stringify(lanes);
    [0, 25, 50].forEach(function (swing) {
      [1, 2, 8].forEach(function (maxVoices) {
        const settings = { bars: 1, swing, maxVoices };
        const planned = playback.plan(lanes, settings, raw);
        assert(planned.length > 0 && concurrency(planned, swing) <= maxVoices,
          'All overlaps respect ' + maxVoices + ' voices with swing ' + swing);
        assert(planned.every(function (item) { return onset(item, swing) + item.durationSteps <= 16; }),
          'No dry voice wraps into the next loop with cap ' + maxVoices + ' and swing ' + swing);
        assert(planned.every(function (item, index) { return index === 0 || onset(planned[index - 1], swing) <= onset(item, swing); }),
          'Lane-grouped input is returned in playback order with cap ' + maxVoices + ' and swing ' + swing);
      });
    });
    assert(JSON.stringify(lanes) === initial, 'All capacity and swing changes leave raw and locked source events untouched');
    const capEight = playback.plan(lanes, { bars: 1, maxVoices: 8, swing: 50 });
    playback.plan(lanes, { bars: 1, maxVoices: 1, swing: 50 });
    const restored = playback.plan(lanes, { bars: 1, maxVoices: 8, swing: 50 });
    assert(JSON.stringify(capEight) === JSON.stringify(restored), 'Raising the limit restores the same phrase after 8 to 1 to 8');
    assert(restored.every(function (copy) { return !raw.includes(copy); }), 'Every planned event is a copy');
    assert(JSON.stringify(playback.plan(lanes, { bars: 1, maxVoices: 2 }, raw)) === JSON.stringify(playback.plan(lanes, { bars: 1, maxVoices: 2 }, raw)), 'Repeated planning is deterministic');

    const retuned = lanes.map(function (lane, index) { return Object.assign({}, lane, { keyShift: index - 5 }); });
    assert(JSON.stringify(playback.plan(retuned, { bars: 1, maxVoices: 2, targetKey: '7:major', bpm: 190 }, raw)) === JSON.stringify(playback.plan(lanes, { bars: 1, maxVoices: 2, targetKey: '0:major', bpm: 80 }, raw)), 'Target key, source pitch corrections, and tempo never change selected slices or beat gates');
    const occupied = [event('lane-0', 1, 1), event('lane-1', 2, 1), event('lane-1', 3, 1)];
    const swung = playback.plan(lanes, { bars: 1, maxVoices: 1, swing: 50 }, occupied);
    assert(swung.length === 2 && swung[0].step === 1 && swung[1].step === 3, 'Swing overlap reserves an existing voice and rejects the conflicting new slice');
    const adjacent = playback.plan(lanes, { bars: 1, maxVoices: 1 }, [event('lane-0', 0, 1), event('lane-1', 1, 1)]);
    assert(adjacent.length === 2, 'A voice becomes free exactly at its end boundary');
    const ending = playback.plan(lanes, { bars: 1, maxVoices: 1, swing: 50 }, [event('lane-0', 15, 2)]);
    assert(ending.length === 1 && ending[0].durationSteps === 0.5, 'The swung final slice is clipped to the exact loop end');

    const sameLane = [event('lane-0', 0, 4), event('lane-0', 1, 2), event('lane-0', 1, 1)];
    assert(playback.plan(lanes, { bars: 1, maxVoices: 1 }, sameLane).length === 1 && playback.plan(lanes, { bars: 1, maxVoices: 2 }, sameLane).length === 2, 'Overlapping slices from the same lane each consume a voice');
    const mixLanes = [
      { id: 'muted', muted: true, volume: 1 },
      { id: 'zero', volume: 0 },
      { id: 'audible', volume: 0.7 },
      { id: 'solo', volume: 0.7, solo: true },
    ];
    const mixEvents = mixLanes.map(function (lane) { return event(lane.id, 0, 2); });
    const solo = playback.plan(mixLanes, { bars: 1, maxVoices: 1 }, mixEvents);
    assert(solo.length === 1 && solo[0].laneId === 'solo', 'Muted, zero-volume, and non-solo lanes cannot consume capacity');
    const unSoloed = mixLanes.slice(0, 3);
    const audible = playback.plan(unSoloed, { bars: 1, maxVoices: 1 }, mixEvents);
    assert(audible.length === 1 && audible[0].laneId === 'audible', 'A zero-volume lane never blocks the audible lane');
    assert(playback.plan(mixLanes.map(function (lane) { return Object.assign({}, lane, { muted: true }); }), { bars: 1, maxVoices: 1 }, mixEvents).length === 0, 'Muting all lanes produces an empty plan');

    const tied = lanes.flatMap(function (lane) {
      return Array.from({ length: 8 }, function (_, step) { return event(lane.id, step, 1); });
    });
    const shared = playback.plan(lanes, { bars: 1, maxVoices: 1 }, tied);
    assert(shared.length === 8 && new Set(shared.map(function (item) { return item.laneId; })).size === 8, 'Repeated tied onsets give all eight lanes a turn at one voice');
    const duplicateTie = playback.plan(lanes, { bars: 1, maxVoices: 2 }, [event('lane-0', 0, 1), event('lane-0', 0, 1), event('lane-1', 0, 1)]);
    assert(duplicateTie.length === 2 && new Set(duplicateTie.map(function (item) { return item.laneId; })).size === 2, 'Ties share available voices across lanes before duplicate slices');
    assert(shared.some(function (item) { return lanes.find(function (lane) { return lane.id === item.laneId; }).locked; }) && concurrency(shared, 0) === 1, 'Locked lanes participate without overriding the voice cap');

    const separated = Array.from({ length: 6 }, function (_, index) {
      const lane = { id: 'group-' + index, category: index % 2 ? 'drums' : 'other', volume: 0.7, locked: index < 2 };
      lane.events = [event(lane.id, 0, 2), event(lane.id, 1, 3), event(lane.id, 2, 2), event(lane.id, 5, 1), event(lane.id, 6, 1), event(lane.id, 15, 2)];
      return lane;
    });
    const separatedBefore = JSON.stringify(separated);
    const otherLanes = separated.filter(function (lane) { return lane.category === 'other'; });
    const drumLanes = separated.filter(function (lane) { return lane.category === 'drums'; });
    const otherIds = new Set(otherLanes.map(function (lane) { return lane.id; }));
    function others(events) { return events.filter(function (item) { return otherIds.has(item.laneId); }); }
    function drums(events) { return events.filter(function (item) { return !otherIds.has(item.laneId); }); }
    [0, 25, 50].forEach(function (swing) {
      [1, 2].forEach(function (maxVoices) {
        [1, 3].forEach(function (maxDrumVoices) {
          const settings = { bars: 1, swing, maxVoices, maxDrumVoices };
          const planned = playback.plan(separated, settings);
          assert(concurrency(others(planned), swing) <= maxVoices && concurrency(drums(planned), swing) <= maxDrumVoices,
            'Each category respects its own cap at ' + maxVoices + '+' + maxDrumVoices + ' voices and swing ' + swing);
          assert(JSON.stringify(others(planned)) === JSON.stringify(playback.plan(otherLanes, settings)) &&
            JSON.stringify(drums(planned)) === JSON.stringify(playback.plan(drumLanes, settings)),
            'Adding or removing the opposite category cannot change slice selection at ' + maxVoices + '+' + maxDrumVoices + ' voices and swing ' + swing);
        });
      });
    });
    const oneEach = playback.plan(separated, { bars: 1, maxVoices: 1, maxDrumVoices: 1 });
    assert(concurrency(oneEach, 0) === 2, 'One drum and one other sample can sound together at separate caps of one');
    const moreDrums = playback.plan(separated, { bars: 1, maxVoices: 1, maxDrumVoices: 3 });
    const moreOthers = playback.plan(separated, { bars: 1, maxVoices: 3, maxDrumVoices: 1 });
    assert(JSON.stringify(others(oneEach)) === JSON.stringify(others(moreDrums)), 'Changing the drum cap never changes selected other samples');
    assert(JSON.stringify(drums(oneEach)) === JSON.stringify(drums(moreOthers)), 'Changing the other cap never changes selected drum samples');
    const allVoices = playback.plan(separated, { bars: 1, maxVoices: 8, maxDrumVoices: 8 });
    playback.plan(separated, { bars: 1, maxVoices: 1, maxDrumVoices: 2 });
    assert(JSON.stringify(allVoices) === JSON.stringify(playback.plan(separated, { bars: 1, maxVoices: 8, maxDrumVoices: 8 })), 'Restoring both caps restores the original selected events');
    assert(JSON.stringify(separated) === separatedBefore, 'Independent caps leave categories, source events, and locked events unchanged');
    assert(JSON.stringify(oneEach) === JSON.stringify(playback.plan(separated, { bars: 1, maxVoices: 1 })), 'The original single setting is applied separately to both categories when the drum setting is absent');
    const onlyDrumCap = playback.plan(separated, { bars: 1, swing: 50, maxDrumVoices: 1 });
    assert(others(onlyDrumCap).length === otherLanes.flatMap(function (lane) { return lane.events; }).length && concurrency(drums(onlyDrumCap), 50) === 1, 'A drum-only limit retains unlimited other samples');
    assert(others(onlyDrumCap).filter(function (item) { return item.step === 15; }).every(function (item) { return item.durationSteps === 2; }) && drums(onlyDrumCap).filter(function (item) { return item.step === 15; }).every(function (item) { return item.durationSteps === 0.5; }), 'Only capped categories trim dry tails at the loop boundary');

    const classifications = [
      { id: 'override', kind: 'drums', category: 'other', volume: 1, locked: true },
      { id: 'melody', kind: 'keys', volume: 1 },
      { id: 'forced-drum', kind: 'keys', category: 'drums', volume: 1 }
    ];
    const categoryEvents = classifications.map(function (lane) { return event(lane.id, 0, 2); });
    const categoryEventsBefore = JSON.stringify(categoryEvents);
    const categorySettings = { bars: 1, maxVoices: 1, maxDrumVoices: 2 };
    assert(playback.plan(classifications, categorySettings, categoryEvents).map(function (item) { return item.laneId; }).join(',') === 'override,forced-drum', 'Explicit categories override synthesis kind for both drums and other samples');
    const moved = classifications.map(function (lane) { return Object.assign({}, lane); });
    moved[0].category = 'drums';
    assert(playback.plan(moved, categorySettings, categoryEvents).length === 3, 'Moving a locked sample to drums immediately uses the drum capacity and releases other capacity');
    delete moved[0].category;
    assert(playback.plan(moved, categorySettings, categoryEvents).length === 3, 'Legacy drum kind supplies the category when no explicit category exists');
    assert(JSON.stringify(categoryEvents) === categoryEventsBefore, 'Category changes never modify generated events');

    const crossSolo = separated.map(function (lane, index) { return Object.assign({}, lane, { solo: index === 0 }); });
    assert(playback.plan(crossSolo, { bars: 1, maxVoices: 1, maxDrumVoices: 1 }).every(function (item) { return item.laneId === crossSolo[0].id; }), 'Solo remains global across drum and other categories');
    crossSolo[1].solo = true;
    const bothSolo = playback.plan(crossSolo, { bars: 1, maxVoices: 1, maxDrumVoices: 1 });
    assert(new Set(bothSolo.map(function (item) { return item.laneId; })).size === 2 && concurrency(bothSolo, 0) === 2, 'A soloed drum and soloed other sample each retain their own capacity');
    crossSolo[1].muted = true;
    assert(playback.plan(crossSolo, { bars: 1, maxVoices: 1, maxDrumVoices: 1 }).every(function (item) { return item.laneId === crossSolo[0].id; }), 'Muting a soloed drum does not mute or consume the other category');

    const legacy = playback.plan(lanes, { bars: 1, swing: 50 }, raw);
    assert(legacy.length === raw.length && concurrency(legacy, 50) > 8, 'An omitted voice limit preserves unlimited legacy overlap');
    assert(legacy.filter(function (item) { return item.step === 15; }).every(function (item) { return item.durationSteps === 2; }), 'An omitted voice limit retains legacy loop tails');
    const sameTime = playback.plan(lanes, { bars: 1, maxVoices: 8 }, [event('lane-2', 0, 1), event('lane-0', 0, 1), event('lane-1', 0, 1)]);
    assert(sameTime.map(function (item) { return item.laneId; }).join(',') === 'lane-2,lane-0,lane-1', 'Equal onset output keeps original stable order');
    assert(playback.plan(lanes, { bars: 1, maxVoices: 1 }, [event('missing', 0, 2), event('lane-0', -1, 1), event('lane-0', 16, 1), event('lane-0', 0, 0)]).length === 0, 'Missing lanes, invalid onsets, and zero-length events do not reserve voices');
    assert(playback.plan([], { maxVoices: 1 }).length === 0, 'An empty project has an empty playback plan');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
