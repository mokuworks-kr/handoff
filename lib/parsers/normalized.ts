/**
 * NormalizedManuscript — 모든 파서의 공통 출력 형태.
 *
 * docx/pdf/pptx/hwpx/text 어떤 입력으로 들어왔든 일단 이 형태로 정규화한 뒤,
 * 분류기(M3a-2) → 페이지네이션 LLM(M3b)이 이 형태 위에서만 동작한다.
 * 파서 종류가 늘어나도 그 위 레이어는 영향받지 않게 하는 것이 목적.
 *
 * ─────────────────────────────────────────────────────────────
 * 설계 정책 (M3a-1 결정 박제)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) §1 약속 — 원고를 다듬지 않는다.
 *    파서는 "추출"만 한다. 의역/요약/병합/분할 금지.
 *    인라인 스타일도 의미적인 것만 보존(bold/italic/underline).
 *    폰트 크기·색상 같은 시각 속성은 버린다 — 디자인 토큰이 다시 입힌다.
 *
 * 2) 블록 6종으로 시작 (`heading | paragraph | list | table | image | separator`).
 *    회사소개서/IR 1차 타깃에서 90%+ 커버. blockquote/code/equation 등은
 *    실제로 자주 나오면 그때 추가.
 *
 * 3) 표 셀 = 단순 문자열 (A안).
 *    중첩 표/셀 안의 다단락은 줄바꿈으로 합쳐서 1차원 문자열로.
 *    이게 깨지는 케이스가 자주 나오면 셀을 Block[] 로 확장.
 *
 * 4) 블록 ID는 순서 기반 `b001`, `b002` ...
 *    파싱 1회에 부여, 같은 파싱 결과 안에서는 안정적.
 *    원고를 다시 파싱하면 ID도 다시 부여 — 파싱 결과 자체가 새 인스턴스.
 *    분류기 출력은 이 ID를 range로 가리킨다.
 *
 * 5) 인라인 스타일은 TextRun 배열로 표현.
 *    스타일이 전혀 없는 단락은 `runs: [{ text: "..." }]` 단일 run.
 *    옵셔널이 아닌 필수 — 분류기/LLM이 항상 같은 모양을 본다.
 *
 * 6) 메타데이터는 `source` 한 묶음에.
 *    분류기/페이지네이션은 거의 안 본다. 디버깅·사용자 미리보기용.
 *
 * ─────────────────────────────────────────────────────────────
 * 라이프사이클
 * ─────────────────────────────────────────────────────────────
 *
 *   업로드 (docx/pdf/pptx/hwpx) 또는 텍스트 붙여넣기
 *      ↓ 파서 (lib/parsers/{docx,pdf,pptx,hwpx,text}.ts)
 *   NormalizedManuscript                ← 이 파일이 정의
 *      ↓ 분류기 (M3a-2, lib/classify/)
 *   ClassifiedManuscript                 ← M3a-2에서 정의
 *      ↓ 페이지네이션 LLM (M3b)
 *   PageBlueprint[] (lib/layout/composition.ts)
 *      ↓ realize() (lib/layout/grid.ts)
 *   Page.frames[] (Document.pages[*].frames)
 *
 * 저장 위치: Document.manuscript (M3a-1 결정, "옵션 A — Document에 합치기").
 * Document.manuscript 의 정확한 모양은 ClassifiedManuscript이지
 * NormalizedManuscript가 아니다. 분류 단계가 끝나야 저장된다.
 * NormalizedManuscript는 분류 직전의 휘발성 중간 표현.
 */

// ─────────────────────────────────────────────────────────────
// 인라인 텍스트 — TextRun
// ─────────────────────────────────────────────────────────────

/**
 * 인라인 스타일이 다른 텍스트 조각.
 *
 * 한 단락이 "안녕하세요, **반갑습니다**." 라면:
 *   runs: [
 *     { text: "안녕하세요, " },
 *     { text: "반갑습니다", bold: true },
 *     { text: "." },
 *   ]
 *
 * 폰트/크기/색상 같은 시각 속성은 박지 않는다 — 디자인 토큰이 입힌다.
 * 의미적 강조(bold/italic/underline)만 보존하는 이유는 §1 약속과 충돌하지
 * 않으면서, 사용자가 의도했던 "여기 강조" 신호를 디자인이 받아낼 수 있게 하기 위함.
 *
 * 주의: 이 TextRun은 lib/types/frames.ts 의 TextRun과 다른 타입이다.
 *   frames.ts의 TextRun: 디자인 단계, characterStyleId 참조 + colorId 등.
 *   여기의 TextRun:        원고 단계, 의미적 스타일만.
 * 페이지네이션이 변환해 frames.ts의 TextRun으로 떨군다.
 */
