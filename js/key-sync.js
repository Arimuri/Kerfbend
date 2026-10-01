(function (root) {
  'use strict';

  const notes = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  const mod = (value) => ((value % 12) + 12) % 12;
  const nearest = (value) => mod(value + 6) - 6;

  function isTonal(key) {
    return !!key && key.status === 'tonal' && Number.isInteger(key.tonic) && key.tonic >= 0 && key.tonic < 12;
  }

  function format(key) {
    if (!isTonal(key)) return '未判定';
    return `${notes[key.tonic]}${key.mode === 'major' ? ' major' : key.mode === 'minor' ? ' minor' : ''}`;
  }

  function fromValue(value, source = 'manual') {
    const match = /^(\d{1,2}):(major|minor|unknown)$/.exec(String(value));
    if (!match || Number(match[1]) > 11) return null;
    const key = { tonic: Number(match[1]), mode: match[2], confidence: 1, source, status: 'tonal' };
    return { ...key, label: format(key) };
  }

  function sourceKey(lane) {
    if (lane.keyOverride === 'none') return { tonic: null, mode: 'unknown', status: 'unpitched', source: 'manual', reason: '補正しない設定です。' };
    return fromValue(lane.keyOverride) || lane.detectedKey || { tonic: null, mode: 'unknown', status: 'uncertain', source: 'analysis', reason: 'キーが未判定です。' };
  }

  function toMajor(key) {
    if (!isTonal(key)) return key;
    // A relative-major reading changes the label, never the audio or chroma.
    // A root-only sample uses its same root as the major convention; retain the
    // original unknown mode separately so it is not presented as a detection.
    const major = { ...key, tonic: mod(key.tonic + (key.mode === 'minor' ? 3 : 0)), mode: 'major' };
    major.label = format(major);
    return major;
  }

  function selectTarget(lanes, settings) {
    const fixed = fromValue(settings.targetKey);
    if (fixed) return toMajor(fixed);
    const candidates = lanes.map((lane, index) => ({ lane, key: sourceKey(lane), index })).filter((entry) => isTonal(entry.key));
    // User material leads the demo. Full keys lead isolated notes within each group.
    const rank = (entry) => (['upload', 'fm'].includes(entry.lane.kind) ? 0 : 4) +
      (entry.key.mode === 'unknown' ? 2 : 0) + (entry.key.source === 'analysis' ? 1 : 0);
    candidates.sort((a, b) => rank(a) - rank(b) || a.index - b.index);
    if (!candidates.length) return null;
    return { ...toMajor(candidates[0].key), laneId: candidates[0].lane.id, laneName: candidates[0].lane.name };
  }

  function metadataShift(key, target) {
    // Twelve pitch classes form a circle. Subtract their relative-major tonics
    // and choose the shortest signed interval, with a downward tritone on ties.
    // This is ordinary modular pitch arithmetic; spectral weights do not take
    // part in transposition once a source key has been selected.
    const sourceMajor = toMajor(key);
    const targetMajor = toMajor(target);
    return nearest(targetMajor.tonic - sourceMajor.tonic);
  }

  function plan(lanes, settings) {
    const target = selectTarget(lanes, settings);
    const entries = lanes.map((lane) => {
      const originalKey = sourceKey(lane);
      const key = toMajor(originalKey);
      const base = { laneId: lane.id, originalKey, key, shift: 0, targetKey: null, method: 'none' };
      if (settings.keySync === false) return { ...base, reason: 'キー同期OFF' };
      if (!isTonal(key)) return { ...base, reason: key.reason || (key.status === 'unpitched' ? '音程なし' : '判定保留') };
      if (!target) return { ...base, reason: '基準キーがありません。' };
      if (settings.targetKey === 'auto' && target.laneId === lane.id) {
        return { ...base, targetKey: { ...key }, method: 'anchor', reason: '自動選択の基準音源は移調しません。' };
      }
      const shift = metadataShift(key, target);
      const targetKey = { ...key, tonic: mod(key.tonic + shift) };
      targetKey.label = format(targetKey);
      return { ...base, shift, targetKey, method: 'metadata', reason: shift ? `${format(key)} → ${format(targetKey)}` : '移調なし' };
    });
    return { target, entries, byId: Object.fromEntries(entries.map((entry) => [entry.laneId, entry])) };
  }

  function isPercussiveFilename(filename) {
    return /(?:^|[\s_.\-()[\]])(?:drums?|percs?|percussion|hi[ -]?hats?|hh|snare|claps?|cymbals?|shakers?|rides?)(?:$|[\s_.\-()[\]\d])/i.test(filename);
  }

  async function detect(filename, buffer) {
    const named = root.BlueLoopFilenameKey.parse(filename);
    if (named) return named;
    if (isPercussiveFilename(filename)) return {
      tonic: null, mode: 'unknown', label: '音程なし', confidence: 0, source: 'filename', status: 'unpitched',
      reason: '打楽器名のため自動移調を省略しました。必要ならキーを指定できます。',
    };
    return root.BlueLoopKeyAnalysis.analyze(buffer);
  }

  root.BlueLoopKeySync = Object.freeze({ notes, format, fromValue, sourceKey, toMajor, selectTarget, metadataShift, plan, detect, isTonal });
})(typeof window !== 'undefined' ? window : globalThis);
