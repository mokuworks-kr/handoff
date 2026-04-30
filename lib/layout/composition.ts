/**
 * 콤포지션 패턴 (Composition Pattern) — M2.5.
 *
 * 페이지 한 장의 "레이아웃 종류"를 그리드 영역 단위로 정의한 객체.
 * 페이지네이션 LLM은 mm 단위 좌표를 직접 출력하지 않는다.
 * 패턴 슬러그 + 변형 슬롯 선택값 + 콘텐츠 슬롯 매핑까지만 출력하고,
 * 좌표 환산은 lib/layout/grid.ts 의 결정론적 함수가 수행한다.
 *
 * ─────────────────────────────────────────────────────────────
 * 설계 원칙
 * ─────────────────────────────────────────────────────────────
 *
 * 1) 그리드 영역(GridArea) 단위로 슬롯 배치.
 *    Format.columns(보통 12) × rows(파생) 위에 "몇 칸~몇 칸"으로 표기.
 *    mm는 grid.ts가 환산. 패턴 정의 어디에도 mm 직접 박지 말 것.
 *
 * 2) 변형 슬롯(VariantOption) — LLM이 흔들 수 있는 자유도.
 *    예: "이미지 비중을 narrow/balanced/wide 중 하나" 같은 enum.
 *    각 선택지는 슬롯의 GridArea 변경분으로 정의. LLM은 슬러그만 고른다.
 *
 * 3) 콘텐츠 슬롯(ContentSlot) — LLM이 콘텐츠를 매핑하는 자리.
 *    각 슬롯은 어떤 Frame 종류를 받는지(text/image/chart/table)와
 *    적용할 paragraphStyleId 등을 명시. LLM 출력 시 검증 가능.
 *
 * 4) 좌·우 페이지 미러링은 패턴 정의가 신경 쓰지 않는다.
 *    binding.ts 의 마진 미러링 + grid.ts 의 환산이 자동 처리.
 *    패턴은 의미적 위치(insideEdge/outsideEdge)만 안다.
 *
 * 5) 패턴은 read-only. 사용자가 페이지를 편집해도 패턴 정의는 안 바뀐다.
 *    편집 결과는 Document.pages[*].frames 에 직접 반영되어 저장된다.
 *    패턴은 "처음 페이지를 만들 때의 청사진"일 뿐, 페이지의 일부가 아니다.
 *
 * 6) 풀블리드는 별도 표기 — bleedToEdge 플래그.
 *    그리드 영역으로 표현 못하는 "트림 박스를 넘어 블리드까지" 케이스.
 *    이 플래그가 켜지면 grid.ts가 좌표를 음수(-bleed)에서 시작하도록 처리.
 *    부분 블리드(예: 왼쪽 가장자리만 블리드)는 의도적으로 미지원.
 *    필요해질 때 bleedToEdge를 boolean → { top?, right?, bottom?, left? } 로 확장하면 됨.
 *    M2.5 1차 패턴 8개 중 부분 블리드를 쓰는 케이스가 없어 미루는 비용이 작다.
 *
 * ─────────────────────────────────────────────────────────────
 * 라이프사이클 (M3 페이지네이션 흐름 미리보기)
 * ─────────────────────────────────────────────────────────────
 *
 *   원고 분류 결과 + DESIGN.md  →  페이지네이션 LLM
 *                                       ↓
 *                            PageBlueprint[] (이 파일의 출력)
 *                                       ↓
 *                          grid.ts.realize(blueprint, format, page.side)
 *                                       ↓
 *                                 Page.frames (실제 mm 좌표)
 *
 * LLM이 만지는 건 PageBlueprint까지. 그 아래는 코드만.
 */

import type { Frame } from "@/lib/types/frames";

// ─────────────────────────────────────────────────────────────
// 그리드 영역
// ─────────────────────────────────────────────────────────────

/**
 * 그리드 좌표.
 *
 * column / row는 1부터 시작(인쇄 조판 관습).
 * span은 칸 수. -1 은 "끝까지 / 남은 칸 전부".
 *
 * 예) 12단 그리드에서 "왼쪽 절반, 위에서 아래로 풀높이":
 *   { column: 1, columnSpan: 6, row: 1, rowSpan: -1 }
 *
 * 행(row)은 컬럼만큼 명시적이지 않다. format.columns는 페이지 폭을 가르는 단위지만
 * 행은 "콘텐츠가 자라는 방향"이라 baselineGrid 단위(format.baselineGrid mm)로
 * 자유 분할된다. 패턴은 의미적 행 인덱스(1=상단, 2=중단…)만 쓰고,
 * grid.ts가 페이지 본문 영역을 N등분해 환산한다. (N은 패턴이 totalRows로 선언.)
 */
export type GridArea = {
  /** 시작 컬럼 (1부터) */
  column: number;
  /** 차지하는 컬럼 수. -1 = 남은 폭 전부 */
  columnSpan: number;
  /** 시작 행 (1부터) */
  row: number;
  /** 차지하는 행 수. -1 = 남은 높이 전부 */
  rowSpan: number;
};

