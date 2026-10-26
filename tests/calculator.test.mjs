import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_INPUT, EXAMPLE_INPUT, calculate, formatPlan } from '../src/calculator.js';

const example = (changes = {}) => ({ ...EXAMPLE_INPUT, ...changes });
const inputOf = (rooms, sessions, invigilators, staff, homeroom, homeroomSessions, excluded, oneSession, minimumSessions) =>
  Object.fromEntries(Object.keys(DEFAULT_INPUT).map((key, index) => [key, String([
    rooms, sessions, invigilators, staff, homeroom, homeroomSessions, excluded, oneSession, minimumSessions,
  ][index])]));
const expectStatus = (input, status) => {
  const result = calculate(input);
  assert.equal(result.status, status, JSON.stringify({ input, result }));
  return result;
};
const success = (input) => expectStatus(input, 'valid');
const conflict = (input) => expectStatus(input, 'conflict');
const invalid = (input) => expectStatus(input, 'invalid');
const integer = (value) => BigInt(value);

function assertInvariants(input, result) {
  const sum = (rows, transform) => rows.reduce((total, row) => total + transform(row), 0n);
  assert.equal(sum(result.rows, (row) => integer(row.people)), integer(input.staff));
  assert.equal(sum(result.rows, (row) => integer(row.people) * integer(row.sessions)), integer(result.totalDemand));
  assert.equal(integer(result.staff), integer(result.participating) + integer(result.inactive));
  assert.equal(integer(result.inactive), sum(result.rows.filter((row) => integer(row.sessions) === 0n), (row) => integer(row.people)));
  assert.ok(result.rows.every((row) => integer(row.people) > 0n && integer(row.sessions) >= 0n && integer(row.sessions) <= integer(input.sessions)));
  const bands = result.rows.filter((row) => row.label === '其他教师')
    .map((row) => ({ sessions: integer(row.sessions), people: integer(row.people) - (integer(row.sessions) === 1n ? integer(input.oneSession) : 0n) }))
    .filter((row) => row.people > 0n);
  assert.ok(bands.every((row) => row.sessions >= integer(input.minimumSessions)));
  if (bands.length) assert.ok(bands.at(-1).sessions - bands[0].sessions <= 1n);
}

test('original example conserves 69 people and 108 assignments', () => {
  const result = success(example());
  assert.equal(result.totalDemand, 108);
  assert.equal(result.staff, 69);
  assert.equal(result.participating, 58);
  assert.equal(result.inactive, 11);
  assert.deepEqual(result.rows, [
    { label: '班主任', people: 18, sessions: 1 },
    { label: '其他教师', people: 4, sessions: 1 },
    { label: '其他教师', people: 22, sessions: 2 },
    { label: '其他教师', people: 14, sessions: 3 },
    { label: '不参与监考', people: 11, sessions: 0 },
  ]);
  assertInvariants(example(), result);
});

test('exact minimum yields one ordinary allocation band', () => {
  const input = example({ staff: '76' });
  const result = success(input);
  assert.deepEqual(result.rows.filter((row) => row.label === '其他教师'), [
    { label: '其他教师', people: 4, sessions: 1 }, { label: '其他教师', people: 43, sessions: 2 },
  ]);
  assertInvariants(input, result);
});

test('zero-session homeroom teachers are counted exactly once', () => {
  const input = example({ homeroomSessions: '0' });
  const result = success(input);
  assert.equal(result.participating, 40);
  assert.equal(result.inactive, 29);
  assert.deepEqual(result.rows[0], { label: '班主任', people: 18, sessions: 0 });
  assert.equal(result.rows.find((row) => row.label === '其他教师' && row.sessions === 2).people, 4);
  assert.equal(result.rows.find((row) => row.label === '其他教师' && row.sessions === 3).people, 32);
  assert.equal(result.rows.find((row) => row.label === '不参与监考').people, 11);
  assertInvariants(input, result);
});

test('ordinary minimum is never silently reduced', () => {
  const result = conflict(inputOf(5, 3, 2, 30, 5, 1, 3, 2, 2));
  assert.equal(result.title, '最低场数与需求冲突');
  assert.equal(result.totalDemand, 30);
  assert.equal(result.difference, 17);
});

