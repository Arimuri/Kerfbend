# Third-party notices and references

確認日: 2026-10-02（日本時間）

Kerfbend に含めている第三者の実装・数値表と、設計を参考にした資料を記録します。ライセンスの適用範囲は各項目に記載しています。

## 含めている実装・数値表

| 項目 | Kerfbend での使用箇所・範囲 | ライセンス・表示 |
| --- | --- | --- |
| fft.js 4.0.4 / Fedor Indutny | `vendor/fft.js/fft.js`。音声キー解析の FFT 実装全体と、ブラウザ用の接続部分 | MIT。著作権・許諾・免責の全文をソース先頭と [LICENSE](vendor/fft.js/LICENSE) に保存 |
| Partitura v1.2.1 掲載の Krumhansl–Kessler profiles | `js/key-analysis.js` の `PROFILES`。major/minor 各12個、計24個の数値のみ | 取得元の Apache-2.0 を [ライセンス原文](licenses/partitura-Apache-2.0.txt) と本書に記録 |
| Mulberry32 | `js/generator.js`・`js/fm-synth.js` の `randomFor`、`js/audio-engine.js` の `randomSource`、`js/pitch-envelope.js` の `unit`、`js/glitch.js` の `randomFor` にある乱数更新部分 | Tommy Ettinger の原実装は CC0。下記 bryc の JavaScript 実装は Public domain と明記 |

### fft.js

- 上流: [indutny/fft.js](https://github.com/indutny/fft.js)
- バージョン: `4.0.4`
- 固定コミット: `f8be92e1369f684da3e121e4c5b7fbcc8d50f868`
- 取得元: [lib/fft.js](https://github.com/indutny/fft.js/blob/f8be92e1369f684da3e121e4c5b7fbcc8d50f868/lib/fft.js)
- ライセンス確認元: [同コミットの README の LICENSE 節](https://github.com/indutny/fft.js/blob/f8be92e1369f684da3e121e4c5b7fbcc8d50f868/README.md#license)
- 著作権表示: `Copyright Fedor Indutny, 2017.`

上流の `lib/fft.js` 本文は変更せず、MIT 表示の全文、ローカルな CommonJS `module` を用意する囲み、`KerfbendFFT` として公開する接続部分を追加しています。取得 URL、上流と配布ファイルの SHA-256、変更点は [provenance.json](vendor/fft.js/provenance.json) に記録しています。

この実装をコピー・再配布する場合は、MIT の著作権表示と許諾表示を保持してください。全文は [vendor/fft.js/LICENSE](vendor/fft.js/LICENSE) にあります。

### Krumhansl–Kessler profiles / Partitura

- 取得元: [Partitura v1.2.1 の key_identification.py](https://github.com/CPJKU/partitura/blob/fc3e42a02ab6877e65d8482ea51b06361a4830f0/partitura/musicanalysis/key_identification.py)
- 固定コミット: `fc3e42a02ab6877e65d8482ea51b06361a4830f0`
- 該当項目: `key_prof_maj_kk` と `key_prof_min_kk`
- ライセンス確認元: [同コミットの LICENSE](https://github.com/CPJKU/partitura/blob/fc3e42a02ab6877e65d8482ea51b06361a4830f0/LICENSE)
- 著作権表示: `Copyright 2022, Maarten Grachten, Carlos Cancino-Chacón, Silvan Peter, Emmanouil Karystinaios, Francesco Foscarin`

変更範囲は、上記2個の数値配列を Python の NumPy 配列から JavaScript の `PROFILES.major` / `PROFILES.minor` に転記した部分です。数値は変更していません。Partitura の Python 処理、その他のプロファイル、パッケージ本体は含めていません。数値表の取得元を明確にするため、取得元の Apache-2.0 ライセンスと著作権表示を保持しています。参照した版の配布ルートに別個の `NOTICE` ファイルはありませんでした。

ライセンス原文は [licenses/partitura-Apache-2.0.txt](licenses/partitura-Apache-2.0.txt) に変更せず保存しています。SHA-256 は `99fc6ac5e7720d5f6a928d86ae9a532559559e92bbaa4504e6c3d49062bf6bd2` です。この表を含む配布では、取得元のライセンス、著作権表示、上記の変更範囲を保持してください。

表の学術的出典は、Partitura が挙げる次の文献です。

Carol L. Krumhansl (1990), *Cognitive Foundations of Musical Pitch*, Oxford University Press, p. 30. [出版社の書誌情報](https://academic.oup.com/book/40395/chapter-abstract/347202746)（初版1990年、ペーパーバック2001年）。書籍本文や図版は含めていません。

### Mulberry32

- 原アルゴリズム: Tommy Ettinger, 2017。[作者の公開実装と CC0 表示](https://gist.github.com/tommyettinger/46a874533244883189143505d203312c)
- JavaScript 実装の確認元: [bryc/code の Mulberry32](https://github.com/bryc/code/blob/88c1317ea6f9b25c153afa9c369c365fed11b482/jshash/PRNGs.md#mulberry32)
- JavaScript 資料の固定コミット: `88c1317ea6f9b25c153afa9c369c365fed11b482`
- ライセンス: 原実装は [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)、上記 JavaScript 資料は冒頭で `License: Public domain.` と明記。

Kerfbend の乱数更新部分は、これらの公開実装と同じ Mulberry32 の定数・更新式を使用しています。変数名と周囲の処理をアプリに合わせています。`randomFor` では文字列からの seed 作成とレーン別の状態管理を加えています。`unit` では断片情報のハッシュを seed として1回だけ更新し、0以上1未満の値に変換しています。この記録は既存の短い実装に対応する出典を公開前に確認したもので、最初の実装時にどの掲載箇所から取得したかまで確定するものではありません。出典を追跡できるよう、作者と確認元を記載しています。

## 方式の参考資料

### Essentia のアルゴリズム説明

[HPCP](https://essentia.upf.edu/reference/std_HPCP.html) と [Key](https://essentia.upf.edu/reference/std_Key.html) の説明を、スペクトルのピークから音高クラス分布を求め、キーのプロファイルと照合する方式の参考にしています。Essentia のライブラリ、WASM、C++ 実装は同梱・読み込みしていません。

## 配布に含める表示

ソース配布や静的サイトの配布には、このファイル、`vendor/fft.js/LICENSE`、`vendor/fft.js/provenance.json`、`licenses/partitura-Apache-2.0.txt` を含め、各ソース内の第三者表示を保持してください。ファイルの結合や minify を行う場合も、対象の著作権・許諾表示を落とさないようにしてください。
