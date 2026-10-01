(function (global) {
  'use strict';

  // Compare the vendored real FFT against a direct definition of the DFT;
  // no transform implementation or precomputed vendor output is reused here.
  global.runFFTTests = function () {
    if (!global.KerfbendFFT) throw new Error('Load vendor/fft.js/fft.js before fft-tests.js.');
    var assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('FFT test failed: ' + label);
      assertions.push({ label: label, passed: true });
    }
    function unchanged(input, snapshot, label) {
      assert(input.every(function (value, index) { return value === snapshot[index]; }), label + ': source input stays unchanged');
    }
    function compare(spectrum, size, expected, tolerance, label) {
      var maximumError = 0;
      // realTransform promises the nonnegative frequencies, including Nyquist.
      for (var bin = 0; bin <= size / 2; bin++) {
        var value = expected(bin);
        maximumError = Math.max(maximumError, Math.abs(spectrum[bin * 2] - value[0]),
          Math.abs(spectrum[bin * 2 + 1] - value[1]));
      }
      assert(maximumError < tolerance, label + ': complex-bin error ' + maximumError);
    }
    function dft(input, bin) {
      var real = 0, imaginary = 0;
      for (var sample = 0; sample < input.length; sample++) {
        var angle = -2 * Math.PI * bin * sample / input.length;
        real += input[sample] * Math.cos(angle);
        imaginary += input[sample] * Math.sin(angle);
      }
      return [real, imaginary];
    }

    var seed = 12471;
    [2, 4, 8, 16, 32, 64].forEach(function (size) {
      var fft = new global.KerfbendFFT(size);
      // Reusing each instance also checks that previous transforms leave no
      // state that changes a subsequent transform's result.
      for (var trial = 0; trial < 3; trial++) {
        var input = new Float64Array(size);
        for (var sample = 0; sample < size; sample++) {
          seed = Math.imul(seed, 1664525) + 1013904223 | 0;
          input[sample] = seed / 2147483648;
        }
        var snapshot = input.slice(), output = new Float64Array(size * 2);
        output.fill(NaN);
        fft.realTransform(output, input);
        var label = size + '-point random input ' + trial;
        compare(output, size, function (bin) { return dft(input, bin); }, 1e-10, label + ' agrees with direct DFT');
        unchanged(input, snapshot, label);
      }
    });

    var size = 4096, fft = new global.KerfbendFFT(size);
    [37, 2047].forEach(function (frequencyBin) {
      var amplitude = 0.625, input = new Float64Array(size);
      for (var sample = 0; sample < size; sample++) input[sample] = amplitude * Math.sin(2 * Math.PI * frequencyBin * sample / size);
      var snapshot = input.slice(), output = new Float64Array(size * 2);
      fft.realTransform(output, input);
      compare(output, size, function (bin) { return [0, bin === frequencyBin ? -amplitude * size / 2 : 0]; }, 1e-8,
        '4096-point sine at bin ' + frequencyBin + ' has unnormalized magnitude and negative imaginary phase');
      unchanged(input, snapshot, '4096-point sine at bin ' + frequencyBin);
    });

    [0, 17].forEach(function (offset) {
      var input = new Float64Array(size), output = new Float64Array(size * 2);
      input[offset] = 1;
      var snapshot = input.slice();
      fft.realTransform(output, input);
      compare(output, size, function (bin) {
        var angle = -2 * Math.PI * bin * offset / size;
        return [Math.cos(angle), Math.sin(angle)];
      }, 1e-10, '4096-point impulse at ' + offset + ' has unit magnitude and the expected phase');
      unchanged(input, snapshot, '4096-point impulse at ' + offset);
    });

    [false, true].forEach(function (nyquist) {
      var input = new Float64Array(size), output = new Float64Array(size * 2);
      for (var sample = 0; sample < size; sample++) input[sample] = nyquist && sample % 2 ? -1 : 1;
      fft.realTransform(output, input);
      compare(output, size, function (bin) { return [bin === (nyquist ? size / 2 : 0) ? size : 0, 0]; }, 1e-10,
        '4096-point ' + (nyquist ? 'Nyquist' : 'DC') + ' signal retains its endpoint bin');
    });
    return { passed: assertions.length, assertions: assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