test('insufficient capacity never assigns more sessions than exams', () => {
  const result = conflict(example({ staff: '60' }));
  assert.equal(result.title, '可安排人员不足');
  assert.equal(result.difference, 5);
});

test('fixed excess is reported before ordinary minimum', () => {
  const result = conflict(inputOf(1, 2, 2, 8, 4, 1, 0, 1, 1));
  assert.equal(result.title, '固定安排超过需求');
  assert.equal(result.difference, 1);
});

test('zero ordinary teachers can exactly satisfy demand; unused minimum is ignored', () => {
  const input = inputOf(1, 2, 2, 10, 4, 0, 2, 4, 5);
  const result = success(input);
  assert.equal(result.totalDemand, 4);
  assert.equal(result.participating, 4);
  assert.equal(result.inactive, 6);
  assertInvariants(input, result);
});

test('zero ordinary teachers and remaining demand produce a conflict without division', () => {
  const result = conflict(inputOf(2, 2, 2, 10, 4, 0, 2, 4, 5));
  assert.equal(result.title, '可安排人员不足');
  assert.equal(result.difference, 4);
});

test('one-session ordinary and fixed teachers merge into one row', () => {
  const input = inputOf(2, 2, 2, 7, 0, 9, 1, 2, 1);
  const result = success(input);
  assert.deepEqual(result.rows, [
    { label: '其他教师', people: 4, sessions: 1 }, { label: '其他教师', people: 2, sessions: 2 },
    { label: '不参与监考', people: 1, sessions: 0 },
  ]);
  assertInvariants(input, result);
});

test('additional work may raise every ordinary teacher several sessions above minimum', () => {
  const input = inputOf(4, 5, 2, 10, 0, 1, 0, 0, 2);
  const result = success(input);
  assert.deepEqual(result.rows, [{ label: '其他教师', people: 10, sessions: 4 }]);
  assertInvariants(input, result);
});

test('single exam omits empty and out-of-range bands', () => {
  const input = inputOf(2, 1, 2, 5, 1, 1, 1, 1, 1);
  const result = success(input);
  assert.ok(result.rows.every((row) => row.sessions <= 1 && row.people > 0));
  assertInvariants(input, result);
});

test('blank inputs are incomplete, never zero', () => {
  assert.deepEqual(calculate(DEFAULT_INPUT).missing, ['rooms', 'sessions', 'staff']);
  assert.equal(calculate(example({ homeroom: ' ' })).status, 'incomplete');
});

test('invalid text is reported even with another field blank', () => {
  assert.ok(invalid(example({ rooms: '', staff: '-1' })).errors.staff);
});

test('reject decimal, negative, signed, exponent, fullwidth, embedded space, and nonnumeric input', () => {
  for (const rooms of ['-1', '2.5', '1e3', '+2', '１２', '1 2', 'NaN', 'Infinity', '<script>']) {
    assert.ok(invalid(example({ rooms })).errors.rooms);
  }
});

test('surrounding whitespace and leading zeroes are accepted', () => {
  assert.equal(success(example({ rooms: ' 018 ' })).totalDemand, 108);
  assert.equal(success(example({ rooms: '0000000000000000000000018' })).totalDemand, 108);
});

test('positive fields reject zero', () => {
  for (const field of ['rooms', 'sessions', 'invigilators', 'staff', 'minimumSessions']) {
    assert.ok(invalid(example({ [field]: '0' })).errors[field]);
  }
});

test('overlapping classification counts cannot exceed staff', () => {
  assert.ok(invalid(example({ staff: '20' })).errors.staff);
});

test('used group session caps report both errors', () => {
  const result = invalid(example({ homeroomSessions: '4', minimumSessions: '4' }));
  assert.deepEqual(Object.keys(result.errors), ['homeroomSessions', 'minimumSessions']);
});

