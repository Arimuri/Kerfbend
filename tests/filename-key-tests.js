(function (root) {
  'use strict';

  // Load js/filename-key.js first, then call runFilenameKeyTests().
  root.runFilenameKeyTests = function () {
    const parser = root.BlueLoopFilenameKey;
    if (!parser) throw new Error('Load js/filename-key.js before filename-key-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Filename key test failed: ' + label);
      assertions.push({ label, passed: true });
    }
    const examples = [
      ['loop_128bpm_F#min.wav', 6, 'minor'],
      ['loop_Bb_minor.wav', 10, 'minor'],
      ['D major.aiff', 2, 'major'],
      ['sample_A#m.flac', 10, 'minor'],
      ['chords_Gmaj.mp3', 7, 'major'],
      ['pads_Cm.WAV', 0, 'minor'],
      ['pads_CM.wav', 0, 'major'],
      ['keys_c#min.wav', 1, 'minor'],
      ['keys_c_minor.wav', 0, 'minor'],
      ['keys_F#_m.wav', 6, 'minor'],
      ['keys_E♭_major.wav', 3, 'major'],
      ['keys_B♭minor.wav', 10, 'minor'],
      ['keys_F♯min.wav', 6, 'minor'],
      ['loop_Dflat_minor_120bpm.wav', 1, 'minor'],
      ['loop_Csharpmajor.wav', 1, 'major'],
      ['loop_D-flat-minor.wav', 1, 'minor'],
      ['loop_F_sharp_minor.wav', 6, 'minor'],
      ['Piano [Ab Maj] 90 BPM.wav', 8, 'major'],
      ['Piano (C# min) 001.wav', 1, 'minor'],
      ['C.wav', 0, 'unknown'],
      ['synth_C.wav', 0, 'unknown'],
      ['synth_Db.wav', 1, 'unknown'],
      ['synth_F#.wav', 6, 'unknown'],
      ['synth_E♭.wav', 3, 'unknown'],
      ['synth_(A).wav', 9, 'unknown'],
      ['synth_[C#]_128bpm.wav', 1, 'unknown'],
      ['synth_C_128bpm.wav', 0, 'unknown'],
      ['synth_C_bpm128.wav', 0, 'unknown'],
      ['808_C1.wav', 0, 'unknown'],
      ['piano_F#4.wav', 6, 'unknown'],
      ['bass_Bb0.wav', 10, 'unknown'],
      ['drone_key=c_120.wav', 0, 'unknown'],
      ['drone_key: D flat.wav', 1, 'unknown'],
      ['drone_KeyDb.wav', 1, 'unknown'],
      ['drone_key-C#m.wav', 1, 'minor'],
      ['drone_(key: Eb major)_v2.wav', 3, 'major'],
      ['drone_tonic=F#_v2.wav', 6, 'unknown'],
      ['/samples/D minor/piano_Cmaj.wav', 0, 'major'],
      ['C:\\samples\\D minor\\piano_Cmaj.wav', 0, 'major'],
      ['loop_Cbmaj.wav', 11, 'major'],
      ['loop_B#min.wav', 0, 'minor'],
      ['loop_E#maj.wav', 5, 'major'],
      ['loop_Fbmin.wav', 4, 'minor'],
      ['loop_Amin_8A.wav', 9, 'minor'],
      ['loop_Dbmin_C#minor.wav', 1, 'minor'],
      ['loop_key=C_Cmaj.wav', 0, 'major'],
      ['loop_Cmaj_key=C.wav', 0, 'major'],
    ];
    examples.forEach(function (example) {
      const [name, tonic, mode] = example;
      const actual = parser.parse(name);
      assert(actual && actual.tonic === tonic && actual.mode === mode && actual.confidence === 1 &&
        actual.source === 'filename' && actual.status === 'tonal' && actual.label === parser.format(actual), 'Parse ' + name);
    });

    // Both wheels are checked in full to catch shifted/reversed Camelot maps.
    const minorNotes = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
    const majorNotes = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];
    minorNotes.forEach(function (tonic, index) {
      const name = 'Loop_' + (index + 1) + 'A_128bpm.wav';
      const actual = parser.parse(name);
      assert(actual && actual.tonic === tonic && actual.mode === 'minor', 'Camelot ' + name);
    });
    majorNotes.forEach(function (tonic, index) {
      const name = 'Loop_128bpm_' + (index + 1) + 'b.wav';
      const actual = parser.parse(name);
      assert(actual && actual.tonic === tonic && actual.mode === 'major', 'Camelot ' + name);
    });

    const negatives = [
      '', null, undefined, 120, {}, 'Amazing.wav', 'Bass.wav', 'camera.wav', 'Ambient.wav',
      'Dream.wav', 'Calm.wav', 'major.wav', 'minor.wav', 'a.wav', 'm.wav', 'synth_a.wav',
      'take_A.wav', 'mic_B.wav', 'part_C.wav', 'take_(A).wav', 'track_D.wav', 'channel_E.wav',
      'variant_F.wav', 'part_C4.wav', 'loop_120bpm.wav', 'loop_128A.wav', 'loop_8BPM.wav',
      'loop_8bars.wav', 'loop_13A.wav', 'loop_0B.wav', 'loop_2026-10-02.wav',
      'loop_F#m7.wav', 'loop_Cmaj7.wav', 'loop_Cminority.wav', 'loop_Gmajority.wav',
      'loop_Amnesia.wav', 'loop_C#minimize.wav', 'loop_somethingCmElse.wav',
      'loop_Dmaj_Emin.wav', 'loop_Cmin_Cmaj.wav', 'loop_8A_8B.wav', 'loop_Cmaj_8A.wav',
      'loop_key=C_key=D.wav', 'loop_key=F_Cmaj.wav', 'loop_key=C_D.wav',
      '/samples/Am/untagged.wav', 'C:\\samples\\Am\\untagged.wav',
    ];
    negatives.forEach(function (name) {
      assert(parser.parse(name) === null, 'Reject ambiguous/untagged ' + String(name));
    });
    assert(parser.format({ tonic: 1, mode: 'minor' }) === 'C# minor', 'Canonical sharp label');
    assert(parser.format({ tonic: 0, mode: 'unknown' }) === 'C', 'Root-only label does not invent a mode');
    assert(parser.format(null) === 'Unknown', 'Unknown label');
    assert(parser.format({ tonic: 12, mode: 'major' }) === 'Unknown', 'Invalid tonic label');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
