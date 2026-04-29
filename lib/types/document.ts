/**
 * 추상 레이아웃 모델 — 모든 출력의 Source of Truth.
 * 스펙 §3 + 추상 모델 검토(2026-04-29) 반영.
 *
 * 이 모델 → 4개 어댑터(PDF / InDesign JSX / Illustrator JSX / 플립북)
 * 로 변환된다. 어떤 어댑터도 이 타입에서만 데이터를 읽도록 강제하면
 * 출력 간 불일치가 구조적으로 발생하지 않는다.
 *
 * DB 저장 형태: projects.document JSONB.
 *
 * ─────────────────────────────────────────────────────────────
 * 모델 전체 정책 (한 곳에 모음 — 어댑터/렌더러는 이 규칙을 어기지 말 것)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) 좌표계 (frames.ts 헤더 참조)
 *    - 원점: 페이지 트림 박스 좌상단 (0, 0).
 *    - 단위: format.unit (보통 mm). 폰트 크기/자간만 pt·1/1000em 강제.
 *    - 양의 y는 아래로.
 *
 * 2) 단위 혼재 정책
 *    - 좌표/너비/높이/마진/들여쓰기: format.unit
 *    - 폰트 크기, leading-pt, 표 테두리 두께: pt
 *    - 자간(tracking): 1/1000 em
 *    - baselineGrid: format.unit
 *    인쇄 조판 표준 그대로(mm + pt 혼재). 의도된 설계.
 *
 * 3) 색상 참조
 *    모든 색상은 Color.id 참조. 프레임/스타일 어디서도 HEX/CMYK 직접 박지 말 것.
 *    Color는 Document.styles.colors가 1차 출처, DesignTokens.print.colors가 카탈로그.
 *
 * 4) 스타일 우선순위
 *    Document.styles > DesignTokens.print > 어댑터 기본값.
 *    같은 id가 양쪽에 있으면 Document.styles가 이긴다.
 *
 * 5) 좌·우 페이지 마진 미러링
 *    Format.margins.inside/outside는 "제본 쪽/바깥쪽"의 의미.
 *    Page.side === "left"  → top/bottom 그대로, left=outside, right=inside
 *    Page.side === "right" → top/bottom 그대로, left=inside,  right=outside
 *    이 변환은 lib/layout/binding.ts의 단일 함수에서만 수행하고
 *    모든 어댑터가 그것만 호출해야 한다. (어댑터별 자체 변환 금지.)
 *
 * 6) Illustrator 매핑 (정책)
 *    Illustrator는 페이지가 아니라 아트보드를 쓴다.
 *    - 책자형: 한 .ai에 모든 페이지를 아트보드로. spreadMode에 따라 단면/펼침.
 *    - 접지형: 한 .ai에 펼친 시트 한 장 = 아트보드 하나.
 *    Illustrator는 keepWithNext, hyphenation 등 일부 ParagraphStyle 옵션을
 *    지원하지 않는다. 어댑터는 표현 가능한 부분만 매핑하고 나머지는 무시
 *    또는 인라인 오버라이드로 흡수한다.
 */

import type { DesignTokens } from "./design-tokens";
import type { Frame } from "./frames";
import type { Color, Font, ParagraphStyle, CharacterStyle } from "./styles";

/**
 * 추상 모델 스키마 버전.
 * 마이너 변경(필드 추가, 옵셔널 확장)은 그대로 두고,
 * 기존 필드 타입/의미가 바뀌는 메이저 변경 시 +1.
 * 마이그레이션 함수는 lib/layout/migrations.ts (M3 시점에 추가 예정).
 */
export const SCHEMA_VERSION = 1;

export type Unit = "mm" | "pt" | "px" | "pica";

export type Format = {
  width: number;
  height: number;
  unit: Unit;
  bleed: { top: number; bottom: number; inside: number; outside: number };
  margins: {
    top: number;
    bottom: number;
    /** 안쪽(제본 쪽) — 좌우 페이지 자동 반전 */
    inside: number;
    /** 바깥쪽 */
    outside: number;
  };
  columns: number;
  gutter: number;
  baselineGrid: number;
};

export type Binding = {
  type: "saddle-stitch" | "perfect" | "spiral" | "wire-o" | "thread";
  /** 한국어/영어 = "left" */
  side: "left" | "right";
  facing: boolean;
};

export type Fold = {
  type: "half" | "tri-fold" | "z-fold" | "gate" | "cross" | "roll-4";
  sheetSize: { width: number; height: number };
  panels: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** 안쪽으로 접히는 면인지 */
    foldHint: "in" | "out";
  }>;
  foldLines: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    type: "valley" | "mountain";
  }>;
};

/**
 * 마스터 페이지.
 * 매 페이지에 자동으로 들어가는 공통 요소 (페이지 번호, 러닝 헤더, 로고 등).
 * Page.masterId로 연결. master의 frames에 토큰 문자열({{pageNumber}}, {{pageCount}}, {{title}})을
 * 쓰면 어댑터가 페이지 단위로 치환한다.
 */
export type Master = {
  id: string;
  name: string;
  /** 어느 면에 적용할지 — facing 책자에서 좌·우 마스터 분리용 */
  appliesTo: "left" | "right" | "both";
  frames: Frame[];
};

/**
 * 페이지 번호 정책. 문서 단위 1개.
 * "from"부터 시작. 표지 등 제외 페이지는 Page.excludeFromPageCount=true.
 */
