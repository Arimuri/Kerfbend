(function (root) {
  'use strict';

  const groups = Object.freeze([
    Object.freeze({ id: 'other', label: 'その他' }),
    Object.freeze({ id: 'drums', label: 'ドラム' }),
  ]);

  function get(lane) {
    if (lane && (lane.category === 'drums' || lane.category === 'other')) return lane.category;
    return lane && lane.kind === 'drums' ? 'drums' : 'other';
  }

  function inferFilename(filename) {
    if (typeof filename !== 'string' || !filename.trim()) return 'other';
    const name = filename.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').normalize('NFKC');
    // Sample packs use both separators and CamelCase, often with a take number.
    const words = name.replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase();
    const percussion = /(?:^|[^a-z0-9])(?:kicks?|snares?|claps?|hi[\s_-]?hats?|hh|drums?|percs?|percussions?|cymbals?|shakers?|rides?|tambourines?|rim[\s_-]?shots?|cow[\s_-]?bells?)\d*(?=$|[^a-z0-9])/;
    if (percussion.test(words)) return 'drums';

    // "Tom" can also be a person's name. Accept a separate marker, a numbered
    // hit, or familiar drum descriptions, rather than every CamelCase name.
    const tomMarker = /(?:^|[^a-z0-9])toms?\d*(?=$|[^a-z0-9])/i;
    const tomDescription = /(?:^|[^a-z0-9])(?:(?:floor|rack|low|high)[\s_-]+toms?\d*|toms?\d*[\s_-]+(?:loops?|hits?|fills?|shots?|drums?|percs?))(?=$|[^a-z0-9])/;
    if (tomMarker.test(name) || tomDescription.test(words)) return 'drums';

    if (/(?:ドラム|キック|スネア|クラップ|ハイハット|パーカッション|シンバル|シェイカー|シェーカー|タンバリン|リムショット|カウベル|フロアタム|ロータム|ハイタム)/.test(name)) return 'drums';
    // Avoid treating カスタム and スライド as drum labels.
    if (/(?:^|[\s_.\-()[\]0-9])(?:タム|ライド)(?=$|[\s_.\-()[\]0-9]|ループ|ヒット|フィル|ワンショット)/.test(name)) return 'drums';
    return 'other';
  }

  root.BlueLoopSourceCategory = Object.freeze({ groups, get, inferFilename });
})(typeof window !== 'undefined' ? window : globalThis);
