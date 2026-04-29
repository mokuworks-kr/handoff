/**
 * 페이지 안의 콘텐츠 단위.
 * InDesign의 TextFrame/이미지 박스, Illustrator의 PathItem/PlacedItem과 1:1 매핑되도록 설계.
 *
 * 좌표계: 페이지 왼쪽 상단 (0,0). 단위는 Document.format.unit과 동일.
 */

export type FrameBase = {
  id: string;
  /** 좌표 (페이지 좌상단 기준) */
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
};

export type TextFrame = FrameBase & {
  type: "text";
  /** 텍스트 본문. 인라인 스타일이 필요하면 runs로 표현 */
  content: string | TextRun[];
  /** 단락 스타일 ID (DesignTokens.print.paragraphStyles 참조) */
  paragraphStyleId?: string;
  /** 컬럼 (이 프레임 안에서 단 분할) */
  columns?: number;
  columnGutter?: number;
};

export type TextRun = {
  text: string;
  characterStyleId?: string;
  /** 인라인 오버라이드 */
  override?: {
    weight?: number;
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
  /** alt 텍스트 (플립북 접근성, SEO) */
  alt?: string;
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
    /** 시리즈별 색상 (DesignTokens.print.colors[].id) */
    seriesColorIds?: string[];
  };
};

export type Frame = TextFrame | ImageFrame | ShapeFrame | ChartFrame;
