(function (root) {
  'use strict';

  root.runPitchEnvelopeTests = function () {
    const envelope = root.BlueLoopPitchEnvelope;
    if (!envelope) throw new Error('Load js/pitch-envelope.js before pitch-envelope-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Pitch envelope test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    function near(first, second, tolerance) {
      return Math.abs(first - second) <= (tolerance == null ? 1e-10 : tolerance);
    }
    const event = Object.freeze({ laneId: 'voice', step: 3, sliceIndex: 5, startRatio: 5 / 16, sourceChop: 16, velocity: 0.83, semitones: 0, reverse: false });
    const settings = Object.freeze({ pitchEnvDepth: 12, pitchEnvTime: 80 });
    const before = JSON.stringify([event, settings]);
    const curve = envelope.create(1, event, settings, 0.377, 44100);
    assert(curve.enabled && Math.abs(curve.depth) === 12, 'Envelope has the requested signed semitone depth');
    assert(near(curve.startRate, Math.pow(2, curve.depth / 12)), 'Starting pitch includes the signed envelope depth');
    assert(curve.decaySeconds === 0.08, 'Milliseconds convert to the requested return time');
    assert(JSON.stringify(curve.points) === JSON.stringify(envelope.create(1, event, settings, 0.377, 44100).points), 'Repeated rendering produces exactly the same envelope');
    assert(JSON.stringify([event, settings]) === before, 'Creating envelopes never mutates stored events or settings');

    const controls = [
      { semitones: 12 }, { semitones: -12 }, { reverse: true },
      { locked: true, muted: true, solo: true }, { durationSteps: 0.5 }
    ];
    assert(controls.every(function (change) {
      return envelope.create(1, Object.assign({}, event, change), settings).depth === curve.depth;
    }), 'Octave, reverse, locks, mixer state and trimmed note gates do not reroll direction');
    assert([0.125, 0.5, 1, 2, 8].every(function (base) {
      const varied = envelope.create(base, event, { pitchEnvDepth: 24, pitchEnvTime: 500 }, 7.937, 48000);
      return Math.sign(varied.depth) === Math.sign(curve.depth) && near(varied.startRate / base, Math.pow(2, varied.depth / 12));
    }), 'Key changes, envelope controls, tempo-dependent onsets and sample rates preserve direction');

    const directions = Array.from({ length: 1000 }, function (_, index) {
      return envelope.create(1, { laneId: 'lane-' + index % 7, step: index % 64, sliceIndex: index % 16, startRatio: index % 16 / 16, sourceChop: 16, velocity: 0.5 + index / 2000 }, settings).depth;
    });
    const positive = directions.filter(function (depth) { return depth > 0; }).length;
    assert(positive > 400 && positive < 600, 'Independent slices produce roughly equal upward and downward attacks');
    assert(directions.every(function (depth) { return Math.abs(depth) === 12; }), 'Both directions retain the requested magnitude');
    [-1, 1].forEach(function (sign) {
      let shaped;
      for (let step = 0; step < 100; step++) {
        shaped = envelope.create(1, Object.assign({}, event, { step }), settings, 0.1234);
        if (Math.sign(shaped.depth) === sign) break;
      }
      assert(Math.sign(shaped.depth) === sign && near(shaped.startRate, sign > 0 ? 2 : 0.5) && shaped.rateAt(0.2) === 1,
        'Signed attack ' + sign + ' starts at one octave and returns to the original pitch');
      assert(sign > 0 ? shaped.sourceSecondsAt(0.04) > 0.04 : shaped.sourceSecondsAt(0.04) < 0.04,
        'Signed attack ' + sign + ' consumes source audio at the expected faster or slower speed');
      assert([0.0005, 0.02, 0.2].every(function (distance) {
        return near(shaped.sourceSecondsAt(shaped.durationFor(distance)), distance);
      }), 'Signed attack ' + sign + ' respects short and long source boundaries');
    });

    [undefined, {}, { pitchEnvDepth: 0 }, { pitchEnvDepth: -8 }, { pitchEnvDepth: NaN }].forEach(function (params) {
      const off = envelope.create(Math.SQRT2, event, params, 0.003);
      assert(!off.enabled && off.depth === 0 && off.startRate === Math.SQRT2 && off.points.length === 1 && off.sourceSecondsAt(0.25) === 0.25 * Math.SQRT2 && off.durationFor(0.25) === 0.25 / Math.SQRT2 && off.rateAt(10) === Math.SQRT2,
        'Disabled or missing depth preserves constant-rate duration and consumption: ' + JSON.stringify(params));
    });

    [[100, -2, 24, 0.005], [2, 999, 2, 0.5], ['9', '30', 9, 0.03], [6, NaN, 6, 0.08]].forEach(function (values) {
      const bounded = envelope.create(1, event, { pitchEnvDepth: values[0], pitchEnvTime: values[1] });
      assert(Math.abs(bounded.depth) === values[2] && bounded.decaySeconds === values[3], 'Envelope controls normalize depth and time: ' + String(values[0]) + '/' + String(values[1]));
    });
    const invalid = envelope.create(NaN, null, { pitchEnvDepth: 12 }, Infinity, -100);
    assert(invalid.baseRate === 1 && invalid.points.every(function (point) { return Number.isFinite(point.time) && point.rate > 0; }), 'Invalid rate, onset, event and sample-rate values remain safe');
    assert(curve.durationFor(-1) === 0 && curve.sourceSecondsAt(NaN) === 0 && curve.rateAt(-1) === curve.startRate, 'Invalid or negative lookups clamp to the envelope start');

    const quantum = 128 / 44100;
    const starts = [0, 0.377, quantum, quantum * 100, 1.001];
    const sampleRates = [44100, 48000];
    starts.forEach(function (start) {
      sampleRates.forEach(function (sampleRate) {
        const shaped = envelope.create(1.5, event, settings, start, sampleRate);
        const points = shaped.points;
        assert(points[0].time === 0 && points.slice(1).every(function (point, index) {
          const frame = (start + point.time) * sampleRate / 128;
          return point.time > points[index].time && near(frame, Math.round(frame), 1e-9);
        }), 'Rate changes follow global render boundaries at ' + start + ' seconds / ' + sampleRate + ' Hz');
        assert(points[points.length - 1].time >= shaped.decaySeconds && points[points.length - 1].time < shaped.decaySeconds + 128 / sampleRate + 1e-12 && points[points.length - 1].rate === shaped.baseRate,
          'The first quantum after decay reaches and retains the baseline at ' + start + '/' + sampleRate);
        assert(points.every(function (point, index) {
          return index === 0 || (shaped.depth > 0 ? point.rate <= points[index - 1].rate : point.rate >= points[index - 1].rate);
        }), 'Pitch moves monotonically back to baseline at ' + start + '/' + sampleRate);
        const probes = [0, 0.0001, 0.001, 0.017, 0.079, 0.08, 0.1, 2].concat(points.map(function (point) { return point.time; }));
        assert(probes.every(function (time) {
          return near(shaped.durationFor(shaped.sourceSecondsAt(time)), time);
        }), 'Source consumption and duration are inverses before, during and after decay at ' + start + '/' + sampleRate);
        let integrated = 0;
        assert(points.every(function (point, index) {
          if (index) integrated += (point.time - points[index - 1].time) * points[index - 1].rate;
          return near(shaped.sourceSecondsAt(point.time), integrated) && shaped.rateAt(point.time) === point.rate;
        }), 'Cumulative source distance exactly follows scheduled constant-rate segments at ' + start + '/' + sampleRate);
      });
    });

    const active = envelope.create(2, event, { pitchEnvDepth: 24, pitchEnvTime: 500 }, 0.13);
    const reversed = envelope.create(2, Object.assign({}, event, { reverse: true }), { pitchEnvDepth: 24, pitchEnvTime: 500 }, 0.13);
    assert([0.0001, 0.02, 0.25, 0.5, 4].every(function (sourceSeconds) {
      const duration = active.durationFor(sourceSeconds);
      return near(active.sourceSecondsAt(duration), sourceSeconds) && duration === reversed.durationFor(sourceSeconds);
    }), 'Forward and reversed slices stop at the same exact source-content boundary');
    assert(envelope.create(1, event, { pitchEnvDepth: 24, pitchEnvTime: 500 }).points.length <= 174, 'Longest 44.1 kHz envelope uses a bounded number of quantum points');

    const slices = Array.from({ length: 1200 }, function (_, index) {
      return { laneId: 'part-' + index % 5, step: index % 64, sliceIndex: index % 16, startRatio: index % 16 / 16, sourceChop: 16, velocity: 0.5 + index / 2400, durationSteps: 8 };
    });
    const always = slices.map(function (slice) { return envelope.create(1, slice, settings); });
    const selections = {};
    [0, 30, 60, 100].forEach(function (chance) {
      const curves = slices.map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvChance: chance }, settings)); });
      const share = curves.filter(function (curve) { return curve.enabled; }).length / curves.length;
      selections[chance] = curves.map(function (curve) { return curve.enabled; });
      assert(chance === 0 ? share === 0 : chance === 100 ? share === 1 : Math.abs(share - chance / 100) < 0.05,
        'A ' + chance + '% part chance applies the envelope to about that share of slices: ' + share.toFixed(3));
      assert(curves.every(function (curve, index) {
        return curve.enabled ? curve.depth === always[index].depth && curve.decaySeconds === always[index].decaySeconds
          : curve.depth === 0 && curve.startRate === 1 && curve.points.length === 1 && curve.sourceSecondsAt(0.3) === 0.3;
      }), 'Chance ' + chance + '% only switches slices on or off without reshaping selected ones');
    });
    assert(selections[30].every(function (enabled, index) { return !enabled || selections[60][index]; }), 'Raising a part chance keeps every slice that already had an envelope');
    [[-5, 0], [150, 100], [NaN, 100], ['abc', 100]].forEach(function (values) {
      const normalized = slices.slice(0, 200).map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvChance: values[0] }, settings)).enabled; });
      const expected = slices.slice(0, 200).map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvChance: values[1] }, settings)).enabled; });
      assert(JSON.stringify(normalized) === JSON.stringify(expected), 'Part chance normalizes ' + String(values[0]) + ' to ' + values[1]);
    });

    [50, 100].forEach(function (spread) {
      const curves = slices.map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvDepthRandom: spread }, settings)); });
      const magnitudes = curves.map(function (curve) { return Math.abs(curve.depth); });
      const mean = magnitudes.reduce(function (sum, value) { return sum + value; }, 0) / magnitudes.length;
      const lowest = Math.max(1, Math.round(12 * (1 - spread / 100)));
      assert(magnitudes.every(function (value) { return Number.isInteger(value) && value <= 12 && value >= lowest; }), 'Depth spread ' + spread + '% keeps whole-semitone depths from ' + lowest + ' to the maximum');
      assert(Math.abs(mean - 12 * (1 - spread / 200)) < 0.5 && new Set(magnitudes).size >= 13 - lowest, 'Depth spread ' + spread + '% uses every whole-semitone depth in its range');
      assert(curves.every(function (curve, index) {
        return Math.sign(curve.depth) === Math.sign(always[index].depth) && curve.decaySeconds === 0.08 && near(curve.startRate, Math.pow(2, curve.depth / 12));
      }), 'Depth spread ' + spread + '% keeps each slice direction and return time');
      assert(JSON.stringify(curves.map(function (curve) { return curve.depth; })) === JSON.stringify(slices.map(function (slice) {
        return envelope.create(1, slice, Object.assign({ pitchEnvDepthRandom: spread }, settings)).depth;
      })), 'Depth spread ' + spread + '% is deterministic for stored slices');
    });
    [50, 100].forEach(function (spread) {
      const factor = Math.pow(4, spread / 100);
      const curves = slices.map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvTimeRandom: spread }, settings)); });
      const times = curves.map(function (curve) { return curve.decaySeconds; });
      const shorter = times.filter(function (time) { return time < 0.08; }).length / times.length;
      assert(times.every(function (time) { return time >= 0.08 / factor - 1e-12 && time <= 0.08 * factor + 1e-12; }), 'Time spread ' + spread + '% stays within its log-scale range');
      assert(Math.abs(shorter - 0.5) < 0.06 && new Set(times.map(function (time) { return time.toFixed(5); })).size > 300, 'Time spread ' + spread + '% makes slices both faster and slower');
      assert(curves.every(function (curve, index) { return curve.depth === always[index].depth; }), 'Time spread ' + spread + '% keeps each slice depth');
      assert(curves.slice(0, 40).every(function (curve) {
        return [0.0005, 0.03, 0.4].every(function (distance) { return near(curve.sourceSecondsAt(curve.durationFor(distance)), distance); }) &&
          curve.points[curve.points.length - 1].rate === curve.baseRate;
      }), 'Time spread ' + spread + '% retains exact source consumption and settles at the base rate');
    });
    [[90, 1], [120, 1], [160, 2], [120, 3]].forEach(function (values) {
      const bpm = values[0];
      const steps = values[1];
      const gate = steps * 15 / bpm;
      const ceiling = Math.max(0.08, 0.7 * gate);
      const short = slices.slice(0, 300).map(function (slice) {
        return envelope.create(1, Object.assign({}, slice, { durationSteps: steps }), { pitchEnvDepth: 24, pitchEnvTime: 80, pitchEnvTimeRandom: 100, bpm });
      });
      const plain = envelope.create(1, Object.assign({}, slices[0], { durationSteps: steps }), { pitchEnvDepth: 24, pitchEnvTime: 500, bpm });
      assert(short.every(function (curve) { return curve.decaySeconds >= 0.02 - 1e-12 && curve.decaySeconds <= ceiling + 1e-12 && curve.rateAt(ceiling + 0.003) === curve.baseRate; }) &&
        short.some(function (curve) { return curve.decaySeconds > 0.08; }) === (ceiling > 0.08) && plain.decaySeconds === 0.5,
      'Spread never lengthens a return past the set time or 70% of a ' + steps + '-step gate at ' + bpm + ' BPM');
    });
    [[500, 0.5], [5, 0.005]].forEach(function (values) {
      const times = slices.slice(0, 300).map(function (slice) {
        return envelope.create(1, slice, { pitchEnvDepth: 12, pitchEnvTime: values[0], pitchEnvTimeRandom: 100 }).decaySeconds;
      });
      assert(values[0] === 500 ? times.every(function (time) { return time <= 0.5; }) : times.every(function (time) { return time >= 0.005; }),
        'Randomized return time stays within the 5–500 ms control range at ' + values[0] + ' ms');
    });
    const formSettings = { pitchEnvDepth: 12, pitchEnvTime: 80, pitchEnvDepthRandom: 100, pitchEnvTimeRandom: 100, pitchEnvChance: 50 };
    assert(slices.slice(0, 300).every(function (slice) {
      const first = envelope.create(1, slice, formSettings);
      const repeat = envelope.create(1, Object.assign({}, slice, { step: slice.step + 48 }), formSettings);
      return first.enabled === repeat.enabled && first.depth === repeat.depth && first.decaySeconds === repeat.decaySeconds;
    }), 'A slice repeated three bars later bends exactly the same way');
    const rerolled = slices.map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvSeed: 'k3x9' }, formSettings)); });
    const original = slices.map(function (slice) { return envelope.create(1, slice, formSettings); });
    assert(JSON.stringify(original.map(function (curve) { return curve.depth; })) === JSON.stringify(slices.map(function (slice) { return envelope.create(1, slice, Object.assign({ pitchEnvSeed: '' }, formSettings)).depth; })) &&
      rerolled.filter(function (curve, index) { return curve.depth !== original[index].depth; }).length > 400 &&
      Math.abs(rerolled.filter(function (curve) { return curve.enabled; }).length / rerolled.length - 0.5) < 0.05,
    'A re-roll seed picks a new pattern with the same chance, and an empty seed keeps the original');
    const generator = root.BlueLoopGenerator;
    if (generator) {
      const band = [{ id: 'vox', kind: 'voice', name: 'GLASS VOICE' }, { id: 'low', kind: 'bass', name: 'ROUND BASS' }, { id: 'kit', kind: 'drums', category: 'drums', name: 'DUST DRUMS' }];
      let pairs = 0;
      for (let index = 0; index < 20; index += 1) {
        const events = generator.generate(band, Object.assign({}, generator.defaults, { breaks: 15 }), 'RETURN-' + index);
        events.filter(function (item) { return item.step === 0; }).forEach(function (opening) {
          const returning = events.find(function (item) { return item.laneId === opening.laneId && item.step === 48; });
          if (!returning || returning.sliceIndex !== opening.sliceIndex || returning.startRatio !== opening.startRatio) return;
          pairs += 1;
          const a = envelope.create(1, opening, formSettings);
          const b = envelope.create(1, returning, formSettings);
          assert(a.enabled === b.enabled && a.depth === b.depth && a.decaySeconds === b.decaySeconds, 'The returning A downbeat bends like bar one, landing accent included: RETURN-' + index);
        });
      }
      assert(pairs > 10, 'Enough returning downbeats were compared: ' + pairs);
    }
    const spreadSettings = { pitchEnvDepth: 12, pitchEnvTime: 80, pitchEnvDepthRandom: 70, pitchEnvTimeRandom: 70, pitchEnvChance: 60 };
    const spreadCurve = envelope.create(1, slices[7], spreadSettings);
    assert(controls.every(function (change) {
      const changed = envelope.create(1, Object.assign({}, slices[7], change), spreadSettings);
      return changed.depth === spreadCurve.depth && changed.enabled === spreadCurve.enabled && (change.durationSteps != null || changed.decaySeconds === spreadCurve.decaySeconds);
    }), 'Octave, reverse, locks, mixer state and gates do not reroll chance or spreads');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
