/**
 * 디자인 토큰 — design.md의 코드 표현.
 * 스펙 §7: Google Stitch DESIGN.md 9개 섹션 + 인쇄용 확장 섹션(`print`).
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

  /** 컬러 팔레트 (HEX) */
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
    /** 단락 스타일 */
    paragraphStyles?: ParagraphStyle[];
    /** 문자 스타일 */
    characterStyles?: CharacterStyle[];
    /** 사용 폰트 (라이선스 포함) */
    fonts?: Font[];
    /** 색상 스와치 */
    colors?: Color[];
  };
};
