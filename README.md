# Kerfbend

A browser-based loop generator for in the blue shirt. Kerfbend detects keys from filenames or audio, aligns sources using major-key references, and generates chopped phrases. FFT processing uses fft.js 4.0.4 under the MIT license. See [Third-party notices](THIRD_PARTY_NOTICES.md) for bundled code and data, and [Implementation notes](docs/reference-algorithms.md) for details of the processing methods.

## Getting started

Open `index.html` in Chrome or Safari. No build, installation, or server is required. All audio processing runs locally in your browser without network requests.

To use a local server:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://localhost:8000`.

## Usage

The interface currently uses Japanese labels; button names below are translated into English.

1. Play the demos or drag in your own audio files. The demos are synthesized sounds, not recordings by the artist. Click ▶ beside a source name to preview up to four seconds of the original audio, or × to remove it. **Clear all** in the source panel removes both drum and other sources. Use ↶ to undo.
2. `KEY SYNC` is enabled by default. Keys in filenames take priority; otherwise, Kerfbend analyzes the audio. Minor keys are interpreted as their relative majors, and target keys are selected as major keys. You can correct each source's original key, including minor-key labels, or disable correction for that source.
3. `busy` controls note density, `breaks` sets how the loop breathes at phrase ends, `size` controls slice and note lengths, and `motion` controls reverse playback. At `breaks` 0 the loop plays continuously. Above 0, every four bars (or the end of a shorter loop) closes with a fill—drums roll in sixteenths, the lead stutters and leaves the last sixteenth open, and bass and answering parts drop out—and all parts share one rest of whole beats that ends on a two-bar boundary; it lengthens as `breaks` rises, up to half the loop. The downbeat after a rest or fill lands on bar one's opening cut without octave shifts or reverse. `octave` independently sets the probability of a one-octave shift up or down (0–100%, default 12%). At 0%, no slices shift; at 100%, every slice shifts in one direction. The down-to-up selection ratio is 1:3. Locked lanes retain their existing placement and octave shifts.
4. Click **New phrase** to generate another arrangement. `LOCK` preserves a lane's slices and placement, `M` mutes it, and `S` solos it. Each lane also has a volume control.
5. Click **Export WAV** to save a loop for your DAW. Output is 44.1 kHz, 16-bit stereo, with a duration matching the selected BPM and number of bars. Export uses the same audio buffer as playback, including key correction. `MONITOR` adjusts listening volume only.

**+ Generate FM Source** creates an original phrase using sine-wave FM synthesis at the current BPM and bar length. Adjust the key, base octave (default 2), modulation frequency ratio, FM amount, decay, and note density. The FM amount defaults to 0, which produces a pure sine wave; raising it adds FM overtones. Slices of FM sources fade out over 30 ms, so cutting a sine note mid-cycle does not click. **Generate & preview** plays the complete phrase before chopping; **Another phrase** changes its SEED. **Add source & chop** adds it to the Other group. FM sources are cut at their note boundaries rather than into equal slices: each cut is a run of whole notes that starts at a note onset and keeps its internal rhythm. `size` sets the run length (below 25%: single notes; 25–74%: one or two notes; 75% and above: two or three notes), and a run that jumps elsewhere lands on the same part of the beat it occupied in the original phrase. Its major key is recorded during synthesis, so audio analysis is unnecessary. Key sync, voice limits, effects, and WAV export all apply. Use ↶ to undo the addition. Generated and imported sources share the same source-count and total-duration limits. Changing synthesis settings or BPM does not regenerate sources already added; generate and add a new source instead.

**Roles.** Each source plays a part: **Lead** (主役), **Bass** (ベース), or **Answer** (合いの手); drum sources keep a drum part. Kerfbend picks one lead and one bass automatically from names such as vocal, chop, or lead and bass, 808, or sub, from the demo kinds, and from FM sources in octaves 1–2; every other source answers. The bass plays its own rhythm cells that land on every downbeat, holds notes until the next onset, repeats its cuts more often, and never shifts an octave up. Answering parts play sparingly while the lead sounds and freely in its gaps. Use **Role** in the source panel to override the choice; changing a role rebuilds unlocked lanes with the same SEED. Adding or removing other parts never changes the lead. A category change keeps the existing placement; a drum role takes effect from the next phrase.

