(function (root) {
  'use strict';

  root.runGlitchTests = function () {
    const glitch = root.BlueLoopGlitch;
    if (!glitch) throw new Error('Load js/glitch.js before glitch-tests.js.');
    const assertions = [];
    function assert(condition, label) {
      if (!condition) throw new Error('Glitch test failed: ' + label);
      assertions.push({ label, passed: true });
    }

    const defaults = glitch.normalize();
    assert(defaults.amount === 0 && defaults.size === 50 && defaults.crush === 0 && defaults.seed === '', 'GLITCH is off by default with 1/32 repeats and no crush');
    const bounded = glitch.normalize({ glitchAmount: 400, glitchSize: -3, glitchCrush: 'x', glitchSeed: 7 });
    assert(bounded.amount === 100 && bounded.size === 0 && bounded.crush === 0 && bounded.seed === '', 'Controls are bounded and invalid values recover defaults');
    assert(glitch.plan({ bars: 4 }, 'SEED').regions.length === 0 && glitch.plan({ bars: 4, glitchAmount: 0 }, 'SEED').regions.length === 0, 'Amount 0 leaves the mix untouched');

    let endings = 0;
    let elsewhere = 0;
    let downbeats = 0;
    let kept = 0;
    let before = 0;
    for (let index = 0; index < 60; index += 1) {
      [1, 2, 4, 8, 16].forEach(function (bars) {
        const settings = { bars, glitchAmount: 60, glitchSize: 50 };
        const result = glitch.plan(settings, 'PHRASE-' + index);
        const total = bars * 16;
        assert(JSON.stringify(result) === JSON.stringify(glitch.plan(settings, 'PHRASE-' + index)), 'Plans are deterministic: ' + bars + ' bars / ' + index);
        assert(result.regions.every(function (region, position) {
          const next = result.regions[position + 1];
          return region.step % 2 === 0 && region.step >= 0 && region.step + region.steps <= total && [2, 4].includes(region.steps) || region.step + region.steps === total;
        }) && result.regions.every(function (region, position) {
          const next = result.regions[position + 1];
          return !next || region.step + region.steps <= next.step;
        }), 'Regions sit on eighth notes inside the loop and never overlap: ' + bars + ' bars / ' + index);
        assert(result.regions.every(function (region) {
          return glitch.divisions.includes(region.division) && ['repeat', 'pitch', 'reverse'].includes(region.mode) && [-1, 1].includes(region.direction);
        }), 'Every region has a known division, style and direction');
        result.regions.forEach(function (region) {
          if (region.step % 32 >= 28) endings += 1;
          else if (region.step % 16 === 0) downbeats += 1;
          else elsewhere += 1;
        });
        if (bars === 4) {
          const more = glitch.plan(Object.assign({}, settings, { glitchAmount: 100 }), 'PHRASE-' + index);
          result.regions.forEach(function (region) {
            before += 1;
            if (more.regions.some(function (other) { return other.step === region.step && other.division === region.division && other.mode === region.mode; })) kept += 1;
          });
        }
      });
    }
    assert(endings > downbeats * 2 && elsewhere > downbeats, 'Phrase ends glitch most and downbeats least: ' + [endings, elsewhere, downbeats].join('/'));
    assert(kept / before > 0.7, 'Raising the amount mostly keeps the edits already heard: ' + kept + '/' + before);
    const fine = glitch.plan({ bars: 8, glitchAmount: 100, glitchSize: 100 }, 'SIZE').regions;
    const coarse = glitch.plan({ bars: 8, glitchAmount: 100, glitchSize: 0 }, 'SIZE').regions;
    assert(fine.length && fine.every(function (region) { return region.division === 0.25; }) && coarse.every(function (region) { return region.division === 1; }), 'Fineness moves repeats from a sixteenth to a 64th');
    const rerolled = glitch.plan({ bars: 4, glitchAmount: 80, glitchSeed: 'abc' }, 'SAME');
    const original = glitch.plan({ bars: 4, glitchAmount: 80 }, 'SAME');
    assert(JSON.stringify(rerolled.regions) !== JSON.stringify(original.regions) && JSON.stringify(original) === JSON.stringify(glitch.plan({ bars: 4, glitchAmount: 80, glitchSeed: '' }, 'SAME')), 'The re-roll seed picks new edits and an empty seed keeps them');
    assert(JSON.stringify(glitch.plan({ bars: 4, glitchAmount: 80, glitchCrush: 90 }, 'SAME').regions) === JSON.stringify(original.regions), 'Crush never moves the edits');

    const rate = 44100;
    const step = 0.125;
    function signal(frames, shape) {
      return [new Float32Array(frames), new Float32Array(frames)].map(function (channel, index) {
        for (let frame = 0; frame < frames; frame++) channel[frame] = shape(frame, index);
        return channel;
      });
    }
    const frames = 2 * rate;
    const ramp = function (frame, index) { return Math.sin(frame / 37) * 0.4 + (index ? 0.05 : 0); };
    function edit(region, crush) {
      const channels = signal(frames, ramp);
      glitch.apply(channels, rate, step, { amount: 50, crush: crush || 0, regions: [region] });
      return channels;
    }
    const dry = signal(frames, ramp);
    const repeat = edit({ step: 4, steps: 2, division: 0.5, mode: 'repeat', direction: 1 });
    const start = Math.round(4 * step * rate);
    const unit = Math.round(0.5 * step * rate);
    const edge = Math.round(0.0015 * rate);
    assert(repeat.every(function (channel, index) {
      for (let frame = 0; frame < start; frame++) if (channel[frame] !== dry[index][frame]) return false;
      for (let frame = start + 2 * step * rate + edge + 1; frame < frames; frame++) if (channel[Math.round(frame)] !== dry[index][Math.round(frame)]) return false;
      return true;
    }), 'Audio outside a region stays exactly dry');
    assert(repeat.every(function (channel, index) {
      for (let offset = edge + 2; offset < unit - edge - 2; offset += 7) {
        if (Math.abs(channel[start + offset] - dry[index][start + offset]) > 1e-6) return false;
        if (Math.abs(channel[start + unit + offset] - dry[index][start + offset]) > 1e-6) return false;
        if (Math.abs(channel[start + 3 * unit + offset] - dry[index][start + offset]) > 1e-6) return false;
      }
      return true;
    }), 'Repeat plays the first piece of the region again and again');
    const reverse = edit({ step: 4, steps: 2, division: 0.5, mode: 'reverse', direction: 1 });
    assert([100, 300, 900].every(function (offset) {
      return Math.abs(reverse[0][start + unit + offset] - dry[0][start + unit - 1 - offset]) < 1e-6 && Math.abs(reverse[0][start + 2 * unit + offset] - dry[0][start + offset]) < 1e-6;
    }), 'Reverse flips every other repeat');
    const pitch = edit({ step: 4, steps: 4, division: 0.5, mode: 'pitch', direction: 1 });
    assert(Math.abs(pitch[0][start + unit + 400] - dry[0][start + Math.round(400 * Math.pow(2, 1 / 12))]) < 0.02 && pitch[0][start + 400] === dry[0][start + 400], 'Pitch zips each repeat a semitone further');
    let jump = 0;
    pitch.forEach(function (channel) {
      for (let frame = start - 10; frame < start + 4 * step * rate + edge + 10; frame++) jump = Math.max(jump, Math.abs(channel[frame + 1] - channel[frame]));
    });
    assert(jump < 0.06, 'Edits fade at every repeat and back into the dry mix without clicks: ' + jump.toFixed(4));
    const crushed = edit({ step: 4, steps: 2, division: 1, mode: 'repeat', direction: 1 }, 100);
    const levels = Math.pow(2, 4);
    let held = true;
    for (let offset = edge; offset < unit - edge; offset += 1) {
      const value = crushed[0][start + offset];
      if (Math.abs(value * levels - Math.round(value * levels)) > 1e-4) held = false;
      if (offset % 12 && value !== crushed[0][start + offset - 1]) held = false;
    }
    assert(held, 'Crush holds samples and lowers the bit depth inside a region');
    assert(glitch.apply(null, rate, step, original) === null && JSON.stringify(Array.from(glitch.apply(signal(100, ramp), rate, step, { regions: [] })[0])) === JSON.stringify(Array.from(signal(100, ramp)[0])), 'Empty input or plans are left alone');
    return { passed: assertions.length, assertions };
  };
})(typeof window !== 'undefined' ? window : globalThis);
