const WIDTH = 1080;
const LEFT = 88;
const CONTENT_WIDTH = WIDTH - LEFT * 2;
const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif';
const COLORS = { background: '#f7f9fc', card: '#ffffff', text: '#191c20', muted: '#43474e', blue: '#245f8c', tint: '#d0e5ff', line: '#dce2ea' };
const formatter = new Intl.NumberFormat('zh-CN');
const number = (value) => formatter.format(BigInt(String(value).trim()));

export function imageFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `监考规划结果-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

/** Render an input/result snapshot locally. No equations, DOM capture or remote assets. */
export async function createPlanImage(input, result, ownerDocument = document) {
  if (result?.status !== 'valid') throw new Error('A valid plan is required.');
  await ownerDocument.fonts?.ready;
  const canvas = ownerDocument.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  const operations = [];
  let y = 84;

  const font = (size, weight) => `${weight} ${size}px ${FONT}`;
  const box = (x, top, width, height, color, radius = 20) => {
    operations.push({ kind: 'box', x, y: top, width, height, color, radius });
  };

  // Measure before allocating the final canvas; every block contributes its actual height.
  // Glyph-level wrapping also handles integers beyond Number.MAX_SAFE_INTEGER without clipping.
  function text(value, x, top, width, size = 28, weight = 400, color = COLORS.text) {
    const runs = typeof value === 'string' ? [{ text: value, weight }] : value;
    const lineHeight = Math.ceil(size * 1.55);
    let offset = 0;
    let line = 0;
    for (const run of runs) {
      const runFont = font(size, run.weight ?? weight);
      ctx.font = runFont;
      for (const char of run.text) {
        const charWidth = ctx.measureText(char).width;
        if (char === '\n' || (offset > 0 && offset + charWidth > width)) {
          line++;
          offset = 0;
          if (char === '\n' || char === ' ') continue;
        }
        operations.push({ kind: 'text', text: char, x: x + offset, y: top + line * lineHeight + size, font: runFont, color });
        offset += charWidth;
      }
    }
    return (line + 1) * lineHeight;
  }

  function heading(label) {
    y += text(label, LEFT, y, CONTENT_WIDTH, 30, 700, COLORS.blue) + 18;
  }

  y += text('监考规划', LEFT, y, CONTENT_WIDTH, 48, 700);
  y += text('教务小工具', LEFT, y + 2, CONTENT_WIDTH, 24, 400, COLORS.muted) + 34;
  heading('考试与人员条件');
  const conditions = [
    ['考场数量', `${number(input.rooms)} 个`],
    ['考试场数', `${number(input.sessions)} 场`],
    ['每场每考场监考人数', `${number(input.invigilators)} 人`],
    ['教职工总数', `${number(input.staff)} 人`],
    ['普通教师最低场数', `${number(input.minimumSessions)} 场`],
    ['班主任人数', `${number(input.homeroom)} 人`],
    ['班主任每人场数', `${number(input.homeroomSessions)} 场`],
    ['不参与监考（不含班主任）', `${number(input.excluded)} 人`],
    ['非班主任固定监考 1 场人数', `${number(input.oneSession)} 人`],
  ];
  const columnWidth = (CONTENT_WIDTH - 40) / 2;
  for (let i = 0; i < conditions.length; i += 2) {
    let rowHeight = 0;
    for (let col = 0; col < 2 && i + col < conditions.length; col++) {
      const [label, value] = conditions[i + col];
      const x = LEFT + col * (columnWidth + 40);
      const labelHeight = text(label, x, y, columnWidth, 23, 400, COLORS.muted);
      const valueHeight = text(value, x, y + labelHeight + 3, columnWidth, 29, 600);
      rowHeight = Math.max(rowHeight, labelHeight + 3 + valueHeight);
    }
    y += rowHeight + 20;
  }

  y += 12;
  heading('规划结果');
  const demandTop = y;
  const demandBoxIndex = operations.length;
  box(LEFT, demandTop, CONTENT_WIDTH, 0, COLORS.tint);
  y += 22;
  y += text('工作量满足需求 · 总需求', LEFT + 28, y, CONTENT_WIDTH - 56, 25, 600, COLORS.blue) + 4;
  const total = number(result.totalDemand);
  let totalSize = 76;
  ctx.font = font(totalSize, 700);
  // Keep the headline on one line when possible; wrapping remains the final safeguard.
  const totalWidth = [...total].reduce((sum, char) => sum + ctx.measureText(char).width, 0);
  totalSize = Math.min(totalSize, Math.max(32, Math.floor(totalSize * (CONTENT_WIDTH - 56) / Math.max(totalWidth, 1))));
  y += text(total, LEFT + 28, y, CONTENT_WIDTH - 56, totalSize, 700, COLORS.blue);
  y += text('监考人次', LEFT + 28, y, CONTENT_WIDTH - 56, 24, 400, COLORS.blue) + 22;
  operations[demandBoxIndex].height = y - demandTop;
  y += 22;

  const statsTop = y;
  let statsHeight = 0;
  for (const [i, [label, value]] of [['实际参与', result.participating], ['实际未参与', result.inactive]].entries()) {
    const x = LEFT + i * (columnWidth + 40);
    const height = text(label, x, statsTop, columnWidth, 24, 400, COLORS.muted);
    statsHeight = Math.max(statsHeight, height + text(`${number(value)} 人`, x, statsTop + height + 3, columnWidth, 32, 700));
  }
  y += statsHeight + 28;
  heading('人员分配');
  for (const row of result.rows) {
    const labelHeight = text(row.label, LEFT, y, CONTENT_WIDTH, 27, 600);
    y += labelHeight + 2;
    const workload = String(row.sessions) === '0'
      ? [{ text: '不安排监考' }]
      : [{ text: '每人监考 ' }, { text: number(row.sessions), weight: 700 }, { text: ' 场' }];
    y += text([
      { text: `${number(row.people)} 人`, weight: 700 },
      { text: '  ·  ' }, ...workload,
    ], LEFT, y, CONTENT_WIDTH, 27, 400, COLORS.muted) + 16;
    box(LEFT, y, CONTENT_WIDTH, 1, COLORS.line, 0);
    y += 16;
  }

  y += 12;
  y += text('人员分类互不重复。本结果仅规划监考工作量，具体教师、考场和场次需另行编排。', LEFT, y, CONTENT_WIDTH, 23, 400, COLORS.muted) + 22;
  y += text('© 2026 Jesse Huang', LEFT, y, CONTENT_WIDTH, 23, 400, COLORS.muted);

  canvas.width = WIDTH;
  canvas.height = Math.ceil(y + 84);
  try {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.card;
    ctx.beginPath();
    ctx.roundRect(48, 48, WIDTH - 96, canvas.height - 96, 28);
    ctx.fill();
    ctx.textBaseline = 'alphabetic';
    for (const operation of operations) {
      ctx.fillStyle = operation.color;
      if (operation.kind === 'box') {
        ctx.beginPath();
        ctx.roundRect(operation.x, operation.y, operation.width, operation.height, operation.radius);
        ctx.fill();
      } else {
        ctx.font = operation.font;
        ctx.fillText(operation.text, operation.x, operation.y);
      }
    }
    const url = canvas.toDataURL('image/png');
    if (!url.startsWith('data:image/png;base64,')) throw new Error('PNG encoding failed.');
    return url;
  } finally {
    // The preview retains only the encoded PNG, not the canvas backing store.
    canvas.width = 0;
    canvas.height = 0;
  }
}
