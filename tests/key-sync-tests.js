(function (root) {
  'use strict';

  async function runKeySyncTests() {
    const sync = root.BlueLoopKeySync;
    const results = [];
    function check(name, condition) {
      results.push({ name, passed: !!condition });
      if (!condition) throw new Error(name);
    }
    const key = (value, source = 'filename') => sync.fromValue(value, source);
    const lane = (id, value, kind = 'upload') => ({ id, name: id, kind, detectedKey: key(value), keyOverride: 'auto' });
    const settings = { keySync: true, targetKey: '2:minor' };
    const cm = lane('chords', '0:minor');
    check('Explicit minor keys align tonic by two semitones', sync.plan([cm], settings).entries[0].shift === 2);
    check('Relative minor and major share a scale without transposition', sync.metadataShift(key('9:minor'), key('0:major')) === 0);
    check('Opposite modes align relative scale, not parallel tonic', sync.metadataShift(key('0:major'), key('2:minor')) === 5);
    const opposite = sync.plan([lane('major', '0:major')], settings).entries[0];
    check('Major source remains major after matching a minor scale', opposite.targetKey.tonic === 5 && opposite.targetKey.mode === 'major');
    check('Nearest octave-equivalent shift stays within six semitones', sync.metadataShift(key('11:minor'), key('0:minor')) === 1 && sync.metadataShift(key('6:major'), key('0:major')) === -6);
    check('Unknown mode uses its same root as the major processing convention', sync.metadataShift(key('2:unknown'), key('0:major')) === -2);
    check('Sync OFF removes all corrections', sync.plan([cm], { ...settings, keySync: false }).entries[0].shift === 0);
    const override = { ...cm, keyOverride: '7:minor' };
    check('Manual source key overrides filename', sync.plan([override], settings).entries[0].shift === -5);
    check('Per-source opt-out is never transposed', sync.plan([{ ...cm, keyOverride: 'none' }], settings).entries[0].shift === 0);
    const uncertain = { ...cm, detectedKey: { tonic: 0, mode: 'minor', source: 'analysis', status: 'uncertain' } };
    check('Uncertain analysis is not transposed despite a candidate tonic', sync.plan([uncertain], settings).entries[0].shift === 0);
    const demo = lane('demo', '9:minor', 'voice');
    const auto = sync.plan([demo, cm], { keySync: true, targetKey: 'auto' });
    check('Minor user source establishes its relative major target ahead of demos', auto.target.tonic === 3 && auto.target.mode === 'major' && auto.target.laneId === 'chords');
    check('Opted-out sources do not establish an automatic target', sync.selectTarget([{ ...cm, keyOverride: 'none' }], { targetKey: 'auto' }) === null);
    check('No reliable sources leaves target unset', sync.plan([uncertain], { targetKey: 'auto' }).target === null);
    const analyzed = { ...lane('audio', '2:minor'), detectedKey: key('2:minor', 'analysis') };
    check('Explicit filename target outranks an analyzed key', sync.selectTarget([analyzed, cm], { targetKey: 'auto' }).laneId === cm.id);
    const fm = { ...lane('fm', '7:major', 'fm'), detectedKey: key('7:major', 'synth') };
    const fmAuto = sync.plan([demo, fm], { keySync: true, targetKey: 'auto' });
    check('A generated FM phrase establishes its known major key ahead of demos', fmAuto.target.laneId === fm.id && fmAuto.target.label === 'G major' && fmAuto.entries[1].shift === 0 && fmAuto.entries[1].method === 'anchor');
    check('Known FM and filename keys share user-material priority with stable source order', sync.selectTarget([cm, fm], { targetKey: 'auto' }).laneId === cm.id && sync.selectTarget([fm, cm], { targetKey: 'auto' }).laneId === fm.id);
    check('The exact generated FM key outranks an estimated imported key', sync.selectTarget([analyzed, fm], { targetKey: 'auto' }).laneId === fm.id);
    check('FM key opt-out restores the next reliable source as the automatic target', sync.selectTarget([{ ...fm, keyOverride: 'none' }, demo], { targetKey: 'auto' }).laneId === demo.id);
    const fmFixed = sync.plan([fm], { keySync: true, targetKey: '0:major' }).entries[0];
    check('FM sources align to fixed keys without losing their original synthesis key', fmFixed.shift === 5 && fmFixed.originalKey.label === 'G major' && fmFixed.originalKey.source === 'synth' && fmFixed.targetKey.label === 'C major' && fm.detectedKey.tonic === 7);
    const chromaticMinor = { ...cm, detectedKey: { ...key('0:minor', 'analysis'), chroma: [.296, .079, 0, .154, .044, .122, 0, .174, .022, .003, .104, .001] } };
    check('An analyzed automatic anchor is never transposed away from its own key', sync.plan([chromaticMinor], { keySync: true, targetKey: 'auto' }).entries[0].shift === 0);
    const chroma = new Array(12).fill(0); chroma[0] = .5; chroma[4] = .3; chroma[7] = .2;
    const spectral = { ...key('0:major', 'analysis'), chroma };
    const analyzedPlan = sync.plan([{ ...cm, detectedKey: spectral }], { ...settings, targetKey: '5:major' }).entries[0];
    check('Analyzed C major transposes to F even when its notes already fit the F scale', analyzedPlan.shift === 5 && analyzedPlan.targetKey.label === 'F major' && analyzedPlan.method === 'metadata');
    check('Analysis uses the same relative-major tonic alignment as filename metadata', sync.plan([{ ...cm, detectedKey: spectral }], { ...settings, targetKey: '9:minor' }).entries[0].shift === 0);
    check('Typed chroma cannot override the detected tonic', sync.plan([{ ...cm, detectedKey: { ...spectral, chroma: Float32Array.from(chroma) } }], { targetKey: '5:major' }).entries[0].shift === 5);
    check('Contradictory chroma cannot override the detected tonic', sync.plan([{ ...cm, detectedKey: { ...spectral, chroma: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0] } }], { targetKey: '5:major' }).entries[0].shift === 5);
    check('Filename keys ignore contradictory spectral metadata', sync.plan([{ ...cm, detectedKey: { ...spectral, source: 'filename' } }], settings).entries[0].shift === 5);
    check('Manual override ignores an analyzed key and its spectrum', sync.plan([{ ...cm, keyOverride: '7:major', detectedKey: spectral }], { targetKey: '5:major' }).entries[0].shift === -2);
    const shortestIntervals = [0, 1, 2, 3, 4, 5, -6, -5, -4, -3, -2, -1];
    for (let source = 0; source < 12; source++) {
      for (let target = 0; target < 12; target++) {
        const expected = shortestIntervals[(target - source + 12) % 12];
        const inputs = ['manual', 'filename', 'analysis'].map((origin) => ({
          ...lane(origin, `${source}:major`),
          detectedKey: { ...key(`${source}:major`, origin), chroma },
        }));
        const entries = sync.plan(inputs, { targetKey: `${target}:major` }).entries;
        check(`All key sources align tonic ${source} to ${target} by the shortest signed interval`, entries.every((entry) => entry.shift === expected && entry.targetKey.tonic === target && entry.targetKey.mode === 'major' && entry.method === 'metadata'));
      }
    }
    const before = JSON.stringify([cm, settings]);
    sync.plan([cm], settings);
    check('Planning does not mutate input', JSON.stringify([cm, settings]) === before);
    check('Invalid key values are rejected', sync.fromValue('12:minor') === null && sync.fromValue('0:dorian') === null);
    const exportedRoot = root.BlueLoopFilenameKey.parse('kerfbend_120bpm_4bars_key-C_BLUE01.wav');
    check('Exported single-note key metadata survives filename reimport', exportedRoot && exportedRoot.tonic === 0 && exportedRoot.mode === 'unknown');

    const originalMinor = { ...key('9:minor', 'analysis'), chroma: [0.2, 0, 0, 0, 0.3, 0, 0, 0, 0, 0.5, 0, 0] };
    const originalJSON = JSON.stringify(originalMinor);
    const major = sync.toMajor(originalMinor);
    check('A minor is interpreted as C major without changing metadata or absolute chroma', major.tonic === 0 && major.mode === 'major' && major.chroma === originalMinor.chroma && JSON.stringify(originalMinor) === originalJSON);
    check('Normalization is idempotent', JSON.stringify(sync.toMajor(major)) === JSON.stringify(major));
    for (let tonic = 0; tonic < 12; tonic++) {
      const normalized = sync.toMajor(key(`${tonic}:minor`));
      const originalScale = [0, 2, 3, 5, 7, 8, 10].map((n) => (n + tonic) % 12).sort((a, b) => a - b);
      const majorScale = [0, 2, 4, 5, 7, 9, 11].map((n) => (n + normalized.tonic) % 12).sort((a, b) => a - b);
      check(`Relative major preserves all scale pitch classes for minor tonic ${tonic}`, normalized.mode === 'major' && JSON.stringify(originalScale) === JSON.stringify(majorScale));
      const equivalent = ['filename', 'analysis'].flatMap((source) => [
        { ...lane(`${source}-minor`, `${tonic}:minor`), detectedKey: { ...key(`${tonic}:minor`, source), chroma } },
        { ...lane(`${source}-major`, `${normalized.tonic}:major`), detectedKey: { ...normalized, source } },
      ]);
      const equivalentEntries = sync.plan(equivalent, { targetKey: '0:major' }).entries;
      check(`Minor tonic ${tonic} and its relative major receive identical corrections regardless of source or spectrum`, equivalentEntries.every((entry) => entry.shift === equivalentEntries[0].shift && entry.targetKey.label === 'C major'));
    }
    const pair = sync.plan([lane('minor', '9:minor'), lane('major', '0:major')], { keySync: true, targetKey: 'auto' });
    check('A minor and C major are both C major with no audio transposition', pair.target.label === 'C major' && pair.entries.every((entry) => entry.key.label === 'C major' && entry.shift === 0));
    check('Original minor label is retained separately from processing key', pair.entries[0].originalKey.mode === 'minor' && pair.entries[0].originalKey.tonic === 9);
    check('D minor is F major at zero shift and shifts down five to C major', sync.plan([lane('dminor', '2:minor')], { targetKey: '5:major' }).entries[0].shift === 0 && sync.plan([lane('dminor', '2:minor')], { targetKey: '0:major' }).entries[0].shift === -5);
    check('A minor to D major transposes by two, not by five', sync.plan([lane('aminor', '9:minor')], { targetKey: '2:major' }).entries[0].shift === 2);
    check('Legacy minor target values resolve to relative major', sync.selectTarget([], { targetKey: '2:minor' }).label === 'F major');
    const note = { ...lane('note', '2:unknown'), detectedKey: { ...key('2:unknown', 'analysis'), chroma: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } };
    const notePlan = sync.plan([note], { targetKey: '0:major' });
    check('Analyzed single note still aligns root rather than any in-scale note', notePlan.entries[0].shift === -2 && notePlan.entries[0].method === 'metadata' && notePlan.entries[0].originalKey.mode === 'unknown' && notePlan.entries[0].key.mode === 'major');
    check('Root-only metadata does not outrank a complete filename key', sync.selectTarget([lane('root', '2:unknown'), cm], { targetKey: 'auto' }).laneId === cm.id);
    const exportedMajor = root.BlueLoopFilenameKey.parse('kerfbend_120bpm_4bars_key-C-major_BLUE01.wav');
    check('Major-normalized WAV filename reimports without another relative shift', exportedMajor.mode === 'major' && sync.toMajor(exportedMajor).tonic === 0);
    check('Unpitched and uncertain metadata are not invented as major keys', sync.toMajor(uncertain.detectedKey) === uncertain.detectedKey && sync.toMajor({ status: 'unpitched', tonic: null }).tonic === null);

    let analyses = 0;
    const originalAnalysis = root.BlueLoopKeyAnalysis;
    const fallback = { ...spectral };
    root.BlueLoopKeyAnalysis = { analyze: async () => { analyses++; return fallback; } };
    try {
      const filename = await sync.detect('vocal_128_F#min.wav', {});
      check('Filename key bypasses audio analysis', filename.tonic === 6 && filename.source === 'filename' && analyses === 0);
      check('Untagged sample falls back to audio analysis', await sync.detect('vocal_loop.wav', {}) === fallback && analyses === 1);
      const drums = await sync.detect('pack_drums_120.wav', {});
      check('Explicit drum name is not auto-transposed', drums.status === 'unpitched' && analyses === 1);
      const pitchedDrums = await sync.detect('pack_drums_Cmin.wav', {});
      check('Explicit key has priority even for pitched drum names', pitchedDrums.tonic === 0 && pitchedDrums.status === 'tonal');
      await sync.detect('loop_Cmin_Dmin.wav', {});
      check('Conflicting filename keys fall back to analysis', analyses === 2);
    } finally { root.BlueLoopKeyAnalysis = originalAnalysis; }

    if (root.OfflineAudioContext && root.BlueLoopAudio) {
      const offline = new root.OfflineAudioContext(2, 44100, 44100);
      const buffer = offline.createBuffer(2, 44100, 44100);
      const inputHz = 440 * Math.pow(2, (62 - 69) / 12); // D4.
      for (let channel = 0; channel < 2; channel++) {
        const samples = buffer.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) samples[i] = .3 * Math.sin(2 * Math.PI * inputHz * i / 44100);
      }
      function frequency(buffer) {
        const pcm = buffer.getChannelData(0);
        const crossings = [];
        for (let i = 4410; i < 30000; i++) if (pcm[i - 1] <= 0 && pcm[i] > 0) crossings.push(i - 1 + -pcm[i - 1] / (pcm[i] - pcm[i - 1]));
        return (crossings.length - 1) * buffer.sampleRate / (crossings[crossings.length - 1] - crossings[0]);
      }
      const engine = new root.BlueLoopAudio.Engine();
      const audioLane = { ...lane('tone', '2:unknown'), buffer, volume: .7 };
      const expected = 440 * Math.pow(2, (60 - 69) / 12);
      const event = { laneId: 'tone', step: 0, startRatio: 0, sourceChop: 1, durationSteps: 8, semitones: 0, velocity: 1, reverse: false };
      const renderSettings = { ...settings, targetKey: '0:major', bars: 2, bpm: 120, chop: 1 };
      audioLane.keyShift = sync.plan([audioLane], renderSettings).entries[0].shift;
      const rendered = await engine.render([audioLane], renderSettings, [event]);
      check('Rendered PCM is audibly retuned from D4 to C4', Math.abs(frequency(rendered) - expected) < .05);
      check('Retuning keeps exact bar length', rendered.length === 176400);
      const octave = await engine.render([audioLane], renderSettings, [{ ...event, semitones: -12 }]);
      check('Key correction adds to creative octave movement', Math.abs(frequency(octave) - expected / 2) < .05);
      const natural = await engine.render([{ ...audioLane, keyShift: 0 }], renderSettings, [event]);
      check('Disabling correction restores original frequency', Math.abs(frequency(natural) - inputHz) < .05);
      const minorLane = { ...audioLane, detectedKey: key('9:minor') };
      minorLane.keyShift = sync.plan([minorLane], renderSettings).entries[0].shift;
      const reinterpreted = await engine.render([minorLane], renderSettings, [event]);
      check('Relative-major reinterpretation alone leaves rendered PCM unchanged', reinterpreted.getChannelData(0).every((sample, index) => sample === natural.getChannelData(0)[index]));
      const file = new DataView(await engine.encodeWav(rendered).arrayBuffer());
      const wavPcm = new Float32Array(rendered.length);
      for (let i = 0; i < wavPcm.length; i++) wavPcm[i] = file.getInt16(44 + i * 4, true) / 32768;
      check('WAV contains corrected PCM, not source pitch', Math.abs(frequency({ sampleRate: 44100, getChannelData: () => wavPcm }) - expected) < .05);
    }
    return { passed: results.length, failed: 0, results };
  }
  root.runKeySyncTests = runKeySyncTests;
})(typeof window !== 'undefined' ? window : globalThis);
