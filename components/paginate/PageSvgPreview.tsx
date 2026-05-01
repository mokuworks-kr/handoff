"use client";

/**
 * PageSvgPreview — Page (Frame[]) → 축소된 SVG 썸네일.
 *
 * ─────────────────────────────────────────────────────────────
 * 책임 / 비책임
 * ─────────────────────────────────────────────────────────────
 *
 * 책임:
 *   - Page.frames 의 좌표/크기를 SVG 좌표계로 그리기 (검증·디버그용 미리보기)
 *   - Frame 종류(text/image/shape/chart/table) 별 시각적 분기
 *   - Color.id 참조를 styles.colors 에서 룩업해 fill 적용
 *   - 페이지 크기·블리드·트림박스 표시
 *
 * 비책임 (1차):
 *   - 정확한 폰트 렌더링 (인쇄 정합성은 PDF 어댑터가 함, M4)
 *   - 텍스트 길이가 슬롯에 맞는지 자동 검증 (validate.ts 가 함)
 *   - 인터랙션·편집 (M3c 캔버스가 함)
 *
 * ─────────────────────────────────────────────────────────────
 * 좌표계
 * ─────────────────────────────────────────────────────────────
 *
 * Frame 좌표는 `format.unit` (보통 mm) 단위, 트림 박스 좌상단이 원점.
 * SVG 의 viewBox 도 같은 단위 그대로 — 별도 환산 X.
 * 즉 viewBox="x y width height" = `0 0 format.width format.height`
 * 풀블리드 프레임은 음수 x/y 가지므로 viewBox 도 블리드 박스로 확장.
 *
 * ─────────────────────────────────────────────────────────────
 * 재사용
 * ─────────────────────────────────────────────────────────────
 *
 * /lab/paginate 에서 1차 사용. M3c 캔버스에서도 같은 컴포넌트 재사용 (정책 §10).
 * 따라서 prop 모양은 Page + styles 만 받고, lab 메타(rationale 등)는 받지 않음.
 * 그건 외부 ResultView 가 카드 레벨에서 표시.
 */

import type { Page, Format } from "@/lib/types/document";
import type { Frame, TextFrame, ImageFrame, ShapeFrame, ChartFrame, TableFrame, TextRun } from "@/lib/types/frames";
import type { Color } from "@/lib/types/styles";

export type PageSvgPreviewProps = {
  page: Page;
  format: Format;
  /**
   * 색상 카탈로그. Frame 의 fillColorId / strokeColorId / paragraphStyle.colorId 등을 룩업.
   * 비어있으면 모든 색상 fallback (회색 톤).
   */
  colors?: readonly Color[];
  /**
   * SVG 가 차지할 컨테이너 너비(px). 높이는 페이지 비율 유지.
   * 기본값 240 (썸네일 시퀀스용).
   */
  width?: number;
  /**
   * 외곽 추가 표시
   *   - showBleed: 블리드 박스 표시 (회색 점선)
   *   - showMargins: 마진 가이드 (옅은 점선)
   *   - showLabels: 슬롯 ID 텍스트 (디버그)
   */
  showBleed?: boolean;
  showMargins?: boolean;
  showLabels?: boolean;
};

// ─────────────────────────────────────────────────────────────
// 미리보기 톤 — 무채색 (§7 UI/UX 원칙)
// ─────────────────────────────────────────────────────────────

const TONE = {
  // 페이지 배경
  pageBg: "#FFFFFF",
  // 트림 박스 외곽선
  trimStroke: "#E5E5E5",
  // 블리드 박스 외곽선
  bleedStroke: "#D4D4D4",
  // 마진 가이드
  marginStroke: "#F5F5F5",
  // 텍스트 프레임 — 옅은 회색 채우기 + 본문 라인
  textFill: "#FAFAFA",
  textStroke: "#E5E5E5",
  textLineColor: "#A3A3A3",
  // 이미지 프레임 — 옅은 파란 회색 (이미지 자리 표시)
  imagePlaceholder: "#F0F4F8",
  imageStroke: "#D4DCE4",
  imageDiag: "#C4CCD4",
  // 표 프레임 — 옅은 베이지
  tableFill: "#FBFAF7",
  tableStroke: "#E5E1D8",
  tableLine: "#D4CFC2",
  // 차트 프레임
  chartFill: "#F8F4FA",
  chartStroke: "#DCD4E0",
  chartBar: "#A39CB0",
  // 도형 fallback
  shapeFill: "#EFEFEF",
  shapeStroke: "#D4D4D4",
  // 라벨
  labelText: "#737373",
} as const;

