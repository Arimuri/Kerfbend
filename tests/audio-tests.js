(function (global) {
  'use strict';

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function peak(buffer) {
    var maximum = 0;
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
      var data = buffer.getChannelData(channel);
      for (var frame = 0; frame < data.length; frame++) {
        assert(Number.isFinite(data[frame]), 'PCM must contain only finite samples');
        maximum = Math.max(maximum, Math.abs(data[frame]));
      }
    }
    return maximum;
  }

  function maximumDifference(first, second) {
    assert(first.length === second.length, 'Buffers must have equal lengths');
    var difference = 0;
    for (var channel = 0; channel < first.numberOfChannels; channel++) {
      var a = first.getChannelData(channel);
      var b = second.getChannelData(channel);
      for (var frame = 0; frame < a.length; frame++) difference = Math.max(difference, Math.abs(a[frame] - b[frame]));
    }
    return difference;
  }

  function toneFrequency(buffer) {
    var data = buffer.getChannelData(0);
    var crossings = [];
    for (var frame = Math.ceil(buffer.sampleRate * 0.025); frame < buffer.sampleRate * 0.15; frame++) {
      if (data[frame - 1] <= 0 && data[frame] > 0) {
        crossings.push(frame - 1 - data[frame - 1] / (data[frame] - data[frame - 1]));
      }
    }
    assert(crossings.length > 10, 'Rendered tone is missing');
    return (crossings.length - 1) * buffer.sampleRate / (crossings[crossings.length - 1] - crossings[0]);
  }

  function monoToneFile() {
    var frames = 44100;
    var data = new ArrayBuffer(44 + frames * 2);
    var view = new DataView(data);
    ['RIFF', 'WAVEfmt ', 'data'].forEach(function (text, index) {
      var offset = [0, 8, 36][index];
      for (var character = 0; character < text.length; character++) view.setUint8(offset + character, text.charCodeAt(character));
    });
    view.setUint32(4, 36 + frames * 2, true);
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 44100, true);
    view.setUint32(28, 88200, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    view.setUint32(40, frames * 2, true);
    for (var frame = 0; frame < frames; frame++) view.setInt16(44 + frame * 2, Math.round(Math.sin(2 * Math.PI * 440 * frame / 44100) * 8192), true);
    return new File([data], 'tone_Amaj.wav', { type: 'audio/wav' });
  }

  async function runAudioTests() {
    var results = [];
    var start = performance.now();
    var engine = new global.BlueLoopAudio.Engine();
    async function test(name, callback) {
      try {
        await callback();
        results.push({ name: name, passed: true });
      } catch (error) {
        results.push({ name: name, passed: false, error: error.message });
      }
    }

    var lanes = await engine.createDemoLanes();
    var settings = { bpm: 137, bars: 1, chop: 16, swing: 25, space: 32 };
    var events = [
      { laneId: 'voice', step: 0, sliceIndex: 2, durationSteps: 2, semitones: 0, velocity: 0.9 },
      { laneId: 'keys', step: 3, sliceIndex: 5, durationSteps: 3, semitones: 12, reverse: true, velocity: 0.7 },
      { laneId: 'bass', step: 8, sliceIndex: 0, durationSteps: 4, semitones: 0, velocity: 0.8 },
      { laneId: 'drums', step: 15, sliceIndex: 2, durationSteps: 2, semitones: 0, velocity: 0.9 }
    ];
    var rendered;
    await test('Procedural demo buffers are stereo, finite and audible', async function () {
      assert(lanes.length === 4, 'Expected four demo lanes');
      lanes.forEach(function (lane) {
        assert(lane.buffer.numberOfChannels === 2, 'Demo must be stereo');
        assert(lane.buffer.sampleRate === 44100, 'Demo must use 44.1 kHz');
        assert(lane.buffer.duration === 8, 'Demo must contain 16 half-second slices');
        assert(peak(lane.buffer) > 0.01, 'Demo is silent');
      });
    });
    await test('Offline render preserves exact musical duration and stereo 44.1 kHz PCM', async function () {
      rendered = await engine.render(lanes, settings, events);
      assert(rendered.length === Math.round(4 * 60 / 137 * 44100), 'Unexpected frame count');
      assert(rendered.numberOfChannels === 2 && rendered.sampleRate === 44100, 'Unexpected PCM format');
      assert(peak(rendered) > 0.01 && peak(rendered) <= 0.950001, 'Silent or clipped render');
    });
    await test('Repeated render with reverse and echo is sample-for-sample deterministic', async function () {
      var repeated = await engine.render(lanes, settings, events);
      var difference = maximumDifference(rendered, repeated);
      assert(difference === 0, 'Repeated render produced different PCM: ' + difference);
    });
    await test('Muted lanes and solo selection affect rendered audio', async function () {
      var muted = lanes.map(function (lane) { return Object.assign({}, lane, { muted: true }); });
      var silence = await engine.render(muted, settings, events);
      assert(peak(silence) === 0, 'Muted lanes were audible');
      var soloed = lanes.map(function (lane) { return Object.assign({}, lane, { solo: lane.id === 'voice' }); });
      var solo = await engine.render(soloed, settings, events);
      var isolated = await engine.render([lanes[0]], settings, events);
      assert(maximumDifference(solo, isolated) === 0, 'Solo did not isolate the selected lane');
    });
    await test('Swing delays odd steps by the requested percentage of one step', async function () {
      var swung = await engine.render([lanes[0]], { bpm: 120, bars: 1, chop: 16, swing: 50 }, [
        { laneId: 'voice', step: 1, sliceIndex: 0, durationSteps: 1, velocity: 1 }
      ]);
      var data = swung.getChannelData(0);
      var firstSound = data.findIndex(function (sample) { return Math.abs(sample) > 0.000001; });
      assert(firstSound >= Math.floor(0.1875 * 44100), 'Swing note started too early');
      assert(firstSound < Math.ceil(0.192 * 44100), 'Swing note started too late');
    });
    await test('Reverse changes a non-symmetric slice without changing loop duration', async function () {
      var context = engine.context;
      var ramp = context.createBuffer(1, 44100, 44100);
      var data = ramp.getChannelData(0);
      for (var frame = 0; frame < data.length; frame++) data[frame] = frame / data.length * 0.3;
      var lane = { id: 'ramp', buffer: ramp, volume: 1 };
      var event = { laneId: 'ramp', step: 0, sliceIndex: 0, durationSteps: 4, velocity: 1 };
      var forward = await engine.render([lane], { bpm: 120, bars: 1, chop: 2 }, [event]);
      var reverse = await engine.render([lane], { bpm: 120, bars: 1, chop: 2 }, [Object.assign({}, event, { reverse: true })]);
      assert(maximumDifference(forward, reverse) > 0.05, 'Slice was not reversed');
    });
    await test('Locked sourceChop preserves sound when SIZE changes', async function () {
      var event = { laneId: 'voice', step: 0, sliceIndex: 3, sourceChop: 16, durationSteps: 4, velocity: 1, reverse: true };
      var first = await engine.render([lanes[0]], { bpm: 120, bars: 1, chop: 16 }, [event]);
      var changed = await engine.render([lanes[0]], { bpm: 120, bars: 1, chop: 4 }, [event]);
      assert(maximumDifference(first, changed) === 0, 'SIZE changed a locked event');
    });
    await test('Imported mono audio survives repeated key changes with its original PCM intact', async function () {
      var buffer = await engine.decodeFile(monoToneFile());
      assert(buffer.numberOfChannels === 1, 'Fixture must decode as mono');
      var original = buffer.getChannelData(0).slice();
      var lane = { id: 'import', buffer: buffer, volume: 1 };
      var event = { laneId: 'import', step: 0, sliceIndex: 0, durationSteps: 4, velocity: 1 };
      var sourceEvents = JSON.stringify(event);
      var first;
      for (var shift of [0, 2, -5, 7, 0]) {
        lane.keyShift = shift;
        var output = await engine.render([lane], { bpm: 120, bars: 1, chop: 1 }, [event]);
        assert(peak(output) > 0.05, 'Imported audio disappeared after a key change');
        assert(Math.abs(toneFrequency(output) - 440 * Math.pow(2, shift / 12)) < 0.1, 'Key correction rendered the wrong pitch');
        var source = buffer.getChannelData(0);
        assert(lane.buffer === buffer && source.length === original.length && source.every(function (sample, index) { return sample === original[index]; }), 'Key correction changed original source PCM');
        if (!first) first = output;
        else if (shift === 0) assert(maximumDifference(first, output) === 0, 'Returning to the initial key changed the phrase');
      }
      assert(JSON.stringify(event) === sourceEvents, 'Key correction changed source events');
    });
    await test('Voice limits render only the expected swung slices and remain stable under key corrections', async function () {
      assert(global.BlueLoopPlayback, 'Load playback-plan.js to verify the renderer integration');
      var sources = [220, 330, 440].map(function (hz, index) {
        var buffer = engine.context.createBuffer(1, 44100 * 2, 44100);
        var samples = buffer.getChannelData(0);
        for (var frame = 0; frame < samples.length; frame++) samples[frame] = Math.sin(2 * Math.PI * hz * frame / 44100) * 0.15;
        return { id: 'tone-' + index, buffer: buffer, volume: 1, keyShift: index, events: [] };
      });
      function event(lane, step, duration) {
        return { laneId: sources[lane].id, step: step, sliceIndex: 0, durationSteps: duration, velocity: 1 };
      }
      var first = event(0, 1, 2);
      var second = event(1, 2, 2);
      var rejected = event(2, 2, 1);
      var third = event(2, 3, 2);
      var fourth = event(0, 4, 2);
      var fifth = event(1, 5, 2);
      var last = event(2, 15, 2);
      // Lane-grouped input also verifies that the render uses chronological planning.
      var raw = [first, fourth, second, fifth, rejected, third, last];
      var beforeEvents = JSON.stringify(raw);
      var originalPCM = sources.map(function (lane) { return lane.buffer.getChannelData(0).slice(); });
      var clippedLast = Object.assign({}, last, { durationSteps: 0.5 });
      var expectedSelections = [[first, third, fifth, clippedLast], [first, second, third, fourth, fifth, clippedLast]];
      for (var cap of [1, 2]) {
        var previous = null;
        for (var keyOffset of [0, 5, -4, 0]) {
          sources.forEach(function (lane, index) { lane.keyShift = index + keyOffset; });
          var settings = { bpm: 120, bars: 1, chop: 1, swing: 50, maxVoices: cap };
          var limited = await engine.render(sources, settings, raw);
          var planned = global.BlueLoopPlayback.plan(sources, settings, raw);
          assert(JSON.stringify(planned) === JSON.stringify(expectedSelections[cap - 1]), 'Unexpected selected slices at capacity ' + cap);
          var referenceSettings = Object.assign({}, settings);
          delete referenceSettings.maxVoices;
          var reference = await engine.render(sources, referenceSettings, expectedSelections[cap - 1]);
          assert(maximumDifference(limited, reference) === 0, 'Renderer played an extra or missing voice at capacity ' + cap);
          if (!previous) previous = limited;
          else if (keyOffset === 0) assert(maximumDifference(previous, limited) === 0, 'Key correction roundtrip changed the selected phrase');
          else assert(maximumDifference(previous, limited) > 0.01, 'Key corrections did not affect the selected phrase');
        }
      }
      assert(JSON.stringify(raw) === beforeEvents, 'Voice limits changed the generated source events');
      sources.forEach(function (lane, index) {
        var samples = lane.buffer.getChannelData(0);
        assert(samples.length === originalPCM[index].length && samples.every(function (sample, frame) { return sample === originalPCM[index][frame]; }), 'Voice limits or key corrections changed original PCM');
      });
    });
    await test('Separate drum and other caps render both categories together without changing source PCM', async function () {
      var sources = [220, 330, 440, 550].map(function (hz, index) {
        var buffer = engine.context.createBuffer(1, 44100 * 2, 44100);
        var samples = buffer.getChannelData(0);
        for (var frame = 0; frame < samples.length; frame++) samples[frame] = Math.sin(2 * Math.PI * hz * frame / 44100) * 0.1;
        return { id: 'separate-' + index, category: index % 2 ? 'drums' : 'other', buffer: buffer, volume: 1, locked: true };
      });
      var raw = sources.flatMap(function (lane) {
        return [0, 3].map(function (step) {
          return { laneId: lane.id, step: step, sliceIndex: 0, durationSteps: 2, velocity: 1 };
        });
      });
      var sourceEvents = JSON.stringify(raw);
      var originalPCM = sources.map(function (lane) { return lane.buffer.getChannelData(0).slice(); });
      var baseSettings = { bpm: 120, bars: 1, chop: 1, swing: 50 };
      // With one voice per category, the first drum and other lane sound at
      // step zero, then each category independently rotates to its second lane.
      var expected = [raw[0], raw[2], raw[5], raw[7]];
      var oneEachSettings = Object.assign({}, baseSettings, { maxVoices: 1, maxDrumVoices: 1 });
      var oneEach = await engine.render(sources, oneEachSettings, raw);
      var reference = await engine.render(sources, baseSettings, expected);
      assert(maximumDifference(oneEach, reference) === 0, 'One drum plus one other sample did not match the expected PCM');
      var onlyOthers = await engine.render(sources.filter(function (lane) { return lane.category === 'other'; }), baseSettings, expected);
      assert(maximumDifference(oneEach, onlyOthers) > 0.02, 'Drums disappeared at the separate one-voice limits');

      // Supplying only the new setting must still invoke planning in the engine.
      var drumOnlyExpected = [raw[0], raw[2], raw[4], raw[1], raw[5], raw[7]];
      var drumOnly = await engine.render(sources, Object.assign({}, baseSettings, { maxDrumVoices: 1 }), raw);
      var drumOnlyReference = await engine.render(sources, baseSettings, drumOnlyExpected);
      assert(maximumDifference(drumOnly, drumOnlyReference) === 0, 'The renderer ignored a standalone drum cap');

      await engine.render(sources, Object.assign({}, baseSettings, { maxVoices: 8, maxDrumVoices: 8 }), raw);
      var restored = await engine.render(sources, oneEachSettings, raw);
      assert(maximumDifference(oneEach, restored) === 0, 'Changing and restoring separate caps changed the rendered phrase');
      assert(JSON.stringify(raw) === sourceEvents, 'Separate caps changed the original events');
      sources.forEach(function (lane, index) {
        assert(lane.buffer.getChannelData(0).every(function (sample, frame) { return sample === originalPCM[index][frame]; }), 'Separate caps changed source PCM');
      });
    });
    await test('Hot overlap is scaled below the 0.95 peak ceiling', async function () {
      var overlaps = Array.from({ length: 40 }, function () {
        return { laneId: 'bass', step: 0, sliceIndex: 0, durationSteps: 4, velocity: 1 };
      });
      var hot = await engine.render(lanes, { bpm: 120, bars: 1, chop: 16 }, overlaps);
      var maximum = peak(hot);
      assert(maximum > 0.949 && maximum <= 0.950001, 'Peak normalization failed');
    });
    await test('WAV export is valid 16-bit stereo RIFF with exact PCM length', async function () {
      var blob = engine.encodeWav(rendered);
      var view = new DataView(await blob.arrayBuffer());
      function text(offset, length) {
        return String.fromCharCode.apply(null, new Uint8Array(view.buffer, offset, length));
      }
      assert(blob.type === 'audio/wav', 'Incorrect MIME type');
      assert(text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE' && text(36, 4) === 'data', 'Missing WAV markers');
      assert(view.getUint16(20, true) === 1, 'WAV is not PCM');
      assert(view.getUint16(22, true) === 2 && view.getUint16(34, true) === 16, 'Wrong channels or bit depth');
      assert(view.getUint32(24, true) === 44100, 'Wrong sample rate');
      assert(view.getUint32(40, true) === rendered.length * 4, 'Wrong data length');
      assert(view.byteLength === 44 + rendered.length * 4, 'Wrong file length');
      var data = rendered.getChannelData(0);
      var sampleIndex = data.findIndex(function (sample) { return Math.abs(sample) > 0.02; });
      assert(sampleIndex >= 0, 'Need an audible sample to verify');
      var sample = data[sampleIndex];
      assert(view.getInt16(44 + sampleIndex * 4, true) === Math.round(sample * (sample < 0 ? 32768 : 32767)), 'Exported PCM differs from rendered playback buffer');
    });
    await test('Exported WAV can be imported and decoded', async function () {
      var file = new File([engine.encodeWav(rendered)], 'test.wav', { type: 'audio/wav' });
      var decoded = await engine.decodeFile(file);
      assert(Math.abs(decoded.duration - rendered.duration) < 0.001, 'Roundtrip changed duration');
      assert(decoded.numberOfChannels === 2 && peak(decoded) > 0.01, 'Roundtrip is silent or non-stereo');
    });
    await test('Oversized imports are rejected before reading file data', async function () {
      var rejected = false;
      try {
        await engine.decodeFile({ size: 40 * 1024 * 1024 + 1, arrayBuffer: function () { throw new Error('File should not be read'); } });
      } catch (error) { rejected = /40 MB/.test(error.message); }
      assert(rejected, 'Oversized file did not receive a clear size error');
    });
    engine.stop();
    if (engine.context) await engine.context.close();
    return {
      passed: results.filter(function (result) { return result.passed; }).length,
      failed: results.filter(function (result) { return !result.passed; }).length,
      durationMs: Math.round(performance.now() - start),
      results: results
    };
  }

  global.runAudioTests = runAudioTests;
})(window);