Sources are automatically classified as **Drums** or **Other** based on their filenames. You can change the category in the source panel. Each group has an independent **voice limit** of 1–8 simultaneous sounds (default 8 each). If overlapping slices exceed a group's limit, some are omitted from playback. Sources and their original arrangements are retained, so raising the limit restores the omitted slices. Muted lanes, lanes excluded by solo, and lanes at zero volume do not use voice slots. `LOCK` preserves the original arrangement, while playback still follows the voice limits. Category and limit changes can be undone. Loop playback and WAV export use the same limits.

`PITCH ENV` briefly shifts each slice's pitch up or down at random, then returns it to its original pitch. Depth ranges from 0–24 semitones (0 disables the effect), and return time ranges from 5–500 ms. **Depth spread** gives each slice its own depth between zero and the set depth, and **speed spread** makes each slice's return up to four times faster or slower (still within 5–500 ms). **Chance per part** sets, for each source, the share of its slices that receive the envelope (0–100%, default 100%); raising a part's chance keeps the slices that already had one. The envelope is applied after key sync and octave shifts. A given slice keeps the same direction, depth, and return time across playback and export. Changing these settings preserves sources and slice placement, and also affects locked lanes. Short slices may end before their pitch fully returns.

Keyboard shortcuts: **Space** to play or stop, **R** for a new phrase, and **⌘/Ctrl + Z** to undo up to 12 actions. Normal input and control behavior takes priority when a field or button has focus.

## Automatic key alignment

For imported sources, key information is prioritized as **manual override → filename → audio analysis**.

**All tonal sources are processed using major-key references.** Original key information is retained, while minor keys are interpreted as their relative majors: `A minor → C major`, `D minor → F major`, and `F# minor → A major`. This reinterpretation alone does not change the audio's pitch. The source panel shows both the original key and the processing key; target keys and export filenames use major-key labels.

- **Filenames:** Supports names such as `vocal_128_F#min.wav`, `piano_Bb_minor.wav`, `loop_D major.wav`, `pad_8A.wav`, and `808_C1.wav`. Enharmonic spellings, Camelot notation, and Unicode ♯/♭ symbols are normalized. Note-only labels do not imply a major or minor key. Parsing avoids mistaking ordinary words, BPM values, or take numbers for keys. Conflicting key labels fall back to audio analysis.
- **Audio analysis:** Uses FFT after band limiting, pitch-peak detection, a 12-pitch-class distribution (chroma), and comparison with major/minor profiles. Up to 96 windows are sampled across the full source, including long files, with processing yielding periodically to keep the interface responsive. Stereo channels are analyzed by power separately to handle opposite-polarity signals.
- **Single notes and uncertain keys:** A single note retains its note-only label and uses the same root's major key as a processing convention—for example, a D note uses D major. This does not mean the analyzer has identified its mode. Clear chords are analyzed for root and mode; competing keys leave correction pending. Silence, noise, and clearly named percussion are not automatically transposed. You can set the key manually in the source menu.
- **Automatic target selection:** User sources, including generated FM phrases, take priority over demos. Within that group, keys with a known mode take priority over root-only labels, and explicitly known keys take priority over estimates. The selected reference source is not transposed. Adding or removing sources, or correcting an original key, can change the reference. Select a target manually to keep it fixed.
- **Transposition:** Key sync uses the difference between the source's major-reference tonic and the target tonic, regardless of whether the key came from a filename, a manual setting, or analysis. It chooses the shortest semitone distance, shifting downward for an exact six-semitone tie. Chroma is used only to estimate source keys; key alignment does not use chroma scoring or similarity thresholds. Correction is applied consistently to the entire source rather than re-estimated for each slice.
- **Relative-major examples:** `A minor` uses C major as its reference, so it shifts by 0 semitones for a C major target and +2 for D major. `D minor` uses F major, so it shifts by −5 semitones for C major. This does not convert the source's chords or chord progression from minor to major.
- **Accuracy:** Analysis is an estimate. Short phrases, key changes, or complex chords may produce incorrect or uncertain results; you can correct the original key manually. Tuning offsets are considered during detection, but cent-level correction is not applied.

