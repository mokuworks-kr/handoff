/**
 * 그리드 환산 — M2.5 핵심 코드.
 *
 * PageBlueprint (LLM 출력) + 패턴 정의 + 페이지 마진
 *   → Frame[] (실제 mm 좌표, Page.frames 에 그대로 들어감)
 *
 * ─────────────────────────────────────────────────────────────
 * 책임 분리
 * ─────────────────────────────────────────────────────────────
 *
 * 이 모듈은:
 *   - 결정론적: 같은 입력 → 같은 출력. 임의성·시간·DB 의존 없음.
 *   - 외부 의존 0: composition.ts와 frames.ts 타입만 import.
 *   - 마진 미러링은 *하지 않는다*. binding.ts(M3 신설)가 한다.
 *     이 모듈은 binding.ts가 계산해 넘겨준 "이 페이지의 실제 마진"을 받기만.
 *
 * 좌표계 (정책 §7-1):
 *   원점 = 페이지 트림 박스 좌상단. 양의 y는 아래로. 단위 = format.unit (보통 mm).
 *
 * ─────────────────────────────────────────────────────────────
 * 환산 공식
 * ─────────────────────────────────────────────────────────────
 *
 * 본문 영역 (content area):
 *   contentX = margins.left
 *   contentY = margins.top
 *   contentW = format.width  - margins.left - margins.right
 *   contentH = format.height - margins.top  - margins.bottom
 *
 * 컬럼 폭 (gutter 포함 분할):
 *   colW = (contentW - gutter * (columns - 1)) / columns
 *
 * 행 높이 (totalRows 등분, 행 사이 거터는 사용하지 않음 — baselineGrid가 그 역할):
 *   rowH = contentH / totalRows
 *
 * 한 GridArea의 박스:
 *   x = contentX + (column - 1) * (colW + gutter)
 *   y = contentY + (row    - 1) *  rowH
 *   w = columnSpan * colW + (columnSpan - 1) * gutter
 *   h = rowSpan * rowH
 *
 * 풀블리드 (bleedToEdge):
 *   x = -bleed.left,  y = -bleed.top
 *   w = format.width + bleed.left + bleed.right
 *   h = format.height + bleed.top + bleed.bottom
 *   (마진/그리드 무시)
 */

import type {
  CompositionPattern,
  ContentSlot,
  GridArea,
  PageBlueprint,
  TextSlot,
  ImageSlot,
  ChartSlot,
  TableSlot,
  ShapeSlot,
} from "./composition";
import type {
  Frame,
  TextFrame,
  ImageFrame,
  ChartFrame,
  TableFrame,
  ShapeFrame,
  TextRun,
  TableCell,
} from "@/lib/types/frames";

// ─────────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────────

/**
 * realize() 의 인자.
 *
 * resolvedMargins 는 binding.ts(M3)가 좌·우 페이지를 보고 미러링까지
 * 끝낸 "이 페이지의 실제 4방향 마진". grid.ts는 그대로 사용한다.
 *
 * binding.ts가 아직 없는 M2.5 단계에서는 호출자가 직접 만들어 넘기면 됨:
 *   side === "left"  → { top, bottom, left: outside, right: inside }
 *   side === "right" → { top, bottom, left: inside,  right: outside }
 */
export type RealizeInput = {
  blueprint: PageBlueprint;
  pattern: CompositionPattern;
  format: {
    width: number;
    height: number;
    columns: number;
    gutter: number;
    bleed: { top: number; right: number; bottom: number; left: number };
  };
  resolvedMargins: { top: number; right: number; bottom: number; left: number };
  /**
   * 페이지의 좌/우 위치.
   * EdgeAffinity (insideEdge / outsideEdge) 를 column 인덱스로 환산할 때 사용.
   */
  side: "left" | "right";
  /**
   * Frame.id prefix. 보통 "p{pageIndex}-" 같은 식.
   * 슬롯 id 와 합쳐 Frame.id를 생성한다 (예: "p3-title").
   */
  framePrefix?: string;
};

// ─────────────────────────────────────────────────────────────
// format 검증
// ─────────────────────────────────────────────────────────────

/**
 * 패턴/포맷 입력값이 환산 가능한지 사전 검증.
 * 현재는 grid.ts 쓰기 전에 호출하면 친절한 에러를 받을 수 있는 정도.
 * 페이지네이션 LLM 결과 검증은 별도 (M3에서 추가).
 */