/**
 * 의미적 위치 — 좌·우 페이지 미러링용 옵션.
 *
 * column 숫자 대신 "안쪽 가장자리 붙임"·"바깥쪽 가장자리 붙임"으로 적으면
 * grid.ts가 Page.side 에 따라 자동으로 column 인덱스를 뒤집는다.
 *
 * 단순 column 좌표를 쓸 때는 이 필드 비워두면 됨. 둘 다 채우면 edge가 이김.
 */
export type EdgeAffinity = "insideEdge" | "outsideEdge" | undefined;

// ─────────────────────────────────────────────────────────────
// 콘텐츠 슬롯
// ─────────────────────────────────────────────────────────────

/**
 * LLM이 콘텐츠를 끼워넣는 자리.
 * Frame 종류별로 가질 수 있는 보조 필드가 다르므로 discriminated union.
 *
 * id 는 패턴 안에서 유일. LLM 출력에서 이 id를 키로 콘텐츠를 매핑한다.
 *   { "title": "회사소개", "subtitle": "2026 IR" }
 */
export type ContentSlot =
  | TextSlot
  | ImageSlot
  | ChartSlot
  | TableSlot
  | ShapeSlot;

type SlotBase = {
  /** 패턴 내 유일 id. LLM 출력의 매핑 키. 예: "title", "body", "hero-image" */
  id: string;
  /** 사람이 읽는 라벨 (LLM 시스템 프롬프트와 디자이너 미리보기에 사용) */
  label: string;
  /** 그리드 영역 — 변형 슬롯에 의해 덮어써질 수 있음 */
  area: GridArea;
  /** 좌·우 미러링 시 어느 가장자리에 붙는지 */
  edge?: EdgeAffinity;
  /** true면 슬롯을 비워두는 것을 허용. 기본 false (필수) */
  optional?: boolean;
  /**
   * 풀블리드. true면 grid 환산을 무시하고 트림 박스 + 블리드까지 채움.
   * 보통 ImageSlot 에서만 의미가 있지만 ShapeSlot에도 허용.
   */
  bleedToEdge?: boolean;
};

export type TextSlot = SlotBase & {
  kind: "text";
  /** 적용할 단락 스타일 ID (Document.styles.paragraphStyles[].id) */
  paragraphStyleId: string;
  /** TextFrame.role — 접근성 + 의미 */
  role?: "heading" | "paragraph" | "caption" | "list" | "blockquote";
  /** role === "heading" 일 때의 레벨 */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** 박스 안 단 분할. 본문 2단 패턴 등에서 사용 */
  columns?: number;
  /** 단 사이 거터 (format.unit) */
  columnGutter?: number;
  /** 박스 내부 인셋 (format.unit). 없으면 0 */
  inset?: { top: number; right: number; bottom: number; left: number };
  /** 박스 내부 세로 정렬 */
  verticalAlignment?: "top" | "center" | "bottom" | "justify";
  /*
   * NOTE: 콘텐츠 길이 힌트(hintCharCount 등)는 의도적으로 두지 않는다.
   * §1 차별점: "사용자가 가진 정확한 원고를 그대로 얹는 워크플로우 — AI가 카피를 새로 쓰지 않음".
   * 슬롯에 길이 권장값을 박으면 LLM이 본문을 자르거나 요약할 유혹이 생기고,
   * 사용자가 누락을 못 알아챈 채로 의뢰인에게 산출물이 전달될 사고 경로가 만들어진다.
   * 콘텐츠가 슬롯에 안 맞으면 패턴을 바꾸거나(2단/다음 페이지) 분할할 일이지,
   * 콘텐츠를 줄일 일이 아니다. 이 책임은 페이지네이션 LLM의 *패턴 선택* 단계가 진다.
   */
};

export type ImageSlot = SlotBase & {
  kind: "image";
  /** 프레임 안에서 이미지 맞춤 방식 */
  fit?: "cover" | "contain" | "fill";
  /** alt 텍스트가 필수인지 (접근성) */
  altRequired?: boolean;
};

export type ChartSlot = SlotBase & {
  kind: "chart";
  /** 권장 차트 타입. LLM이 데이터 모양 보고 바꿀 수 있음 */
  preferredChartType?: "bar" | "line" | "area" | "pie" | "donut";
};

export type TableSlot = SlotBase & {
  kind: "table";
  /** 권장 행/열 범위 (LLM 가이드용) */
  hint?: { rowsMin?: number; rowsMax?: number; colsMin?: number; colsMax?: number };
};

export type ShapeSlot = SlotBase & {
  kind: "shape";
  shape: "rect" | "ellipse" | "line";
  fillColorId?: string;
  strokeColorId?: string;
  strokeWidth?: number;
  cornerRadius?: number;
};

// ─────────────────────────────────────────────────────────────
// 변형 슬롯
// ─────────────────────────────────────────────────────────────

