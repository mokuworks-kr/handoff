/**
 * 인쇄 조판 스타일 정의.
 * InDesign/Illustrator JSX 어댑터(마일스톤 4)에서 단락/문자 스타일,
 * 컬러 스와치 생성에 그대로 매핑됨.
 *
 * 단위 정책 (모델 전체 공통):
 * - 폰트 크기, 행간(leading-pt), 자간(tracking) 단위는 항상 pt 또는 1/1000 em.
 * - 들여쓰기/공백(firstLineIndent, leftIndent, rightIndent, spaceBefore, spaceAfter)은
 *   `Document.format.unit`(보통 mm)을 따름.
 * - 색상은 모두 `Color.id` 참조. HEX/CMYK 직접 박지 말 것.
 */

/**
 * InDesign 단락 스타일 매핑을 위한 boolean 토글들.
 * "고아/외톨이 줄 방지" 류는 인쇄 조판의 표준 옵션으로, 회사소개서/IR에서
 * 페이지 끝에 제목만 남고 본문이 다음 장으로 넘어가는 사고를 막는다.
 */
export type ParagraphStyle = {
  id: string;
  name: string;
  /** 다른 스타일을 상속(InDesign basedOn). 미지정 시 [No Paragraph Style] 기반. */
  basedOn?: string;

  fontFamily: string;
  /** pt */
  fontSize: number;
  /**
   * 행간.
   * - number  : 배수(1.5 = 150%) — CSS line-height 호환
   * - leading-pt: 절대 pt 값 (InDesign 표준)
   * - multiple: 배수 명시
   */
  lineHeight:
    | number
    | { type: "leading-pt"; value: number }
    | { type: "multiple"; value: number };

  alignment: "left" | "center" | "right" | "justify";

  /** 들여쓰기 (Document.format.unit 단위, 보통 mm) */
  firstLineIndent?: number;
  /** 왼쪽 들여쓰기 */
  leftIndent?: number;
  /** 오른쪽 들여쓰기 */
  rightIndent?: number;
  /** 단락 위 여백 */
  spaceBefore?: number;
  /** 단락 아래 여백 */
  spaceAfter?: number;

  /** 자간 (1/1000 em) */
  tracking?: number;

  /** 색상 ID (Document.styles.colors[].id 또는 DesignTokens.print.colors[].id) */
  colorId?: string;

  // ───── InDesign 단락 스타일 핵심 옵션 ─────

  /** 자동 하이픈 (한글은 보통 false, 영문 본문은 true) */
  hyphenation?: boolean;

  /** 다음 단락과 같은 페이지/단에 붙이기 (제목+본문 분리 방지). 0 또는 미지정 = 끔 */
  keepWithNext?: number;
  /** 단락 자체가 페이지/단을 넘어 분할되지 않게 */
  keepLinesTogether?: boolean;

  /** 드롭캡 — 커버/장 시작 페이지에서 자주 사용 */
  dropCap?: {
    /** 몇 줄 높이 */
    lines: number;
    /** 첫 N글자 */
    characters: number;
  };
};

/**
 * 문자 스타일.
 *
 * weight는 CSS 100~900 숫자 또는 PostScript 스타일 이름 둘 다 허용.
 * - 숫자: CSS 호환, 웹 미리보기/플립북에 직결
 * - 문자열("Bold", "Regular", "SemiBold"): InDesign font.styleName과 직결
 * 어댑터(특히 InDesign)는 폰트별 스타일 이름 테이블을 통해 둘을 변환한다.
 */
export type CharacterStyle = {
  id: string;
  name: string;
  basedOn?: string;

  fontFamily?: string;
  fontSize?: number;
  weight?: number | string;
  italic?: boolean;
  underline?: boolean;
  /** 자간 (1/1000 em) */
  tracking?: number;
  colorId?: string;
};

export type Color = {
  id: string;
  name: string;
  /** 우리 모델 안에서는 HEX가 1급 */
  hex: string;
  cmyk?: { c: number; m: number; y: number; k: number };
  pantone?: string;
  /** spot color 여부 (인쇄소 별색 분판) */
  spot?: boolean;
};

export type Font = {
  /** PostScript 이름 또는 패밀리 키 */
  family: string;
  /** 표시명 */
  displayName: string;
  /** 라이선스 종류 */
  license: "OFL" | "Apache-2.0" | "commercial" | "user-uploaded" | "unknown";
  /** zip 패키징 시 폰트 파일 동봉 가능 여부 */
  redistributable: boolean;
  /** 파일 경로 (선택, 동봉 가능 시) */
  filePath?: string;
  /**
   * Fallback 체인. 첫 번째부터 시도.
   * 예: ["Pretendard", "Noto Sans KR", "system-ui"]
   * PDF 임베드 실패, InDesign 폰트 누락 시 사용.
   */
  fallbacks?: string[];
};
