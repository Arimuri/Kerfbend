(function (root) {
  'use strict';

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const naturalNotes = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const camelotMinor = [8, 3, 10, 5, 0, 7, 2, 9, 4, 11, 6, 1];
  const camelotMajor = [11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4];
  const separator = '[\\s._-]*';
  const notePattern = '[a-g](?:[#♯b♭]|' + separator + '(?:sharp|flat))?';
  const modePattern = '(?:major|minor|maj|min|m)';
  // A boundary includes underscores (common in sample packs), but excludes the
  // letters/digits that distinguish names, BPM values, and chord extensions.
  const leftBoundary = '(^|[^a-z0-9#♯♭])';
  const rightBoundary = '(?=$|[^a-z0-9#♯♭])';

  function format(key) {
    if (!key || !Number.isInteger(key.tonic) || key.tonic < 0 || key.tonic > 11) return 'Unknown';
    const suffix = key.mode === 'major' || key.mode === 'minor' ? ' ' + key.mode : '';
    return noteNames[key.tonic] + suffix;
  }

  function decodeNote(token) {
    const clean = token.toLowerCase().replace(/[\s._-]/g, '');
    const accidental = clean.slice(1);
    const offset = ['#', '♯', 'sharp'].includes(accidental) ? 1 : ['b', '♭', 'flat'].includes(accidental) ? -1 : 0;
    return (naturalNotes[clean[0]] + offset + 12) % 12;
  }

  function decodeMode(token) {
    if (!token) return 'unknown';
    // A capital M is the conventional compact major suffix; m means minor.
    return token === 'M' || /^maj/i.test(token) ? 'major' : 'minor';
  }

  function parse(filename) {
    if (typeof filename !== 'string' || !filename.trim()) return null;
    const name = filename.split(/[\\/]/).pop().replace(/\.(?:wav|wave|aif|aiff|mp3|flac|ogg|oga|opus|m4a|aac|mp4|webm|wma)$/i, '').trim();
    const candidates = [];
    let match;

    const modes = new RegExp(leftBoundary + '(' + notePattern + ')' + separator + '(' + modePattern + ')' + rightBoundary, 'gi');
    while ((match = modes.exec(name))) {
      candidates.push({ tonic: decodeNote(match[2]), mode: decodeMode(match[3]) });
    }

    // A declared key may have an unknown mode, and may use lower-case notes.
    const declared = new RegExp(leftBoundary + '(?:key|tonic)[\\s._:=()\\[\\]-]*(' + notePattern + ')(?:[0-8])?(?:' + separator + '(' + modePattern + '))?' + rightBoundary, 'gi');
    while ((match = declared.exec(name))) {
      candidates.push({ tonic: decodeNote(match[2]), mode: decodeMode(match[3]) });
    }

    const camelot = new RegExp(leftBoundary + '(1[0-2]|[1-9])([ab])' + rightBoundary, 'gi');
    while ((match = camelot.exec(name))) {
      const minor = match[3].toLowerCase() === 'a';
      candidates.push({ tonic: (minor ? camelotMinor : camelotMajor)[Number(match[2]) - 1], mode: minor ? 'minor' : 'major' });
    }

    // Root-only names are intentionally conservative: an uppercase final note,
    // optionally with an octave or a clearly labelled BPM suffix. Bare lowercase
    // letters and take/part/channel labels carry too little evidence for a key.
    const suffix = new RegExp(leftBoundary + '(' + notePattern + ')(?:[0-8])?[\\s)\\]\\}]*' +
      '(?:' + separator + '(?:\\d+(?:\\.\\d+)?' + separator + 'bpm|bpm' + separator + '\\d+(?:\\.\\d+)?))?[\\s)\\]\\}]*$', 'i');
    match = suffix.exec(name);
    if (match && /^[A-G]/.test(match[2])) {
      const preceding = name.slice(0, match.index + match[1].length).replace(/[\s._:=(\[\]-]+$/, '');
      const isIdentifier = /(?:^|[^a-z0-9])(?:take|mic|part|channel|ch|track|section|bus|version|ver|variant|layer|pattern|bank)$/i.test(preceding);
      if (!isIdentifier) candidates.push({ tonic: decodeNote(match[2]), mode: 'unknown' });
    }

    if (!candidates.length) return null;
    let chosen = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (candidate.tonic !== chosen.tonic) return null;
      if (chosen.mode !== 'unknown' && candidate.mode !== 'unknown' && chosen.mode !== candidate.mode) return null;
      if (chosen.mode === 'unknown') chosen = candidate;
    }
    const key = { tonic: chosen.tonic, mode: chosen.mode, confidence: 1, source: 'filename', status: 'tonal' };
    key.label = format(key);
    return key;
  }

  root.BlueLoopFilenameKey = Object.freeze({ parse, format });
})(typeof window !== 'undefined' ? window : globalThis);
