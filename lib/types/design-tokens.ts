/**
 * 디자인 토큰 — design.md의 코드 표현.
 * 스펙 §7: Google Stitch DESIGN.md 9개 섹션 + 인쇄용 확장 섹션(`print`).
 *
 * ───── 정책: read-only 카탈로그 ─────
 * DesignTokens는 "스타일의 원본 카탈로그"다. 사용자가 프로젝트 안에서
 * 단락 스타일을 편집하면 그 변경은 `Document.styles`에만 반영되고
 * DesignTokens는 건드리지 않는다.
 *
 * 어댑터/렌더러는 다음 우선순위로 스타일을 조회한다:
 *   1) Document.styles  (mutable, 사용자 편집 결과)
 *   2) DesignTokens.print  (read-only, 카탈로그 기본값)
 * 같은 id가 두 곳에 있으면 (1)이 이긴다. 분기 후 (2)는 참고만.
 *
 * 새 프로젝트 생성 시 DesignTokens.print의 내용을 Document.styles로 1회 복사.
 *
 * MVP 범위: 일단 핵심 토큰만 정의. 세부는 마일스톤 2 디자인 작업과 병행해 채움.
 */

import type { Color, Font, ParagraphStyle, CharacterStyle } from "./styles";

export type DesignTokens = {
  /** design.md 슬러그 (예: "minimal-mono", "warm-editorial") */
  slug: string;
  /** 사람이 읽는 이름 */
  name: string;
  /** 한 줄 설명 */
  description?: string;

  /**
   * 컬러 팔레트 (HEX).
   * 주의: 프레임은 이 팔레트를 직접 참조하지 않는다.
   * 어댑터/생성기가 이 팔레트를 기반으로 print.colors[] 카탈로그를 만들고,
   * 프레임은 colorId로 그 카탈로그를 참조한다.
   */
  palette: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
    border: string;
    /** 추가 색상 (이름 → HEX) */
    extra?: Record<string, string>;
  };

  /** 폰트 패밀리 */
  typography: {
    headingFamily: string;
    bodyFamily: string;
    monoFamily?: string;
    /** 본문 기본 크기 (pt) */
    bodySize: number;
    /** 본문 기본 행간 (배수, 예: 1.5) */
    bodyLineHeight: number;
  };

  /** 인쇄 확장 — 마일스톤 2에서 본격적으로 채워짐 */
  print?: {
    /** CMYK + Pantone 매핑 (HEX → CMYK/Pantone) */
    cmyk?: Record<string, { c: number; m: number; y: number; k: number; pantone?: string }>;
    /** 단락 스타일 카탈로그 (read-only) */
    paragraphStyles?: ParagraphStyle[];
    /** 문자 스타일 카탈로그 (read-only) */
    characterStyles?: CharacterStyle[];
    /** 사용 폰트 (라이선스 포함) */
    fonts?: Font[];
    /** 색상 스와치 카탈로그 (모든 colorId의 출처) */
    colors?: Color[];
  };
};