## Features and limits

- Up to 16 sources, 2/4/8 bars, 40–200 BPM, and swing.
- Up to 40 MB and 120 seconds per file, with 240 seconds of source audio in total. Supported formats depend on the browser's decoder. WAV and MP3 are generally straightforward; formats such as AIFF may not load in every environment.
- The same sources, lane IDs, roles, settings, and SEED produce the same arrangement. Locked lanes retain their previous arrangement, and answering parts follow a locked lead.
- Each lane builds one-bar phrases and arranges them as A → A′ → B → A: A′ keeps the first three beats of A and replaces its last beat, and B is a contrasting bar with another rhythm from another part of the source. Two-bar loops play A → A′; eight-bar loops repeat the form, vary the ending of the second B, and close on A′. Imported and demo sources are divided into equal slices, with short fades to reduce clicks; FM sources are cut into runs of whole notes.
- Adjustments redraw and re-render the phrase. If playback is active, it restarts from the beginning of the loop. Playback and WAV export use the same audio buffer.
- Tempo, swing, mixer, and key-sync changes also affect locked lanes. Shortening the loop removes events outside its new range and trims its end.
- Pitch combines key-sync correction, `octave` shifts of ±1 octave, and `PITCH ENV` changes at the start of each slice. Pitch changes also affect playback speed. Independent time-stretching and transient detection are not implemented.
- Project saving, stem export, video, and cloud features are not implemented. Reloading or closing the page clears sources and edits, so export any loops you want to keep as WAV files.

## Project structure and verification

- `js/generator.js`: Seeded event generation, including roles, the A → A′ → B → A form, note-boundary cuts, rests, and lane locks.
- `js/fm-synth.js`: Seeded major-scale phrases and sine-wave FM synthesis.
- `js/audio-engine.js`: Web Audio, synthesized demos, file decoding, rendering with `OfflineAudioContext`, and WAV encoding.
- `js/playback-plan.js`: Independent voice limits for drum and other sources while preserving the original arrangement. Overlap detection includes swing and is shared by waveform display and audio rendering.
- `js/pitch-envelope.js`: Per-slice pitch envelopes, playback rates, and source read positions.
- `js/source-category.js`: Filename-based drum classification and manual category overrides.
- `js/filename-key.js`: Key extraction from filenames.
- `js/key-analysis.js`: Pitch and key estimation from audio.
- `vendor/fft.js/`: Pinned FFT implementation, full MIT license, provenance, and hashes. No runtime CDN access or npm installation is required.
- `js/key-sync.js`: Key-information priority, target selection, and transposition calculations.
- `js/app.js`: Interface, undo history, version tracking for asynchronous renders, source import, and waveform display.
- `styles.css`: Desktop and mobile layouts.

Open `tests/index.html` in a browser and click **Run tests** to verify generation reproducibility and locks; FM pitch, waveforms, and reproducibility; voice limits and arrangement preservation; filename parsing and false positives; key analysis of synthesized audio; relative keys and key-information priority; and actual Web Audio/WAV pitch, duration, reverse playback, and peak limiting. Key analysis is tested with synthesized audio; evaluation against labeled real recordings has not yet been performed.

FFT is checked against a direct DFT and a known 4096-sample signal. Run `python3 scripts/verify_vendor.py` to verify the bundled hashes of third-party source code and license texts.

## Attribution, licenses, and source snapshots

See [License notices](licenses.html), [Third-party notices](THIRD_PARTY_NOTICES.md), and [Source snapshot documentation](docs/publication.md). Licensing for the application itself is separate from the terms covering third-party code and data.

Run `python3 scripts/export_source.py` to create `exports/kerfbend-source.zip` containing only committed files. Git history, local settings, and imported audio are excluded.
