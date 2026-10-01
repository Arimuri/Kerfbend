(function (root) {
  'use strict';

  root.runLoopLengthTests = function () {
    const loops = root.BlueLoopLength;
    if (!loops) throw new Error('Load js/loop-length.js before loop-length-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Loop length test failed: ' + label);
      assertions.push({ label, passed: true });
    }

    [['drum_loop_92bpm.wav', 92], ['Break 120 BPM.wav', 120], ['BPM128_kit_loop.aif', 128], ['loop-87.5bpm.wav', 87.5], ['ｄｒｕｍ_１００ＢＰＭ.wav', 100],
      ['loop_128.wav', null], ['take 120.wav', null], ['bpm.wav', null], ['loop_400bpm.wav', null], ['loop_30bpm.wav', null], [null, null]].forEach(function (values) {
      assert(loops.bpmFromName(values[0]) === values[1], 'Filename BPM of ' + values[0] + ' is ' + values[1]);
    });
    [[4.8, 'drum_loop_100bpm.wav', 2], [2.0, 'loop_120bpm.wav', 1], [9.6, 'loop_100bpm.wav', 4], [6.4, 'odd_75bpm.wav', 2], [7.0, 'odd_120bpm.wav', 4],
      [8, 'loop.wav', 4], [2, 'hit.wav', 1], [5.333, 'loop.wav', 2], [16, 'loop.wav', 8], [32, 'loop.wav', 16], [0, 'loop.wav', 1], [-3, 'loop.wav', 1]].forEach(function (values) {
      assert(loops.estimateBars(values[0], values[1]) === values[2], values[0] + ' s ' + values[1] + ' spans ' + values[2] + ' bars');
    });
    assert(Math.abs(loops.rateFor(4.8, 2, 120) - 1.2) < 1e-12 && loops.rateFor(8, 4, 120) === 1 && loops.rateFor(0, 4, 120) === 1, 'The playback rate stretches a loop over its bars at the tempo');
    assert(loops.prefersLoop('Drum Loop 01.wav', 'drums') && loops.prefersLoop('breakbeat_95bpm.wav', 'drums') && !loops.prefersLoop('Drum Loop 01.wav', 'other') && !loops.prefersLoop('kick.wav', 'drums') && !loops.prefersLoop('breakdown_pad.wav', 'drums'),
      'Drum files named as loops or breaks start in whole-loop mode');
    assert(loops.barOptions.join(',') === '1,2,4,8,16', 'Loops can span 1 to 16 bars');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
