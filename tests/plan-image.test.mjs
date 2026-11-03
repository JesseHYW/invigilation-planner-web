import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, EXAMPLE_INPUT, DEFAULT_INPUT } from '../src/calculator.js';
import { createPlanImage, imageFilename } from '../src/plan-image.js';

// A recording canvas checks exported content and layout bounds without a native dependency.
// Actual PNG encoding, rendering and download are checked in the browser.
function recordingDocument({ contextMissing = false, encoding = 'data:image/png;base64,cG5n' } = {}) {
  const glyphs = [];
  let dimensions;
  const context = {
    font: '400 28px sans-serif',
    measureText(value) { return { width: [...value].length * Number(this.font.match(/(\d+)px/)[1]) }; },
    fillRect() {}, beginPath() {}, roundRect() {}, fill() {},
    fillText(text, x, y) { glyphs.push({ text, x, y, font: this.font, width: this.measureText(text).width }); },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => contextMissing ? null : context,
    toDataURL(type) {
      assert.equal(type, 'image/png');
      dimensions = { width: this.width, height: this.height };
      return encoding;
    },
  };
  return {
    fonts: { ready: Promise.resolve() },
    createElement: (tag) => { assert.equal(tag, 'canvas'); return canvas; },
    get text() { return glyphs.map((glyph) => glyph.text).join(''); },
    get dimensions() { return dimensions; },
    glyphs, canvas,
  };
}

test('image includes all example conditions and allocations, but no calculation steps', async () => {
  const doc = recordingDocument();
  const result = calculate(EXAMPLE_INPUT);
  const before = JSON.stringify({ input: EXAMPLE_INPUT, result });
  await createPlanImage(EXAMPLE_INPUT, result, doc);
  for (const text of ['教务小工具', '考场数量18 个', '考试场数3 场', '教职工总数69 人', '普通教师最低场数2 场',
    '班主任人数18 人', '班主任每人场数1 场', '不参与监考（不含班主任）11 人', '非班主任固定监考 1 场人数4 人',
    '总需求108监考人次', '实际参与58 人', '实际未参与11 人', '22 人  ·  每人监考 2 场', '14 人  ·  每人监考 3 场', '© 2026 Jesse Huang']) {
    assert.ok(doc.text.includes(text), text);
  }
  assert.ok(!doc.text.includes('计算过程'));
  for (const step of result.steps) assert.ok(!doc.text.includes(step));
  const match = doc.text.indexOf('每人监考 2 场');
  assert.match(doc.glyphs[match + '每人监考 '.length].font, /^700 /);
  assert.match(doc.glyphs[match].font, /^400 /);
  assert.equal(doc.dimensions.width, 1080);
  assert.equal(doc.canvas.width, 0, 'release the backing store');
  assert.equal(JSON.stringify({ input: EXAMPLE_INPUT, result }), before);
});

test('zero-session homeroom teachers are labelled as not assigned in the image', async () => {
  const input = { ...EXAMPLE_INPUT, homeroomSessions: '0' };
  const result = calculate(input);
  assert.equal(result.status, 'valid');
  const doc = recordingDocument();
  await createPlanImage(input, result, doc);
  assert.ok(doc.text.includes('班主任18 人  ·  不安排监考'));
  assert.ok(!doc.text.includes('每人监考 0 场'));
});

test('large valid integers retain exact digits and stay inside the image bounds', async () => {
  const input = { ...DEFAULT_INPUT, rooms: '9223372036854775807', sessions: '1', invigilators: '1', staff: '9223372036854775807', minimumSessions: '1' };
  const result = calculate(input);
  assert.equal(result.status, 'valid');
  const doc = recordingDocument();
  await createPlanImage(input, result, doc);
  assert.ok(doc.text.includes('9,223,372,036,854,775,807'));
  for (const glyph of doc.glyphs) {
    assert.ok(glyph.x >= 88 && glyph.x + glyph.width <= 992, `horizontal bounds: ${glyph.text}`);
    assert.ok(glyph.y > 48 && glyph.y < doc.dimensions.height - 48, 'vertical bounds');
  }
});

test('invalid plans, unavailable canvas and failed PNG encoding reject cleanly', async () => {
  await assert.rejects(createPlanImage(DEFAULT_INPUT, calculate(DEFAULT_INPUT), recordingDocument()), /valid plan/);
  await assert.rejects(createPlanImage(EXAMPLE_INPUT, calculate(EXAMPLE_INPUT), recordingDocument({ contextMissing: true })), /Canvas/);
  const doc = recordingDocument({ encoding: 'data:,' });
  await assert.rejects(createPlanImage(EXAMPLE_INPUT, calculate(EXAMPLE_INPUT), doc), /PNG/);
  assert.equal(doc.canvas.width, 0);
});

test('PNG filenames use a padded local timestamp', () => {
  assert.equal(imageFilename(new Date(2026, 10, 3, 9, 5, 7)), '监考规划结果-20261103-090507.png');
});
