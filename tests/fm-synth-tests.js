(function (root) {
  'use strict';

  root.runFMSynthTests = function () {
    const synth = root.BlueLoopFMSynth;
    if (!synth) throw new Error('Load js/fm-synth.js before fm-synth-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('FM synthesis test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    function near(first, second, tolerance) {
      return Math.abs(first - second) < (tolerance == null ? 1e-8 : tolerance);
    }
    const Constructor = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    const context = new Constructor(1, 1, 44100);
    const defaults = synth.normalize();
    assert(defaults.bpm === 120 && defaults.bars === 4 && defaults.tonic === 0 && defaults.octave === 2 && defaults.density === 60 && defaults.index === 0 && defaults.ratio === 2 && defaults.decay === 300 && defaults.seed === 'FM-001', 'Default settings specify a pure C2 sine phrase');
    const invalid = synth.normalize({ bpm: NaN, bars: Infinity, tonic: NaN, octave: NaN, density: NaN, index: Infinity, ratio: NaN, decay: NaN, seed: ' ' });
    assert(JSON.stringify(invalid) === JSON.stringify(defaults), 'Nonfinite controls and empty seed recover sensible defaults');
    const low = synth.normalize({ bpm: -4, bars: -1, tonic: -5, octave: 0, density: -1, index: -10, ratio: -1, decay: -4 });
    const high = synth.normalize({ bpm: 900, bars: 100, tonic: 90, octave: 10, density: 900, index: 900, ratio: 20, decay: 9000 });
    assert(low.bpm === 40 && low.bars === 2 && low.tonic === 0 && low.octave === 1 && low.density === 0 && low.index === 0 && low.ratio === 1 && low.decay === 40, 'Lower bounds prevent invalid pitches, times and FM amounts');
    assert(high.bpm === 200 && high.bars === 8 && high.tonic === 11 && high.octave === 5 && high.density === 100 && high.index === 8 && high.ratio === 4 && high.decay === 1200, 'Upper bounds keep buffer sizes and synthesis work bounded');
    assert(synth.normalize({ bpm: '137', tonic: '9', octave: '3', ratio: '4', bars: '8' }).bpm === 137 && synth.normalize({ seed: 'X'.repeat(500) }).seed.length === 256, 'Form values are accepted and unusually long seeds are bounded');

    const options = Object.freeze({ seed: 'FM-test', bpm: 137, bars: 8, tonic: 9, octave: 2, density: 60 });
    const before = JSON.stringify(options);
    const phrase = synth.phrase(options);
    assert(JSON.stringify(phrase) === JSON.stringify(synth.phrase(options)) && JSON.stringify(options) === before, 'Seeded phrase generation is deterministic and leaves input untouched');
    assert(near(phrase.duration, 8 * 4 * 60 / 137), 'Phrase duration follows the selected BPM and bars');
    assert(phrase.notes[0].start === 0 && phrase.notes[0].midi === 45, 'The opening note names the selected tonic and octave');
    const stepSeconds = 60 / 137 / 4;
    const major = [0, 2, 4, 5, 7, 9, 11];
    assert(phrase.notes.every(function (note, index) {
      const next = phrase.notes[index + 1];
      return Number.isInteger(note.midi) && major.includes((note.midi - 45) % 12) && note.duration > 0 && note.velocity > 0 && note.velocity <= 1 &&
        near(note.start / stepSeconds, Math.round(note.start / stepSeconds)) && near(note.duration / stepSeconds, Math.round(note.duration / stepSeconds)) &&
        note.start + note.duration <= phrase.duration + 1e-8 && (!next || note.start + note.duration <= next.start + 1e-8);
    }), 'All notes belong to the major scale, fit the sixteenth grid and never overlap');
    const call = phrase.notes.filter(function (note) { return note.start < 16 * stepSeconds; });
    assert([1, 2, 3].every(function (cycle) {
      const offset = cycle * 32 * stepSeconds;
      const repeated = phrase.notes.filter(function (note) { return note.start >= offset - 1e-8 && note.start < offset + 16 * stepSeconds - 1e-8; });
      return call.length === repeated.length && repeated.every(function (note, index) {
        return near(note.start - offset, call[index].start) && note.midi === call[index].midi && near(note.duration, call[index].duration);
      });
    }), 'Repeated two-bar phrases preserve their opening motif');
    assert(JSON.stringify(phrase.notes) === JSON.stringify(synth.phrase(Object.assign({}, options, { index: 8, ratio: 4, decay: 1000 })).notes), 'Timbre controls preserve the musical phrase');
    const faster = synth.phrase(Object.assign({}, options, { bpm: 200 }));
    assert(faster.notes.every(function (note, index) {
      return note.midi === phrase.notes[index].midi && near(note.start * 200, phrase.notes[index].start * 137) && near(note.duration * 200, phrase.notes[index].duration * 137);
    }), 'Tempo changes preserve melody and rhythm while scaling note timing');
    const transposed = synth.phrase(Object.assign({}, options, { tonic: 2, octave: 3 }));
    assert(transposed.notes.every(function (note, index) { return note.midi === phrase.notes[index].midi + 5 && note.start === phrase.notes[index].start; }), 'Key and register controls transpose the whole major phrase');
    const cutPoints = synth.noteSegments(phrase);
    assert(cutPoints.segmentsDuration === phrase.duration && cutPoints.segments.length === phrase.notes.length && cutPoints.segments.every(function (segment, index) {
      const note = phrase.notes[index];
      return segment.start === note.start && near(segment.end, note.start + note.duration) && segment.step === note.step && segment.midi === note.midi && segment.degree === note.degree &&
        Number.isInteger(note.step) && near(note.start, note.step * stepSeconds) && near(note.duration, note.steps * stepSeconds) && note.midi === 45 + synth.semitonesOf(note.degree) && segment.chord === note.chord;
    }), 'Note segments expose every note boundary, grid step and scale degree');
    assert(synth.noteSegments(null).segments.length === 0 && synth.noteSegments({ duration: 0, notes: [] }).segmentsDuration === 0, 'Missing phrases produce no note segments');
    assert(defaults.progression === 'I' && synth.normalize({ progression: 'nope' }).progression === 'I' && synth.normalize({ progression: 'vi-IV-V-I' }).progression === 'vi-IV-V-I' &&
      Object.keys(synth.progressions).join(',') === 'I,I-IV,I-V,vi-IV,IV-V-iii-vi,vi-IV-V-I', 'Progressions default to one chord and accept the listed presets');
    const triad = function (degree, root) { return [0, 2, 4].includes((((degree - root) % 7) + 7) % 7); };
    let strongNotes = 0;
    let leaps = 0;
    let moves = 0;
    Object.keys(synth.progressions).forEach(function (name) {
      const roots = synth.progressions[name];
      for (let seed = 0; seed < 12; seed++) {
        [4, 8].forEach(function (bars) {
          const chordPhrase = synth.phrase({ seed: 'CHORD-' + seed, bars, density: 75, progression: name, tonic: 9, octave: 2 });
          assert(JSON.stringify(chordPhrase.chords) === JSON.stringify(Array.from({ length: bars }, function (_, bar) { return roots[bar % roots.length]; })) &&
            chordPhrase.notes.every(function (note) { return note.chord === chordPhrase.chords[Math.floor(note.step / 16)]; }), 'Each bar carries its chord: ' + name + ' / ' + seed);
          assert(chordPhrase.notes.every(function (note) {
            return note.degree >= 0 && note.degree <= 9 && note.midi === 45 + synth.semitonesOf(note.degree) && (note.step % 4 || triad(note.degree, note.chord));
          }), 'Notes on the beat are chord tones and every note stays in the major scale: ' + name + ' / ' + seed);
          assert(chordPhrase.notes[0].step === 0 && chordPhrase.notes[0].degree === roots[0], 'The phrase opens on the first chord root: ' + name + ' / ' + seed);
          chordPhrase.notes.forEach(function (note, index) {
            if (note.step % 4 === 0) strongNotes += 1;
            const next = chordPhrase.notes[index + 1];
            if (next && Math.floor(next.step / 16) === Math.floor(note.step / 16)) {
              moves += 1;
              if (Math.abs(next.degree - note.degree) > 4) leaps += 1;
            }
          });
        });
      }
    });
    assert(strongNotes > 500 && leaps / moves < 0.08, 'Lines move mostly by steps and small skips within a bar: ' + (leaps / moves).toFixed(3));
    const lowLine = synth.phrase({ seed: 'SHARED', octave: 2, progression: 'vi-IV-V-I', bars: 8 });
    const highLine = synth.phrase({ seed: 'OTHER', octave: 4, progression: 'vi-IV-V-I', bars: 8 });
    assert(JSON.stringify(lowLine.chords) === JSON.stringify(highLine.chords) && [lowLine, highLine].every(function (line) {
      return line.notes.filter(function (note) { return note.step % 16 === 0; }).every(function (note) { return triad(note.degree, line.chords[note.step / 16]); });
    }), 'Bass and upper FM phrases on the same progression share each bar\'s chord');
    const defaultLine = synth.phrase(options);
    assert(defaultLine.notes.filter(function (note) { return note.step % 4 === 0; }).every(function (note) { return triad(note.degree, 0); }), 'One-chord phrases put tonic chord tones on every beat');

    const signatures = new Set();
    for (let seed = 0; seed < 24; seed++) {
      const sparse = synth.phrase({ seed, bars: 8, density: 0 });
      const full = synth.phrase({ seed, bars: 8, density: 100 });
      assert(sparse.notes.length === 8 && sparse.notes.every(function (note, index) { return note.start === index * 2; }), 'Zero density keeps one audible downbeat per bar for seed ' + seed);
      assert(full.notes.length > sparse.notes.length && full.notes.every(function (note, index) {
        return note.duration > 0 && (!full.notes[index + 1] || note.start + note.duration <= full.notes[index + 1].start + 1e-8);
      }), 'Dense phrases still remain monophonic for seed ' + seed);
      signatures.add(JSON.stringify(full.notes));
    }
    assert(signatures.size === 24, 'Reseeding produces different phrases across independent seeds');

    function statistics(buffer) {
      const data = buffer.getChannelData(0);
      let peak = 0;
      let squares = 0;
      let sum = 0;
      for (let frame = 0; frame < data.length; frame++) {
        if (!Number.isFinite(data[frame])) return { finite: false };
        peak = Math.max(peak, Math.abs(data[frame]));
        squares += data[frame] * data[frame];
        sum += data[frame];
      }
      return { finite: true, peak, rms: Math.sqrt(squares / data.length), mean: sum / data.length };
    }
    function equalPCM(first, second) {
      const a = first.getChannelData(0);
      const b = second.getChannelData(0);
      return a.length === b.length && a.every(function (sample, index) { return sample === b[index]; });
    }
    const rendered = synth.synthesize(context, { seed: 'PCM', bars: 2, bpm: 137 });
    const pcm = rendered.buffer.getChannelData(0);
    const stats = statistics(rendered.buffer);
    assert(rendered.buffer.numberOfChannels === 1 && rendered.buffer.sampleRate === 44100 && rendered.buffer.length === Math.round(8 * 60 / 137 * 44100), 'PCM is mono 44.1 kHz and exactly the musical length rounded to one frame');
    assert(stats.finite && stats.peak > 0.1 && stats.peak < 0.8 && stats.rms > 0.01 && Math.abs(stats.mean) < 0.01, 'Generated FM PCM is audible, finite, unclipped and has negligible DC');
    assert(equalPCM(rendered.buffer, synth.synthesize(context, { seed: 'PCM', bars: 2, bpm: 137 }).buffer), 'Rendering the same settings produces bit-identical PCM');
    assert(!equalPCM(rendered.buffer, synth.synthesize(context, { seed: 'PCM-other', bars: 2, bpm: 137 }).buffer), 'Reseeding changes the rendered audio');
    assert(rendered.phrase.notes.every(function (note) {
      const first = Math.round(note.start * 44100);
      const last = Math.min(pcm.length, Math.round((note.start + note.duration) * 44100)) - 1;
      return pcm[first] === 0 && pcm[last] === 0 && Math.abs(pcm[first + 1]) < 0.001 && Math.abs(pcm[last - 1]) < 0.001;
    }) && pcm[0] === 0 && pcm[pcm.length - 1] === 0, 'Each attack, release and buffer boundary reaches silence without a discontinuity');

    const pureOptions = { seed: 'spectrum', bars: 2, bpm: 40, tonic: 9, octave: 3, density: 0, index: 0, ratio: 2, decay: 1200 };
    const pure = synth.synthesize(context, pureOptions);
    const bright = synth.synthesize(context, Object.assign({}, pureOptions, { index: 3 }));
    const signal = pure.buffer.getChannelData(0);
    const end = Math.min(0.25, pure.phrase.notes[0].duration - 0.02);
    const crossings = [];
    for (let frame = Math.ceil(0.02 * 44100); frame < end * 44100; frame++) {
      if (signal[frame - 1] <= 0 && signal[frame] > 0) crossings.push(frame - 1 - signal[frame - 1] / (signal[frame] - signal[frame - 1]));
    }
    const frequency = (crossings.length - 1) * 44100 / (crossings[crossings.length - 1] - crossings[0]);
    assert(crossings.length > 5 && near(frequency, 220, 0.002), 'With FM off the carrier retains the exact A3 fundamental');
    function powerAt(buffer, frequency) {
      const data = buffer.getChannelData(0);
      const first = Math.ceil(0.015 * 44100);
      const last = Math.floor(end * 44100);
      let sine = 0;
      let cosine = 0;
      for (let frame = first; frame < last; frame++) {
        const window = 0.5 - 0.5 * Math.cos(TAU * (frame - first) / (last - first - 1));
        const phase = TAU * frequency * frame / 44100;
        sine += data[frame] * window * Math.sin(phase);
        cosine += data[frame] * window * Math.cos(phase);
      }
      return sine * sine + cosine * cosine;
    }
    const TAU = Math.PI * 2;
    assert(powerAt(pure.buffer, 660) / powerAt(pure.buffer, 220) < 1e-6, 'FM index zero produces a sine without an added third harmonic');
    const plain = Object.assign({}, pureOptions);
    delete plain.index;
    assert(equalPCM(pure.buffer, synth.synthesize(context, plain).buffer), 'Without an FM amount the default renders the same pure sine');
    assert(powerAt(bright.buffer, 660) > powerAt(pure.buffer, 220) * 0.01, 'FM adds audible harmonic energy to the sine carrier');
    assert(equalPCM(pure.buffer, synth.synthesize(context, Object.assign({}, pureOptions, { ratio: 4 })).buffer), 'Ratio has no effect while FM depth is zero');
    const short = synth.synthesize(context, Object.assign({}, pureOptions, { decay: 40 }));
    assert(statistics(short.buffer).rms < statistics(pure.buffer).rms * 0.5, 'Short decay reduces sustained note energy');
    assert(!equalPCM(bright.buffer, synth.synthesize(context, Object.assign({}, pureOptions, { index: 3, ratio: 1 })).buffer), 'Changing the modulator ratio changes the synthesized timbre');

    let highSeed = 0;
    while (highSeed < 64 && !synth.phrase({ seed: highSeed, bars: 2, octave: 5, tonic: 11, density: 100 }).notes.some(function (note) { return note.midi >= 95; })) highSeed += 1;
    const highOptions = { seed: highSeed, bars: 2, octave: 5, tonic: 11, density: 100, ratio: 4, index: 8 };
    const highFM = synth.synthesize(context, highOptions);
    const highSine = synth.synthesize(context, Object.assign({}, highOptions, { index: 0 }));
    const highest = highFM.phrase.notes.reduce(function (top, note) { return !top || note.midi > top.midi ? note : top; }, null);
    assert(highest && highest.midi >= 95, 'A seed reaches the top of the register for the aliasing check');
    assert(highest && highFM.buffer.getChannelData(0).slice(Math.round(highest.start * 44100), Math.round((highest.start + highest.duration) * 44100)).every(function (sample, frame) {
      return sample === highSine.buffer.getChannelData(0)[Math.round(highest.start * 44100) + frame];
    }) && !equalPCM(highFM.buffer, highSine.buffer), 'FM depth rolls down to a sine where high-note sidebands would alias, while lower notes retain FM');

    [
      { bpm: 40, bars: 8, tonic: 0, octave: 1, density: 100, index: 8, ratio: 4, decay: 1200 },
      { bpm: 200, bars: 2, tonic: 11, octave: 5, density: 100, index: 8, ratio: 4, decay: 40 }
    ].forEach(function (settings, index) {
      const extreme = synth.synthesize(context, settings);
      const values = statistics(extreme.buffer);
      assert(extreme.buffer.length <= 48 * 44100 && values.finite && values.peak < 0.8 && values.rms > 0.001, 'Extreme register, FM and tempo settings remain bounded and audible: ' + index);
    });
    let missingContextRejected = false;
    try { synth.synthesize(null, {}); } catch (error) { missingContextRejected = /context/.test(error.message); }
    assert(missingContextRejected, 'Missing audio buffer context fails with a clear error');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