export type TextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};

// ─────────────────────────────────────────────────────────────
// 블록 종류
// ─────────────────────────────────────────────────────────────

/**
 * 모든 블록의 공통 필드.
 *
 * `id`는 같은 NormalizedManuscript 안에서 유일.
 * `sourceLocation`은 디버깅과 "원본 어디서 왔는지" 미리보기용.
 *   pdf의 페이지 번호, pptx의 슬라이드 번호, docx의 단락 인덱스 등.
 *   포맷마다 의미가 달라 자유 문자열.
 */
type BlockBase = {
  id: string;
  /** 디버깅용 원본 위치 표기 (예: "pdf:p3", "pptx:slide5", "docx:¶17") */
  sourceLocation?: string;
};

/**
 * 제목 블록.
 *
 * level 1~6은 의미적 깊이.
 * docx Heading 1~6, hwpx outline level, pdf 본문보다 큰 글씨로 보이는 줄 등이 매핑됨.
 *
 * 분류기가 "여기서 새 섹션이 시작된다"는 강한 신호로 사용한다.
 */
export type HeadingBlock = BlockBase & {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  runs: TextRun[];
};

/**
 * 일반 단락.
 *
 * 줄바꿈은 단락 분리로 표현. 단락 안의 줄바꿈(soft break)은 보존하지 않는다.
 * (실제로 회사소개서/IR 원고에서 의미 있는 soft break는 거의 없음.)
 */
export type ParagraphBlock = BlockBase & {
  type: "paragraph";
  runs: TextRun[];
};

/**
 * 목록.
 *
 * 한 ListBlock = 같은 들여쓰기 레벨의 인접한 항목들.
 * 중첩 목록은 1차에서 평탄화 (level 필드로 깊이만 표시).
 *
 * `ordered`: true면 1, 2, 3... / false면 •, ◦, ▪... 식.
 *   원본의 정확한 마커 모양은 보존하지 않음 — 디자인 토큰이 결정.
 */
export type ListBlock = BlockBase & {
  type: "list";
  ordered: boolean;
  items: ListItem[];
};

export type ListItem = {
  /** 들여쓰기 깊이. 0 = 최상위, 1 = 한 단계 들여씀 ... */
  level: number;
  runs: TextRun[];
};

/**
 * 표.
 *
 * cells는 [row][col] 2차원 배열. 각 셀은 단순 문자열 (A안).
 * 셀 안의 줄바꿈은 \n 으로 보존 (이건 의미 있는 줄바꿈으로 간주 — 표 셀에서는
 * 흔히 의도적인 단락 분리).
 *
 * `headerRows`: 머리글 행 수. 보통 1. docx/hwpx에서 헤더 표시가 있으면 채움,
 * 아니면 분류기/페이지네이션이 추정.
 *
 * 표는 인라인 스타일을 보존하지 않는다 — 회사소개서/IR 표는 평문이 절대다수.
 * 필요해지면 셀을 `string | TextRun[]` 로 확장.
 */
export type TableBlock = BlockBase & {
  type: "table";
  rows: number;
  cols: number;
  cells: string[][];
  headerRows?: number;
};

/**
 * 이미지 placeholder.
 *
 * 1차 정책: 원본에 박혀있던 이미지는 "있다"는 신호만 잡고
 * 실제 이미지 업로드/매칭은 별도 흐름.
 *
 * - alt: 원본에 alt 텍스트가 있으면 보존. 없으면 빈 문자열.
 * - caption: 원본의 그림 캡션 (docx/hwpx에서 잡힐 수 있음).
 * - originalSrc: 원본 파일 안에서의 경로(zip 내부 경로 등). 실제 추출 여부는
 *   파서 구현이 결정 — 1차에서는 placeholder만 두고 추출 X.
 *
 * 페이지네이션 LLM은 이 블록을 보고 "이 자리에 이미지가 있어야 한다"고만 인식.
 * Unsplash 검색 또는 사용자 업로드는 후속 단계.
 */
export type ImageBlock = BlockBase & {
  type: "image";
  alt: string;
  caption?: string;
  originalSrc?: string;
};

