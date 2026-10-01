(function (global) {
  'use strict';

  // Windowed FFT spectral peaks -> pitch-class energy -> Krumhansl–Kessler
  // profile correlation. FFT: vendored fft.js, MIT; see THIRD_PARTY_NOTICES.md.
  // Algorithm references:
  // https://essentia.upf.edu/reference/std_HPCP.html
  // https://essentia.upf.edu/reference/std_Key.html
  // The two published experimental key profiles below are documented at:
  // https://partitura.readthedocs.io/en/v1.2.1/_modules/partitura/musicanalysis/key_identification.html
  // Confidence is a heuristic, not a calibrated probability of a correct key.
  var NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Numeric table from Partitura v1.2.1 (Apache-2.0); values unchanged,
  // NumPy representation ported to JavaScript. See THIRD_PARTY_NOTICES.md.
  // Copyright 2022, Maarten Grachten, Carlos Cancino-Chacón, Silvan Peter,
  // Emmanouil Karystinaios, Francesco Foscarin.
  var PROFILES = {
    major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  };
  var FFT_SIZE = 4096;
  var MAX_FRAMES = 96;
  var TWO_PI = 2 * Math.PI;

  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
  function yieldToUI() { return new Promise(function (resolve) { setTimeout(resolve, 0); }); }

  function result(status, reason, extra) {
    return Object.assign({
      tonic: null, mode: 'unknown', label: '不明', confidence: 0,
      source: 'analysis', status: status, reason: reason
    }, extra || {});
  }

  function label(tonic, mode) {
    return NOTES[tonic] + (mode === 'major' ? ' major' : mode === 'minor' ? ' minor' : '');
  }

  function makeFilter(decimation) {
    if (decimation === 1) return new Float64Array([1]);
    // Windowed-sinc low-pass before decimation; no unfiltered sample skipping.
    // Cutoff at 80% of the new Nyquist leaves a transition band for anti-aliasing.
    var radius = decimation * 8;
    var cutoff = 0.4 / decimation;
    var filter = new Float64Array(radius * 2 + 1), sum = 0;
    for (var tap = -radius; tap <= radius; tap++) {
      var sinc = tap === 0 ? 2 * cutoff : Math.sin(TWO_PI * cutoff * tap) / (Math.PI * tap);
      var weight = 0.42 + 0.5 * Math.cos(Math.PI * tap / radius) + 0.08 * Math.cos(TWO_PI * tap / radius);
      filter[tap + radius] = sinc * weight;
      sum += filter[tap + radius];
    }
    for (var i = 0; i < filter.length; i++) filter[i] /= sum;
    return filter;
  }

  function loadFrame(data, start, decimation, filter, window, real) {
    var radius = (filter.length - 1) / 2;
    var energy = 0, mean = 0;
    for (var i = 0; i < real.length; i++) {
      var center = start + i * decimation, sample = 0;
      if (radius === 0) {
        sample = center >= 0 && center < data.length ? data[center] : 0;
      } else {
        for (var tap = 0; tap < filter.length; tap++) {
          var source = center + tap - radius;
          if (source >= 0 && source < data.length) sample += data[source] * filter[tap];
        }
      }
      // A malformed PCM value should not contaminate the entire FFT.
      sample = Number.isFinite(sample) ? sample : 0;
      real[i] = sample;
      mean += sample;
      energy += sample * sample;
    }
    mean /= real.length;
    for (var j = 0; j < real.length; j++) {
      real[j] = (real[j] - mean) * window[j];
    }
    return Math.max(0, energy / real.length - mean * mean);
  }

  function getPeaks(power, sampleRate) {
    var first = Math.max(3, Math.ceil(40 * FFT_SIZE / sampleRate));
    var last = Math.min(power.length - 4, Math.floor(Math.min(4500, sampleRate * 0.4) * FFT_SIZE / sampleRate));
    var energy = 0;
    for (var k = first; k <= last; k++) energy += power[k];
    if (energy <= 1e-15) return { peaks: [], clarity: 0 };
    var average = energy / (last - first + 1), peaks = [], peakEnergy = 0;
    for (var bin = first; bin <= last; bin++) {
      var height = power[bin];
      if (height <= power[bin - 1] || height < power[bin + 1] || height < average * 5) continue;
      var surrounding = (power[bin - 3] + power[bin + 3]) / 2;
      if (height < surrounding * 6) continue;
      // Quadratic interpolation in log-power improves tuning resolution between bins.
      var left = Math.log(Math.max(1e-30, power[bin - 1]));
      var middle = Math.log(Math.max(1e-30, height));
      var right = Math.log(Math.max(1e-30, power[bin + 1]));
      var denominator = left - 2 * middle + right;
      var interpolation = denominator === 0 ? 0 : clamp(0.5 * (left - right) / denominator, -0.5, 0.5);
      var frequency = (bin + interpolation) * sampleRate / FFT_SIZE;
      var magnitude = Math.sqrt(height);
      peaks.push({ frequency: frequency, midi: 69 + 12 * Math.log2(frequency / 440), magnitude: magnitude, weight: magnitude });
      peakEnergy += power[bin - 1] + height + power[bin + 1];
    }
    // Suppress upper partials only when a lower, sufficiently strong spectral
    // peak supports that harmonic. An isolated sine keeps its own pitch class.
    for (var p = 0; p < peaks.length; p++) {
      for (var lower = 0; lower < p; lower++) {
        var ratio = peaks[p].frequency / peaks[lower].frequency;
        var harmonic = Math.round(ratio);
        if (harmonic < 2 || harmonic > 6 || peaks[lower].magnitude < peaks[p].magnitude * 0.35) continue;
        if (Math.abs(12 * Math.log2(ratio / harmonic)) < 0.35) {
          peaks[p].weight *= 0.18;
          break;
        }
      }
    }
    return { peaks: peaks, clarity: clamp(peakEnergy / energy, 0, 1) };
  }

  function correlation(chroma, tonic, profile) {
    var mean = profile.reduce(function (sum, value) { return sum + value; }, 0) / 12;
    var covariance = 0, chromaVariance = 0, profileVariance = 0;
    for (var pitch = 0; pitch < 12; pitch++) {
      var a = chroma[mod(pitch + tonic, 12)] - 1 / 12;
      var b = profile[pitch] - mean;
      covariance += a * b; chromaVariance += a * a; profileVariance += b * b;
    }
    return covariance / Math.sqrt(Math.max(1e-20, chromaVariance * profileVariance));
  }

  function classify(chroma, clarity, tuningCents, frameCount, stability) {
    var rankedPitches = Array.from(chroma, function (energy, tonic) { return { tonic: tonic, energy: energy }; });
    rankedPitches.sort(function (a, b) { return b.energy - a.energy; });
    var extra = { chroma: Array.from(chroma), tuningCents: Math.round(tuningCents), analyzedFrames: frameCount };
    var dominant = rankedPitches[0];
    if (dominant.energy >= 0.78 && rankedPitches[1].energy < 0.16) {
      if (stability < 0.72) return result('uncertain', '音高が安定していないため、キーを確定できません。', extra);
      return result('tonal', '単音のルートを検出しました。長調・短調は判定できません。', Object.assign(extra, {
        tonic: dominant.tonic, label: label(dominant.tonic, 'unknown'),
        confidence: clamp(0.68 + 0.26 * dominant.energy * clarity, 0, 0.96)
      }));
    }

    var candidates = [];
    ['major', 'minor'].forEach(function (mode) {
      for (var tonic = 0; tonic < 12; tonic++) {
        var third = mode === 'major' ? 4 : 3;
        var triad = chroma[tonic] + chroma[(tonic + third) % 12] + chroma[(tonic + 7) % 12];
        var completeTriad = Math.min(chroma[tonic], chroma[(tonic + third) % 12], chroma[(tonic + 7) % 12]);
        candidates.push({
          tonic: tonic, mode: mode, label: label(tonic, mode),
          score: correlation(chroma, tonic, PROFILES[mode]),
          triad: triad, completeTriad: completeTriad
        });
      }
    });
    candidates.sort(function (a, b) { return b.score - a.score; });
    var chord = candidates.filter(function (candidate) { return candidate.triad > 0.86 && candidate.completeTriad > 0.13; });
    // A clear three-note chord supports its root/quality even though it cannot
    // establish the key of a longer composition containing that chord.
    if (chord.length === 1) {
      var triadWinner = chord[0];
      return result('tonal', '主な和音のルートと長短を推定しました。曲全体の調とは異なる場合があります。', Object.assign(extra, {
        tonic: triadWinner.tonic, mode: triadWinner.mode, label: triadWinner.label,
        confidence: clamp(0.65 + 0.25 * triadWinner.triad * clarity, 0, 0.92)
      }));
    }
    var best = candidates[0], margin = best.score - candidates[1].score;
    var confidence = clamp(0.25 + 0.35 * best.score + 1.7 * margin + 0.12 * clarity, 0, 0.96);
    extra.alternatives = candidates.slice(0, 3).map(function (candidate) {
      return { tonic: candidate.tonic, mode: candidate.mode, label: candidate.label, score: Number(candidate.score.toFixed(3)) };
    });
    // Close relative-major/minor and other competing hypotheses stay unassigned.
    if (rankedPitches[2].energy < 0.06 || best.score < 0.64 || margin < 0.06 || confidence < 0.68) {
      return result('uncertain', '複数のキー候補が近いため、自動補正を保留しました。', Object.assign(extra, { confidence: Math.min(0.64, confidence) }));
    }
    return result('tonal', '音高の分布からキーを推定しました。', Object.assign(extra, {
      tonic: best.tonic, mode: best.mode, label: best.label, confidence: confidence
    }));
  }

  async function analyze(buffer) {
    if (!buffer || !Number.isFinite(buffer.sampleRate) || buffer.sampleRate < 4000 ||
      !Number.isFinite(buffer.length) || buffer.length < 1 || !buffer.numberOfChannels || typeof buffer.getChannelData !== 'function') {
      return result('unpitched', '解析できる音声がありません。');
    }
    if (buffer.length / buffer.sampleRate < 0.07) return result('uncertain', '音が短すぎるため、音高を確定できません。');

    var decimation = Math.max(1, Math.round(buffer.sampleRate / 12000));
    var sampleRate = buffer.sampleRate / decimation;
    var filter = makeFilter(decimation);
    var window = new Float64Array(FFT_SIZE);
    for (var w = 0; w < FFT_SIZE; w++) window[w] = 0.5 - 0.5 * Math.cos(TWO_PI * w / (FFT_SIZE - 1));
    // Each analysis owns its FFT state because multiple imports may overlap
    // across yieldToUI(). realTransform writes interleaved, unnormalized bins.
    var transform = new global.KerfbendFFT(FFT_SIZE);
    var real = new Float64Array(FFT_SIZE), spectrum = new Float64Array(FFT_SIZE * 2);
    var power = new Float64Array(FFT_SIZE / 2);
    // All channels contribute power, never a mono sum: inverted stereo cannot cancel.
    var channels = [];
    for (var channel = 0; channel < buffer.numberOfChannels; channel++) channels.push(buffer.getChannelData(channel));
    var frameLength = FFT_SIZE * decimation;
    var span = Math.max(0, buffer.length - frameLength);
    var frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(span / (frameLength / 2)) + 1));
    var frames = [], maximumRMS = 0, audibleFrames = 0;
    await yieldToUI();
    for (var frame = 0; frame < frameCount; frame++) {
      var start = span > 0 ? Math.round(frame * span / Math.max(1, frameCount - 1)) : Math.round((buffer.length - frameLength) / 2);
      power.fill(0);
      var meanEnergy = 0;
      for (var c = 0; c < channels.length; c++) {
        meanEnergy += loadFrame(channels[c], start, decimation, filter, window, real) / channels.length;
        transform.realTransform(spectrum, real);
        for (var bin = 0; bin < power.length; bin++) {
          var binReal = spectrum[bin * 2], binImaginary = spectrum[bin * 2 + 1];
          power[bin] += (binReal * binReal + binImaginary * binImaginary) / channels.length;
        }
      }
      var rms = Math.sqrt(meanEnergy);
      maximumRMS = Math.max(maximumRMS, rms);
      var spectral = getPeaks(power, sampleRate);
      frames.push({ rms: rms, clarity: spectral.clarity, peaks: spectral.peaks });
      if (frame % 4 === 3) await yieldToUI();
    }
    if (maximumRMS < 0.00002) return result('unpitched', '無音、または音量が小さすぎます。', { analyzedFrames: frameCount });

    var accepted = [], tuningSin = 0, tuningCos = 0, tuningWeight = 0;
    frames.forEach(function (frame) {
      if (frame.rms < Math.max(0.00002, maximumRMS * 0.04)) return;
      audibleFrames++;
      if (frame.clarity < 0.48 || !frame.peaks.length) return;
      var total = frame.peaks.reduce(function (sum, peak) { return sum + peak.weight; }, 0);
      if (!total) return;
      accepted.push(frame);
      frame.peaks.forEach(function (peak) {
        var weight = peak.weight / total;
        tuningSin += Math.sin(TWO_PI * peak.midi) * weight;
        tuningCos += Math.cos(TWO_PI * peak.midi) * weight;
        tuningWeight += weight;
      });
    });
    if (!accepted.length || accepted.length / audibleFrames < 0.3) {
      return result('unpitched', '安定した音高が見つかりません。打楽器やノイズは補正しません。', { analyzedFrames: frameCount });
    }
    var tuningCoherence = Math.hypot(tuningSin, tuningCos) / tuningWeight;
    if (tuningCoherence < 0.55) return result('uncertain', '音高が一定の音階に収まらないため、キーを確定できません。', { analyzedFrames: frameCount });
    var tuning = Math.atan2(tuningSin, tuningCos) / TWO_PI;
    // Near the midpoint between semitones, the note naming itself is ambiguous.
    if (Math.abs(tuning) > 0.45) return result('uncertain', '半音の中間に近いチューニングのため、キーを確認してください。', { tuningCents: Math.round(tuning * 100), analyzedFrames: frameCount });

    var chroma = new Float64Array(12), totalFrameWeight = 0, clarity = 0, stability = 0;
    accepted.forEach(function (frame) {
      var local = new Float64Array(12), sum = 0, localMaximum = 0;
      frame.peaks.forEach(function (peak) {
        var midi = peak.midi - tuning;
        var nearest = Math.round(midi), residual = midi - nearest;
        var weight = peak.weight * Math.pow(Math.cos(Math.PI * residual), 2);
        local[mod(nearest, 12)] += weight;
        sum += weight;
      });
      if (!sum) return;
      // Gentle loudness weighting keeps a single attack from owning the whole loop.
      var frameWeight = Math.sqrt(frame.rms / maximumRMS) * frame.clarity;
      for (var pitch = 0; pitch < 12; pitch++) {
        local[pitch] /= sum;
        chroma[pitch] += local[pitch] * frameWeight;
        localMaximum = Math.max(localMaximum, local[pitch]);
      }
      stability += localMaximum * frameWeight;
      clarity += frame.clarity * frameWeight;
      totalFrameWeight += frameWeight;
    });
    if (!totalFrameWeight) return result('unpitched', '安定した音高が見つかりません。');
    for (var pitch = 0; pitch < 12; pitch++) chroma[pitch] /= totalFrameWeight;
    return classify(chroma, clarity / totalFrameWeight, tuning * 100, frameCount, stability / totalFrameWeight);
  }

  global.BlueLoopKeyAnalysis = { analyze: analyze };
})(typeof window !== 'undefined' ? window : globalThis);
