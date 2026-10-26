/**
 * Pure workload planner ported from Android's PlanningCalculator.
 * Integer arithmetic retains Kotlin Long's bounds. Public integers are numbers
 * when safely representable, otherwise decimal strings; neither is rounded.
 * This module stores no inputs and performs no network or browser operations.
 */
const LONG_MAX = 9223372036854775807n;
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

export const DEFAULT_INPUT = Object.freeze({
  rooms: '', sessions: '', invigilators: '2', staff: '', homeroom: '0',
  homeroomSessions: '1', excluded: '0', oneSession: '0', minimumSessions: '2',
});

export const EXAMPLE_INPUT = Object.freeze({
  rooms: '18', sessions: '3', invigilators: '2', staff: '69', homeroom: '18',
  homeroomSessions: '1', excluded: '11', oneSession: '4', minimumSessions: '2',
});

const fields = Object.keys(DEFAULT_INPUT);
const positiveFields = new Set(['rooms', 'sessions', 'invigilators', 'staff', 'minimumSessions']);
const publicInteger = (value) => value <= SAFE_MAX && value >= -SAFE_MAX ? Number(value) : value.toString();
const invalid = (field, message) => ({ status: 'invalid', errors: { [field]: message } });
const conflict = (title, message, demand, difference, steps) => ({
  status: 'conflict', errors: {}, title, message,
  totalDemand: publicInteger(demand), difference: publicInteger(difference), steps,
});