/**
 * 한 패턴 안에서 LLM이 흔들 수 있는 자유도.
 *
 * 예) "left-image-right-text" 패턴에서 이미지 비중:
 *   {
 *     id: "imageWeight",
 *     label: "이미지 비중",
 *     options: [
 *       { value: "narrow",   override: { "hero-image": { columnSpan: 4 }, "body": { column: 5, columnSpan: 8 } } },
 *       { value: "balanced", override: { "hero-image": { columnSpan: 6 }, "body": { column: 7, columnSpan: 6 } } },
 *       { value: "wide",     override: { "hero-image": { columnSpan: 8 }, "body": { column: 9, columnSpan: 4 } } },
 *     ],
 *     defaultValue: "balanced",
 *   }
 *
 * override의 키는 ContentSlot.id. 값은 GridArea의 부분 — 명시한 필드만 덮어쓴다.
 */
export type Variant = {
  /** LLM 출력에서 이 변형을 가리키는 키. 예: "imageWeight" */
  id: string;
  /** 사람이 읽는 라벨 */
  label: string;
  /** 선택지 목록 */
  options: VariantOption[];
  /** LLM이 선택을 안 했을 때의 기본값 (options[*].value 중 하나) */
  defaultValue: string;
};

export type VariantOption = {
  /** LLM이 출력할 enum 값. 예: "narrow" */
  value: string;
  /** 사람이 읽는 라벨 */
  label?: string;
  /**
   * 슬롯별 GridArea 부분 덮어쓰기.
   * key = ContentSlot.id, value = GridArea의 일부 필드.
   */
  override?: Record<string, Partial<GridArea>>;
};

// ─────────────────────────────────────────────────────────────
// 패턴 본체
// ─────────────────────────────────────────────────────────────

/**
 * 콤포지션 패턴 1개.
 *
 * 명명 규칙:
 *   slug: 영문 케밥 케이스. 예: "cover-centered", "body-1col", "left-image-right-text"
 *   role: 패턴이 어떤 용도로 쓰이는지의 분류. LLM 시스템 프롬프트에서 "표지가 필요해요"
 *         같은 의도를 패턴 후보군으로 좁히는 데 사용.
 */
export type CompositionPattern = {
  slug: string;
  name: string;
  /** 한 줄 설명 (LLM 시스템 프롬프트에 노출) */
  description: string;
  /** 패턴 분류 — LLM이 후보를 좁히는 데 사용 */
  role:
    | "cover" // 표지
    | "section-opener" // 장 시작 페이지
    | "body" // 본문
    | "media" // 이미지/차트가 주연
    | "data" // 표/차트 등 정보 밀도 높음
    | "closing"; // 마지막 페이지, 연락처 등

  /**
   * 이 패턴이 가정하는 행 수.
   * 페이지 본문 영역(트림 - 마진)을 totalRows 등분한 것을 행 1~totalRows로 본다.
   * 보통 12 (컬럼과 동일). 콘텐츠 밀도 낮은 표지 등은 6.
   */
  totalRows: number;

  /** 콘텐츠 슬롯 목록 */
  slots: ContentSlot[];

  /** 변형 슬롯 (선택) */
  variants?: Variant[];

  /**
   * 적용 가능한 artifactType 제한.
   * 미지정 = 둘 다 가능. 책자형 전용 패턴은 ["bound"], 접지형은 ["folded"].
   */
  appliesTo?: Array<"bound" | "folded">;
};

// ─────────────────────────────────────────────────────────────
// LLM ↔ 코드 인터페이스
// ─────────────────────────────────────────────────────────────

/**
 * 페이지네이션 LLM의 페이지 1개 출력 형태.
 * 실제 좌표 환산 전 단계. lib/layout/grid.ts.realize() 의 입력.
 *
 * LLM은 패턴 슬러그를 가리키고, 변형 선택값을 채우고, 슬롯에 콘텐츠를 매핑하기만 한다.
 */
export type PageBlueprint = {
  /** CompositionPattern.slug */
  pattern: string;

  /** 변형 선택값. key = Variant.id, value = VariantOption.value. 일부만 명시 가능 */
  variants?: Record<string, string>;

  /**
   * 슬롯별 콘텐츠.
   * key = ContentSlot.id.
   *
   * 값 형태는 슬롯 종류에 따라 다르다 — 런타임 검증은 grid.ts에서.
   *   text:  { content: string | TextRun[], headingLevel?: 1..6 }
   *   image: { src: string, alt?: string }
   *   chart: ChartFrame 의 chartType / data / config 일부
   *   table: TableFrame 의 cells 등
   *
   * `unknown` 으로 둔 이유: 슬롯 타입에 의존한 강타입은 conditional types가 너무 깊어진다.
   * 검증은 grid.ts.realize()에서 슬롯 kind를 보며 좁히는 식으로 처리.
   */
  content: Record<string, unknown>;

  /**
   * 일부 슬롯을 비활성화. optional: true 슬롯에만 적용.
   * 예: "이미지 슬롯이 옵션인 본문 패턴에서 이번 페이지는 이미지 없이"
   */
  hiddenSlotIds?: string[];
};

/**
 * grid.ts.realize() 의 출력 — Page.frames에 그대로 들어가는 모양.
 * 별 다른 타입은 아니지만 가독성을 위해 alias 둠.
 */
export type RealizedFrames = Frame[];
