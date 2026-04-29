/**
 * 페이지 안의 콘텐츠 단위.
 * InDesign의 TextFrame/이미지 박스, Illustrator의 PathItem/PlacedItem과 1:1 매핑되도록 설계.
 *
 * ───── 좌표계 정책 (전 어댑터 공통) ─────
 * - 원점: 페이지 트림(trim) 박스의 좌상단 (0, 0).
 *   블리드 박스가 아니다. 따라서 풀블리드 이미지는 음수 좌표(-bleed)에서 시작해
 *   width/height가 페이지 + 블리드 합계가 된다.
 * - 단위: `Document.format.unit` 그대로 (보통 mm). 폰트 크기만 pt 강제(styles.ts 참조).
 * - 양의 y는 아래로. (Illustrator는 위로 올라가는 좌표계라 어댑터에서 변환.)
 *
 * ───── 색상 참조 정책 ─────
 * 모든 색상은 ID 참조(`fillColorId`, `strokeColorId`, `colorId`)로만.
 * HEX 직접 박지 말 것. Color는 `Document.styles.colors`에서 조회되며,
 * CMYK 분판/스폿 색 변환 시 한 곳에서만 보면 된다.
 */

export type FrameBase = {
  id: string;
  /** 좌표 (페이지 트림 박스 좌상단 기준) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 회전 (도, 시계방향) */
  rotation?: number;
  /** z-index (작을수록 뒤) */
  z?: number;
  /** 잠금 여부 (UI에서 드래그 방지용) */
  locked?: boolean;

  /** 투명도 0~1 */
  opacity?: number;

  /**
   * 어댑터별 확장 메타데이터.
   * 플립북 인터랙션(CTA, 동영상 임베드, 폼), 어댑터 힌트 등.
   * 어댑터가 모르는 키는 무시한다. V2 호환성 안전판.
   */
  metadata?: Record<string, unknown>;
};

export type TextFrame = FrameBase & {
  type: "text";
  /** 텍스트 본문. 인라인 스타일이 필요하면 runs로 표현 */
  content: string | TextRun[];
  /** 단락 스타일 ID (Document.styles.paragraphStyles 참조) */
  paragraphStyleId?: string;
  /** 컬럼 (이 프레임 안에서 단 분할) */
  columns?: number;
  columnGutter?: number;

  /** 텍스트 박스 내부 인셋(패딩). 단위는 format.unit. InDesign textFramePreferences.insetSpacing 매핑. */
  inset?: { top: number; right: number; bottom: number; left: number };

  /** 텍스트 세로 정렬. InDesign textFramePreferences.verticalJustification 매핑. */
  verticalAlignment?: "top" | "center" | "bottom" | "justify";

  // ───── 접근성 (플립북 / 디지털 PDF) ─────
  /** 의미적 역할. 스크린리더/태그된 PDF에서 사용. */
  role?: "heading" | "paragraph" | "caption" | "list" | "blockquote";
  /** role이 heading일 때의 레벨 (1~6) */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
};

export type TextRun = {
  text: string;
  characterStyleId?: string;
  /** 인라인 오버라이드 */
  override?: {
    weight?: number | string;
    italic?: boolean;
    colorId?: string;
  };
};

export type ImageFrame = FrameBase & {
  type: "image";
  /** Storage URL 또는 외부 URL (Unsplash 등) */
  src: string;
  /** 프레임 안에서 이미지 맞춤 방식 */
  fit: "cover" | "contain" | "fill";
  /** 이미지 자체의 오프셋/스케일 (cropperjs 결과) */
  transform?: {
    offsetX: number;
    offsetY: number;
    scale: number;
  };
  /** alt 텍스트 (플립북 접근성, SEO, 태그된 PDF) */
  alt?: string;

  /**
   * 원본 이미지 메타.
   * 인쇄 PDF 생성 시 dpi 검증(<300 경고)에 사용.
   * 클라이언트에서 업로드 직후 또는 Unsplash 응답에서 채움.
   */
  source?: {
    /** 원본 픽셀 너비 */
    pxWidth: number;
    /** 원본 픽셀 높이 */
    pxHeight: number;
    /** 명시적 DPI(있으면). 없으면 어댑터가 frame 크기와 픽셀 크기로 환산 */
    dpi?: number;
  };
};