/** Missing fields remain incomplete, and malformed fields remain visible. */
export function calculate(input = DEFAULT_INPUT) {
  const missing = [];
  const errors = {};
  const values = {};
  for (const field of fields) {
    const raw = input?.[field];
    const text = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
    if (text === '') {
      missing.push(field);
    } else if (!/^[0-9]+$/.test(text)) {
      errors[field] = positiveFields.has(field) ? '请输入大于 0 的整数' : '请输入 0 或正整数';
    } else {
      // Remove leading zeroes before the length check, matching Long parsing.
      const digits = text.replace(/^0+/, '') || '0';
      const number = digits.length <= 19 ? BigInt(digits) : null;
      if (number === null || number > LONG_MAX) {
        errors[field] = '数值过大，请缩小后重试';
      } else if (number === 0n && positiveFields.has(field)) {
        errors[field] = '请输入大于 0 的整数';
      } else {
        values[field] = number;
      }
    }
  }
  if (Object.keys(errors).length) return { status: 'invalid', errors };
  if (missing.length) return { status: 'incomplete', errors: {}, missing };

  const { rooms, sessions, invigilators, staff, homeroom, homeroomSessions,
    excluded, oneSession, minimumSessions: minimum } = values;
  const classified = homeroom + excluded + oneSession;
  if (classified > LONG_MAX) return invalid('staff', '分类人数合计过大，请检查三类人员数量');
  if (classified > staff) {
    return invalid('staff', `三类特殊人员合计 ${classified} 人，超过教职工总人数 ${staff} 人；每人只能计入一类`);
  }
  const ordinary = staff - classified;
  if (homeroom > 0n && homeroomSessions > sessions) {
    errors.homeroomSessions = `不能超过考试总场数 ${sessions}`;
  }
  if (ordinary > 0n && minimum > sessions) {
    errors.minimumSessions = `不能超过考试总场数 ${sessions}`;
  }
  if (Object.keys(errors).length) return { status: 'invalid', errors };

  const perSession = rooms * invigilators;
  const demand = perSession * sessions;
  if (perSession > LONG_MAX || demand > LONG_MAX) {
    return invalid('rooms', '考试规模计算超出数值范围，请缩小考场数、监考人数或考试场数');
  }
  const homeroomWork = homeroom * homeroomSessions;
  const fixed = homeroomWork + oneSession;
  if (homeroomWork > LONG_MAX || fixed > LONG_MAX) {
    return invalid('homeroomSessions', '固定监考工作量超出数值范围，请检查人员与场数');
  }
  const remaining = demand - fixed;
  const steps = [
    `每场岗位数：${rooms} × ${invigilators} = ${perSession} 人`,
    `总需求：${perSession} × ${sessions} = ${demand} 人次`,
    `普通教师人数：${staff} − ${homeroom} − ${excluded} − ${oneSession} = ${ordinary} 人`,
    `班主任工作量：${homeroom} × ${homeroomSessions} = ${homeroomWork} 人次`,
    `固定 1 场教师工作量：${oneSession} × 1 = ${oneSession} 人次`,
    `普通教师需承担：${demand} − ${homeroomWork} − ${oneSession} = ${remaining} 人次`,
  ];
  if (remaining < 0n) {
    return conflict('固定安排超过需求',
      `固定安排共 ${fixed} 人次，比总需求多 ${-remaining} 人次。请调整班主任或固定 1 场人员的安排。`,
      demand, -remaining, steps);
  }

  const ordinaryRows = new Map();
  if (ordinary === 0n) {
    if (remaining > 0n) {
      return conflict('可安排人员不足',
        `当前没有普通教师可继续安排，仍缺 ${remaining} 人次。请调整人员分类或考试规模。`,
        demand, remaining, steps);
    }
    steps.push('无需安排普通教师，固定工作量已满足全部需求。');
  } else {
    const minimumWork = ordinary * minimum;
    if (minimumWork > LONG_MAX) {
      return invalid('minimumSessions', '最低监考工作量超出数值范围，请检查人数与场数');
    }
    steps.push(`普通教师最低工作量：${ordinary} × ${minimum} = ${minimumWork} 人次`);
    if (remaining < minimumWork) {
      const difference = minimumWork - remaining;
      return conflict('最低场数与需求冲突',
        `让 ${ordinary} 位普通教师每人至少监考 ${minimum} 场，会比总需求多 ${difference} 人次。请降低最低场数或调整参与人数。`,
        demand, difference, steps);
    }
    const maximumWork = ordinary * sessions;
    if (maximumWork > LONG_MAX) {
      return invalid('staff', '最大监考工作量超出数值范围，请检查人数与考试场数');
    }
    if (remaining > maximumWork) {
      const difference = remaining - maximumWork;
      steps.push(`普通教师最大工作量：${ordinary} × ${sessions} = ${maximumWork} 人次`);
      return conflict('可安排人员不足',
        `即使 ${ordinary} 位普通教师均监考全部 ${sessions} 场，仍缺 ${difference} 人次。请增加参与人数或减少考试规模。`,
        demand, difference, steps);
    }
    const quotient = remaining / ordinary;
    const remainder = remaining % ordinary;
    ordinaryRows.set(quotient, ordinary - remainder);
    if (remainder > 0n) ordinaryRows.set(quotient + 1n, remainder);
    steps.push(`相对最低安排还需：${remaining} − ${minimumWork} = ${remaining - minimumWork} 人次`);
    steps.push(`均摊：${remaining} ÷ ${ordinary} = ${quotient} 余 ${remainder}`);
    steps.push('普通教师分配：' + [...ordinaryRows].map(([count, people]) => `${people} 人监考 ${count} 场`).join('，'));
  }

  if (oneSession > 0n) ordinaryRows.set(1n, (ordinaryRows.get(1n) ?? 0n) + oneSession);
  const rows = [];
  const addRow = (label, people, count) => rows.push({
    label, people: publicInteger(people), sessions: publicInteger(count),
  });
  if (homeroom > 0n) addRow('班主任', homeroom, homeroomSessions);
  [...ordinaryRows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .forEach(([count, people]) => { if (people > 0n) addRow('其他教师', people, count); });
  if (excluded > 0n) addRow('不参与监考', excluded, 0n);
  const inactive = excluded + (homeroomSessions === 0n ? homeroom : 0n);
  return {
    status: 'valid', errors: {}, totalDemand: publicInteger(demand), staff: publicInteger(staff),
    participating: publicInteger(staff - inactive), inactive: publicInteger(inactive), rows, steps,
  };
}

/** Copy/share text is derived from the displayed result, never a new calculation. */
export function formatPlan(result, input) {
  if (result?.status !== 'valid') return '';
  const value = (field) => String(input[field]).trim();
  return [
    '监考规划', '', '考试规模',
    `考场 ${value('rooms')} 个 · 考试 ${value('sessions')} 场 · 每考场 ${value('invigilators')} 人`,
    `教职工总数：${result.staff} 人`,
    `普通教师最低监考：${value('minimumSessions')} 场`,
    `班主任：${value('homeroom')} 人，每人 ${value('homeroomSessions')} 场`,
    `固定监考 1 场的非班主任：${value('oneSession')} 人`,
    `另行不参与监考：${value('excluded')} 人`, '', '规划结果',
    `总需求：${result.totalDemand} 监考人次`,
    `实际参与：${result.participating} 人`,
    `实际未参与：${result.inactive} 人`,
    ...result.rows.map((row) => `${row.label}：${row.people} 人 · 每人 ${row.sessions} 场`), '',
    '人员分类互不重复。本结果为工作量规划，具体考场与场次需另行排定。',
  ].join('\n');
}
