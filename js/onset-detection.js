(function (global) {
  'use strict';

  // Onset detection for chopping a source at the start of each sound.
  // Method: log-compressed spectral flux over log-frequency bands, where the
  // reference frame is maximum-filtered across neighbouring bands so vibrato
  // and slides do not read as new notes (after S. Böck and G. Widmer,
  // "Maximum filter vibrato suppression for onset detection", DAFx 2013),
  // with local-maximum and moving-mean peak picking (after J. P. Bello et al.,
  // "A tutorial on onset detection in music signals", IEEE TSAP 2005).
  // Written for Kerfbend; FFT: vendored fft.js (MIT), see THIRD_PARTY_NOTICES.md.

  var HOP_SECONDS = 0.01;
  var WINDOW_SECONDS = 0.046;
  var LAG = 2;
  var BANDS_PER_OCTAVE = 12;
  var LOW_HZ = 40;
  var HIGH_HZ = 16000;
  var LOCAL_MAX = 3;
  var MEAN_BEFORE = 10;
  var MEAN_AFTER = 7;
  var SILENCE_RMS = 0.0005;
  var QUIET = Math.pow(10, -50 / 20);
  var START_LEVEL = Math.pow(10, -30 / 20);
  var MIN_SEGMENT = 0.04;
  var FINE_SECONDS = 0.001;
  var COMPRESSION = 1000;
  var MIN_EXCESS = 0.012;
  var STRENGTH_FLOOR = 0.2;
  var cache = new WeakMap();

  function yieldToUI() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function isBuffer(buffer) {
    return buffer && buffer.sampleRate >= 8000 && buffer.length > 0 && buffer.numberOfChannels > 0 && typeof buffer.getChannelData === 'function';
  }

  // Bins grouped into roughly semitone-wide bands from 40 Hz to 16 kHz.
  function bandMap(size, sampleRate) {
    var bins = size / 2;
    var map = new Int32Array(bins).fill(-1);
    var high = Math.min(HIGH_HZ, sampleRate * 0.45);
    var count = Math.max(1, Math.ceil(Math.log2(high / LOW_HZ) * BANDS_PER_OCTAVE));
    for (var bin = 1; bin < bins; bin++) {
      var frequency = bin * sampleRate / size;
      if (frequency < LOW_HZ || frequency > high) continue;
      map[bin] = Math.min(count - 1, Math.floor(Math.log2(frequency / LOW_HZ) * BANDS_PER_OCTAVE));
    }
    return { map: map, count: count };
  }

  // Analyses every channel without summing them, so inverted stereo cannot
  // cancel. The result is cached per buffer and is independent of tempo and
  // of how finely the source is later cut.
  async function analyze(buffer) {
    if (!isBuffer(buffer)) return { duration: 0, start: null, candidates: [] };
    if (cache.has(buffer)) return cache.get(buffer);
    var sampleRate = buffer.sampleRate;
    // The power of two nearest to 46 ms keeps the timing alike at every rate.
    var size = Math.pow(2, Math.round(Math.log2(WINDOW_SECONDS * sampleRate)));
    var hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
    var channels = [];
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) channels.push(buffer.getChannelData(channel));
    var length = buffer.length;
    var frames = Math.floor((length - 1) / hop) + 1;
    var bands = bandMap(size, sampleRate);
    var window = new Float64Array(size);
    for (var w = 0; w < size; w++) window[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / (size - 1));
    var transform = new global.KerfbendFFT(size);
    var real = new Float64Array(size);
    var spectrum = new Float64Array(size * 2);
    var count = bands.count;
    var levels = new Float32Array(frames * count);
    var rms = new Float64Array(frames);
    var peak = 0;
    await yieldToUI();
    for (var frame = 0; frame < frames; frame++) {
      var center = frame * hop;
      var start = center - size / 2;
      var row = frame * count;
      var power = 0;
      for (var c = 0; c < channels.length; c++) {
        var data = channels[c];
        for (var index = 0; index < size; index++) {
          var position = start + index;
          var sample = position >= 0 && position < length ? data[position] : 0;
          if (!Number.isFinite(sample)) sample = 0;
          power += sample * sample;
          real[index] = sample * window[index];
        }
        transform.realTransform(spectrum, real);
        for (var bin = 1; bin < size / 2; bin++) {
          var band = bands.map[bin];
          if (band >= 0) levels[row + band] += Math.hypot(spectrum[bin * 2], spectrum[bin * 2 + 1]);
        }
      }
      for (var b = 0; b < count; b++) peak = Math.max(peak, levels[row + b]);
      rms[frame] = Math.sqrt(power / (size * channels.length));
      if (frame % 64 === 63) await yieldToUI();
    }
    // Frames far below the loudest part (tails, room noise) never start a cut.
    var loudest = 0;
    for (var r = 0; r < frames; r++) loudest = Math.max(loudest, rms[r]);
    var quiet = Math.max(SILENCE_RMS, loudest * QUIET);
    // Log magnitude relative to the loudest band, so a quieter copy of the
    // same audio gives the same flux.
    var scale = peak > 0 ? COMPRESSION / peak : 0;
    for (var cell = 0; cell < levels.length; cell++) levels[cell] = Math.log10(1 + levels[cell] * scale);

    // Positive change against a frequency-widened earlier frame.
    var flux = new Float64Array(frames);
    for (var t = LAG; t < frames; t++) {
      var now = t * count;
      var before = (t - LAG) * count;
      var sum = 0;
      for (var k = 0; k < count; k++) {
        var reference = levels[before + k];
        if (k > 0) reference = Math.max(reference, levels[before + k - 1]);
        if (k + 1 < count) reference = Math.max(reference, levels[before + k + 1]);
        if (levels[now + k] > reference) sum += levels[now + k] - reference;
      }
      flux[t] = sum / count;
    }

    // A peak must top its neighbourhood and rise above the local average.
    // Frames compared with one that reaches before the top would read any
    // sound already playing there as an onset; the first sound covers them.
    var fine = fineEnvelope(channels, length, sampleRate);
    var candidates = [];
    for (var p = Math.ceil(size / 2 / hop) + LAG; p < frames - 1; p++) {
      if (!(flux[p] > 0) || Math.max(rms[p], rms[Math.min(frames - 1, p + 1)]) < quiet) continue;
      var highest = true;
      for (var q = Math.max(0, p - LOCAL_MAX); q <= Math.min(frames - 1, p + LOCAL_MAX) && highest; q++) {
        if (flux[q] > flux[p] || (flux[q] === flux[p] && q < p)) highest = false;
      }
      if (!highest) continue;
      var total = 0;
      var taken = 0;
      for (var m = Math.max(0, p - MEAN_BEFORE); m <= Math.min(frames - 1, p + MEAN_AFTER); m++) { total += flux[m]; taken++; }
      var excess = flux[p] - total / taken;
      // Very small peaks are the ripple of held notes (vibrato, bowing, room).
      if (excess < MIN_EXCESS) continue;
      candidates.push({ time: attackTime(fine, p * hop / sampleRate), strength: excess });
    }
    // Strength is relative to the clearer onsets of this source, but never
    // to less than a fixed floor, so a source of held notes stays uncut.
    var ranked = candidates.map(function (candidate) { return candidate.strength; }).sort(function (a, b) { return b - a; });
    var typical = Math.max(STRENGTH_FLOOR, ranked[Math.min(ranked.length - 1, Math.floor(ranked.length * 0.25))] || 0);
    var first = soundStart(fine);
    var result = {
      duration: length / sampleRate,
      start: first == null ? null : Math.round(first * 1e5) / 1e5,
      candidates: candidates.map(function (candidate) {
        return { time: Math.round(candidate.time * 1e5) / 1e5, strength: Math.round(candidate.strength / typical * 1e4) / 1e4 };
      }).sort(function (a, b) { return a.time - b.time; }),
    };
    cache.set(buffer, result);
    return result;
  }

  // A 2 ms RMS envelope at 1 ms steps, used to place each cut just before
  // its attack rather than at the coarse analysis frame.
  function fineEnvelope(channels, length, sampleRate) {
    var step = Math.max(1, Math.round(FINE_SECONDS * sampleRate));
    var span = 2 * step;
    var count = Math.floor(length / step) + 1;
    var values = new Float64Array(count);
    for (var index = 0; index < count; index++) {
      var start = index * step;
      var sum = 0;
      for (var c = 0; c < channels.length; c++) {
        var data = channels[c];
        for (var frame = start; frame < Math.min(length, start + span); frame++) {
          var sample = Number.isFinite(data[frame]) ? data[frame] : 0;
          sum += sample * sample;
        }
      }
      values[index] = Math.sqrt(sum / (span * channels.length));
    }
    return { values: values, seconds: step / sampleRate };
  }

  // Where the source first sounds: the first 10 ms within 30 dB of the
  // loudest 10 ms of the half second that follows, and within 50 dB of the
  // loudest 10 ms overall. Noise before a loud entry is skipped, but a quiet
  // opening still counts however loud a later hit is. It is a cut even
  // without a clear attack. Null for silence.
  function soundStart(fine) {
    var values = fine.values;
    var span = Math.max(1, Math.round(0.01 / fine.seconds));
    var ahead = Math.round(0.5 / fine.seconds);
    var smooth = new Float64Array(values.length);
    var power = 0;
    var loudest = 0;
    for (var index = 0; index < values.length; index++) {
      power += values[index] * values[index];
      if (index >= span) power -= values[index - span] * values[index - span];
      smooth[index] = Math.sqrt(Math.max(0, power) / span);
      loudest = Math.max(loudest, smooth[index]);
    }
    if (loudest < SILENCE_RMS) return null;
    var floor = Math.max(SILENCE_RMS, loudest * QUIET);
    for (var at = 0; at < values.length; at++) {
      // smooth[] ends each 10 ms window, so this is the 10 ms starting here.
      var level = smooth[Math.min(values.length - 1, at + span - 1)];
      if (level < floor) continue;
      var near = 0;
      for (var next = at; next < Math.min(values.length, at + ahead); next++) near = Math.max(near, smooth[next]);
      if (level < near * START_LEVEL) continue;
      // The 10 ms window reaches the sound early; start where it begins.
      var begin = at;
      while (begin < at + span - 1 && begin + 1 < values.length && values[begin] < near * START_LEVEL) begin++;
      return begin < 3 ? 0 : (begin - 1) * fine.seconds;
    }
    return null;
  }

  // Find the steepest rise near the frame estimate, then back up to where
  // that rise leaves the level before it, so a cut keeps the whole attack.
  // A rise counts against the highest level of the previous 12 ms, so the
  // ripple of a low note's waveform is not taken for an attack.
  function attackTime(fine, estimate) {
    var values = fine.values;
    var from = Math.max(1, Math.floor((estimate - 0.05) / fine.seconds));
    var to = Math.min(values.length - 1, Math.ceil((estimate + 0.02) / fine.seconds));
    var held = Math.round(0.012 / fine.seconds);
    var best = from;
    var rise = -Infinity;
    for (var index = from; index <= to; index++) {
      var recent = 0;
      for (var past = Math.max(0, index - held); past < index; past++) recent = Math.max(recent, values[past]);
      var change = values[index] - recent;
      if (change > rise) { rise = change; best = index; }
    }
    var floor = Infinity;
    for (var back = Math.max(0, best - 20); back < best; back++) floor = Math.min(floor, values[back]);
    var top = values[best];
    for (var ahead = best; ahead < Math.min(values.length, best + 10); ahead++) top = Math.max(top, values[ahead]);
    var start = best;
    while (start > Math.max(0, best - 20) && values[start - 1] > floor + 0.1 * (top - floor)) start--;
    return Math.max(0, (start - 1) * fine.seconds);
  }

  // Sensitivity 0 keeps only the clearest onsets; 100 keeps every candidate.
  // The first sound always starts a cut, and so does any onset kept before
  // it (a soft pickup before a loud downbeat). Cuts stay 40 ms apart: of two
  // close ones the stronger stays, and the first sound takes the earlier time.
  function cutTimes(analysis, sensitivity) {
    var duration = Number(analysis && analysis.duration);
    var first = Number(analysis && analysis.start);
    if (!(duration > 0) || analysis.start == null || !(first >= 0) || first >= duration) return [];
    var candidates = Array.isArray(analysis.candidates) ? analysis.candidates : [];
    var threshold = 0.8 * Math.pow(0.03 / 0.8, clamp(Number(sensitivity) || 0, 0, 100) / 100);
    var chosen = candidates.filter(function (candidate) {
      return candidate.strength >= threshold && candidate.time >= 0 && candidate.time <= duration - MIN_SEGMENT;
    }).concat([{ time: first, strength: Infinity }]).sort(function (a, b) { return a.time - b.time; });
    var times = [];
    chosen.forEach(function (candidate) {
      var last = times[times.length - 1];
      if (!last || candidate.time - last.time >= MIN_SEGMENT) times.push(candidate);
      else if (last.strength === Infinity || candidate.strength === Infinity) times[times.length - 1] = { time: last.time, strength: Infinity };
      else if (candidate.strength > last.strength) times[times.length - 1] = candidate;
    });
    return times.map(function (candidate) { return candidate.time; });
  }

  // Pieces from each cut to the next; silence before the first cut is left out.
  function cuts(analysis, sensitivity) {
    var times = cutTimes(analysis, sensitivity);
    var duration = Number(analysis && analysis.duration);
    return times.map(function (time, index) {
      return { start: time, end: index + 1 < times.length ? times[index + 1] : duration };
    });
  }

  global.BlueLoopOnsets = { analyze: analyze, cutTimes: cutTimes, cuts: cuts };
})(typeof window !== 'undefined' ? window : globalThis);
