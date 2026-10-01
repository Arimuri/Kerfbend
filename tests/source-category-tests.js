(function (root) {
  'use strict';

  root.runSourceCategoryTests = function () {
    const categories = root.BlueLoopSourceCategory;
    if (!categories) throw new Error('Load js/source-category.js before source-category-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Source category test failed: ' + label);
      assertions.push({ label, passed: true });
    }

    const drums = [
      'kick.wav', 'pack_KICK01_C.wav', '808_kick_C1.wav', 'KickLoop120.wav',
      'AcousticDrumLoop.wav', 'pack_HH03.wav', 'hh01.wav', 'snare-12.wav',
      'Clap02.wav', 'hihat.wav', 'HiHatLoop.wav', 'hi-hats_closed.wav',
      'drums_120bpm.wav', 'PercLoop.wav', 'percussion01.wav', 'cymbal.aiff',
      'shakers_100.wav', 'ride01.wav', 'RideLoop.wav', 'tom.wav', 'tom01.wav',
      'floor_tom.wav', 'FloorTom.wav', 'TomFill.wav', 'tambourine.wav',
      'Rimshot02.wav', 'rim-shot.wav', 'Cowbell.wav', 'CowBellLoop.wav',
      'ドラムループ.wav', 'キック01.wav', 'スネア.wav', 'クラップ.wav',
      'ハイハット.wav', 'パーカッション.wav', 'シンバル.wav', 'シェイカー.wav',
      'シェーカー.wav', 'ライド01.wav', 'ライドループ.wav', 'タム01.wav',
      'フロアタム.wav', 'タンバリン.wav', 'リムショット.wav', 'カウベル.wav',
      'Ｋｉｃｋ０１.wav', '/samples/piano/snare.wav', 'C:\\samples\\bass\\kick.wav',
    ];
    drums.forEach(function (name) {
      assert(categories.inferFilename(name) === 'drums', 'Recognize ' + name);
    });
    const others = [
      '', null, undefined, 808, {}, '808.wav', '808_C1.wav', 'bass.wav',
      'sub_bass_C.wav', 'piano_Cmaj.wav', 'noise.wav', 'atonal_texture.wav',
      'untagged.wav', 'kickstarter.wav', 'sidekick.wav', 'handclapping.wav',
      'percolate.wav', 'shakespeare.wav', 'brides.wav', 'slide.wav',
      'tomorrow.wav', 'phantom.wav', 'TomPiano.wav', 'TomJones.wav',
      'custom.wav', 'カスタム.wav', 'スライドギター.wav', 'グライド.wav',
      '/samples/drums/piano.wav', 'C:\\samples\\kick\\piano.wav',
    ];
    others.forEach(function (name) {
      assert(categories.inferFilename(name) === 'other', 'Leave unclassified ' + String(name));
    });

    assert(categories.groups.length === 2 && categories.groups[0].id === 'other' &&
      categories.groups[0].label === 'その他' && categories.groups[1].id === 'drums' &&
      categories.groups[1].label === 'ドラム', 'Stable group order and labels');
    assert(categories.get({ category: 'drums', kind: 'upload' }) === 'drums', 'Uploaded drum category');
    assert(categories.get({ category: 'other', kind: 'drums' }) === 'other', 'Manual category overrides demo kind');
    assert(categories.get({ kind: 'drums' }) === 'drums', 'Legacy drum demo fallback');
    assert(categories.get({ category: 'invalid', kind: 'drums' }) === 'drums', 'Invalid category uses legacy fallback');
    assert(categories.get({ kind: 'upload', name: 'kick.wav' }) === 'other', 'Grouping does not re-infer a filename');
    assert(categories.get({ detectedKey: { status: 'unpitched' } }) === 'other', 'Unpitched audio alone is not a drum');
    assert(categories.get({ kind: 'bass' }) === 'other', 'Pitched demo is other');
    assert(categories.get(null) === 'other' && categories.get() === 'other', 'Missing lane safely falls back');
    const lane = { category: 'other', kind: 'drums', events: [{ step: 0 }] };
    const before = JSON.stringify(lane);
    categories.get(lane);
    assert(JSON.stringify(lane) === before, 'Classification does not change source or events');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
