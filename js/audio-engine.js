(function (global) {
  'use strict';

  var SAMPLE_RATE = 44100;
  var MAX_FILE_BYTES = 40 * 1024 * 1024;
  var MAX_FILE_SECONDS = 120;
  var TAU = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function number(value, fallback) {
    var result = Number(value);
    return Number.isFinite(result) ? result : fallback;
  }

  function frequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function pitchSemitones(lane, event) {
    return clamp(number(event && event.semitones, 0) + number(lane && lane.keyShift, 0), -36, 36);
  }

  // Mulberry32 (Tommy Ettinger; bryc's public-domain JS form).
  // Source and license declarations are recorded in THIRD_PARTY_NOTICES.md.
  function randomSource(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      var value = Math.imul(seed ^ seed >>> 15, 1 | seed);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function getContextConstructor(offline) {
    var Constructor = offline
      ? global.OfflineAudioContext || global.webkitOfflineAudioContext
      : global.AudioContext || global.webkitAudioContext;
    if (!Constructor) throw new Error('このブラウザは Web Audio に対応していません。Safari または Chrome の最新版をお使いください。');
    return Constructor;
  }

  function isBuffer(buffer) {
    return buffer && buffer.length > 0 && buffer.sampleRate > 0 &&
      buffer.numberOfChannels > 0 && typeof buffer.getChannelData === 'function';
  }

  function makeBuffer(context, channels, frames, sampleRate) {
    return context.createBuffer(channels, frames, sampleRate);
  }

  // Shared by rendering and the timeline so both follow the same source position.
  function eventPlayback(lane, event, settings) {
    settings = settings || {};
    if (!lane || !event || !isBuffer(lane.buffer)) return null;
    var bpm = number(settings.bpm, 120);
    var bars = number(settings.bars, 4);
    var step = number(event.step, -1);
    if (bpm <= 0 || bars <= 0 || step < 0 || step >= bars * 16) return null;
    var stepSeconds = 60 / bpm / 4;
    var chop = clamp(Math.round(number(settings.chop, 16)), 1, 128);
    var swing = clamp(number(settings.swing, 0), 0, 50) / 100;
    var rate = Math.pow(2, pitchSemitones(lane, event) / 12);
    var eventChop = clamp(Math.round(number(event.sourceChop, chop)), 1, 128);
    var startRatio = event.startRatio == null
      ? clamp(number(event.sliceIndex, 0), 0, eventChop - 1) / eventChop
      : clamp(number(event.startRatio, 0), 0, 1);
    var offset = startRatio * lane.buffer.duration;
    // Note-boundary cuts carry their own length; equal slices use the chop.
    var lengthRatio = number(event.lengthRatio, 0);
    var sliceSeconds = Math.min(lengthRatio > 0 ? lengthRatio * lane.buffer.duration : lane.buffer.duration / eventChop,
      lane.buffer.duration - offset);
    var start = step * stepSeconds + (Math.floor(step) % 2 ? swing * stepSeconds : 0);
    // Each lane sets how often its slices receive the shared pitch envelope.
    var envelopeSettings = lane.pitchEnvChance == null ? settings
      : Object.assign({}, settings, { pitchEnvChance: lane.pitchEnvChance });
    var envelope = global.BlueLoopPitchEnvelope
      ? global.BlueLoopPitchEnvelope.create(rate, event, envelopeSettings, start, SAMPLE_RATE)
      : {
        enabled: false, depth: 0, baseRate: rate, startRate: rate, decaySeconds: 0,
        points: [{ time: 0, rate: rate }],
        sourceSecondsAt: function (time) { return Math.max(0, time) * rate; },
        durationFor: function (seconds) { return Math.max(0, seconds) / rate; },
        rateAt: function () { return rate; }
      };
    var duration = Math.min(envelope.durationFor(sliceSeconds),
      clamp(number(event.durationSteps, 1), 0, bars * 16) * stepSeconds);
    if (duration <= 0) return null;
    return {
      start: start, offset: offset, sliceSeconds: sliceSeconds, rate: rate,
      duration: duration, envelope: envelope, sourceSecondsAt: envelope.sourceSecondsAt
    };
  }

  function makeDemo(context, kind, seed) {
    var duration = 8;
    var buffer = makeBuffer(context, 2, SAMPLE_RATE * duration, SAMPLE_RATE);
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(1);
    var random = randomSource(seed);
    var notes = kind === 'bass'
      ? [45, 45, 48, 45, 41, 41, 43, 40, 45, 48, 52, 48, 41, 43, 45, 40]
      : [69, 72, 76, 74, 72, 79, 76, 67, 69, 76, 72, 74, 79, 76, 72, 67];
    var sliceFrames = SAMPLE_RATE / 2;
    for (var slice = 0; slice < 16; slice++) {
      var pitch = frequency(notes[slice]);
      var lastNoise = 0;
      var kickPhase = 0;
      for (var frame = 0; frame < sliceFrames; frame++) {
        var time = frame / SAMPLE_RATE;
        var attack = Math.min(1, time / 0.007);
        var endFade = Math.min(1, (0.5 - time) / 0.015);
        var value = 0;
        var side = 0;
        if (kind === 'voice') {
          // Original additive formant synthesis; these are not vocal recordings.
          var vibrato = 0.0025 * Math.sin(TAU * 5.2 * time);
          var phase = TAU * pitch * time + vibrato;
          var formant = slice % 3 === 0 ? 780 : slice % 3 === 1 ? 1150 : 1650;
          for (var harmonic = 1; harmonic <= 12; harmonic++) {
            var formantWeight = Math.exp(-Math.pow((harmonic * pitch - formant) / 510, 2));
            value += Math.sin(phase * harmonic) * (0.055 / harmonic + formantWeight * 0.042);
          }
          var vowelEnvelope = attack * endFade * Math.exp(-time * 5.4);
          value *= vowelEnvelope * 1.2;
          side = Math.sin(phase * 2 + 0.15) * 0.014 * vowelEnvelope;
        } else if (kind === 'keys') {
          var keyEnvelope = attack * endFade * Math.exp(-time * 7);
          [0, 7, 12].forEach(function (interval, index) {
            var keyPitch = pitch * 0.5 * Math.pow(2, interval / 12);
            value += (Math.sin(TAU * keyPitch * time) +
              0.22 * Math.sin(TAU * keyPitch * 2.005 * time)) * keyEnvelope * (0.095 - index * 0.019);
          });
          side = Math.sin(TAU * pitch * 0.501 * time) * keyEnvelope * 0.025;
        } else if (kind === 'bass') {
          var bassEnvelope = attack * endFade * Math.exp(-time * 4.8);
          value = (Math.sin(TAU * pitch * time) * 0.34 +
            Math.sin(TAU * pitch * 2 * time) * 0.055 +
            Math.sin(TAU * pitch * 3 * time) * 0.018) * bassEnvelope;
        } else {
          var noise = random() * 2 - 1;
          var highNoise = noise - lastNoise;
          lastNoise = noise;
          if (slice % 4 === 0 || slice === 10) {
            kickPhase += TAU * (48 + 115 * Math.exp(-time * 40)) / SAMPLE_RATE;
            value = Math.sin(kickPhase) * Math.exp(-time * 13) * 0.52 +
              noise * Math.exp(-time * 180) * 0.055;
          } else if (slice % 4 === 2) {
            value = noise * Math.exp(-time * 28) * 0.24 +
              Math.sin(TAU * 185 * time) * Math.exp(-time * 38) * 0.16;
          } else {
            value = highNoise * Math.exp(-time * (slice % 8 === 7 ? 24 : 65)) * 0.10;
            side = -value * 0.12;
          }
          value *= Math.min(1, time / 0.0007) * endFade;
        }
        var outputIndex = slice * sliceFrames + frame;
        left[outputIndex] = value + side;
        right[outputIndex] = value - side;
      }
    }
    return buffer;
  }

  function encodeWav(buffer) {
    if (!isBuffer(buffer)) throw new Error('書き出す音声がありません。');
    var frames = buffer.length;
    var channels = 2;
    var bytesPerSample = 2;
    var dataSize = frames * channels * bytesPerSample;
    var array = new ArrayBuffer(44 + dataSize);
    var view = new DataView(array);
    function writeText(offset, text) {
      for (var index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
    }
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
    view.setUint16(32, channels * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, 'data');
    view.setUint32(40, dataSize, true);
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
    for (var frame = 0; frame < frames; frame++) {
      var l = clamp(Number.isFinite(left[frame]) ? left[frame] : 0, -1, 1);
      var r = clamp(Number.isFinite(right[frame]) ? right[frame] : 0, -1, 1);
      view.setInt16(44 + frame * 4, Math.round(l * (l < 0 ? 32768 : 32767)), true);
      view.setInt16(46 + frame * 4, Math.round(r * (r < 0 ? 32768 : 32767)), true);
    }
    return new Blob([array], { type: 'audio/wav' });
  }

  class Engine {
    constructor() {
      this.context = null;
      this.master = null;
      this.masterVolume = 0.85;
      this.source = null;
      this.startTime = null;
      this.playingBuffer = null;
      this._sourceGain = null;
      this._preview = null;
      this._playRequest = 0;
      this._reverseBuffers = new WeakMap();
      this._sliceBuffers = new WeakMap();
    }

    _ensureContext() {
      if (!this.context || this.context.state === 'closed') {
        var Context = getContextConstructor(false);
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.masterVolume;
        this.master.connect(this.context.destination);
      }
      return this.context;
    }

    async init() {
      var context = this._ensureContext();
      if (context.state !== 'running') await context.resume();
      return context;
    }

    createFMSource(settings) {
      return global.BlueLoopFMSynth.synthesize(this._ensureContext(), settings);
    }

    async createDemoLanes() {
      var context = this._ensureContext();
      return [
        { id: 'voice', name: 'GLASS VOICE', kind: 'voice', color: '#a7d1ff', seed: 18 },
        { id: 'keys', name: 'SOFT KEYS', kind: 'keys', color: '#d6bfff', seed: 39 },
        { id: 'bass', name: 'ROUND BASS', kind: 'bass', color: '#e7e68c', seed: 62 },
        { id: 'drums', name: 'DUST DRUMS', kind: 'drums', color: '#ffb99f', seed: 85 }
      ].map(function (definition) {
        return {
          id: definition.id, name: definition.name, kind: definition.kind,
          color: definition.color, buffer: makeDemo(context, definition.kind, definition.seed),
          volume: 0.7, muted: false, solo: false, locked: false, events: []
        };
      });
    }

    async decodeFile(file) {
      if (!file || typeof file.arrayBuffer !== 'function') throw new Error('音声ファイルを選択してください。');
      if (file.size > MAX_FILE_BYTES) throw new Error('音声ファイルは 40 MB 以下にしてください。');
      if (file.size === 0) throw new Error('このファイルには音声データがありません。');
      var data = await file.arrayBuffer();
      if (data.byteLength > MAX_FILE_BYTES) throw new Error('音声ファイルは 40 MB 以下にしてください。');
      var buffer;
      try {
        buffer = await this._ensureContext().decodeAudioData(data);
      } catch (error) {
        throw new Error('音声を読み込めませんでした。WAV・MP3・M4A など、ブラウザが再生できる音声をお試しください。');
      }
      if (!isBuffer(buffer)) throw new Error('このファイルには音声データがありません。');
      if (buffer.duration > MAX_FILE_SECONDS) throw new Error('音声は ' + MAX_FILE_SECONDS + ' 秒以下にしてください。短く切り出してから読み込めます。');
      return buffer;
    }

    _reversed(buffer, context) {
      var reversed = this._reverseBuffers.get(buffer);
      if (!reversed) {
        reversed = makeBuffer(context, buffer.numberOfChannels, buffer.length, buffer.sampleRate);
        for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
          var source = buffer.getChannelData(channel);
          var target = reversed.getChannelData(channel);
          for (var frame = 0; frame < source.length; frame++) target[frame] = source[source.length - frame - 1];
        }
        this._reverseBuffers.set(buffer, reversed);
      }
      return reversed;
    }

    _isolatedSlice(buffer, offset, seconds, reverse, context) {
      var cache = this._sliceBuffers.get(buffer);
      if (!cache) {
        cache = { entries: new Map(), frames: 0 };
        this._sliceBuffers.set(buffer, cache);
      }
      var key = offset + ':' + seconds + ':' + !!reverse;
      var isolated = cache.entries.get(key);
      if (!isolated) {
        var sampleRate = buffer.sampleRate;
        var start = offset * sampleRate;
        var length = seconds * sampleRate;
        var first = Math.min(buffer.length - 1, Math.ceil(start - 1e-7));
        var last = Math.max(first, Math.min(buffer.length - 1, Math.ceil(start + length - 1e-7) - 1));
        isolated = makeBuffer(context, buffer.numberOfChannels, clamp(Math.ceil(length), 1, buffer.length), sampleRate);
        for (var channel = 0; channel < buffer.numberOfChannels; channel++) {
          var source = buffer.getChannelData(channel);
          var target = isolated.getChannelData(channel);
          for (var frame = 0; frame < target.length; frame++) {
            var position = reverse ? start + length - 1 - frame : start + frame;
            var lower = Math.floor(position);
            var fraction = position - lower;
            var a = source[clamp(lower, first, last)];
            var b = source[clamp(lower + 1, first, last)];
            target[frame] = a + (b - a) * fraction;
          }
        }
        // Retain at most twice the original PCM and a bounded number of slices.
        while (cache.entries.size && (cache.entries.size >= 256 || cache.frames + isolated.length > buffer.length * 2)) {
          var oldest = cache.entries.keys().next().value;
          cache.frames -= cache.entries.get(oldest).length;
          cache.entries.delete(oldest);
        }
        cache.entries.set(key, isolated);
        cache.frames += isolated.length;
      }
      return isolated;
    }

    async render(lanes, settings, events) {
      settings = settings || {};
      if (!Array.isArray(lanes)) throw new Error('音声トラックがありません。');
      var bpm = number(settings.bpm, 120);
      var bars = number(settings.bars, 4);
      if (bpm < 40 || bpm > 240 || bars < 1 || bars > 16 || !Number.isInteger(bars)) {
        throw new Error('BPM は 40〜240、小節数は 1〜16 に設定してください。');
      }
      var duration = bars * 4 * 60 / bpm;
      var frameCount = Math.round(duration * SAMPLE_RATE);
      var stepSeconds = 60 / bpm / 4;
      var space = clamp(number(settings.space, 0), 0, 100) / 100;
      var hasSolo = lanes.some(function (lane) { return lane.solo; });
      var laneMap = new Map(lanes.filter(function (lane) {
        return !lane.muted && (!hasSolo || lane.solo) && isBuffer(lane.buffer);
      }).map(function (lane) { return [lane.id, lane]; }));
      if (!Array.isArray(events)) events = lanes.flatMap(function (lane) {
        return (lane.events || []).map(function (event) { return Object.assign({ laneId: lane.id }, event); });
      });
      if (global.BlueLoopPlayback && (settings.maxVoices != null || settings.maxDrumVoices != null)) {
        events = global.BlueLoopPlayback.plan(lanes, settings, events);
      }
      var scheduled = [];
      var latestEnd = duration;
      events.forEach(function (event) {
        var lane = laneMap.get(event.laneId);
        var playback = eventPlayback(lane, event, settings);
        if (!playback) return;
        scheduled.push(Object.assign({}, playback, {
          lane: lane, event: event,
          gain: clamp(number(lane.volume, 0.7), 0, 1.5) * clamp(number(event.velocity, 0.8), 0, 1)
        }));
        latestEnd = Math.max(latestEnd, playback.start + playback.duration);
      });
      var echoDelay = stepSeconds * 3;
      var tailSeconds = space ? echoDelay * 3 + 0.04 : 0;
      var OfflineContext = getContextConstructor(true);
      var offline = new OfflineContext(2, Math.ceil((latestEnd + tailSeconds) * SAMPLE_RATE), SAMPLE_RATE);
      var bus = offline.createGain();
      bus.gain.value = 0.8;
      var finalOutput = bus;
      if (space > 0) {
        [1, 2, 3].forEach(function (tap) {
          var delay = offline.createDelay(5);
          delay.delayTime.value = echoDelay * tap;
          var gain = offline.createGain();
          gain.gain.value = space * 0.27 * Math.pow(0.48, tap - 1);
          var filter = offline.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 4200 / tap;
          bus.connect(delay);
          delay.connect(filter);
          filter.connect(gain);
          var echoSum = offline.createGain();
          finalOutput.connect(echoSum);
          gain.connect(echoSum);
          finalOutput = echoSum;
        });
      }
      finalOutput.connect(offline.destination);
      var engine = this;
      var eventSum = null;
      scheduled.forEach(function (item) {
        var source = offline.createBufferSource();
        if (item.envelope.enabled) {
          source.buffer = engine._isolatedSlice(item.lane.buffer, item.offset, item.sliceSeconds, item.event.reverse, offline);
          source.playbackRate.value = item.envelope.startRate;
          item.envelope.points.forEach(function (point) {
            source.playbackRate.setValueAtTime(point.rate, item.start + point.time);
          });
        } else {
          source.buffer = item.event.reverse ? engine._reversed(item.lane.buffer, offline) : item.lane.buffer;
          source.playbackRate.value = item.rate;
        }
        var gain = offline.createGain();
        var fade = Math.min(0.006, item.duration / 3);
        // Pure tones (FM sources) close over a few cycles when a note is cut;
        // a cut that plays its notes to the end keeps the short fade.
        var truncated = item.duration < item.envelope.durationFor(item.sliceSeconds) - 0.001;
        var release = truncated ? Math.min(clamp(number(item.lane.releaseSeconds, 0.006), 0.006, 0.05), item.duration / 3) : fade;
        gain.gain.setValueAtTime(0, item.start);
        gain.gain.linearRampToValueAtTime(item.gain, item.start + fade);
        gain.gain.setValueAtTime(item.gain, item.start + item.duration - release);
        gain.gain.linearRampToValueAtTime(0, item.start + item.duration);
        source.connect(gain);
        // Two-input sums fix floating-point accumulation order across renders.
        var sum = offline.createGain();
        if (eventSum) eventSum.connect(sum);
        gain.connect(sum);
        eventSum = sum;
        var offset = item.event.reverse
          ? Math.max(0, item.lane.buffer.duration - item.offset - item.sliceSeconds)
          : item.offset;
        if (item.envelope.enabled) source.start(item.start, 0, item.sliceSeconds);
        else source.start(item.start, offset, item.duration * item.rate);
        source.stop(item.start + item.duration + 1 / SAMPLE_RATE);
      });
      if (eventSum) eventSum.connect(bus);
      var rendered = await offline.startRendering();
      var output = makeBuffer(offline, 2, frameCount, SAMPLE_RATE);
      var peak = 0;
      // Fold tails into the loop's beginning, preserving the exact musical length.
      for (var channel = 0; channel < 2; channel++) {
        var input = rendered.getChannelData(channel);
        var target = output.getChannelData(channel);
        for (var frame = 0; frame < input.length; frame++) target[frame % frameCount] += input[frame];
        for (var sample = 0; sample < target.length; sample++) peak = Math.max(peak, Math.abs(target[sample]));
      }
      if (peak > 0.95) {
        var scale = 0.95 / peak;
        for (var outputChannel = 0; outputChannel < 2; outputChannel++) {
          var pcm = output.getChannelData(outputChannel);
          for (var pcmFrame = 0; pcmFrame < pcm.length; pcmFrame++) pcm[pcmFrame] *= scale;
        }
      }
      return output;
    }

    _stopMain() {
      if (this.source && this.context) {
        var now = this.context.currentTime;
        if (this._sourceGain) {
          this._sourceGain.gain.cancelScheduledValues(now);
          this._sourceGain.gain.setValueAtTime(this._sourceGain.gain.value, now);
          this._sourceGain.gain.linearRampToValueAtTime(0, now + 0.006);
        }
        try { this.source.stop(now + 0.007); } catch (error) { /* Already ended. */ }
      }
      this.source = null;
      this._sourceGain = null;
      this.playingBuffer = null;
      this.startTime = null;
    }

    async play(buffer) {
      if (!isBuffer(buffer)) throw new Error('再生するループがありません。');
      var request = ++this._playRequest;
      var context = await this.init();
      if (request !== this._playRequest) return;
      this._stopMain();
      this._stopPreview();
      var source = context.createBufferSource();
      var gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      source.connect(gain);
      gain.connect(this.master);
      this.startTime = context.currentTime + 0.008;
      gain.gain.setValueAtTime(0, this.startTime);
      gain.gain.linearRampToValueAtTime(1, this.startTime + 0.006);
      source.start(this.startTime);
      this.source = source;
      this._sourceGain = gain;
      this.playingBuffer = buffer;
      source.onended = function () { source.disconnect(); gain.disconnect(); };
      return source;
    }

    stop() {
      this._playRequest++;
      this._stopMain();
      this._stopPreview();
    }

    get progress() {
      if (!this.source || !this.playingBuffer || this.startTime == null) return 0;
      var elapsed = Math.max(0, this.context.currentTime - this.startTime);
      return (elapsed % this.playingBuffer.duration) / this.playingBuffer.duration;
    }

    get isPlaying() {
      return !!this.source;
    }

    setMasterVolume(value) {
      this.masterVolume = clamp(number(value, 0.85), 0, 1);
      if (this.master && this.context) this.master.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, 0.012);
    }

    _stopPreview() {
      if (this._preview) {
        try { this._preview.stop(); } catch (error) { /* Already ended. */ }
        this._preview.disconnect();
        this._preview = null;
      }
    }

    async playPreview(buffer, maxSeconds = 4) {
      if (!isBuffer(buffer)) return;
      var request = ++this._playRequest;
      var context = await this.init();
      if (request !== this._playRequest) return;
      this._stopPreview();
      var source = context.createBufferSource();
      var gain = context.createGain();
      var duration = Math.min(buffer.duration, Math.max(0.01, number(maxSeconds, 4)));
      var now = context.currentTime;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(this.master);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.65, now + Math.min(0.006, duration / 3));
      gain.gain.setValueAtTime(0.65, now + Math.max(duration - 0.008, duration * 2 / 3));
      gain.gain.linearRampToValueAtTime(0, now + duration);
      source.start(now, 0, duration);
      this._preview = source;
      var engine = this;
      source.onended = function () {
        source.disconnect();
        gain.disconnect();
        if (engine._preview === source) engine._preview = null;
      };
      return source;
    }

    encodeWav(buffer) {
      return encodeWav(buffer);
    }
  }

  global.BlueLoopAudio = {
    Engine: Engine, encodeWav: encodeWav, pitchSemitones: pitchSemitones,
    eventPlayback: eventPlayback, SAMPLE_RATE: SAMPLE_RATE
  };
})(window);