// ─────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────

export function PageSvgPreview({
  page,
  format,
  colors = [],
  width = 240,
  showBleed = false,
  showMargins = true,
  showLabels = false,
}: PageSvgPreviewProps) {
  // viewBox 계산 — 블리드 표시할 땐 블리드 박스까지 포함
  const bleedTop = showBleed ? format.bleed.top : 0;
  const bleedBottom = showBleed ? format.bleed.bottom : 0;
  const bleedInside = showBleed ? format.bleed.inside : 0;
  const bleedOutside = showBleed ? format.bleed.outside : 0;

  // bleed 의 inside/outside 는 좌·우 미러링과 관계 — 1차 미리보기는 page.side 따라 좌우 적용
  // (실제 인쇄 변환은 binding.ts 가 처리. 여기는 단순 시각화)
  const bleedLeft = page.side === "left" ? bleedOutside : bleedInside;
  const bleedRight = page.side === "left" ? bleedInside : bleedOutside;

  const vbX = -bleedLeft;
  const vbY = -bleedTop;
  const vbW = format.width + bleedLeft + bleedRight;
  const vbH = format.height + bleedTop + bleedBottom;

  // SVG 픽셀 크기 — 페이지 비율 유지
  const aspect = format.height / format.width;
  const height = Math.round(width * aspect);

  // 색상 룩업 헬퍼
  const colorMap = new Map(colors.map((c) => [c.id, c.hex]));
  const lookupColor = (id?: string, fallback = "#D4D4D4"): string => {
    if (!id) return fallback;
    return colorMap.get(id) ?? fallback;
  };

  // 프레임 z 정렬 (작을수록 뒤). z 미지정은 정의 순서대로.
  const sortedFrames = [...page.frames]
    .map((f, idx) => ({ frame: f, idx }))
    .sort((a, b) => {
      const za = a.frame.z ?? a.idx;
      const zb = b.frame.z ?? b.idx;
      return za - zb;
    })
    .map((x) => x.frame);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`페이지 미리보기 (${page.composition})`}
      style={{ display: "block", background: TONE.pageBg }}
    >
      {/* 블리드 박스 외곽선 (옵션) */}
      {showBleed && (
        <rect
          x={-bleedLeft}
          y={-bleedTop}
          width={vbW}
          height={vbH}
          fill="none"
          stroke={TONE.bleedStroke}
          strokeWidth={0.3}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* 트림 박스 (페이지 본체) */}
      <rect
        x={0}
        y={0}
        width={format.width}
        height={format.height}
        fill={TONE.pageBg}
        stroke={TONE.trimStroke}
        strokeWidth={0.5}
        vectorEffect="non-scaling-stroke"
      />

      {/* 마진 가이드 (옵션) */}
      {showMargins && (() => {
        // 좌·우 페이지 미러링 (정책 §5 — 단순 시각화 버전)
        const left = page.side === "left" ? format.margins.outside : format.margins.inside;
        const right = page.side === "left" ? format.margins.inside : format.margins.outside;
        return (
          <rect
            x={left}
            y={format.margins.top}
            width={format.width - left - right}
            height={format.height - format.margins.top - format.margins.bottom}
            fill="none"
            stroke={TONE.marginStroke}
            strokeWidth={0.3}
            strokeDasharray="1 1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })()}

      {/* 프레임들 */}
      {sortedFrames.map((frame) => (
        <FrameSvg
          key={frame.id}
          frame={frame}
          lookupColor={lookupColor}
          showLabel={showLabels}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Frame 종류별 분기
// ─────────────────────────────────────────────────────────────

function FrameSvg({
  frame,
  lookupColor,
  showLabel,
}: {
  frame: Frame;
  lookupColor: (id?: string, fallback?: string) => string;
  showLabel: boolean;
}) {
  // 회전: rotation 도. 중심 기준 회전 (CSS transform-origin 과 동일).
  const rotation = frame.rotation ?? 0;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const transform = rotation !== 0 ? `rotate(${rotation} ${cx} ${cy})` : undefined;
  const opacity = frame.opacity ?? 1;

  let body: React.ReactNode;
  switch (frame.type) {
    case "text":
      body = <TextFrameSvg frame={frame} lookupColor={lookupColor} />;
      break;
    case "image":
      body = <ImageFrameSvg frame={frame} />;
      break;
    case "shape":
      body = <ShapeFrameSvg frame={frame} lookupColor={lookupColor} />;
      break;
    case "chart":
      body = <ChartFrameSvg frame={frame} />;
      break;
    case "table":
      body = <TableFrameSvg frame={frame} />;
      break;
  }

  return (
    <g transform={transform} opacity={opacity}>
      {body}
      {showLabel && (
        <text
          x={frame.x + 1}
          y={frame.y + 4}
          fontSize={2.5}
          fill={TONE.labelText}
          fontFamily="ui-monospace, monospace"
        >
          {frame.id}
        </text>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// TextFrame — 옅은 박스 + 가짜 본문 라인 (실제 텍스트 랜더 X)
// ─────────────────────────────────────────────────────────────

function TextFrameSvg({
  frame,
  lookupColor,
}: {
  frame: TextFrame;
  lookupColor: (id?: string, fallback?: string) => string;
}) {
  // role 별 다른 채우기로 시각적으로 구분
  const isHeading = frame.role === "heading";
  const isCaption = frame.role === "caption";
  const fill = isHeading ? "#F0F0F0" : TONE.textFill;

  // 텍스트 첫 마디 추출 — heading/caption 이면 미리보기에 1줄 표시
  const previewText = extractFirstWords(frame.content, isHeading ? 12 : 6);

  // 본문 가짜 라인: 박스 안 inset 적용 후 일정 간격으로 가로 줄
  const inset = frame.inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const innerX = frame.x + inset.left;
  const innerY = frame.y + inset.top;
  const innerW = Math.max(0, frame.width - inset.left - inset.right);
  const innerH = Math.max(0, frame.height - inset.top - inset.bottom);

  // 라인 간격 — heading/caption 보다 paragraph 가 더 촘촘
  const lineGap = isHeading ? 6 : isCaption ? 3 : 4;
  const lineThickness = isHeading ? 1.5 : 0.6;
  const linesCount = Math.max(0, Math.floor(innerH / lineGap));

  // 라인의 길이 — 마지막 라인은 70%, 나머지는 95~100%
  const lineColor = lookupColor(undefined, TONE.textLineColor);

  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={fill}
        stroke={TONE.textStroke}
        strokeWidth={0.3}
        vectorEffect="non-scaling-stroke"
      />
      {/* 가짜 본문 라인 */}
      {Array.from({ length: linesCount }).map((_, i) => {
        const y = innerY + (i + 0.5) * lineGap;
        if (y > innerY + innerH) return null;
        const isLast = i === linesCount - 1;
        const w = isLast ? innerW * 0.7 : innerW * 0.95;
        return (
          <rect
            key={i}
            x={innerX}
            y={y}
            width={w}
            height={lineThickness}
            fill={lineColor}
            opacity={isHeading ? 0.85 : 0.55}
          />
        );
      })}
      {/* heading 미리보기 텍스트 — 옵셔널 */}
      {isHeading && previewText && innerW > 20 && (
        <text
          x={innerX + 1}
          y={innerY + Math.min(6, innerH * 0.4)}
          fontSize={Math.min(5, innerH * 0.3)}
          fill="#525252"
          fontFamily="system-ui, -apple-system, sans-serif"
          fontWeight={600}
        >
          {truncateForFit(previewText, innerW, 5)}
        </text>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// ImageFrame — placeholder 박스 + 대각선 (이미지 슬롯 표시)
// ─────────────────────────────────────────────────────────────

function ImageFrameSvg({ frame }: { frame: ImageFrame }) {
  // src 가 있고 외부 URL 이면 image 태그로. 단 SVG 안 image 는 CORS 이슈 + 미리보기에 무거우므로
  // 1차는 placeholder + alt 우선. 실제 이미지 표시는 옵션으로 미래 확장.
  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={TONE.imagePlaceholder}
        stroke={TONE.imageStroke}
        strokeWidth={0.3}
        vectorEffect="non-scaling-stroke"
      />
      {/* 대각선 X (이미지 슬롯 표준 표시) */}
      <line
        x1={frame.x}
        y1={frame.y}
        x2={frame.x + frame.width}
        y2={frame.y + frame.height}
        stroke={TONE.imageDiag}
        strokeWidth={0.4}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={frame.x + frame.width}
        y1={frame.y}
        x2={frame.x}
        y2={frame.y + frame.height}
        stroke={TONE.imageDiag}
        strokeWidth={0.4}
        vectorEffect="non-scaling-stroke"
      />
      {/* alt 텍스트 옵셔널 */}
      {frame.alt && frame.width > 20 && (
        <text
          x={frame.x + frame.width / 2}
          y={frame.y + frame.height / 2}
          fontSize={Math.min(3, frame.height * 0.15)}
          fill="#737373"
          fontFamily="system-ui, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {truncateForFit(frame.alt, frame.width - 4, 3)}
        </text>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// ShapeFrame — rect / ellipse / line
// ─────────────────────────────────────────────────────────────

function ShapeFrameSvg({
  frame,
  lookupColor,
}: {
  frame: ShapeFrame;
  lookupColor: (id?: string, fallback?: string) => string;
}) {
  const fill = frame.fillColorId
    ? lookupColor(frame.fillColorId, TONE.shapeFill)
    : "none";
  const stroke = frame.strokeColorId
    ? lookupColor(frame.strokeColorId, TONE.shapeStroke)
    : frame.strokeWidth
      ? TONE.shapeStroke
      : "none";
  const sw = frame.strokeWidth ?? 0;

  if (frame.shape === "ellipse") {
    return (
      <ellipse
        cx={frame.x + frame.width / 2}
        cy={frame.y + frame.height / 2}
        rx={frame.width / 2}
        ry={frame.height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  if (frame.shape === "line") {
    return (
      <line
        x1={frame.x}
        y1={frame.y + frame.height / 2}
        x2={frame.x + frame.width}
        y2={frame.y + frame.height / 2}
        stroke={stroke === "none" ? TONE.shapeStroke : stroke}
        strokeWidth={Math.max(sw, 0.3)}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  // rect (기본)
  return (
    <rect
      x={frame.x}
      y={frame.y}
      width={frame.width}
      height={frame.height}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      rx={frame.cornerRadius ?? 0}
      ry={frame.cornerRadius ?? 0}
      vectorEffect="non-scaling-stroke"
    />
  );
}

// ─────────────────────────────────────────────────────────────
// ChartFrame — bar/line 등 단순 시각화 (실제 데이터 차트 렌더 X)
// ─────────────────────────────────────────────────────────────

function ChartFrameSvg({ frame }: { frame: ChartFrame }) {
  // 미리보기는 차트 *종류* 만 시각화 — 실 데이터 렌더는 PDF 어댑터(M4)
  const padding = Math.min(frame.width, frame.height) * 0.1;
  const innerX = frame.x + padding;
  const innerY = frame.y + padding;
  const innerW = frame.width - padding * 2;
  const innerH = frame.height - padding * 2;

  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={TONE.chartFill}
        stroke={TONE.chartStroke}
        strokeWidth={0.3}
        vectorEffect="non-scaling-stroke"
      />
      {frame.chartType === "bar" && (
        <>
          {[0.7, 0.4, 0.85, 0.55, 0.95].map((h, i) => {
            const barW = innerW / 6;
            const barH = innerH * h;
            return (
              <rect
                key={i}
                x={innerX + i * (innerW / 5) + barW * 0.1}
                y={innerY + innerH - barH}
                width={barW * 0.8}
                height={barH}
                fill={TONE.chartBar}
              />
            );
          })}
        </>
      )}
      {(frame.chartType === "line" || frame.chartType === "area") && (() => {
        // 5개 가짜 데이터 포인트 — y 비율 (0=위, 1=아래)
        const points = [0.6, 0.4, 0.7, 0.3, 0.45];
        const coords = points
          .map((y, i) => {
            const px = innerX + (i / (points.length - 1)) * innerW;
            const py = innerY + y * innerH;
            return `${px.toFixed(2)},${py.toFixed(2)}`;
          })
          .join(" ");
        return (
          <polyline
            points={coords}
            fill="none"
            stroke={TONE.chartBar}
            strokeWidth={0.6}
            vectorEffect="non-scaling-stroke"
          />
        );
      })()}
      {(frame.chartType === "pie" || frame.chartType === "donut") && (
        <circle
          cx={innerX + innerW / 2}
          cy={innerY + innerH / 2}
          r={Math.min(innerW, innerH) / 2}
          fill={TONE.chartBar}
          opacity={0.8}
        />
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// TableFrame — 행/열 그리드 표시
// ─────────────────────────────────────────────────────────────

function TableFrameSvg({ frame }: { frame: TableFrame }) {
  // 행 높이는 균등 분배 (preview 용 — "auto" 도 같이 균등하게)
  const rowH = frame.height / Math.max(1, frame.rows);
  // 컬럼 너비 — columnWidths 합과 frame.width 비율로 정규화
  const totalColW = frame.columnWidths.reduce((s, w) => s + w, 0) || 1;
  const colXs: number[] = [];
  let cx = frame.x;
  for (const w of frame.columnWidths) {
    colXs.push(cx);
    cx += (w / totalColW) * frame.width;
  }
  colXs.push(frame.x + frame.width);

  return (
    <g>
      <rect
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={TONE.tableFill}
        stroke={TONE.tableStroke}
        strokeWidth={0.3}
        vectorEffect="non-scaling-stroke"
      />
      {/* 헤더 음영 */}
      {frame.headerRows && frame.headerRows > 0 && (
        <rect
          x={frame.x}
          y={frame.y}
          width={frame.width}
          height={rowH * frame.headerRows}
          fill="#F0EBE0"
          opacity={0.6}
        />
      )}
      {/* 가로선 */}
      {Array.from({ length: frame.rows + 1 }).map((_, i) => (
        <line
          key={`h${i}`}
          x1={frame.x}
          y1={frame.y + i * rowH}
          x2={frame.x + frame.width}
          y2={frame.y + i * rowH}
          stroke={TONE.tableLine}
          strokeWidth={0.2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* 세로선 */}
      {colXs.map((x, i) => (
        <line
          key={`v${i}`}
          x1={x}
          y1={frame.y}
          x2={x}
          y2={frame.y + frame.height}
          stroke={TONE.tableLine}
          strokeWidth={0.2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────

/**
 * TextFrame.content (string | TextRun[]) 에서 첫 N 글자 추출.
 * 미리보기 텍스트에 사용 — 정확한 폰트 메트릭 안 따짐.
 */
function extractFirstWords(content: string | TextRun[], maxChars: number): string {
  let raw: string;
  if (typeof content === "string") {
    raw = content;
  } else {
    raw = content.map((r) => r.text).join("");
  }
  const trimmed = raw.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars) + "…";
}

/**
 * SVG 텍스트가 박스 너비 안에 들어갈 만큼 자름.
 * 폰트 메트릭 정확 측정 X — fontSize 와 폭 비율로 단순 추정.
 * 한글은 글자당 폭이 fontSize 와 거의 같고, 영문은 0.5 배 정도.
 * 보수적으로 0.6 배로 잡음.
 */
function truncateForFit(text: string, maxWidthMm: number, fontSizeMm: number): string {
  const charWidth = fontSizeMm * 0.6;
  const maxChars = Math.max(1, Math.floor(maxWidthMm / charWidth));
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)) + "…";
}