export function assertRealizable(input: Pick<RealizeInput, "pattern" | "format">): void {
  const { pattern, format } = input;
  if (format.columns < 1) throw new Error(`format.columns must be >= 1 (got ${format.columns})`);
  if (format.gutter < 0) throw new Error(`format.gutter must be >= 0`);
  if (pattern.totalRows < 1) throw new Error(`pattern.totalRows must be >= 1`);
  for (const slot of pattern.slots) {
    const a = slot.area;
    if (slot.bleedToEdge) continue;
    if (a.column < 1 || a.column > format.columns) {
      throw new Error(`slot "${slot.id}" column ${a.column} out of range 1..${format.columns}`);
    }
    if (a.columnSpan !== -1 && a.columnSpan < 1) {
      throw new Error(`slot "${slot.id}" columnSpan must be >= 1 or -1`);
    }
    if (a.row < 1 || a.row > pattern.totalRows) {
      throw new Error(`slot "${slot.id}" row ${a.row} out of range 1..${pattern.totalRows}`);
    }
    if (a.rowSpan !== -1 && a.rowSpan < 1) {
      throw new Error(`slot "${slot.id}" rowSpan must be >= 1 or -1`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 메인 함수
// ─────────────────────────────────────────────────────────────

/**
 * PageBlueprint → Frame[].
 *
 * 1) 변형(variants) 적용해 슬롯들의 GridArea를 결정
 * 2) hiddenSlotIds + optional + 콘텐츠 누락 슬롯 제외
 * 3) 각 슬롯을 Frame 으로 변환
 *    - 풀블리드면 트림+블리드 박스로
 *    - EdgeAffinity 있으면 column 미러링
 *    - 그리드 영역 → mm 박스 환산
 *
 * z 인덱스: 슬롯 정의 순서대로 0,1,2... 부여 (뒤에 정의된 게 위로).
 */
export function realize(input: RealizeInput): Frame[] {
  assertRealizable(input);

  const { blueprint, pattern, format, resolvedMargins, side, framePrefix = "" } = input;
  const frames: Frame[] = [];

  // 1) 변형 적용 — 슬롯별 area 오버라이드 누적
  const areaOverrides = collectVariantOverrides(pattern, blueprint);

  // 2) 본문 영역 + 컬럼/행 단위 사전 계산
  const contentX = resolvedMargins.left;
  const contentY = resolvedMargins.top;
  const contentW = format.width - resolvedMargins.left - resolvedMargins.right;
  const contentH = format.height - resolvedMargins.top - resolvedMargins.bottom;
  if (contentW <= 0 || contentH <= 0) {
    throw new Error(
      `content area collapsed: W=${contentW} H=${contentH}. margins too large for format.`,
    );
  }
  const colCount = format.columns;
  const colW = (contentW - format.gutter * (colCount - 1)) / colCount;
  const rowH = contentH / pattern.totalRows;

  // 3) 슬롯 → Frame
  let zIndex = 0;
  for (const slot of pattern.slots) {
    if (blueprint.hiddenSlotIds?.includes(slot.id)) continue;
    const provided = blueprint.content[slot.id];
    const hasContent = provided !== undefined && provided !== null;
    if (!hasContent) {
      if (slot.optional) continue;
      // 필수 슬롯에 콘텐츠 누락 — LLM 출력 결함. 명확한 에러로 짚어준다.
      throw new Error(
        `pattern "${pattern.slug}" requires content for slot "${slot.id}" but none was provided`,
      );
    }

    const finalArea = applyOverride(slot.area, areaOverrides[slot.id]);

    const box = slot.bleedToEdge
      ? bleedBox(format)
      : gridBoxFor({
          area: finalArea,
          edge: slot.edge,
          side,
          colCount,
          colW,
          rowH,
          contentX,
          contentY,
          contentW,
          contentH,
          gutter: format.gutter,
          totalRows: pattern.totalRows,
        });

    const frameId = `${framePrefix}${slot.id}`;
    const frame = buildFrame(slot, provided, frameId, box, zIndex++);
    frames.push(frame);
  }

  return frames;
}

// ─────────────────────────────────────────────────────────────
// 변형 적용
// ─────────────────────────────────────────────────────────────

function collectVariantOverrides(
  pattern: CompositionPattern,
  blueprint: PageBlueprint,
): Record<string, Partial<GridArea>> {
  const result: Record<string, Partial<GridArea>> = {};
  if (!pattern.variants) return result;
  for (const variant of pattern.variants) {
    const chosen = blueprint.variants?.[variant.id] ?? variant.defaultValue;
    const option = variant.options.find((o) => o.value === chosen);
    if (!option) {
      throw new Error(
        `variant "${variant.id}" of pattern "${pattern.slug}" has no option "${chosen}"`,
      );
    }
    if (!option.override) continue;
    for (const [slotId, partial] of Object.entries(option.override)) {
      // 같은 슬롯에 여러 변형이 동시에 만지는 경우 머지 (마지막이 이김 — variants 정의 순서)
      result[slotId] = { ...result[slotId], ...partial };
    }
  }
  return result;
}

function applyOverride(base: GridArea, override?: Partial<GridArea>): GridArea {
  if (!override) return base;
  return {
    column: override.column ?? base.column,
    columnSpan: override.columnSpan ?? base.columnSpan,
    row: override.row ?? base.row,
    rowSpan: override.rowSpan ?? base.rowSpan,
  };
}

// ─────────────────────────────────────────────────────────────
// 박스 환산
// ─────────────────────────────────────────────────────────────

type Box = { x: number; y: number; w: number; h: number };

function bleedBox(format: RealizeInput["format"]): Box {
  return {
    x: -format.bleed.left,
    y: -format.bleed.top,
    w: format.width + format.bleed.left + format.bleed.right,
    h: format.height + format.bleed.top + format.bleed.bottom,
  };
}

function gridBoxFor(args: {
  area: GridArea;
  edge: ContentSlot["edge"];
  side: "left" | "right";
  colCount: number;
  colW: number;
  rowH: number;
  contentX: number;
  contentY: number;
  contentW: number;
  contentH: number;
  gutter: number;
  totalRows: number;
}): Box {
  const { area, edge, side, colCount, colW, rowH, contentX, contentY, gutter, totalRows } = args;

  // -1 span 정규화
  const cSpan = area.columnSpan === -1 ? colCount - area.column + 1 : area.columnSpan;
  const rSpan = area.rowSpan === -1 ? totalRows - area.row + 1 : area.rowSpan;

  if (cSpan < 1 || area.column + cSpan - 1 > colCount) {
    throw new Error(
      `area exceeds columns: col=${area.column} span=${area.columnSpan} max=${colCount}`,
    );
  }
  if (rSpan < 1 || area.row + rSpan - 1 > totalRows) {
    throw new Error(
      `area exceeds rows: row=${area.row} span=${area.rowSpan} max=${totalRows}`,
    );
  }

  // EdgeAffinity 적용 — 컬럼 인덱스 미러링
  // 인쇄 관습: 책의 안쪽 가장자리(=제본)가
  //   왼쪽 페이지에선 오른쪽, 오른쪽 페이지에선 왼쪽.
  // outsideEdge는 그 반대.
  let column = area.column;
  if (edge === "insideEdge") {
    const insideOnRight = side === "left";
    if (insideOnRight) column = colCount - (area.column + cSpan - 1) + 1;
  } else if (edge === "outsideEdge") {
    const outsideOnRight = side === "right";
    if (outsideOnRight) column = colCount - (area.column + cSpan - 1) + 1;
  }

  const x = contentX + (column - 1) * (colW + gutter);
  const y = contentY + (area.row - 1) * rowH;
  const w = cSpan * colW + (cSpan - 1) * gutter;
  const h = rSpan * rowH;
  return { x, y, w, h };
}

// ─────────────────────────────────────────────────────────────
// Frame 빌더 (슬롯 종류별)
// ─────────────────────────────────────────────────────────────

function buildFrame(
  slot: ContentSlot,
  provided: unknown,
  id: string,
  box: Box,
  z: number,
): Frame {
  switch (slot.kind) {
    case "text":
      return buildTextFrame(slot, provided, id, box, z);
    case "image":
      return buildImageFrame(slot, provided, id, box, z);
    case "chart":
      return buildChartFrame(slot, provided, id, box, z);
    case "table":
      return buildTableFrame(slot, provided, id, box, z);
    case "shape":
      return buildShapeFrame(slot, provided, id, box, z);
  }
}

function buildTextFrame(slot: TextSlot, provided: unknown, id: string, box: Box, z: number): TextFrame {
  // PageBlueprint.content[slotId] 에 들어오는 형태:
  //   string 단일                                  — 가장 흔함
  //   { content: string | TextRun[], headingLevel?: 1..6, runs?: ... } — 복잡
  let content: string | TextRun[] = "";
  let headingLevelOverride: TextSlot["headingLevel"];
  if (typeof provided === "string") {
    content = provided;
  } else if (provided && typeof provided === "object") {
    const obj = provided as { content?: unknown; headingLevel?: number };
    if (typeof obj.content === "string") content = obj.content;
    else if (Array.isArray(obj.content)) content = obj.content as TextRun[];
    if (typeof obj.headingLevel === "number") {
      headingLevelOverride = obj.headingLevel as TextSlot["headingLevel"];
    }
  } else {
    throw new Error(`slot "${slot.id}": text content must be string or { content: ... }`);
  }

  return {
    id,
    type: "text",
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    z,
    content,
    paragraphStyleId: slot.paragraphStyleId,
    ...(slot.role ? { role: slot.role } : {}),
    ...(headingLevelOverride ?? slot.headingLevel
      ? { headingLevel: headingLevelOverride ?? slot.headingLevel }
      : {}),
    ...(slot.columns ? { columns: slot.columns } : {}),
    ...(slot.columnGutter !== undefined ? { columnGutter: slot.columnGutter } : {}),
    ...(slot.inset ? { inset: slot.inset } : {}),
    ...(slot.verticalAlignment ? { verticalAlignment: slot.verticalAlignment } : {}),
  };
}

function buildImageFrame(
  slot: ImageSlot,
  provided: unknown,
  id: string,
  box: Box,
  z: number,
): ImageFrame {
  if (!provided || typeof provided !== "object") {
    throw new Error(`slot "${slot.id}": image content must be object with src`);
  }
  const obj = provided as { src?: unknown; alt?: unknown; source?: unknown };
  if (typeof obj.src !== "string") {
    throw new Error(`slot "${slot.id}": image content.src must be string`);
  }
  if (slot.altRequired && typeof obj.alt !== "string") {
    throw new Error(`slot "${slot.id}": alt text is required`);
  }
  return {
    id,
    type: "image",
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    z,
    src: obj.src,
    fit: slot.fit ?? "cover",
    ...(typeof obj.alt === "string" ? { alt: obj.alt } : {}),
    ...(obj.source ? { source: obj.source as ImageFrame["source"] } : {}),
  };
}

function buildChartFrame(
  slot: ChartSlot,
  provided: unknown,
  id: string,
  box: Box,
  z: number,
): ChartFrame {
  if (!provided || typeof provided !== "object") {
    throw new Error(`slot "${slot.id}": chart content must be object`);
  }
  const obj = provided as {
    chartType?: unknown;
    data?: unknown;
    config?: unknown;
  };
  const chartType = (obj.chartType as ChartFrame["chartType"]) ?? slot.preferredChartType ?? "bar";
  if (!Array.isArray(obj.data)) {
    throw new Error(`slot "${slot.id}": chart content.data must be array`);
  }
  if (!obj.config || typeof obj.config !== "object") {
    throw new Error(`slot "${slot.id}": chart content.config required`);
  }
  return {
    id,
    type: "chart",
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    z,
    chartType,
    data: obj.data as ChartFrame["data"],
    config: obj.config as ChartFrame["config"],
  };
}

function buildTableFrame(
  slot: TableSlot,
  provided: unknown,
  id: string,
  box: Box,
  z: number,
): TableFrame {
  if (!provided || typeof provided !== "object") {
    throw new Error(`slot "${slot.id}": table content must be object`);
  }
  const obj = provided as {
    rows?: unknown;
    cols?: unknown;
    cells?: unknown;
    columnWidths?: unknown;
    rowHeights?: unknown;
    headerRows?: unknown;
  };
  if (typeof obj.rows !== "number" || typeof obj.cols !== "number") {
    throw new Error(`slot "${slot.id}": table needs rows and cols (numbers)`);
  }
  if (!Array.isArray(obj.cells)) {
    throw new Error(`slot "${slot.id}": table.cells must be 2D array`);
  }

  // columnWidths 미지정 시 균등 분할
  const columnWidths = Array.isArray(obj.columnWidths)
    ? (obj.columnWidths as number[])
    : Array<number>(obj.cols).fill(box.w / obj.cols);

  // rowHeights 미지정 시 모두 "auto"
  const rowHeights = Array.isArray(obj.rowHeights)
    ? (obj.rowHeights as Array<number | "auto">)
    : Array<"auto">(obj.rows).fill("auto");

  return {
    id,
    type: "table",
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    z,
    rows: obj.rows,
    cols: obj.cols,
    cells: obj.cells as TableCell[][],
    columnWidths,
    rowHeights,
    ...(typeof obj.headerRows === "number" ? { headerRows: obj.headerRows } : {}),
  };
}

function buildShapeFrame(
  slot: ShapeSlot,
  _provided: unknown,
  id: string,
  box: Box,
  z: number,
): ShapeFrame {
  // ShapeSlot은 정적 — provided 내용 거의 무시. (장식용)
  return {
    id,
    type: "shape",
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    z,
    shape: slot.shape,
    ...(slot.fillColorId ? { fillColorId: slot.fillColorId } : {}),
    ...(slot.strokeColorId ? { strokeColorId: slot.strokeColorId } : {}),
    ...(slot.strokeWidth !== undefined ? { strokeWidth: slot.strokeWidth } : {}),
    ...(slot.cornerRadius !== undefined ? { cornerRadius: slot.cornerRadius } : {}),
  };
}
