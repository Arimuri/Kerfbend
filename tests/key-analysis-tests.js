(function (global) {
  'use strict';

  function assert(condition, message) { if (!condition) throw new Error(message); }

  function makeBuffer(duration, sampleRate, channelCount, sample) {
    var length = Math.round(duration * sampleRate);
    var channels = [];
    for (var c = 0; c < channelCount; c++) {
      var data = new Float32Array(length);
      for (var i = 0; i < length; i++) data[i] = sample(i / sampleRate, c, i);
      channels.push(data);
    }
    return { length: length, duration: length / sampleRate, sampleRate: sampleRate, numberOfChannels: channelCount,
      getChannelData: function (channel) { return channels[channel]; } };
  }

  function tone(midi, time, harmonics) {
    var frequency = 440 * Math.pow(2, (midi - 69) / 12);
    var value = Math.sin(2 * Math.PI * frequency * time);
    if (harmonics) value += 0.35 * Math.sin(4 * Math.PI * frequency * time) + 0.16 * Math.sin(6 * Math.PI * frequency * time);
    return value;
  }

  function progression(tonic, minor, sampleRate, channelCount, antiphase, detuning) {
    var chords = minor ? [[0, 3, 7], [0, 3, 7], [5, 8, 12], [7, 11, 14], [0, 3, 7]] :
      [[0, 4, 7], [0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
    return makeBuffer(5, sampleRate || 44100, channelCount || 1, function (time, channel) {
      var chord = chords[Math.min(chords.length - 1, Math.floor(time))];
      var local = time % 1;
      var envelope = Math.min(1, local * 100) * Math.min(1, (1 - local) * 100);
      var value = chord.reduce(function (sum, note) { return sum + tone(48 + tonic + note + (detuning || 0), time, true); }, 0) * 0.12 * envelope;
      return antiphase && channel === 1 ? -value : value;
    });
  }

  global.runKeyAnalysisTests = async function () {
    var analyzer = global.BlueLoopKeyAnalysis;
    if (!analyzer) throw new Error('Load js/key-analysis.js before key-analysis-tests.js.');
    var results = [], start = performance.now();
    async function test(name, callback) {
      try { await callback(); results.push({ name: name, passed: true }); }
      catch (error) { results.push({ name: name, passed: false, error: error.message }); }
    }
    async function expectKey(buffer, tonic, mode) {
      var found = await analyzer.analyze(buffer);
      assert(found.status === 'tonal' && found.tonic === tonic && found.mode === mode,
        'Expected ' + tonic + ' ' + mode + ', received ' + JSON.stringify(found));
      assert(found.confidence >= 0 && found.confidence <= 1, 'Invalid confidence');
      assert(found.source === 'analysis', 'Wrong provenance');
      assert(found.chroma.length === 12 && Math.abs(found.chroma.reduce(function (a, b) { return a + b; }, 0) - 1) < 1e-9, 'Chroma must have 12 normalized bins');
      return found;
    }

    for (var tonic of [0, 2, 6, 9]) {
      for (var mode of ['major', 'minor']) {
        await test('Harmonic ' + tonic + ' ' + mode + ' cadence is detected', async function () {
          await expectKey(progression(tonic, mode === 'minor'), tonic, mode);
        });
      }
    }
    await test('A sustained chord reports its root and quality', async function () {
      var chord = makeBuffer(1, 48000, 1, function (time) { return (tone(53, time) + tone(56, time) + tone(60, time)) * 0.18; });
      await expectKey(chord, 5, 'minor');
    });
    await test('A decaying sine one-shot reports pitch without inventing a mode', async function () {
      var note = makeBuffer(0.7, 44100, 1, function (time) { return tone(58, time) * Math.exp(-time * 5) * Math.min(1, time * 1000) * 0.6; });
      await expectKey(note, 10, 'unknown');
    });
    await test('An overtone-rich bass note retains its fundamental pitch class', async function () {
      var note = makeBuffer(1, 48000, 1, function (time) { return tone(33, time, true) * 0.4; });
      await expectKey(note, 9, 'unknown');
    });
    await test('44.1, 48 and 96 kHz produce the same musical key', async function () {
      for (var sampleRate of [22050, 48000, 96000]) await expectKey(progression(4, false, sampleRate), 4, 'major');
    });
    await test('Opposite-polarity stereo does not cancel the detected key', async function () {
      await expectKey(progression(7, true, 44100, 2, true), 7, 'minor');
    });
    await test('Detuning is measured before the pitch-class assignment', async function () {
      var found = await expectKey(progression(1, false, 44100, 1, false, 0.3), 1, 'major');
      assert(Math.abs(found.tuningCents - 30) < 5, 'Expected about +30 cents, received ' + found.tuningCents);
    });
    await test('Digital silence has no assignable key', async function () {
      var found = await analyzer.analyze(makeBuffer(1, 44100, 2, function () { return 0; }));
      assert(found.tonic === null && found.status === 'unpitched', 'Silence must be unpitched');
    });
    await test('Broadband noise and a decaying noise hit are not auto-tuned', async function () {
      for (var decay of [0, 15]) {
        var seed = 15321;
        var noise = makeBuffer(1.2, 44100, 1, function (time) {
          seed = Math.imul(1664525, seed) + 1013904223 | 0;
          return (seed / 2147483648) * 0.4 * Math.exp(-time * decay);
        });
        var found = await analyzer.analyze(noise);
        assert(found.tonic === null && found.status !== 'tonal', 'Noise was assigned ' + JSON.stringify(found));
      }
    });
    await test('A fast pitch-sweeping kick is not mistaken for a stable note', async function () {
      var kick = makeBuffer(1, 44100, 1, function (time) {
        var local = time % 0.5;
        var phase = 2 * Math.PI * (45 * local + 110 * (1 - Math.exp(-local * 25)) / 25);
        return Math.sin(phase) * Math.exp(-local * 18) * 0.8;
      });
      var found = await analyzer.analyze(kick);
      assert(found.tonic === null && found.status !== 'tonal', 'Kick was assigned ' + JSON.stringify(found));
    });
    await test('Chromatic material stays uncertain', async function () {
      var chromatic = makeBuffer(6, 44100, 1, function (time) { return tone(60 + Math.min(11, Math.floor(time * 2)), time) * 0.4; });
      var found = await analyzer.analyze(chromatic);
      assert(found.tonic === null && found.status !== 'tonal', 'Chromatic material was assigned a key');
    });
    await test('Analysis is deterministic and does not mutate source samples', async function () {
      var buffer = progression(11, true, 44100, 2, true);
      var snapshots = [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
      var first = await analyzer.analyze(buffer), second = await analyzer.analyze(buffer);
      assert(JSON.stringify(first) === JSON.stringify(second), 'Repeated analysis differs');
      snapshots.forEach(function (data, channel) {
        var source = buffer.getChannelData(channel);
        for (var i = 0; i < source.length; i++) assert(source[i] === data[i], 'Source PCM was mutated');
      });
    });
    await test('A 60-second sample uses a bounded number of frames and yields to the UI', async function () {
      var timerRan = false;
      var buffer = makeBuffer(60, 44100, 1, function (time) { return tone(64, time) * 0.4; });
      setTimeout(function () { timerRan = true; }, 0);
      var before = performance.now(), found = await analyzer.analyze(buffer);
      assert(found.analyzedFrames <= 96, 'Analysis exceeded its frame budget');
      assert(found.tonic === 4 && found.mode === 'unknown', 'Long note was not detected');
      assert(timerRan, 'Analysis starved the event loop');
      // A generous guard catches accidental analysis of every sample/window.
      assert(performance.now() - before < 15000, 'Analysis exceeded 15 seconds');
    });
    return { passed: results.filter(function (r) { return r.passed; }).length,
      failed: results.filter(function (r) { return !r.passed; }).length,
      durationMs: Math.round(performance.now() - start), results: results };
  };
})(typeof window !== 'undefined' ? window : globalThis);
