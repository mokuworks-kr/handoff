/**
 * 인쇄 조판 스타일 정의.
 * InDesign/Illustrator JSX 어댑터(마일스톤 4)에서 단락/문자 스타일,
 * 컬러 스와치 생성에 그대로 매핑됨.
 */

export type ParagraphStyle = {
  id: string;
  name: string;
  fontFamily: string;
  /** pt */
  fontSize: number;
  /** pt or 배수 */
  lineHeight: number | { type: "leading-pt"; value: number } | { type: "multiple"; value: number };
  alignment: "left" | "center" | "right" | "justify";
  /** 들여쓰기 (mm) */
  firstLineIndent?: number;
  /** 위/아래 여백 (mm) */
  spaceBefore?: number;
  spaceAfter?: number;
  /** 자간 (1/1000 em) */
  tracking?: number;
  /** 색상 ID (DesignTokens.print.colors[].id) */
  colorId?: string;
};

export type CharacterStyle = {
  id: string;
  name: string;
  fontFamily?: string;
  fontSize?: number;
  weight?: number; // 100~900
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
};
