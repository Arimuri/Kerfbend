(function (global) {
  'use strict';

  function assert(condition, message) { if (!condition) throw new Error(message); }

  function makeBuffer(duration, sampleRate, channelCount, write) {
    var length = Math.round(duration * sampleRate);
    var channels = [];
    for (var c = 0; c < channelCount; c++) channels.push(new Float32Array(length));
    write(channels, sampleRate);
    return { length: length, duration: length / sampleRate, sampleRate: sampleRate, numberOfChannels: channelCount,
      getChannelData: function (channel) { return channels[channel]; } };
  }

  function noise(seed) {
    var state = seed >>> 0;
    return function () {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      return state / 2147483648 - 1;
    };
  }

  // Kicks (a falling sine), snares and hats (noise bursts) over a quiet
  // noise floor; the kick's phase is integrated, so its pitch only falls.
  var HITS = [0.25, 0.5, 0.875, 1.25, 1.375, 1.5, 2];
  function drums(sampleRate, gain, channelCount, invert) {
    return makeBuffer(2.4, sampleRate || 44100, channelCount || 1, function (channels, rate) {
      var random = noise(7);
      var data = channels[0];
      for (var i = 0; i < data.length; i++) data[i] = random() * 0.0005;
      HITS.forEach(function (time, index) {
        var start = Math.round(time * rate);
        var phase = 0;
        for (var j = 0; j < 0.2 * rate && start + j < data.length; j++) {
          var t = j / rate;
          phase += 2 * Math.PI * (50 + 120 * Math.exp(-t * 30)) / rate;
          var fade = Math.min(1, (0.2 - t) / 0.01);
          data[start + j] += (index % 2 ? random() * Math.exp(-t * 40) * 0.5 : Math.sin(phase) * Math.exp(-t * 12) * 0.8) * fade;
        }
      });
      for (var k = 0; k < data.length; k++) data[k] *= gain == null ? 1 : gain;
      for (var c = 1; c < channels.length; c++) {
        for (var m = 0; m < data.length; m++) channels[c][m] = invert ? -data[m] : data[m];
      }
    });
  }

  // Notes that follow one another with no gap, each with a soft 5 ms attack.
  var NOTES = [0, 0.3, 0.6, 0.9, 1.2, 1.5];
  function legato(sampleRate) {
    var pitches = [220, 247, 262, 294, 330, 349];
    return makeBuffer(1.8, sampleRate || 44100, 1, function (channels, rate) {
      var data = channels[0];
      var phase = 0;
      for (var i = 0; i < data.length; i++) {
        var t = i / rate;
        var note = Math.min(NOTES.length - 1, Math.floor(t / 0.3));
        var within = t - NOTES[note];
        phase += 2 * Math.PI * pitches[note] / rate;
        var envelope = Math.min(1, within / 0.005) * (0.4 + 0.6 * Math.exp(-within * 6));
        data[i] = (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) * envelope * 0.3;
      }
    });
  }

  // A held 330 Hz sine whose pitch swings by the given cents at 5.5 Hz.
  function vibrato(cents) {
    return makeBuffer(2, 44100, 1, function (channels, rate) {
      var data = channels[0];
      var phase = 0;
      for (var i = 0; i < data.length; i++) {
        var t = i / rate;
        phase += 2 * Math.PI * 330 * Math.pow(2, cents / 1200 * Math.sin(2 * Math.PI * 5.5 * t)) / rate;
        data[i] = Math.sin(phase) * Math.min(1, t / 0.01) * 0.4;
      }
    });
  }

  // Decaying plucks at the given times and level, each a quarter second long.
  function plucks(duration, times, gain, write) {
    return makeBuffer(duration, 44100, 1, function (channels, rate) {
      var data = channels[0];
      times.forEach(function (time, index) {
        var start = Math.round(time * rate);
        for (var i = start; i < Math.min(data.length, start + Math.round(0.24 * rate)); i++) {
          var t = i / rate - time;
          data[i] += Math.sin(2 * Math.PI * 330 * Math.pow(2, (index % 4) / 12) * t) * gain * Math.exp(-t * 12) * Math.min(1, t / 0.002);
        }
      });
      if (write) write(data, rate);
    });
  }

  function near(times, truth, early, late) {
    return times.length === truth.length && times.every(function (time, index) {
      return time >= truth[index] - early && time <= truth[index] + late;
    });
  }

  function show(times) {
    return times.map(function (time) { return time.toFixed(3); }).join(' ');
  }

  global.runOnsetDetectionTests = async function () {
    var onsets = global.BlueLoopOnsets;
    if (!onsets) throw new Error('Load js/onset-detection.js before onset-detection-tests.js.');
    var results = [], begun = performance.now();
    async function test(name, callback) {
      try { await callback(); results.push({ name: name, passed: true }); }
      catch (error) { results.push({ name: name, passed: false, error: error.message }); }
    }

    var hits = await onsets.analyze(drums());
    await test('Every drum hit starts a cut just before its attack, and nothing else does', async function () {
      var times = onsets.cutTimes(hits, 50);
      assert(near(times, HITS, 0.006, 0.001), 'Cuts ' + show(times));
    });
    await test('Notes that follow without a gap are cut at each new note', async function () {
      var times = onsets.cutTimes(await onsets.analyze(legato()), 50);
      assert(near(times, NOTES, 0.006, 0.006), 'Cuts ' + show(times));
    });
    await test('A quieter copy of the same audio is cut in the same places', async function () {
      var quiet = await onsets.analyze(drums(44100, 0.05));
      [0, 25, 50, 75, 100].forEach(function (sensitivity) {
        assert(show(onsets.cutTimes(quiet, sensitivity)) === show(onsets.cutTimes(hits, sensitivity)), 'Sensitivity ' + sensitivity + ': ' + show(onsets.cutTimes(quiet, sensitivity)));
      });
    });
    await test('Opposite-polarity stereo does not cancel the onsets', async function () {
      var times = onsets.cutTimes(await onsets.analyze(drums(44100, 1, 2, true)), 50);
      assert(show(times) === show(onsets.cutTimes(hits, 50)), 'Cuts ' + show(times));
    });
    await test('Other sample rates find the same onsets', async function () {
      for (var sampleRate of [22050, 48000, 96000]) {
        var times = onsets.cutTimes(await onsets.analyze(drums(sampleRate)), 50);
        assert(near(times, HITS, 0.007, 0.002), sampleRate + ' Hz: ' + show(times));
      }
    });
    await test('A held note with vibrato stays one piece', async function () {
      var gentle = await onsets.analyze(vibrato(25));
      var wide = await onsets.analyze(vibrato(48));
      for (var sensitivity = 0; sensitivity <= 100; sensitivity += 10) {
        assert(show(onsets.cutTimes(gentle, sensitivity)) === '0.000', '25 cents at sensitivity ' + sensitivity + ': ' + show(onsets.cutTimes(gentle, sensitivity)));
        // Small sizes may cut a wide vibrato at its swings, as the help says.
        if (sensitivity <= 50) assert(show(onsets.cutTimes(wide, sensitivity)) === '0.000', '48 cents at sensitivity ' + sensitivity + ': ' + show(onsets.cutTimes(wide, sensitivity)));
      }
    });
    await test('One loud click does not hide the quieter notes around it', async function () {
      var times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75];
      var click = function (data, rate) { for (var i = Math.round(1.9 * rate); i < Math.round(1.901 * rate); i++) data[i] += 1; };
      var clicked = await onsets.analyze(plucks(2, times, Math.pow(10, -36 / 20), click));
      var cut = onsets.cutTimes(clicked, 50);
      assert(near(cut, times.concat([1.9]), 0.006, 0.002), 'Plucks 36 dB below the click: ' + show(cut));
      var quieter = await onsets.analyze(plucks(2, times, Math.pow(10, -45 / 20), click));
      for (var sensitivity = 0; sensitivity <= 100; sensitivity += 25) {
        assert(onsets.cutTimes(quieter, sensitivity)[0] === 0, 'Plucks 45 dB below the click lost the opening at sensitivity ' + sensitivity + ': ' + show(onsets.cutTimes(quieter, sensitivity)));
      }
    });
    await test('Soft notes before a loud entry are kept, noise before it is not', async function () {
      var entry = makeBuffer(2, 44100, 1, function (channels, rate) {
        var data = channels[0];
        [[0.1, 0.02, 440], [0.4, 0.02, 523], [1, 0.9, 220], [1.5, 0.9, 247]].forEach(function (note) {
          for (var i = Math.round(note[0] * rate); i < data.length; i++) {
            var t = i / rate - note[0];
            data[i] += Math.sin(2 * Math.PI * note[2] * t) * note[1] * Math.exp(-t * 8) * Math.min(1, t / 0.002);
          }
        });
      });
      var analysis = await onsets.analyze(entry);
      assert(near(onsets.cutTimes(analysis, 50), [0.1, 0.4, 1, 1.5], 0.006, 0.002), 'Cuts ' + show(onsets.cutTimes(analysis, 50)));
      assert(near(onsets.cutTimes(analysis, 0).slice(0, 1), [0.1], 0.006, 0.002), 'The soft opening was left out: ' + show(onsets.cutTimes(analysis, 0)));
      var noisy = makeBuffer(1, 44100, 1, function (channels, rate) {
        var data = channels[0];
        var random = noise(3);
        for (var i = 0; i < data.length; i++) data[i] = random() * 0.002;
        for (var j = Math.round(0.4 * rate); j < data.length; j++) data[j] += Math.sin(2 * Math.PI * 220 * (j / rate - 0.4)) * 0.1 * Math.min(1, (j / rate - 0.4) / 0.002);
      });
      var first = onsets.cutTimes(await onsets.analyze(noisy), 100)[0];
      assert(first >= 0.394 && first <= 0.402, 'Noise 34 dB below the entry started a cut at ' + first);
    });
    await test('Leading silence is skipped and a sound at the top is cut at the top', async function () {
      var late = makeBuffer(1, 44100, 1, function (channels, rate) {
        var data = channels[0];
        for (var i = Math.round(0.3 * rate); i < data.length; i++) data[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 0.5 * Math.exp(-(i / rate - 0.3) * 3);
      });
      var times = onsets.cutTimes(await onsets.analyze(late), 100);
      assert(times.length === 1 && times[0] >= 0.295 && times[0] <= 0.301, 'Cuts ' + show(times));
      var top = onsets.cutTimes(await onsets.analyze(legato()), 0);
      assert(top[0] === 0, 'The first note at the top was left out: ' + show(top));
    });
    await test('Silence and invalid input give no cuts', async function () {
      var silent = await onsets.analyze(makeBuffer(1, 44100, 2, function () {}));
      assert(silent.start === null && silent.candidates.length === 0 && onsets.cuts(silent, 100).length === 0, 'Silence was cut');
      var invalid = await onsets.analyze(null);
      assert(invalid.duration === 0 && invalid.start === null && onsets.cuts(invalid, 50).length === 0, 'Invalid input was cut');
      assert(onsets.cuts(null, 50).length === 0 && onsets.cuts({ duration: 1, start: null, candidates: [{ time: 0.5, strength: 9 }] }, 50).length === 0, 'Missing analysis was cut');
    });
    await test('Higher sensitivity only adds cuts', async function () {
      var analyses = [hits, await onsets.analyze(legato()), await onsets.analyze(plucks(2, [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75], 0.3))];
      analyses.forEach(function (analysis) {
        var previous = null;
        for (var sensitivity = 0; sensitivity <= 100; sensitivity += 5) {
          var times = onsets.cutTimes(analysis, sensitivity);
          // A weak onset just before the first sound may move that cut earlier.
          assert(!previous || (times.length >= previous.length && previous.every(function (time) {
            return times.some(function (other) { return other <= time && time - other < 0.04; });
          })), 'Sensitivity ' + sensitivity + ' lost a cut: ' + show(previous || []) + ' → ' + show(times));
          previous = times;
        }
      });
      assert(onsets.cutTimes(hits, 0).length < onsets.cutTimes(hits, 50).length, 'Sensitivity 0 still keeps every hit');
    });
    await test('Cuts cover the source from the first sound to the end without overlaps', async function () {
      [0, 50, 100].forEach(function (sensitivity) {
        var pieces = onsets.cuts(hits, sensitivity);
        assert(pieces.length > 0 && pieces[0].start === hits.start && pieces[pieces.length - 1].end === hits.duration, 'Sensitivity ' + sensitivity + ' leaves gaps at the ends');
        assert(pieces.every(function (piece, index) {
          return piece.end - piece.start >= 0.04 - 1e-9 && (index === 0 || piece.start === pieces[index - 1].end);
        }), 'Sensitivity ' + sensitivity + ' has a short or broken piece');
      });
    });
    await test('An analysis is cached per buffer and is plain data', async function () {
      var buffer = drums();
      var analysis = await onsets.analyze(buffer);
      assert(await onsets.analyze(buffer) === analysis, 'A second analysis of the same buffer was not reused');
      var json = JSON.parse(JSON.stringify(analysis));
      assert(show(onsets.cutTimes(json, 50)) === show(onsets.cutTimes(analysis, 50)), 'The analysis is not plain data');
    });
    await test('A long analysis keeps giving the page time to respond', async function () {
      var times = [];
      for (var time = 0; time < 30; time += 0.25) times.push(time);
      var long = plucks(30, times, 0.3);
      var last = performance.now();
      var longest = 0;
      var running = true;
      (function tick() {
        if (!running) return;
        var now = performance.now();
        longest = Math.max(longest, now - last);
        last = now;
        setTimeout(tick, 0);
      })();
      var analysis = await onsets.analyze(long);
      running = false;
      assert(onsets.cutTimes(analysis, 50).length === times.length, 'Wrong cuts in the long source');
      assert(longest < 200, 'The page waited ' + Math.round(longest) + ' ms');
    });
    return { passed: results.filter(function (r) { return r.passed; }).length,
      failed: results.filter(function (r) { return !r.passed; }).length,
      durationMs: Math.round(performance.now() - begun), results: results };
  };
})(typeof window !== 'undefined' ? window : globalThis);