export type ShapeFrame = FrameBase & {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fillColorId?: string;
  strokeColorId?: string;
  strokeWidth?: number;
  cornerRadius?: number;
};

export type ChartFrame = FrameBase & {
  type: "chart";
  chartType: "bar" | "line" | "area" | "pie" | "donut";
  /** Recharts에 그대로 넘겨질 데이터 */
  data: Array<Record<string, string | number>>;
  /** 데이터 키 매핑 */
  config: {
    xKey: string;
    yKeys: string[];
    /** 시리즈별 색상 ID */
    seriesColorIds?: string[];
  };

  /**
   * 래스터화/벡터화 캐시.
   * InDesign/Illustrator 어댑터는 차트 객체를 만들 수 없으므로
   * 어댑터 단계에서 PNG 또는 vector PDF로 굽고, 결과를 여기 저장한 뒤
   * placedItem으로 박는다. 데이터/스타일 변경 시 invalidate.
   */
  rasterized?: {
    src: string;
    /** "png" | "pdf-vector" */
    kind: "png" | "pdf-vector";
    /** PNG일 때 dpi */
    dpi?: number;
    /** 캐시 무효화 키 (data/config 해시) */
    hash: string;
  };
};

/**
 * 표 (TableFrame).
 * InDesign 표 객체와 직접 매핑. Illustrator/PDF 어댑터는 셀을 TextFrame + 선으로 합성.
 *
 * 회사소개서/IR 시나리오 빈출: 임원 명단, 재무제표 요약, 제품 스펙표.
 */
export type TableFrame = FrameBase & {
  type: "table";
  /** 행/열 수 (cells 배열 차원과 일치해야 함) */
  rows: number;
  cols: number;

  /**
   * 셀 그리드. cells[row][col].
   * 행 길이 < cols면 빈 셀로 패딩, 초과는 무시.
   */
  cells: TableCell[][];

  /** 컬럼 너비 (단위 format.unit). 합 = frame.width 권장. */
  columnWidths: number[];
  /** 행 높이 (단위 format.unit). "auto"는 어댑터가 본문 길이로 산정. */
  rowHeights: Array<number | "auto">;

  /** 머리글 행 수 (반복 표시용). 0 = 없음 */
  headerRows?: number;
  /** 바닥글 행 수 */
  footerRows?: number;

  /** 외곽 테두리 / 가로/세로 구분선 스타일 */
  borders?: {
    outer?: TableBorder;
    horizontal?: TableBorder;
    vertical?: TableBorder;
  };

  /** 헤더/짝수행 등 일괄 배경 */
  rowBanding?: {
    headerColorId?: string;
    evenColorId?: string;
    oddColorId?: string;
  };
};

export type TableBorder = {
  /** 단위 pt (조판 표준) */
  width: number;
  colorId: string;
  style?: "solid" | "dashed" | "dotted";
};

export type TableCell = {
  /** 셀 내 텍스트. 인라인 스타일이 필요하면 runs */
  content: string | TextRun[];
  /** 단락 스타일 ID */
  paragraphStyleId?: string;
  /** 셀 배경 색상 ID */
  fillColorId?: string;
  /** 가로 정렬 (paragraphStyle 미지정 시 사용) */
  align?: "left" | "center" | "right";
  /** 세로 정렬 */
  valign?: "top" | "middle" | "bottom";
  /** 셀 패딩 (format.unit) */
  padding?: { top: number; right: number; bottom: number; left: number };
  /** 셀 병합. 1=병합 없음, 2이상=오른쪽/아래로 N칸 병합 */
  colSpan?: number;
  rowSpan?: number;
};

export type Frame = TextFrame | ImageFrame | ShapeFrame | ChartFrame | TableFrame;