/**
 * 구분자.
 *
 * 원본의 page break, section break, hr(<hr>) 등.
 * 분류기에 "여기서 끊어보면 어떻겠냐"는 약한 힌트.
 *
 * `kind`:
 *   "page"    — 페이지 구분 (docx/pdf/pptx의 명시적 page/slide break)
 *   "section" — 섹션 구분 (docx의 section break)
 *   "rule"    — 가로선 (<hr>)
 */
export type SeparatorBlock = BlockBase & {
  type: "separator";
  kind: "page" | "section" | "rule";
};

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | SeparatorBlock;

// ─────────────────────────────────────────────────────────────
// 메타데이터
// ─────────────────────────────────────────────────────────────

export type SourceFormat = "docx" | "pdf" | "pptx" | "hwpx" | "text";

export type ManuscriptSource = {
  format: SourceFormat;
  /** 원본 파일명. 텍스트 붙여넣기는 "untitled.txt" 등 */
  filename: string;
  /** 파일 크기 (bytes). 텍스트 붙여넣기는 문자열 byte length */
  byteSize?: number;
  /** 원본 파일에서 따낸 작성자/제목/생성일 (있으면) */
  author?: string;
  title?: string;
  createdAt?: string;
  modifiedAt?: string;
  /** pdf/pptx의 페이지·슬라이드 수 */
  pageCount?: number;
};

// ─────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────

/**
 * 정규화된 원고.
 *
 * 분류 직전의 중간 표현. 휘발성 — DB에 저장하지 않는다.
 * 분류 결과(ClassifiedManuscript)가 Document.manuscript 로 저장됨.
 */
export type NormalizedManuscript = {
  /**
   * 정규화 스키마 버전. 블록 종류가 늘거나 표 셀 정책이 바뀌는 등의
   * 메이저 변경 시 +1.
   */
  schemaVersion: 1;

  source: ManuscriptSource;

  /**
   * 원고를 구성하는 블록의 평탄한 시퀀스.
   * 순서가 의미를 가진다 — 분류기/페이지네이션이 이 순서를 신뢰한다.
   */
  blocks: Block[];

  /**
   * 파서가 추출 중 만난 경고/주의사항.
   * 사용자에게 미리보기에서 보여줄 것 (예: "이 PDF는 스캔본이라 텍스트 추출이
   * 부정확할 수 있어요" / "표 안의 표는 평탄화됐어요").
   */
  warnings?: ManuscriptWarning[];
};

export type ManuscriptWarning = {
  /** 자유 텍스트 사람이 읽는 메시지 */
  message: string;
  /** 관련된 블록 ID (있으면) */
  blockId?: string;
  /** 심각도 — info는 미리보기에서 회색, warn은 노랑, error는 빨강 */
  severity: "info" | "warn" | "error";
};

// ─────────────────────────────────────────────────────────────
// 헬퍼 — 블록 ID 생성
// ─────────────────────────────────────────────────────────────

/**
 * 블록 ID 포맷터. b001, b002 ... b999, b1000 ...
 * 4자리까지는 0 패딩, 그 이상은 자연수. 9999 블록까지는 정렬 시 시각적 안정성 유지.
 *
 * 30~40페이지 회사소개서/IR이라도 블록 수가 1000을 넘기 어려우니
 * 4자리 패딩으로 충분.
 */
export function blockId(index: number): string {
  if (index < 0) throw new Error(`blockId index must be >= 0 (got ${index})`);
  return `b${String(index + 1).padStart(4, "0")}`;
}

/**
 * 평탄한 텍스트로 합치기 — 디버깅·LLM 프롬프트 짧게 보낼 때.
 * 인라인 스타일 정보는 잃는다. 분류기에는 풀 정보를 주고, 디버깅에만 사용.
 */
export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        lines.push("#".repeat(b.level) + " " + runsToText(b.runs));
        break;
      case "paragraph":
        lines.push(runsToText(b.runs));
        break;
      case "list":
        for (const item of b.items) {
          const indent = "  ".repeat(item.level);
          const marker = b.ordered ? "1." : "-";
          lines.push(`${indent}${marker} ${runsToText(item.runs)}`);
        }
        break;
      case "table":
        lines.push(`[표 ${b.rows}행 × ${b.cols}열]`);
        for (const row of b.cells) {
          lines.push("| " + row.join(" | ") + " |");
        }
        break;
      case "image":
        lines.push(`[이미지${b.alt ? `: ${b.alt}` : ""}]`);
        break;
      case "separator":
        lines.push(b.kind === "rule" ? "---" : `[${b.kind} break]`);
        break;
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function runsToText(runs: TextRun[]): string {
  return runs.map((r) => r.text).join("");
}
