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

  function toneFrequency(buffer, fromSeconds, toSeconds) {
    var data = buffer.getChannelData(0);
    var crossings = [];
    var from = fromSeconds == null ? 0.025 : fromSeconds;
    var to = toSeconds == null ? 0.15 : toSeconds;
    for (var frame = Math.max(1, Math.ceil(buffer.sampleRate * from)); frame < buffer.sampleRate * to; frame++) {
      if (data[frame - 1] <= 0 && data[frame] > 0) {
        crossings.push(frame - 1 - data[frame - 1] / (data[frame] - data[frame - 1]));
      }
    }
    assert(crossings.length > 2, 'Rendered tone is missing');
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
    await test('Note-boundary cuts play whole FM notes from their silent starts', async function () {
      var source = engine.createFMSource({ bpm: 105, bars: 2, tonic: 2, octave: 3, density: 70, seed: 'FM-NOTES' });
      var lane = Object.assign({ id: 'fm-notes', kind: 'fm', category: 'other', buffer: source.buffer, volume: 1, keyShift: 0, releaseSeconds: 0.03, events: [] },
        global.BlueLoopFMSynth.noteSegments(source.phrase));
      var config = Object.assign({}, global.BlueLoopGenerator.defaults, { bpm: 105, bars: 2, density: 100, breaks: 0, motion: 0, octave: 0, size: 50 });
      var cuts = global.BlueLoopGenerator.generate([lane], config, 'NOTE-CUTS');
      assert(cuts.length > 3 && cuts.every(function (cut) { return cut.lengthRatio > 0 && cut.segmentCount >= 1; }), 'FM lanes were not cut at note boundaries');
      var output = await engine.render([lane], config, cuts);
      var pcm = source.buffer.getChannelData(0);
      var rendered = output.getChannelData(0);
      var compared = 0;
      cuts.forEach(function (cut) {
        var playback = global.BlueLoopAudio.eventPlayback(lane, cut, config);
        var from = Math.round(playback.start * 44100);
        var offset = Math.round(playback.offset * 44100);
        assert(Math.abs(pcm[offset]) < 1e-6, 'A note cut started away from the note onset');
        assert(Math.abs(playback.sliceSeconds - cut.lengthRatio * source.buffer.duration) < 1e-9, 'A note cut used an equal-slice length');
        var gain = cut.velocity * 0.8;
        var span = Math.floor((playback.duration - 0.035) * 44100);
        for (var frame = Math.round(0.007 * 44100); frame < span; frame += 37) {
          assert(Math.abs(rendered[from + frame] - pcm[offset + frame] * gain) < 2e-3, 'A note cut did not reproduce its source note');
          compared++;
        }
      });
      assert(compared > 200, 'Too little audio was compared');
    });
    await test('Generated FM material can be chopped, retuned, enveloped and exported without changing its source', async function () {
      var source = engine.createFMSource({ bpm: 120, bars: 2, tonic: 7, octave: 2, density: 85, index: 3, seed: 'FM-RENDER' });
      var original = source.buffer.getChannelData(0).slice();
      var originalPhrase = JSON.stringify(source.phrase);
      var lane = { id: 'fm-render', kind: 'fm', category: 'other', buffer: source.buffer, volume: 0.7, keyShift: 0, events: [] };
      var config = Object.assign({}, global.BlueLoopGenerator.defaults, { bpm: 120, bars: 2, density: 100, breaks: 0, motion: 70, octave: 50, maxVoices: 1, maxDrumVoices: 1 });
      var cuts = global.BlueLoopGenerator.generate([lane], config, 'FM-CHOPS');
      var originalCuts = JSON.stringify(cuts);
      assert(cuts.length > 4 && cuts.some(function (cut) { return cut.startRatio > 0; }), 'FM material was not sliced into a phrase');
      var dry = await engine.render([lane], config, cuts);
      lane.keyShift = -5;
      var effected = await engine.render([lane], Object.assign({}, config, { pitchEnvDepth: 12, pitchEnvTime: 100 }), cuts);
      assert(effected.length === 4 * 44100 && effected.numberOfChannels === 2, 'FM chops lost exact loop length or stereo output');
      assert(peak(effected) > 0.01 && peak(effected) <= 0.950001, 'FM chops became silent, non-finite or clipped');
      assert(maximumDifference(dry, effected) > 0.001, 'Key correction and pitch envelope did not reach FM material');
      var wav = new DataView(await engine.encodeWav(effected).arrayBuffer());
      assert(wav.byteLength === 44 + effected.length * 4 && wav.getUint32(24, true) === 44100, 'FM WAV has an incorrect format or frame count');
      var pcm = effected.getChannelData(0);
      var frame = pcm.findIndex(function (sample) { return Math.abs(sample) > 0.01; });
      assert(frame >= 0 && wav.getInt16(44 + frame * 4, true) === Math.round(pcm[frame] * (pcm[frame] < 0 ? 32768 : 32767)), 'FM WAV differs from the rendered chops');
      lane.keyShift = 0;
      var restored = await engine.render([lane], config, cuts);
      assert(maximumDifference(dry, restored) === 0, 'Returning FM controls to their original state changed the phrase');
      assert(source.buffer.getChannelData(0).every(function (sample, index) { return sample === original[index]; }), 'Chopping or effects changed original FM PCM');
      assert(JSON.stringify(source.phrase) === originalPhrase && JSON.stringify(cuts) === originalCuts, 'Rendering changed synthesized notes or generated cuts');
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

    function envelopeFixture(direction, overrides) {
      assert(global.BlueLoopPitchEnvelope, 'Load pitch-envelope.js to verify the renderer integration');
      var config = Object.assign({ bpm: 120, bars: 1, chop: 1, pitchEnvDepth: 12, pitchEnvTime: 180 }, overrides);
      var buffer = engine.context.createBuffer(1, 44100, 44100);
      var samples = buffer.getChannelData(0);
      for (var frame = 0; frame < samples.length; frame++) samples[frame] = Math.sin(2 * Math.PI * 440 * frame / 44100) * 0.25;
      for (var candidate = 0; candidate < 100; candidate++) {
        var lane = { id: 'envelope-' + candidate, buffer: buffer, volume: 1, locked: true };
        var event = { laneId: lane.id, step: 0, sliceIndex: 0, durationSteps: 4, velocity: 1 };
        if (Math.sign(global.BlueLoopAudio.eventPlayback(lane, event, config).envelope.depth) === direction) {
          return { lane: lane, event: event, settings: config };
        }
      }
      throw new Error('Could not find the requested deterministic envelope direction');
    }

    await test('Pitch envelope starts above or below the source and returns to its original pitch', async function () {
      for (var sign of [-1, 1]) {
        var fixture = envelopeFixture(sign);
        var output = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
        var early = toneFrequency(output, 0.015, 0.05);
        var settled = toneFrequency(output, 0.25, 0.4);
        assert(sign < 0 ? early < 330 : early > 650, 'Envelope did not bend in the requested direction: ' + early);
        assert(Math.abs(settled - 440) < 0.1, 'Envelope did not return to the source pitch: ' + settled);
      }
    });
    await test('Pitch envelope returns to the combined key correction and octave pitch', async function () {
      var fixture = envelopeFixture(1);
      fixture.lane.keyShift = 5;
      fixture.event.semitones = -12;
      var output = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
      var baseFrequency = 440 * Math.pow(2, -7 / 12);
      var settled = toneFrequency(output, 0.25, 0.4);
      assert(Math.abs(settled - baseFrequency) < 0.1, 'Envelope replaced key or octave correction');
      assert(toneFrequency(output, 0.015, 0.05) > baseFrequency * 1.45, 'Envelope did not add its pitch to key and octave');
    });
    await test('Each slice restarts its envelope with a deterministic direction', async function () {
      var fixture = envelopeFixture(1);
      var events = [fixture.event, Object.assign({}, fixture.event, { step: 4 })];
      var first = await engine.render([fixture.lane], fixture.settings, events);
      var repeated = await engine.render([fixture.lane], fixture.settings, events);
      assert(maximumDifference(first, repeated) === 0, 'Repeated envelope render produced different PCM');
      events.forEach(function (event) {
        var playback = global.BlueLoopAudio.eventPlayback(fixture.lane, event, fixture.settings);
        var early = toneFrequency(first, playback.start + 0.015, playback.start + 0.05);
        var settled = toneFrequency(first, playback.start + 0.25, playback.start + 0.4);
        assert(playback.envelope.depth < 0 ? early < 330 : early > 650, 'A slice inherited the previous envelope state');
        assert(Math.abs(settled - 440) < 0.1, 'A slice did not settle to its base pitch');
      });
    });
    await test('Pitch envelope can be disabled without changing locked events or original PCM', async function () {
      var fixture = envelopeFixture(-1);
      fixture.event.reverse = true;
      fixture.event.semitones = 12;
      fixture.lane.keyShift = -3;
      Object.freeze(fixture.event);
      var beforeEvent = JSON.stringify(fixture.event);
      var beforePCM = fixture.lane.buffer.getChannelData(0).slice();
      var offSettings = Object.assign({}, fixture.settings);
      delete offSettings.pitchEnvDepth;
      delete offSettings.pitchEnvTime;
      var before = await engine.render([fixture.lane], offSettings, [fixture.event]);
      var enabled = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
      assert(maximumDifference(before, enabled) > 0.05, 'Envelope did not affect a locked event');
      for (var time of [5, 500]) {
        var restored = await engine.render([fixture.lane], Object.assign({}, fixture.settings, { pitchEnvDepth: 0, pitchEnvTime: time }), [fixture.event]);
        assert(maximumDifference(before, restored) === 0, 'Disabling the envelope did not restore identical PCM');
      }
      assert(JSON.stringify(fixture.event) === beforeEvent, 'Envelope changed source event metadata');
      assert(fixture.lane.buffer.getChannelData(0).every(function (sample, index) { return sample === beforePCM[index]; }), 'Envelope changed the original source PCM');
    });
    await test('GLITCH rewrites the non-drum mix and leaves drums untouched', async function () {
      assert(global.BlueLoopGlitch, 'Load glitch.js to verify the renderer integration');
      function source(shape) {
        var buffer = engine.context.createBuffer(1, 4 * 44100, 44100);
        var data = buffer.getChannelData(0);
        for (var frame = 0; frame < data.length; frame++) data[frame] = shape(frame);
        return buffer;
      }
      var melody = { id: 'keys', category: 'other', buffer: source(function (frame) { return Math.sin(frame / 23) * 0.2; }), volume: 1 };
      var drums = { id: 'kit', category: 'drums', buffer: source(function (frame) { return Math.sin(frame / 7) * Math.exp(-(frame % 5512) / 900) * 0.2; }), volume: 1 };
      var events = [
        { laneId: 'keys', step: 0, sliceIndex: 0, durationSteps: 32, velocity: 1 },
        { laneId: 'kit', step: 0, sliceIndex: 0, durationSteps: 32, velocity: 1 }
      ];
      var dry = { bpm: 120, bars: 2, chop: 1, phraseSeed: 'GLITCH' };
      var wet = Object.assign({ glitchAmount: 100, glitchSize: 50 }, dry);
      var regions = global.BlueLoopGlitch.plan(wet, 'GLITCH').regions;
      assert(regions.length > 2, 'The test plan has no edits');
      var drumsDry = await engine.render([drums], dry, [events[1]]);
      var drumsWet = await engine.render([drums], wet, [events[1]]);
      assert(maximumDifference(drumsDry, drumsWet) === 0, 'GLITCH changed a drum lane');
      var melodyDry = await engine.render([melody], dry, [events[0]]);
      var melodyWet = await engine.render([melody], wet, [events[0]]);
      var inside = new Uint8Array(melodyDry.length);
      regions.forEach(function (region) {
        var from = Math.round(region.step * 0.125 * 44100);
        var to = Math.min(inside.length, Math.round((region.step + region.steps) * 0.125 * 44100) + 70);
        for (var frame = from; frame < to; frame++) inside[frame] = 1;
      });
      var outsideSame = true;
      var insideDiffer = 0;
      for (var frame = 0; frame < inside.length; frame++) {
        var difference = Math.abs(melodyDry.getChannelData(0)[frame] - melodyWet.getChannelData(0)[frame]);
        if (!inside[frame] && difference > 0) outsideSame = false;
        if (inside[frame] && difference > 1e-3) insideDiffer += 1;
      }
      assert(outsideSame && insideDiffer > 1000, 'GLITCH must change the non-drum mix only inside its regions');
      var both = await engine.render([melody, drums], wet, events);
      var mixed = 0;
      for (var sample = 0; sample < both.length; sample += 3) {
        mixed = Math.max(mixed, Math.abs(both.getChannelData(0)[sample] - drumsWet.getChannelData(0)[sample] - melodyWet.getChannelData(0)[sample]));
      }
      assert(mixed < 1e-5, 'The full mix must equal the untouched drums plus the glitched parts: ' + mixed);
    });
    await test('Pure-tone lanes release cut notes over their release time', async function () {
      var buffer = engine.context.createBuffer(1, 44100, 44100);
      buffer.getChannelData(0).fill(0.5);
      var settings = { bpm: 120, bars: 1, chop: 1 };
      var event = { laneId: 'tone', step: 0, sliceIndex: 0, durationSteps: 2, velocity: 1 };
      var plain = await engine.render([{ id: 'tone', buffer: buffer, volume: 1 }], settings, [event]);
      var soft = await engine.render([{ id: 'tone', buffer: buffer, volume: 1, releaseSeconds: 0.03 }], settings, [event]);
      var capped = await engine.render([{ id: 'tone', buffer: buffer, volume: 1, releaseSeconds: 4 }], settings, [event]);
      var end = Math.round(0.25 * 44100);
      function before(output, seconds) { return output.getChannelData(0)[end - Math.round(seconds * 44100)]; }
      assert(Math.abs(before(plain, 0.015) - 0.4) < 1e-3 && Math.abs(before(soft, 0.015) - 0.2) < 0.005, 'A 30 ms release did not halve the level 15 ms before the cut');
      assert(Math.abs(before(soft, 0.024) - 0.4 * 0.8) < 0.005 && before(soft, 0.001) < 0.02, 'The release did not ramp linearly to silence at the cut');
      assert(Math.abs(before(capped, 0.025) - 0.2) < 0.005, 'Release times longer than 50 ms were not capped');
      var whole = { laneId: 'tone', step: 0, sliceIndex: 0, startRatio: 0, lengthRatio: 0.2, durationSteps: 4, velocity: 1 };
      var shortFade = await engine.render([{ id: 'tone', buffer: buffer, volume: 1 }], settings, [whole]);
      var keptFade = await engine.render([{ id: 'tone', buffer: buffer, volume: 1, releaseSeconds: 0.03 }], settings, [whole]);
      assert(maximumDifference(shortFade, keptFade) === 0, 'A cut that plays to its end must keep the short fade');
      var untouched = Math.round((0.25 - 0.06) * 44100);
      var a = plain.getChannelData(0);
      var b = soft.getChannelData(0);
      for (var frame = 0; frame < untouched; frame++) assert(a[frame] === b[frame], 'A release changed the attack or sustain');
    });
    await test('Per-part envelope chance switches a lane without touching other lanes', async function () {
      var fixture = envelopeFixture(1);
      var plain = Object.assign({}, fixture.settings, { pitchEnvDepth: 0 });
      var off = Object.assign({}, fixture.lane, { pitchEnvChance: 0 });
      var full = Object.assign({}, fixture.lane, { pitchEnvChance: 100 });
      var reference = await engine.render([fixture.lane], plain, [fixture.event]);
      var silenced = await engine.render([off], fixture.settings, [fixture.event]);
      assert(maximumDifference(reference, silenced) === 0, 'A part at 0% still received the pitch envelope');
      var everything = await engine.render([full], fixture.settings, [fixture.event]);
      var unspecified = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
      assert(maximumDifference(everything, unspecified) === 0 && maximumDifference(everything, reference) > 0.05, 'A missing part chance must behave as 100%');
      var other = Object.assign({}, fixture.lane, { id: fixture.lane.id + '-other' });
      var otherEvent = Object.assign({}, fixture.event, { laneId: other.id });
      assert(!global.BlueLoopAudio.eventPlayback(off, fixture.event, fixture.settings).envelope.enabled &&
        global.BlueLoopAudio.eventPlayback(other, otherEvent, fixture.settings).envelope.enabled, 'Part chance leaked into another lane');
      var spread = Object.assign({}, fixture.settings, { pitchEnvDepthRandom: 100, pitchEnvTimeRandom: 100 });
      var first = await engine.render([full], spread, [fixture.event]);
      var second = await engine.render([full], spread, [fixture.event]);
      var playback = global.BlueLoopAudio.eventPlayback(full, fixture.event, spread);
      assert(maximumDifference(first, second) === 0 && Math.abs(playback.envelope.depth) <= 12 && playback.duration === Math.min(playback.envelope.durationFor(playback.sliceSeconds), 4 * 60 / 120 / 4),
        'Randomized depth and time must render deterministically and share the playback duration');
    });
    await test('A lengthened bend settles within the first note of an FM run', async function () {
      var source = engine.createFMSource({ bpm: 120, bars: 2, tonic: 0, octave: 4, density: 90, seed: 'BEND-RUN' });
      var lane = Object.assign({ id: 'fm-bend', kind: 'fm', category: 'other', buffer: source.buffer, volume: 1, keyShift: 0, releaseSeconds: 0.03, pitchEnvChance: 100 },
        global.BlueLoopFMSynth.noteSegments(source.phrase));
      var config = Object.assign({}, global.BlueLoopGenerator.defaults, { bpm: 120, bars: 2, density: 100, breaks: 0, size: 100, pitchEnvDepth: 12, pitchEnvTime: 80, pitchEnvTimeRandom: 100 });
      var runs = global.BlueLoopGenerator.generate([lane], config, 'BEND-RUN').filter(function (event) { return event.segmentCount > 1; });
      assert(runs.length > 2, 'The fixture has no runs of several notes');
      assert(runs.every(function (event) {
        var playback = global.BlueLoopAudio.eventPlayback(lane, event, config);
        var first = lane.segments[event.sliceIndex];
        return playback.envelope.decaySeconds <= Math.max(0.08, 0.7 * first.steps * 0.125) + 1e-9;
      }), 'A lengthened bend ran into the next note of a run');
    });
    await test('Landing accents raise the level without changing the stored velocity', async function () {
      var buffer = engine.context.createBuffer(1, 44100, 44100);
      buffer.getChannelData(0).fill(0.5);
      var lane = { id: 'accent', buffer: buffer, volume: 1 };
      var plain = await engine.render([lane], { bpm: 120, bars: 1, chop: 1 }, [{ laneId: 'accent', step: 0, sliceIndex: 0, durationSteps: 4, velocity: 0.8 }]);
      var accented = await engine.render([lane], { bpm: 120, bars: 1, chop: 1 }, [{ laneId: 'accent', step: 0, sliceIndex: 0, durationSteps: 4, velocity: 0.8, accent: true }]);
      var middle = Math.round(0.25 * 44100);
      assert(Math.abs(accented.getChannelData(0)[middle] / plain.getChannelData(0)[middle] - 1.12) < 1e-4, 'The landing accent did not raise the level by 12%');
    });
    await test('Swung forward and reverse audio follows the shared envelope source-position helper', async function () {
      var fixture = envelopeFixture(1, { swing: 50, pitchEnvTime: 83 });
      var data = fixture.lane.buffer.getChannelData(0);
      for (var frame = 0; frame < data.length; frame++) data[frame] = frame / data.length * 0.25;
      fixture.event.step = 1;
      fixture.event.startRatio = 0.25;
      fixture.event.sourceChop = 2;
      for (var reverse of [false, true]) {
        fixture.event.reverse = reverse;
        var playback = global.BlueLoopAudio.eventPlayback(fixture.lane, fixture.event, fixture.settings);
        var output = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
        var samples = output.getChannelData(0);
        var largestError = 0;
        for (var sample = Math.ceil((playback.start + 0.01) * 44100); sample < (playback.start + playback.duration - 0.01) * 44100; sample += 37) {
          var consumed = playback.sourceSecondsAt(sample / 44100 - playback.start);
          var position = reverse ? playback.offset + playback.sliceSeconds - 1 / 44100 - consumed : playback.offset + consumed;
          largestError = Math.max(largestError, Math.abs(samples[sample] - position * 0.25 * 0.8));
        }
        assert(largestError < 0.0001, 'Timeline source position disagrees with rendered PCM: ' + largestError);
      }
    });
    await test('Envelope resampling never reads adjacent slices in either direction', async function () {
      for (var sign of [-1, 1]) {
        var fixture = envelopeFixture(sign, { chop: 4, pitchEnvDepth: 24, pitchEnvTime: 5 });
        var data = fixture.lane.buffer.getChannelData(0);
        data.fill(0.8);
        data.fill(0, 11025, 22050);
        fixture.event.sliceIndex = 1;
        for (var reverse of [false, true]) {
          fixture.event.reverse = reverse;
          var output = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
          assert(peak(output) === 0, 'Adjacent source marker leaked into a silent selected slice');
        }
      }
    });
    await test('Very short enveloped slices finish their fade within the selected audio', async function () {
      for (var sign of [-1, 1]) {
        var fixture = envelopeFixture(sign, { chop: 128, pitchEnvDepth: 24, pitchEnvTime: 5 });
        fixture.lane.buffer = engine.context.createBuffer(1, 11264, 44100);
        fixture.lane.buffer.getChannelData(0).fill(0.2);
        var playback = global.BlueLoopAudio.eventPlayback(fixture.lane, fixture.event, fixture.settings);
        var output = await engine.render([fixture.lane], fixture.settings, [fixture.event]);
        assert(peak(output) > 0 && peak(output) <= 0.160001, 'Short slice is silent, non-finite or amplified');
        var samples = output.getChannelData(0);
        var finish = Math.ceil(playback.duration * 44100);
        assert(Math.abs(samples[finish - 1]) < 0.06, 'Short slice stopped before completing its fade');
        assert(samples.subarray(finish + 1).every(function (value) { return value === 0; }), 'Short slice exceeded its calculated duration');
      }
    });
    await test('Envelope changes preserve voice selection, exact musical length and exported PCM', async function () {
      var config = Object.assign({}, settings, { maxVoices: 1, maxDrumVoices: 1, pitchEnvDepth: 24, pitchEnvTime: 500 });
      var beforeEvents = JSON.stringify(events);
      var selected = global.BlueLoopPlayback.plan(lanes, config, events);
      var output = await engine.render(lanes, config, events);
      var withoutCaps = Object.assign({}, config);
      delete withoutCaps.maxVoices;
      delete withoutCaps.maxDrumVoices;
      var explicitSelection = await engine.render(lanes, withoutCaps, selected);
      assert(maximumDifference(output, explicitSelection) === 0, 'Envelope affected voice allocation');
      assert(output.length === rendered.length && output.sampleRate === 44100, 'Envelope changed musical loop length or sample rate');
      assert(peak(output) > 0 && peak(output) <= 0.950001, 'Envelope produced silent or clipped output');
      var wav = new DataView(await engine.encodeWav(output).arrayBuffer());
      assert(wav.byteLength === 44 + output.length * 4, 'Envelope export changed WAV length');
      var samples = output.getChannelData(0);
      var frame = samples.findIndex(function (sample) { return Math.abs(sample) > 0.02; });
      assert(wav.getInt16(44 + frame * 4, true) === Math.round(samples[frame] * (samples[frame] < 0 ? 32768 : 32767)), 'Envelope export differs from rendered playback');
      assert(JSON.stringify(events) === beforeEvents, 'Envelope changed generated events');
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
    // Exercise the decoded-duration boundary without allocating two minutes of PCM.
    async function importDecodedFrames(frames) {
      var importer = new global.BlueLoopAudio.Engine();
      var decoded = {
        length: frames, sampleRate: 44100, numberOfChannels: 1,
        duration: frames / 44100,
        getChannelData: function () { throw new Error('Import validation must not read PCM'); }
      };
      importer._ensureContext = function () {
        return { decodeAudioData: function () { return Promise.resolve(decoded); } };
      };
      var imported = await importer.decodeFile({
        size: 1, arrayBuffer: function () { return Promise.resolve(new ArrayBuffer(1)); }
      });
      assert(imported === decoded, 'The decoded buffer was replaced during import');
      return imported;
    }
    await test('Imports accept audio exactly 120 seconds long', async function () {
      var imported = await importDecodedFrames(120 * 44100);
      assert(imported.duration === 120, 'The 120-second boundary was not accepted intact');
    });
    await test('Imports reject audio one sample longer than 120 seconds', async function () {
      var rejected = false;
      try {
        await importDecodedFrames(120 * 44100 + 1);
      } catch (error) { rejected = /120 秒以下/.test(error.message); }
      assert(rejected, 'Audio exceeding 120 seconds did not receive the correct duration error');
    });
    await test('Oversized imports are rejected before reading file data', async function () {
      var rejected = false;
      try {
        await engine.decodeFile({ size: 40 * 1024 * 1024 + 1, arrayBuffer: function () { throw new Error('File should not be read'); } });
      } catch (error) { rejected = /40 MB/.test(error.message); }
      assert(rejected, 'Oversized file did not receive a clear size error');
    });
    await test('Preview keeps the four-second source default and supports a complete synthesized phrase', async function () {
      var originalInit = engine.init;
      var createSource = engine.context.createBufferSource;
      var scheduled = [];
      engine.init = function () { return Promise.resolve(engine.context); };
      engine.context.createBufferSource = function () {
        var source = createSource.call(engine.context);
        var start = source.start;
        source.start = function (when, offset, duration) {
          scheduled.push(duration);
          start.call(source, when, offset, duration);
        };
        return source;
      };
      try {
        await engine.playPreview(lanes[0].buffer);
        engine.stop();
        await engine.playPreview(lanes[0].buffer, lanes[0].buffer.duration);
        engine.stop();
        await engine.playPreview(lanes[0].buffer, lanes[0].buffer.duration + 10);
        assert(scheduled[0] === 4, 'Ordinary source previews no longer stop at four seconds');
        assert(scheduled[1] === lanes[0].buffer.duration, 'An explicit full-phrase preview was truncated');
        assert(scheduled[2] === lanes[0].buffer.duration, 'Preview scheduled beyond the available source audio');
      } finally {
        engine.init = originalInit;
        engine.context.createBufferSource = createSource;
        engine.stop();
      }
    });
    await test('Stopping while preview initialization is pending prevents deleted audio from starting later', async function () {
      var originalInit = engine.init;
      var resume;
      engine.init = function () { return new Promise(function (resolve) { resume = resolve; }); };
      try {
        var pending = engine.playPreview(lanes[0].buffer);
        engine.stop();
        resume(engine.context);
        var source = await pending;
        assert(!source && !engine._preview && !engine.isPlaying, 'A cancelled preview started after stop');
      } finally {
        engine.init = originalInit;
        engine.stop();
      }
    });
    await test('A delayed preview cannot interrupt a newer loop playback', async function () {
      var originalInit = engine.init;
      var resume;
      engine.init = function () { return new Promise(function (resolve) { resume = resolve; }); };
      try {
        var pending = engine.playPreview(lanes[0].buffer);
        engine.init = function () { return Promise.resolve(engine.context); };
        var current = await engine.play(rendered);
        resume(engine.context);
        var stale = await pending;
        assert(current && !stale && engine.source === current && !engine._preview, 'An older preview interrupted or overlapped the newer loop');
      } finally {
        engine.init = originalInit;
        engine.stop();
      }
    });
    await test('A delayed preview cannot replace a newer sample preview', async function () {
      var originalInit = engine.init;
      var resume;
      engine.init = function () { return new Promise(function (resolve) { resume = resolve; }); };
      try {
        var pending = engine.playPreview(lanes[0].buffer);
        engine.init = function () { return Promise.resolve(engine.context); };
        var current = await engine.playPreview(lanes[1].buffer);
        resume(engine.context);
        var stale = await pending;
        assert(current && !stale && engine._preview === current, 'An older sample preview replaced the latest selection');
        engine.stop();
        assert(!engine._preview, 'Stopping failed to release the active preview');
      } finally {
        engine.init = originalInit;
        engine.stop();
      }
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