export type PageNumbering = {
  enabled: boolean;
  from: number;
  /** 형식: "1" | "i" | "I" | "001". 기본 "1" */
  format?: "1" | "i" | "I" | "001";
  /** 마스터 안에서 토큰 위치를 잡으므로 여기엔 포지션 없음 */
};

export type Page = {
  id: string;
  /** 좌/우 페이지 (좌우 미러링 마진 적용용) */
  side: "left" | "right";
  /** 페이지 템플릿 슬러그 (lib/layout/templates/) */
  template: string;
  frames: Frame[];

  /** 적용할 마스터 페이지 ID */
  masterId?: string;
  /** 이 페이지를 페이지 번호 카운트에서 제외(예: 표지) */
  excludeFromPageCount?: boolean;
  /** 마스터의 일부 프레임을 이 페이지에서 숨길 때 */
  hiddenMasterFrameIds?: string[];
};

export type Document = {
  /** 추상 모델 스키마 버전. 마이그레이션 시 사용. */
  schemaVersion: number;

  /** 책자형(bound) vs 접지형(folded) — 둘은 임포지션 규칙이 완전히 다름 */
  artifactType: "bound" | "folded";

  format: Format;

  /** 책자형일 때 */
  binding?: Binding;
  /** 접지형일 때 */
  fold?: Fold;

  designTokens: DesignTokens;

  /** 마스터 페이지 목록 (페이지 번호, 러닝 헤더 등 공통 요소) */
  masters?: Master[];

  /** 페이지 번호 정책 */
  pageNumbering?: PageNumbering;

  pages: Page[];

  /**
   * 문서 단위 스타일 카탈로그 (mutable).
   * DesignTokens.print의 카탈로그를 새 프로젝트 시 1회 복사해 시작.
   * 이후 사용자 편집은 여기에만 반영. 색상은 모두 colors[].id로 참조됨.
   */
  styles: {
    paragraphStyles: ParagraphStyle[];
    characterStyles: CharacterStyle[];
    colors: Color[];
    fonts: Font[];
  };

  /**
   * 어댑터 옵션. 어댑터별 정책 결정값을 한곳에 모음.
   * 모델 자체의 의미를 바꾸지 않으며, 출력 시점에만 영향.
   */
  adapterOptions?: {
    illustrator?: {
      /** "single": 페이지마다 아트보드 1개 / "facing": 펼침면을 한 아트보드 */
      spreadMode: "single" | "facing";
    };
    pdfPrint?: {
      /** 크롭/레지스트레이션 마크 포함 여부 */
      printMarks?: boolean;
      /** 컬러 변환 강도 — "preserve"는 임베드된 프로파일 보존 */
      colorIntent?: "preserve" | "convert-cmyk";
    };
  };
};

/** 새 빈 책자형 문서 시드 — 디버깅/시드용 */
export const EMPTY_BOUND_DOCUMENT: Document = {
  schemaVersion: SCHEMA_VERSION,
  artifactType: "bound",
  format: {
    width: 210,
    height: 297,
    unit: "mm",
    bleed: { top: 3, bottom: 3, inside: 3, outside: 3 },
    margins: { top: 20, bottom: 20, inside: 25, outside: 15 },
    columns: 12,
    gutter: 4,
    baselineGrid: 6,
  },
  binding: { type: "perfect", side: "left", facing: true },
  designTokens: {
    slug: "default",
    name: "Default",
    palette: {
      background: "#FFFFFF",
      surface: "#FAFAFA",
      text: "#0A0A0A",
      textMuted: "#525252",
      accent: "#000000",
      border: "#EAEAEA",
    },
    typography: {
      headingFamily: "Pretendard",
      bodyFamily: "Pretendard",
      bodySize: 10.5,
      bodyLineHeight: 1.6,
    },
  },
  pages: [],
  styles: {
    paragraphStyles: [],
    characterStyles: [],
    colors: [],
    fonts: [],
  },
};

/**
 * 새 빈 접지형 문서 시드 (트라이폴드, A4 가로 = 297×210mm 기준).
 * 임포지션 테스트와 디버깅용. panels/foldLines은 비워두고
 * 실제 값은 lib/layout/imposition.ts(M4)에서 생성.
 */
export const EMPTY_FOLDED_DOCUMENT: Document = {
  schemaVersion: SCHEMA_VERSION,
  artifactType: "folded",
  format: {
    width: 297,
    height: 210,
    unit: "mm",
    bleed: { top: 3, bottom: 3, inside: 3, outside: 3 },
    margins: { top: 15, bottom: 15, inside: 10, outside: 10 },
    columns: 6,
    gutter: 4,
    baselineGrid: 6,
  },
  fold: {
    type: "tri-fold",
    sheetSize: { width: 297, height: 210 },
    panels: [],
    foldLines: [],
  },
  designTokens: {
    slug: "default",
    name: "Default",
    palette: {
      background: "#FFFFFF",
      surface: "#FAFAFA",
      text: "#0A0A0A",
      textMuted: "#525252",
      accent: "#000000",
      border: "#EAEAEA",
    },
    typography: {
      headingFamily: "Pretendard",
      bodyFamily: "Pretendard",
      bodySize: 10.5,
      bodyLineHeight: 1.6,
    },
  },
  pages: [],
  styles: {
    paragraphStyles: [],
    characterStyles: [],
    colors: [],
    fonts: [],
  },
};

/**
 * @deprecated 명시적인 EMPTY_BOUND_DOCUMENT를 쓰세요. 하위호환용 별칭.
 */
export const EMPTY_DOCUMENT = EMPTY_BOUND_DOCUMENT;
