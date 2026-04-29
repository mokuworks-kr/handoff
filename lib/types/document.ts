/**
 * 추상 레이아웃 모델 — 모든 출력의 Source of Truth.
 * 스펙 §3 그대로.
 *
 * 이 모델 → 4개 어댑터(PDF / InDesign JSX / Illustrator JSX / 플립북)
 * 로 변환된다. 어떤 어댑터도 이 타입에서만 데이터를 읽도록 강제하면
 * 출력 간 불일치가 구조적으로 발생하지 않는다.
 *
 * DB 저장 형태: projects.document JSONB.
 */

import type { DesignTokens } from "./design-tokens";
import type { Frame } from "./frames";
import type { Color, Font, ParagraphStyle, CharacterStyle } from "./styles";

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

export type Page = {
  id: string;
  /** 좌/우 페이지 (좌우 미러링 마진 적용용) */
  side: "left" | "right";
  /** 페이지 템플릿 슬러그 (lib/layout/templates/) */
  template: string;
  frames: Frame[];
};

export type Document = {
  /** 책자형(bound) vs 접지형(folded) — 둘은 임포지션 규칙이 완전히 다름 */
  artifactType: "bound" | "folded";

  format: Format;

  /** 책자형일 때 */
  binding?: Binding;
  /** 접지형일 때 */
  fold?: Fold;

  designTokens: DesignTokens;

  pages: Page[];

  /**
   * 문서 단위 스타일 카탈로그.
   * DesignTokens.print에 들어가는 것과 동일하지만, 사용자 편집으로
   * 디자인 토큰에서 분기되는 경우를 위해 문서에도 따로 둠.
   */
  styles: {
    paragraphStyles: ParagraphStyle[];
    characterStyles: CharacterStyle[];
    colors: Color[];
    fonts: Font[];
  };
};

/** 새 빈 문서 시드 — 디버깅/시드용 */
export const EMPTY_DOCUMENT: Document = {
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