test('Kotlin Long overflows yield errors at the original stages', () => {
  const huge = '9223372036854775807';
  assert.ok(invalid(example({ rooms: huge })).errors.rooms);
  assert.ok(invalid(example({ staff: '9223372036854775808' })).errors.staff);
  assert.ok(invalid(example({ homeroom: huge, excluded: huge })).errors.staff);
  assert.ok(invalid(inputOf(1, 2, 1, huge, huge, 2, 0, 0, 1)).errors.homeroomSessions);
  assert.ok(invalid(inputOf(1, 2, 1, huge, 0, 1, 0, 0, 2)).errors.minimumSessions);
  assert.equal(conflict(inputOf(1, 2, 1, huge, 0, 1, 0, 0, 1)).title, '最低场数与需求冲突');
  assert.ok(invalid(inputOf('4611686018427387903', 2, 1, '4611686018427387904', 0, 1, 0, 0, 1)).errors.staff);
  const maximum = inputOf(huge, 1, 1, huge, 0, 1, 0, 0, 1);
  assertInvariants(maximum, success(maximum));
});

test('large valid integers preserve exact decimal values above Number safe precision', () => {
  const exact = '9007199254740993';
  const input = inputOf(exact, 1, 1, exact, 0, 1, 0, 0, 1);
  const result = success(input);
  assert.equal(result.totalDemand, exact);
  assert.equal(result.staff, exact);
  assert.equal(result.rows[0].people, exact);
  assertInvariants(input, result);
  assert.match(formatPlan(result, input), /9007199254740993 监考人次/);
});

test('very long numeric input fails cleanly without constructing a giant integer', () => {
  assert.ok(invalid(example({ rooms: '9'.repeat(10000) })).errors.rooms);
});

test('random feasible plans preserve people, workload, minimum, and even allocation', () => {
  let seed = 20261025;
  const next = (min, max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return min + seed % (max - min + 1);
  };
  let checked = 0;
  for (let index = 0; index < 3000; index++) {
    const rooms = next(1, 30), invigilators = next(1, 4), sessions = next(1, 8);
    const homeroom = next(0, 20), homeroomSessions = next(0, sessions);
    const excluded = next(0, 20), oneSession = next(0, 20), minimum = next(1, sessions);
    const remaining = rooms * invigilators * sessions - homeroom * homeroomSessions - oneSession;
    if (remaining < 0) continue;
    const lower = Math.ceil(remaining / sessions), upper = Math.floor(remaining / minimum);
    if (lower > upper) continue;
    const ordinary = next(lower, upper), staff = ordinary + homeroom + excluded + oneSession;
    if (staff === 0) continue;
    const input = inputOf(rooms, sessions, invigilators, staff, homeroom, homeroomSessions, excluded, oneSession, minimum);
    assertInvariants(input, success(input));
    checked++;
  }
  assert.ok(checked > 1500, `Expected substantial sample, received ${checked}`);
});

test('format text uses displayed allocation and omits calculation equations', () => {
  const input = example(), result = success(input), text = formatPlan(result, input);
  assert.ok(text.startsWith('监考规划'));
  for (const excerpt of ['108 监考人次', '实际参与：58 人', '其他教师：22 人 · 每人 2 场', '其他教师：14 人 · 每人 3 场', '固定监考 1 场的非班主任：4 人']) {
    assert.ok(text.includes(excerpt));
  }
  assert.doesNotMatch(text, /[×÷=]/);
  assert.equal(formatPlan(calculate(DEFAULT_INPUT), DEFAULT_INPUT), '');
});

test('zero-session homeroom teachers do not repeat in excluded distribution text', () => {
  const input = example({ homeroomSessions: '0' });
  const text = formatPlan(success(input), input);
  assert.ok(text.includes('实际未参与：29 人'));
  assert.ok(text.includes('班主任：18 人 · 每人 0 场'));
  assert.ok(text.includes('不参与监考：11 人 · 每人 0 场'));
  assert.ok(!text.includes('不参与监考：29 人 ·'));
});

test('calculation never mutates inputs or shares mutable result state', () => {
  const original = JSON.stringify(EXAMPLE_INPUT);
  const first = success(EXAMPLE_INPUT);
  first.rows[0].people = 123;
  first.steps.push('modified');
  assert.equal(JSON.stringify(EXAMPLE_INPUT), original);
  const second = success(EXAMPLE_INPUT);
  assert.equal(second.rows[0].people, 18);
  assert.ok(!second.steps.includes('modified'));
});
