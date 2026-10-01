(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const generator = window.BlueLoopGenerator;
  const harmony = window.BlueLoopKeySync;
  const categories = window.BlueLoopSourceCategory;
  const engine = new window.BlueLoopAudio.Engine();
  const MAX_SOURCES = 16;
  const MAX_TOTAL_SECONDS = 240;
  const colors = ['#a7d1ff', '#d6bfff', '#e7e68c', '#ffb99f', '#9dd8c8', '#efb8d3', '#b7c6f5', '#ddc5a1'];
  const state = { settings: { ...generator.defaults, pitchEnvDepth: 0, pitchEnvTime: 80, pitchEnvDepthRandom: 0, pitchEnvTimeRandom: 0, keySync: true, targetKey: 'auto', maxVoices: 8, maxDrumVoices: 8 }, seed: 'BLUE01', lanes: [], events: [], buffer: null };
  const envelopeChances = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0];
  const history = [];
  const peaks = new WeakMap();
  let renderVersion = 0;
  let pendingRender = Promise.resolve();
  let rendering = false;
  let importing = false;
  let playing = false;
  let toastTimer;
  let uploadNumber = 0;
  let lastPosition = '';
  let analysisLabel = '';
  let keyPlan = harmony.plan([], state.settings);
  let fmNumber = 0;
  let fmDraft = null;
  let fmBusy = false;
  let fmVersion = 0;
  let fmPreviewSource = null;

  function fillKeyOptions(select, includeNotes = false) {
    ['major', ...(includeNotes ? ['minor', 'unknown'] : [])].forEach((mode) => {
      const group = document.createElement('optgroup');
      group.label = { major: 'Major', minor: 'Minor', unknown: '単音・ルートのみ' }[mode];
      harmony.notes.forEach((note, tonic) => {
        const option = document.createElement('option');
        option.value = `${tonic}:${mode}`;
        const original = harmony.fromValue(`${tonic}:${mode}`);
        option.textContent = mode === 'major' ? `${note} major` : `${note}${mode === 'minor' ? ' minor' : ' (note)'} → ${harmony.format(harmony.toMajor(original))}`;
        group.append(option);
      });
      select.append(group);
    });
  }

  function updateKeyPlan() {
    keyPlan = harmony.plan(state.lanes, state.settings);
    state.lanes.forEach((lane) => { lane.keyShift = keyPlan.byId[lane.id].shift; });
  }

  function notify(message, duration = 3500) {
    clearTimeout(toastTimer);
    $('status').textContent = message;
    $('status').classList.add('visible');
    toastTimer = setTimeout(() => $('status').classList.remove('visible'), duration);
  }

  function snapshot() {
    return {
      settings: { ...state.settings }, seed: state.seed,
      lanes: state.lanes.map((lane) => ({ ...lane, events: lane.events.map((event) => ({ ...event })) })),
    };
  }

  function remember() {
    history.push(snapshot());
    if (history.length > 12) history.shift();
    $('undo-button').disabled = false;
  }

  function getEvents() {
    state.events = state.lanes.flatMap((lane) => lane.events);
  }

  function regenerateEvents() {
    const events = generator.generate(state.lanes, state.settings, state.seed);
    state.lanes.forEach((lane) => { lane.events = events.filter((event) => event.laneId === lane.id); });
    getEvents();
  }

  function updateButtons() {
    const empty = state.lanes.length === 0;
    $('play-button').disabled = empty || (!playing && (rendering || !state.buffer));
    $('generate-button').disabled = empty || importing;
    $('undo-button').disabled = history.length === 0 || importing;
    $('export-button').disabled = empty || rendering || !state.buffer || importing;
    $('demo-button').disabled = importing || state.lanes.length >= MAX_SOURCES;
    $('fm-button').disabled = importing || state.lanes.length >= MAX_SOURCES;
    $('clear-sources-button').disabled = importing || empty;
    $('file-input').disabled = importing;
    $('key-sync').disabled = importing;
    $('target-key').disabled = importing || !state.settings.keySync;
    $('max-voices').disabled = importing;
    $('max-drum-voices').disabled = importing;
    ['pitch-env-depth', 'pitch-env-time', 'pitch-env-depth-random', 'pitch-env-time-random'].forEach((id) => { $(id).disabled = importing; });
    document.querySelectorAll('.source-key, .source-category, .pitch-envelope-lane select').forEach((select) => { select.disabled = importing; });
    document.body.classList.toggle('busy', rendering || importing);
    document.body.classList.toggle('playing', playing);
    $('play-button').classList.toggle('is-playing', playing);
    $('play-label').textContent = playing ? '停止' : '再生';
    $('play-icon').textContent = playing ? '■' : '▶';
    $('live-label').textContent = importing ? (analysisLabel ? 'ANALYZING KEY…' : 'LOADING SOUNDS…') : rendering ? 'BUILDING PHRASE…' : playing ? 'LOOP IS PLAYING' : empty ? 'ADD A SOUND' : 'READY TO PLAY';
    $('live-label').title = analysisLabel;
    $('live-label').classList.toggle('playing', playing);
    $('undo-button').title = `元に戻す (⌘/Ctrl + Z) — ${history.length}`;
  }

  function stop() {
    playing = false;
    engine.stop();
    updateButtons();
  }

  function renderAudio() {
    updateKeyPlan();
    const version = ++renderVersion;
    const lanes = state.lanes.map((lane) => ({ ...lane }));
    const settings = { ...state.settings };
    const events = state.events.map((event) => ({ ...event }));
    if (!lanes.length) {
      stop();
      state.buffer = null;
      rendering = false;
      pendingRender = Promise.resolve();
      updateButtons();
      return pendingRender;
    }
    rendering = true;
    updateButtons();
    pendingRender = (async () => {
      try {
        const buffer = await engine.render(lanes, settings, events);
        if (version !== renderVersion) return;
        state.buffer = buffer;
        if (playing) await engine.play(buffer);
      } catch (error) {
        if (version === renderVersion) {
          state.buffer = null;
          stop();
          notify(error.message || '音声を生成できませんでした。', 6500);
        }
      } finally {
        if (version === renderVersion) {
          rendering = false;
          updateButtons();
        }
      }
    })();
    return pendingRender;
  }

  function rangeFill(input) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    input.style.setProperty('--fill', `${(Number(input.value) - min) / (max - min) * 100}%`);
  }

  function syncSettings() {
    ['bpm', 'bars', 'density', 'breaks', 'size', 'motion', 'octave', 'swing'].forEach((key) => {
      $(key).value = state.settings[key];
      const output = $(`${key}-output`);
      if (output) output.innerHTML = key === 'swing' ? `${state.settings[key]}%` : `${state.settings[key]}<span>%</span>`;
      if ($(key).type === 'range') rangeFill($(key));
    });
    $('seed').value = state.seed;
    $('max-voices').value = state.settings.maxVoices;
    $('max-drum-voices').value = state.settings.maxDrumVoices;
    $('pitch-env-depth').value = state.settings.pitchEnvDepth;
    $('pitch-env-time').value = state.settings.pitchEnvTime;
    $('pitch-env-depth-random').value = state.settings.pitchEnvDepthRandom;
    $('pitch-env-time-random').value = state.settings.pitchEnvTimeRandom;
    showPitchEnvelope();
    $('duration').textContent = `${generator.duration(state.settings).toFixed(2)} SEC / LOOP`;
    $('key-sync').checked = state.settings.keySync;
    $('target-key').value = state.settings.targetKey === 'auto' ? 'auto' : `${keyPlan.target.tonic}:major`;
    $('resolved-key').textContent = state.settings.keySync ? (keyPlan.target ? harmony.format(keyPlan.target) : '基準キー未定') : 'OFF';
    const anchor = state.settings.targetKey === 'auto' ? (keyPlan.target && keyPlan.target.laneName ? `基準：${keyPlan.target.laneName}` : 'キー付きの素材を追加してください') : '手動で指定';
    $('key-anchor').textContent = state.settings.keySync ? anchor : '元のピッチで再生';
    $('key-anchor').title = $('key-anchor').textContent;
  }

  function showPitchEnvelope() {
    const depth = Number($('pitch-env-depth').value);
    const milliseconds = Number($('pitch-env-time').value);
    const depthSpread = Number($('pitch-env-depth-random').value);
    const timeSpread = Number($('pitch-env-time-random').value);
    $('pitch-env-depth-output').textContent = depth ? `±${depth} st` : 'OFF';
    $('pitch-env-time-output').textContent = `${milliseconds} ms`;
    $('pitch-env-depth-random-output').textContent = `${depthSpread}%`;
    $('pitch-env-time-random-output').textContent = `${timeSpread}%`;
    ['pitch-env-depth', 'pitch-env-time', 'pitch-env-depth-random', 'pitch-env-time-random'].forEach((id) => rangeFill($(id)));
    const draw = (suffix, semitones, milliseconds) => {
      const height = semitones / 24 * 20;
      const end = 15 + Math.min(500, Math.max(5, milliseconds)) / 500 * 125;
      $(`pitch-env-up${suffix}`).setAttribute('d', `M5 ${25 - height} L${end} 25 H155`);
      $(`pitch-env-down${suffix}`).setAttribute('d', `M5 ${25 + height} L${end} 25 H155`);
    };
    draw('', depth, milliseconds);
    // The faint pair marks the smallest, fastest end of the per-slice spread.
    draw('-range', depth && (depthSpread || timeSpread) ? depth * (1 - depthSpread / 100) : 0,
      milliseconds * Math.pow(4, -timeSpread / 100));
  }

  function pitchEnvelopeLanes() {
    const list = $('pitch-env-lane-list');
    list.replaceChildren();
    if (!state.lanes.length) {
      const empty = document.createElement('span');
      empty.className = 'pitch-envelope-lanes-empty';
      empty.textContent = '素材を追加するとパートごとに設定できます';
      list.append(empty);
      return;
    }
    categories.groups.flatMap((category) => state.lanes.filter((lane) => categories.get(lane) === category.id)).forEach((lane) => {
      const item = document.createElement('label');
      item.className = 'pitch-envelope-lane';
      item.dataset.laneId = lane.id;
      item.style.setProperty('--lane-color', lane.color);
      item.innerHTML = '<i aria-hidden="true"></i><span></span><select></select>';
      item.querySelector('span').textContent = lane.name;
      item.title = `${lane.name}：PITCH ENVがかかる断片の割合`;
      const select = item.querySelector('select');
      envelopeChances.forEach((chance) => {
        const option = document.createElement('option');
        option.value = String(chance);
        option.textContent = `${chance}%`;
        select.append(option);
      });
      const current = laneEnvelopeChance(lane);
      select.value = String(current);
      select.disabled = importing;
      select.setAttribute('aria-label', `${lane.name} のPITCH ENV発生確率`);
      item.classList.toggle('is-off', current === 0);
      select.addEventListener('change', () => {
        if (importing) { select.value = String(laneEnvelopeChance(lane)); return; }
        const value = Number(select.value);
        if (!envelopeChances.includes(value) || value === laneEnvelopeChance(lane)) return;
        remember();
        lane.pitchEnvChance = value;
        updateView();
        renderAudio();
      });
      list.append(item);
    });
  }

  function laneEnvelopeChance(lane) {
    const value = Number(lane && lane.pitchEnvChance);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
  }

  function playbackEvents() {
    return window.BlueLoopPlayback.plan(state.lanes, state.settings, state.events);
  }

  function sourceList() {
    const list = $('source-list');
    list.replaceChildren();
    const groups = new Map(categories.groups.map((category) => {
      const group = document.createElement('section');
      group.className = 'source-group';
      group.dataset.category = category.id;
      group.setAttribute('aria-label', `${category.label}の素材`);
      const heading = document.createElement('h3');
      const count = state.lanes.filter((lane) => categories.get(lane) === category.id).length;
      heading.textContent = `${category.label} · ${count}`;
      const rows = document.createElement('div');
      rows.className = 'source-group-list';
      group.append(heading, rows);
      if (!count) {
        const empty = document.createElement('p');
        empty.className = 'source-group-empty';
        empty.textContent = '素材なし';
        rows.append(empty);
      }
      list.append(group);
      return [category.id, rows];
    }));
    state.lanes.forEach((lane) => {
      const row = document.createElement('div');
      row.className = 'source-item';
      row.dataset.laneId = lane.id;
      row.dataset.category = categories.get(lane);
      row.style.setProperty('--lane-color', lane.color);
      row.innerHTML = '<i class="source-color"></i><div><span class="source-title"></span><span class="source-detail"></span></div><button class="source-preview" type="button">▶</button><button class="source-remove" type="button">×</button><label class="source-category-control">分類 <select class="source-category"><option value="other">その他</option><option value="drums">ドラム</option></select></label><div class="source-tuning"><select class="source-key"></select><span class="key-shift"></span></div><span class="source-major-note"></span>';
      const filename = lane.filename || lane.name;
      row.querySelector('.source-title').textContent = filename;
      row.querySelector('.source-title').title = filename;
      const entry = keyPlan.byId[lane.id];
      const sourceName = { filename: 'ファイル名', analysis: '音声推定', manual: '手動', demo: 'デモ設定', synth: '合成設定' }[entry.key.source] || '未判定';
      const detail = `${lane.buffer.duration.toFixed(2)}s / ${lane.kind === 'upload' ? 'YOUR SOUND' : lane.kind === 'fm' ? 'FM SYNTH' : 'SYNTH DEMO'} · ${sourceName}`;
      row.querySelector('.source-detail').textContent = detail;
      row.querySelector('.source-detail').title = detail;
      const categorySelect = row.querySelector('.source-category');
      categorySelect.value = categories.get(lane);
      categorySelect.setAttribute('aria-label', `${lane.name} の分類`);
      categorySelect.addEventListener('change', () => {
        if (importing) return;
        if (!categories.groups.some((group) => group.id === categorySelect.value)) return;
        if (categories.get(lane) === categorySelect.value) return;
        remember();
        lane.category = categorySelect.value;
        updateView();
        renderAudio();
      });
      const keySelect = row.querySelector('.source-key');
      const auto = document.createElement('option');
      auto.value = 'auto';
      auto.textContent = `自動：${harmony.isTonal(lane.detectedKey) ? harmony.format(harmony.toMajor(lane.detectedKey)) : lane.detectedKey && lane.detectedKey.status === 'unpitched' ? '音程なし' : '判定保留'}`;
      keySelect.append(auto);
      const skip = document.createElement('option');
      skip.value = 'none'; skip.textContent = '補正しない'; keySelect.append(skip);
      fillKeyOptions(keySelect, true);
      keySelect.value = lane.keyOverride || 'auto';
      keySelect.disabled = importing;
      keySelect.setAttribute('aria-label', `${lane.name} の元のキー`);
      const alternatives = lane.detectedKey && lane.detectedKey.alternatives;
      keySelect.title = `${sourceName}：${harmony.format(entry.originalKey)} / ${entry.originalKey.reason || ''}${alternatives && alternatives.length ? ` / 候補：${alternatives.map((key) => key.label || harmony.notes[key.tonic] + ' ' + key.mode).join(', ')}` : ''}`;
      const majorNote = row.querySelector('.source-major-note');
      if (harmony.isTonal(entry.key)) {
        const original = harmony.format(entry.originalKey);
        majorNote.textContent = entry.originalKey.mode === 'major' ? `${original}扱い` : `${original} → ${harmony.format(entry.key)}扱い`;
        majorNote.title = entry.originalKey.mode === 'unknown' ? `${original}：長短調は不明。ルートをメジャー基準として扱います。` : `元のキー：${original} / 処理上のキー：${harmony.format(entry.key)}。読み替えだけでは音程を変えません。`;
      } else { majorNote.hidden = true; }
      keySelect.addEventListener('change', () => {
        if (importing) return;
        remember();
        lane.keyOverride = keySelect.value;
        updateView();
        renderAudio();
      });
      const shift = row.querySelector('.key-shift');
      shift.textContent = !state.settings.keySync || !harmony.isTonal(entry.key) || !keyPlan.target ? '—' : `${entry.shift > 0 ? '+' : entry.shift === 0 ? '±' : ''}${entry.shift} st`;
      shift.title = entry.reason;
      shift.classList.toggle('shifted', entry.shift !== 0);
      row.dataset.keySource = entry.key.source;
      row.dataset.keyShift = entry.shift;
      row.dataset.effectiveKey = harmony.isTonal(entry.key) ? harmony.format(entry.key) : '';
      row.dataset.originalKey = harmony.isTonal(entry.originalKey) ? harmony.format(entry.originalKey) : '';
      const preview = row.querySelector('.source-preview');
      preview.setAttribute('aria-label', `${lane.name} の素材を試聴`);
      preview.title = '元の素材を試聴（最大4秒）';
      preview.addEventListener('click', async () => {
        try {
          stop();
          const previewSource = await engine.playPreview(lane.buffer);
          if (previewSource) notify(`${lane.name} / 元の素材を試聴中`);
        } catch (error) { notify(error.message); }
      });
      const remove = row.querySelector('.source-remove');
      remove.setAttribute('aria-label', `${lane.name} を削除`);
      remove.addEventListener('click', () => {
        if (importing) return;
        remember();
        state.lanes = state.lanes.filter((entry) => entry.id !== lane.id);
        getEvents();
        updateView();
        renderAudio();
      });
      groups.get(categories.get(lane)).append(row);
    });
    $('source-count').textContent = `${state.lanes.length} / ${MAX_SOURCES}`;
  }

  function sequenceView() {
    $('bar-ruler').replaceChildren();
    for (let bar = 0; bar < state.settings.bars; bar++) {
      const label = document.createElement('span');
      label.textContent = String(bar + 1).padStart(2, '0');
      $('bar-ruler').append(label);
    }
    const list = $('lane-list');
    list.replaceChildren();
    const anySolo = state.lanes.some((lane) => lane.solo);
    const audible = playbackEvents();
    const ordered = categories.groups.flatMap((category) => state.lanes.filter((lane) => categories.get(lane) === category.id));
    let previousCategory;
    ordered.forEach((lane, index) => {
      const category = categories.get(lane);
      if (category !== previousCategory) {
        const heading = document.createElement('h3');
        heading.className = 'lane-group-heading';
        heading.dataset.category = category;
        heading.textContent = categories.groups.find((group) => group.id === category).label;
        list.append(heading);
        previousCategory = category;
      }
      const row = document.createElement('div');
      row.className = 'lane-row';
      row.classList.toggle('is-muted', lane.muted || (anySolo && !lane.solo));
      row.dataset.laneId = lane.id;
      row.dataset.category = category;
      row.innerHTML = '<div class="lane-info"><div class="lane-title"><span class="lane-number"></span><span class="lane-name"></span></div><div class="lane-buttons"><button class="lane-button lock-button" type="button">LOCK</button><button class="lane-button mute-button" type="button">M</button><button class="lane-button solo-button" type="button">S</button><input class="lane-volume" type="range" min="0" max="100"></div></div><div class="lane-track"><canvas></canvas><div class="playhead"></div></div>';
      row.querySelector('.lane-number').textContent = String(index + 1).padStart(2, '0');
      row.querySelector('.lane-name').textContent = lane.name;
      row.querySelector('.lane-title').title = lane.name;
      const canvas = row.querySelector('canvas');
      const count = audible.filter((event) => event.laneId === lane.id).length;
      canvas.setAttribute('aria-label', `${lane.name}: ${count}個の発音 / ${lane.events.length}個の断片`);
      canvas.setAttribute('role', 'img');
      ['lock', 'mute', 'solo'].forEach((action) => {
        const key = { lock: 'locked', mute: 'muted', solo: 'solo' }[action];
        const button = row.querySelector(`.${action}-button`);
        const label = { lock: '固定', mute: 'ミュート', solo: 'ソロ' }[action];
        button.setAttribute('aria-label', `${lane.name} ${label}`);
        button.setAttribute('aria-pressed', String(lane[key]));
        button.title = label;
        button.addEventListener('click', () => {
          if (importing) return;
          remember();
          lane[key] = !lane[key];
          sequenceView();
          drawTracks();
          updateButtons();
          if (action !== 'lock') renderAudio();
        });
      });
      const volume = row.querySelector('.lane-volume');
      volume.value = lane.volume * 100;
      volume.setAttribute('aria-label', `${lane.name} 音量`);
      volume.title = 'レーン音量';
      rangeFill(volume);
      volume.addEventListener('input', () => rangeFill(volume));
      volume.addEventListener('change', () => {
        if (importing) { volume.value = lane.volume * 100; rangeFill(volume); return; }
        remember();
        lane.volume = Number(volume.value) / 100;
        sequenceView();
        drawTracks();
        renderAudio();
      });
      list.append(row);
    });
    $('empty-state').hidden = state.lanes.length > 0;
    $('event-count').textContent = `${audible.length} / ${state.events.length} fragments`;
  }

  function sourcePeak(buffer) {
    if (peaks.has(buffer)) return peaks.get(buffer);
    const data = buffer.getChannelData(0);
    let peak = 0.01;
    for (let frame = 0; frame < data.length; frame += 47) peak = Math.max(peak, Math.abs(data[frame]));
    peaks.set(buffer, peak);
    return peak;
  }

  function drawTracks() {
    const audible = playbackEvents();
    const lanes = new Map(state.lanes.map((lane) => [lane.id, lane]));
    document.querySelectorAll('.lane-row').forEach((row) => {
      const lane = lanes.get(row.dataset.laneId);
      if (!lane) return;
      const canvas = row.querySelector('canvas');
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width;
      const height = bounds.height;
      if (!width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const context = canvas.getContext('2d');
      context.scale(dpr, dpr);
      const totalSteps = state.settings.bars * 16;
      const unit = width / totalSteps;
      for (let step = 0; step <= totalSteps; step++) {
        if (step % 16 === 0 && (step / 16) % 2 === 0) {
          context.fillStyle = '#f3f5fa';
          context.fillRect(step * unit, 0, unit * 16, height);
        }
        context.strokeStyle = step % 16 === 0 ? '#dbe1ed' : step % 4 === 0 ? '#e7ebf3' : '#eff2f7';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(Math.round(step * unit) + 0.5, 0);
        context.lineTo(Math.round(step * unit) + 0.5, height);
        context.stroke();
      }
      const data = lane.buffer.getChannelData(0);
      const peak = sourcePeak(lane.buffer);
      audible.filter((event) => event.laneId === lane.id).forEach((event) => {
        const playback = window.BlueLoopAudio.eventPlayback(lane, event, state.settings);
        if (!playback) return;
        const stepSeconds = 60 / state.settings.bpm / 4;
        const x = playback.start / stepSeconds * unit + 1;
        const totalSemitones = window.BlueLoopAudio.pitchSemitones(lane, event);
        const noteSeconds = playback.duration;
        const w = Math.max(1, Math.min(noteSeconds / stepSeconds * unit - 1, width - x));
        const y = totalSemitones > 0 ? 9 : totalSemitones < 0 ? 25 : 17;
        const h = height - 34;
        context.fillStyle = lane.color;
        context.globalAlpha = 0.76;
        context.fillRect(x, y, w, h);
        context.globalAlpha = 1;
        context.fillStyle = '#30435c';
        context.globalAlpha = .38;
        const sliceStart = playback.offset * lane.buffer.sampleRate;
        const sliceEnd = (playback.offset + playback.sliceSeconds) * lane.buffer.sampleRate;
        const firstFrame = Math.max(0, Math.floor(sliceStart));
        const lastFrame = Math.min(data.length - 1, Math.ceil(sliceEnd) - 1);
        const count = Math.max(2, Math.floor(w / 2));
        for (let point = 0; point < count; point++) {
          const sourcePosition = playback.sourceSecondsAt(point / count * noteSeconds) * lane.buffer.sampleRate;
          const frame = Math.floor(event.reverse ? sliceEnd - 1 - sourcePosition : sliceStart + sourcePosition);
          let amplitude = 0;
          for (let sample = 0; sample < 7; sample++) {
            const position = Math.max(firstFrame, Math.min(lastFrame, frame + (event.reverse ? -1 : 1) * sample * 23));
            amplitude = Math.max(amplitude, Math.abs(data[position] || 0));
          }
          const line = Math.max(1, Math.min(h - 6, amplitude / peak * (h - 6)));
          context.fillRect(x + point * w / count, y + (h - line) / 2, 1, line);
        }
        context.globalAlpha = 1;
        if (playback.envelope.enabled && w > 8) {
          context.strokeStyle = '#244ce5';
          context.globalAlpha = .65;
          context.beginPath();
          for (let point = 0; point <= count; point++) {
            const time = point / count * noteSeconds;
            const bend = 12 * Math.log2(playback.envelope.rateAt(time) / playback.rate);
            const curveY = y + h / 2 - bend / 24 * (h / 2 - 3);
            if (point === 0) context.moveTo(x, curveY);
            else context.lineTo(x + w * point / count, curveY);
          }
          context.stroke();
          context.globalAlpha = 1;
        }
        if (event.reverse) {
          context.strokeStyle = '#37496755';
          context.beginPath();
          context.moveTo(x + w, y);
          context.lineTo(x, y + h);
          context.stroke();
        }
        if (totalSemitones && w > 16) {
          context.font = '6px monospace';
          context.fillStyle = '#647692';
          context.fillText(`${totalSemitones > 0 ? '+' : ''}${totalSemitones}`, x + 2, y - 3);
        }
      });
    });
  }

  function updateView() {
    updateKeyPlan();
    syncSettings();
    sourceList();
    pitchEnvelopeLanes();
    sequenceView();
    drawTracks();
    updateButtons();
  }

  async function togglePlay() {
    if (playing) { stop(); return; }
    if (!state.buffer || rendering) return;
    playing = true;
    updateButtons();
    try { await engine.play(state.buffer); }
    catch (error) { stop(); notify(error.message); }
  }

  function newPhrase() {
    if (!state.lanes.length || importing) return;
    if (state.lanes.every((lane) => lane.locked)) {
      notify('すべてのレーンが固定されています。LOCKを解除すると再生成できます。');
      return;
    }
    remember();
    const value = new Uint32Array(1);
    window.crypto.getRandomValues(value);
    state.seed = value[0].toString(36).toUpperCase().padStart(6, '0');
    regenerateEvents();
    updateView();
    renderAudio();
  }

  function undo() {
    if (!history.length || importing) return;
    Object.assign(state, history.pop());
    getEvents();
    updateView();
    renderAudio();
    notify('ひとつ前の状態に戻しました。');
  }

  function clearSources() {
    if (importing || !state.lanes.length) return;
    remember();
    state.lanes = [];
    getEvents();
    updateView();
    renderAudio();
    notify('素材をすべて削除しました。↶で元に戻せます。');
  }

  async function addFiles(fileList) {
    if (importing || !fileList.length) return;
    importing = true;
    updateButtons();
    let added = 0;
    const errors = [];
    const before = snapshot();
    for (const file of Array.from(fileList)) {
      if (state.lanes.length >= MAX_SOURCES) { errors.push(`素材は最大${MAX_SOURCES}個です。不要な素材を×で削除して追加できます。`); break; }
      try {
        const buffer = await engine.decodeFile(file);
        const total = state.lanes.reduce((seconds, lane) => seconds + lane.buffer.duration, 0);
        if (total + buffer.duration > MAX_TOTAL_SECONDS) throw new Error(`素材の合計は${MAX_TOTAL_SECONDS}秒以内にしてください。`);
        analysisLabel = file.name;
        updateButtons();
        notify(`キーを確認中：${file.name}`, 15000);
        let detectedKey;
        try { detectedKey = await harmony.detect(file.name, buffer); }
        catch (error) {
          detectedKey = { tonic: null, mode: 'unknown', status: 'uncertain', source: 'analysis', reason: '解析できませんでした。元のキーを手動で指定できます。' };
          errors.push(`${file.name}: キー解析を保留しました。音源は読み込めます。`);
        }
        state.lanes.push({
          id: `user-${++uploadNumber}`, name: file.name.replace(/\.[^.]+$/, ''), filename: file.name, kind: 'upload', category: categories.inferFilename(file.name),
          buffer, color: colors[state.lanes.length % colors.length], volume: .7,
          muted: false, solo: false, locked: false, events: [], pitchEnvChance: 100,
          detectedKey, keyOverride: 'auto', keyShift: 0,
        });
        added++;
      } catch (error) { errors.push(`${file.name}: ${error.message}`); }
    }
    if (added) {
      history.push(before);
      if (history.length > 12) history.shift();
      regenerateEvents();
    }
    importing = false;
    analysisLabel = '';
    $('file-input').value = '';
    updateView();
    if (added) renderAudio();
    notify([added ? `${added}個の素材を追加しました。` : '', ...errors].filter(Boolean).join(' '), errors.length ? 9000 : 3500);
  }

  async function addDemos(initial = false) {
    if (importing) return;
    importing = true;
    updateButtons();
    try {
      const demos = await engine.createDemoLanes();
      demos.forEach((lane) => {
        lane.category = categories.get(lane);
        lane.detectedKey = lane.kind === 'drums'
          ? { tonic: null, mode: 'unknown', status: 'unpitched', source: 'demo', reason: 'ドラムのため自動移調しません。' }
          : { tonic: 9, mode: 'minor', status: 'tonal', source: 'demo', confidence: 1, label: 'A minor' };
        lane.keyOverride = 'auto';
        lane.keyShift = 0;
        lane.pitchEnvChance = 100;
      });
      const existing = new Set(state.lanes.map((lane) => lane.id));
      const capacity = Math.min(MAX_SOURCES - state.lanes.length, Math.floor((MAX_TOTAL_SECONDS - state.lanes.reduce((sum, lane) => sum + lane.buffer.duration, 0)) / 8));
      const additions = demos.filter((lane) => !existing.has(lane.id)).slice(0, Math.max(0, capacity));
      if (additions.length) {
        if (!initial) remember();
        state.lanes.push(...additions);
        regenerateEvents();
        if (!initial) notify('合成音のデモを追加しました。');
      } else if (!initial) notify('デモは追加済み、または素材の上限に達しています。');
    } catch (error) { notify(error.message, 9000); }
    finally {
      importing = false;
      updateView();
      await renderAudio();
    }
  }

  function fmOptions() {
    return window.BlueLoopFMSynth.normalize({
      bpm: state.settings.bpm, bars: state.settings.bars,
      tonic: Number($('fm-key').value.split(':')[0]), octave: Number($('fm-octave').value),
      ratio: Number($('fm-ratio').value), index: Number($('fm-index').value),
      decay: Number($('fm-decay').value), density: Number($('fm-density').value), seed: $('fm-seed').value,
    });
  }

  function fmCapacityError(duration) {
    if (state.lanes.length >= MAX_SOURCES) return `素材は最大${MAX_SOURCES}個です。不要な素材を削除してください。`;
    const total = state.lanes.reduce((sum, lane) => sum + lane.buffer.duration, 0);
    return total + duration > MAX_TOTAL_SECONDS + 1 / 44100 ? `素材の合計が${MAX_TOTAL_SECONDS}秒を超えます。不要な素材を削除してください。` : '';
  }

  function updateFMControls() {
    ['key', 'octave', 'ratio', 'index', 'decay', 'density', 'seed', 'reroll', 'preview'].forEach((id) => { $(`fm-${id}`).disabled = fmBusy; });
    $('fm-add').disabled = fmBusy || !fmDraft || importing || !!fmCapacityError(fmDraft.buffer.duration);
    $('fm-preview').textContent = fmBusy ? '合成中…' : fmPreviewSource ? '■ 試聴を停止' : fmDraft ? '▶ 元フレーズを試聴' : '▶ 生成・試聴';
    $('fm-dialog').setAttribute('aria-busy', String(fmBusy));
  }

  function stopFMPreview() {
    fmPreviewSource = null;
    engine.stop();
  }

  function invalidateFM() {
    ++fmVersion;
    fmBusy = false;
    fmDraft = null;
    stopFMPreview();
    $('fm-notes').replaceChildren();
    $('fm-notes').setAttribute('aria-label', '生成前のフレーズ表示');
    $('fm-index-output').textContent = Number($('fm-index').value).toFixed(1);
    $('fm-decay-output').textContent = `${$('fm-decay').value} ms`;
    $('fm-density-output').textContent = `${$('fm-density').value}%`;
    ['index', 'decay', 'density'].forEach((id) => rangeFill($(`fm-${id}`)));
    const options = fmOptions();
    const duration = options.bars * 4 * 60 / options.bpm;
    $('fm-length').textContent = `${options.bpm} BPM / ${options.bars} bars / ${duration.toFixed(2)} s`;
    $('fm-status').textContent = fmCapacityError(duration) || '「生成・試聴」で元のフレーズを確認できます。';
    updateFMControls();
  }

  function drawFMNotes(phrase) {
    const svg = $('fm-notes');
    svg.replaceChildren();
    const pitches = phrase.notes.map((note) => note.midi);
    const low = Math.min(...pitches) - 2, high = Math.max(...pitches) + 2;
    const add = (tag, attrs) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      svg.append(element);
    };
    for (let bar = 0; bar <= phrase.settings.bars; bar++) {
      const x = 8 + bar / phrase.settings.bars * 544;
      add('line', { x1: x, x2: x, y1: 6, y2: 82, stroke: '#dce3f1' });
    }
    phrase.notes.forEach((note) => add('rect', {
      x: 8 + note.start / phrase.duration * 544, y: 8 + (high - note.midi) / (high - low) * 64,
      width: Math.max(1, note.duration / phrase.duration * 544 - 1), height: 5, rx: 1,
      fill: '#244ce5', opacity: 0.4 + note.velocity * 0.6,
    }));
    svg.setAttribute('aria-label', `${phrase.settings.bars}小節、${phrase.notes.length}音のチョップ前のフレーズ`);
  }

  async function previewFM(reroll = false) {
    if (fmBusy || !$('fm-dialog').open) return;
    if (fmPreviewSource && !reroll) { stopFMPreview(); updateFMControls(); return; }
    if (reroll) {
      const seed = new Uint32Array(1);
      window.crypto.getRandomValues(seed);
      $('fm-seed').value = seed[0].toString(36).toUpperCase();
      invalidateFM();
    }
    const version = ++fmVersion;
    const options = fmOptions();
    fmBusy = true;
    updateFMControls();
    try {
      // Resume in the click handler before yielding for browsers that require
      // a direct user gesture to unlock audio playback.
      await engine.init();
      if (version !== fmVersion || !$('fm-dialog').open) return;
      if (!fmDraft) {
        $('fm-status').textContent = 'FMフレーズを合成しています…';
        // Let the dialog paint before filling the PCM buffer.
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        if (version !== fmVersion || !$('fm-dialog').open) return;
        fmDraft = engine.createFMSource(options);
        $('fm-seed').value = fmDraft.phrase.settings.seed;
        drawFMNotes(fmDraft.phrase);
      }
      $('fm-status').textContent = fmCapacityError(fmDraft.buffer.duration) || `${fmDraft.phrase.notes.length}音 / ${harmony.notes[options.tonic]} major。元のフレーズを試聴します。`;
      const source = await engine.playPreview(fmDraft.buffer, fmDraft.buffer.duration);
      if (version !== fmVersion || !$('fm-dialog').open) return;
      fmPreviewSource = source || null;
      if (source) {
        const onended = source.onended;
        source.onended = (event) => {
          if (onended) onended.call(source, event);
          if (fmPreviewSource === source) { fmPreviewSource = null; updateFMControls(); }
        };
      }
    } catch (error) {
      if (version === fmVersion) $('fm-status').textContent = error.message;
    } finally {
      if (version === fmVersion) { fmBusy = false; updateFMControls(); }
    }
  }

  function addFMSource() {
    if (fmBusy || !fmDraft || importing) return;
    const error = fmCapacityError(fmDraft.buffer.duration);
    if (error) { $('fm-status').textContent = error; updateFMControls(); return; }
    const { buffer, phrase } = fmDraft;
    const options = phrase.settings;
    const name = `${options.index ? 'FM' : 'SINE'} ${harmony.notes[options.tonic]} major · ${options.seed}`;
    remember();
    state.lanes.push({
      id: `fm-${++fmNumber}`, name, kind: 'fm', category: 'other', buffer, releaseSeconds: 0.03,
      synthSettings: { ...options }, color: colors[state.lanes.length % colors.length], volume: .7,
      muted: false, solo: false, locked: false, events: [], pitchEnvChance: 100,
      detectedKey: harmony.fromValue(`${options.tonic}:major`, 'synth'), keyOverride: 'auto', keyShift: 0,
    });
    stopFMPreview();
    $('fm-dialog').close();
    regenerateEvents();
    updateView();
    renderAudio();
    notify('FMフレーズを素材に追加してチョップしました。');
  }

  async function exportWav() {
    await pendingRender;
    if (!state.buffer) return;
    try {
      const blob = engine.encodeWav(state.buffer);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeSeed = state.seed.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'loop';
      link.href = url;
      const keyTag = state.settings.keySync && keyPlan.target ? `_key-${harmony.format(keyPlan.target).replace('#', 'sharp').replace(/\s+/g, '-')}` : '';
      link.download = `kerfbend_${state.settings.bpm}bpm_${state.settings.bars}bars${keyTag}_${safeSeed}.wav`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      notify(`${state.settings.bars}小節のWAVを書き出しました。`);
    } catch (error) { notify(error.message); }
  }

  ['density', 'breaks', 'size', 'motion', 'octave', 'swing'].forEach((key) => {
    $(key).addEventListener('input', () => {
      rangeFill($(key));
      $(`${key}-output`).innerHTML = key === 'swing' ? `${$(key).value}%` : `${$(key).value}<span>%</span>`;
    });
    $(key).addEventListener('change', () => {
      if (importing) { syncSettings(); return; }
      if (Number($(key).value) === state.settings[key]) return;
      remember();
      state.settings[key] = Number($(key).value);
      state.settings.chop = generator.getChop(state.settings);
      if (key !== 'swing') regenerateEvents();
      updateView();
      renderAudio();
    });
  });
  ['bpm', 'bars'].forEach((key) => $(key).addEventListener('change', () => {
    if (importing) { syncSettings(); return; }
    const number = Number($(key).value);
    const value = key === 'bars' ? ([2, 4, 8].includes(number) ? number : 4) : Math.min(200, Math.max(40, Math.round(number || 120)));
    if (value === state.settings[key]) { syncSettings(); return; }
    remember();
    state.settings[key] = value;
    if (key === 'bars') regenerateEvents();
    updateView();
    renderAudio();
  }));
  [['pitch-env-depth', 'pitchEnvDepth'], ['pitch-env-time', 'pitchEnvTime'], ['pitch-env-depth-random', 'pitchEnvDepthRandom'], ['pitch-env-time-random', 'pitchEnvTimeRandom']].forEach(([id, key]) => {
    $(id).addEventListener('input', showPitchEnvelope);
    $(id).addEventListener('change', () => {
      if (importing) { syncSettings(); return; }
      const value = Number($(id).value);
      if (!Number.isFinite(value) || value === state.settings[key]) return;
      remember();
      state.settings[key] = value;
      updateView();
      renderAudio();
    });
  });
  $('seed').addEventListener('change', () => {
    if (importing) { syncSettings(); return; }
    const seed = generator.seedString($('seed').value);
    if (seed === state.seed) return;
    remember();
    state.seed = seed;
    regenerateEvents();
    updateView();
    renderAudio();
  });
  $('master-volume').addEventListener('input', () => {
    engine.setMasterVolume(Number($('master-volume').value) / 100);
    $('master-output').textContent = `${$('master-volume').value}%`;
    rangeFill($('master-volume'));
  });
  fillKeyOptions($('target-key'));
  [['max-voices', 'maxVoices'], ['max-drum-voices', 'maxDrumVoices']].forEach(([id, key]) => $(id).addEventListener('change', () => {
    if (importing) { syncSettings(); return; }
    const value = Number($(id).value);
    if (!Number.isInteger(value) || value < 1 || value > 8) { syncSettings(); return; }
    if (value === state.settings[key]) return;
    remember();
    state.settings[key] = value;
    updateView();
    renderAudio();
  }));
  $('key-sync').addEventListener('change', () => {
    if (importing) return;
    remember();
    state.settings.keySync = $('key-sync').checked;
    updateView();
    renderAudio();
  });
  $('target-key').addEventListener('change', () => {
    if (importing) return;
    remember();
    state.settings.targetKey = $('target-key').value;
    updateView();
    renderAudio();
  });
  $('file-input').addEventListener('change', (event) => addFiles(event.target.files));
  $('drop-zone').addEventListener('dragover', (event) => { event.preventDefault(); $('drop-zone').classList.add('drag-over'); });
  $('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('drag-over'));
  $('drop-zone').addEventListener('drop', (event) => {
    event.preventDefault();
    $('drop-zone').classList.remove('drag-over');
    addFiles(event.dataTransfer.files);
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
  $('play-button').addEventListener('click', togglePlay);
  $('generate-button').addEventListener('click', newPhrase);
  $('undo-button').addEventListener('click', undo);
  $('export-button').addEventListener('click', exportWav);
  $('demo-button').addEventListener('click', () => addDemos());
  $('clear-sources-button').addEventListener('click', clearSources);
  fillKeyOptions($('fm-key'));
  $('fm-button').addEventListener('click', () => {
    if (importing || state.lanes.length >= MAX_SOURCES) return;
    stop();
    $('fm-key').value = `${keyPlan.target ? keyPlan.target.tonic : 0}:major`;
    invalidateFM();
    $('fm-dialog').showModal();
  });
  ['key', 'octave', 'ratio', 'index', 'decay', 'density', 'seed'].forEach((id) => $(`fm-${id}`).addEventListener('input', invalidateFM));
  $('fm-preview').addEventListener('click', () => previewFM());
  $('fm-reroll').addEventListener('click', () => previewFM(true));
  $('fm-add').addEventListener('click', addFMSource);
  $('close-fm').addEventListener('click', () => $('fm-dialog').close());
  $('fm-dialog').addEventListener('cancel', invalidateFM);
  $('fm-dialog').addEventListener('close', invalidateFM);
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  $('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) $('help-dialog').close(); });
  window.addEventListener('keydown', (event) => {
    if (event.target.closest('input,select,textarea') || document.querySelector('dialog[open]') || event.repeat) return;
    if (event.code === 'Space') {
      if (event.target.closest('button,a,[role="button"]')) return;
      event.preventDefault(); togglePlay();
    }
    else if (event.key.toLowerCase() === 'r' && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); newPhrase(); }
    else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey) && !event.shiftKey) { event.preventDefault(); undo(); }
  });
  window.addEventListener('pagehide', stop);
  if ('ResizeObserver' in window) new ResizeObserver(drawTracks).observe($('sequence'));
  else window.addEventListener('resize', drawTracks);

  function animate() {
    const progress = playing ? engine.progress : 0;
    document.querySelectorAll('.playhead').forEach((head) => { head.style.left = `${progress * 100}%`; });
    const step = Math.floor(progress * state.settings.bars * 16);
    const position = `${String(Math.floor(step / 16) + 1).padStart(2, '0')} : ${String(Math.floor(step % 16 / 4) + 1).padStart(2, '0')}`;
    if (position !== lastPosition) { $('position').textContent = position; lastPosition = position; }
    requestAnimationFrame(animate);
  }
  engine.setMasterVolume(.75);
  document.querySelectorAll('input[type=range]').forEach(rangeFill);
  animate();
  addDemos(true);
})();
