(function (root) {
  'use strict';

  // Whole-loop sources (drum loops played without chopping) need to know how
  // many bars they span. A BPM in the filename decides it; otherwise the bar
  // count whose implied tempo sits closest to 120 BPM is used.
  const BAR_OPTIONS = Object.freeze([1, 2, 4, 8, 16]);

  function bpmFromName(filename) {
    if (typeof filename !== 'string') return null;
    const name = filename.split(/[\\/]/).pop().normalize('NFKC');
    const match = /(?:^|[^0-9.])(\d{2,3}(?:\.\d+)?)\s*[-_ ]?bpm(?![a-z])/i.exec(name) || /(?:^|[^a-z])bpm\s*[-_ ]?(\d{2,3}(?:\.\d+)?)(?![0-9])/i.exec(name);
    const value = match ? Number(match[1]) : NaN;
    return value >= 50 && value <= 220 ? value : null;
  }

  function estimateBars(seconds, filename) {
    const duration = Number(seconds);
    if (!(duration > 0)) return 1;
    const bpm = bpmFromName(filename);
    if (bpm) {
      const exact = duration * bpm / 240;
      const near = BAR_OPTIONS.find(function (bars) { return Math.abs(exact / bars - 1) <= 0.08; });
      return near || Math.max(1, Math.min(16, Math.round(exact)));
    }
    return BAR_OPTIONS.reduce(function (best, bars) {
      const distance = Math.abs(Math.log(bars * 240 / duration / 120));
      return distance < best.distance ? { bars, distance } : best;
    }, { bars: 1, distance: Infinity }).bars;
  }

  // The playback rate that stretches the source over its bars at a tempo.
  function rateFor(seconds, bars, bpm) {
    const duration = Number(seconds);
    const count = Number(bars);
    const tempo = Number(bpm);
    return duration > 0 && count > 0 && tempo > 0 ? duration * tempo / (count * 240) : 1;
  }

  // Drum files named as loops start in whole-loop mode.
  function prefersLoop(filename, category) {
    return category === 'drums' && typeof filename === 'string' && /loop|break(?:beat)?s?(?![a-z])/i.test(filename.split(/[\\/]/).pop());
  }

  root.BlueLoopLength = Object.freeze({ barOptions: BAR_OPTIONS, bpmFromName, estimateBars, rateFor, prefersLoop });
})(typeof window !== 'undefined' ? window : globalThis);
