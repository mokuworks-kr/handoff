/**
 * pptx 파서 — Microsoft PowerPoint(.pptx) → NormalizedManuscript.
 *
 * 전략: jszip으로 zip 풀고, fast-xml-parser로 ppt/slides/slideN.xml을 파싱.
 * 슬라이드별로 도형을 순회하며 텍스트/표를 추출.
 *
 * ─────────────────────────────────────────────────────────────
 * pptx의 본질
 * ─────────────────────────────────────────────────────────────
 *
 * docx와 결정적으로 다름:
 *   - docx = "흐르는 본문". 단락이 순서대로 이어짐.
 *   - pptx = "슬라이드 = 캔버스". 텍스트 박스가 좌표로 배치됨.
 *
 * 그래서 슬라이드 1장 = "여러 텍스트 박스의 집합". 같은 슬라이드 안에
 * 제목 박스 + 본문 박스 + 캡션 박스 + 표 + 이미지가 공존할 수 있다.
 *
 * 우리는 슬라이드 안의 도형을 XML 등장 순서대로 평탄화한다. PowerPoint도
 * 보통 도형을 위→아래 순서로 추가하므로 시각적 순서와 거의 일치한다.
 * 좌표 기반 정렬은 1차에서 비용 대비 효과 낮음.
 *
 * ─────────────────────────────────────────────────────────────
 * pptx OOXML 핵심 태그 (이 파서가 이해하는 것)
 * ─────────────────────────────────────────────────────────────
 *
 *   p:sld          — 슬라이드 1장
 *   p:spTree       — 슬라이드 안 도형들의 트리
 *   p:sp           — 도형 (텍스트 박스 포함)
 *   p:txBody       — 텍스트 박스 본문
 *   p:graphicFrame — 표/차트가 들어가는 프레임
 *   a:tbl          — 표
 *   a:tblGrid/a:gridCol — 표의 열 정의
 *   a:tr           — 행
 *   a:tc           — 셀
 *   p:pic          — 이미지
 *   a:p            — 단락
 *   a:r            — 텍스트 run (스타일 적용 범위)
 *   a:rPr          — run 속성 (b="1" → bold, sz="1800" → 18pt, i="1" → italic, u="sng" → underline)
 *   a:t            — 실제 텍스트
 *   a:pPr          — 단락 속성 (lvl="1" → 들여쓰기 1단계, buNone → 불릿 없음)
 *
 * ─────────────────────────────────────────────────────────────
 * 1차 정책 (M3a-1)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) 슬라이드 경계 = SeparatorBlock("page"). 분류기가 슬라이드 단위로 섹션 잡기.
 *
 * 2) 텍스트 박스는 paragraph로 출력하되, 폰트 크기가 명시적으로 큰 박스
 *    (≥ 24pt) 의 첫 단락은 HeadingBlock 으로 승격.
 *    docx와 달리 pptx는 폰트 크기를 직접 알 수 있어 휴리스틱이 단순하고 정확함.
 *
 * 3) 표는 TableBlock 으로 직접 매핑. 셀 안의 단락들은 줄바꿈으로 합쳐 단순 문자열.
 *
 * 4) 불릿 리스트는 a:pPr 의 lvl 속성 + buNone 부재로 감지. ListBlock 으로 묶음.
 *
 * 5) 이미지는 p:pic 발견 시 ImageBlock placeholder.
 *
 * 6) 발표자 노트(notesSlide)는 1차 무시 — 분류기에 노이즈.
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  blockId,
  type Block,
  type ListItem,
  type ManuscriptWarning,
  type NormalizedManuscript,
  type TextRun,
} from "./normalized";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type PptxParseInput = {
  buffer: Buffer | ArrayBuffer;
  filename: string;
};

export async function parsePptx(input: PptxParseInput): Promise<NormalizedManuscript> {
  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer);

  const warnings: ManuscriptWarning[] = [];
  const zip = await JSZip.loadAsync(buffer);

  // 슬라이드 파일 목록 — ppt/slides/slide1.xml, slide2.xml, ...
  // presentation.xml 의 sldIdLst 순서를 따라야 정확하지만, 1차에서는
  // 파일 이름 숫자 정렬로 충분 (PowerPoint가 기본적으로 순서대로 만듦).
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const aNum = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
      const bNum = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
      return aNum - bNum;
    });

  if (slideFiles.length === 0) {
    throw new Error("pptx 안에 슬라이드를 찾지 못했습니다. 손상된 파일일 수 있습니다.");
  }

  // 메타데이터 (docProps/core.xml)
  const meta = await readDocProps(zip);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // 기본 네임스페이스 prefix(p:, a:, r:)는 그대로 보존 (태그 이름에 포함)
    // 예: "<p:sp>" → 키 "p:sp"
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    // 단일 자식이면 배열이 아니라 객체로 들어오는데, 우리는 항상 배열로 다루고 싶음
    isArray: (name) => {
      // 여러 번 등장할 수 있는 태그를 항상 배열로
      return [
        "p:sp",
        "p:graphicFrame",
        "p:pic",
        "p:grpSp",
        "a:p",
        "a:r",
        "a:tr",
        "a:tc",
        "a:gridCol",
      ].includes(name);
    },
  });

  const blocks: Block[] = [];
  let counter = 0;
  const nextId = () => blockId(counter++);

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.file(slideFiles[i])!.async("string");
    const slideNumber = i + 1;
    try {
      const parsed = parser.parse(slideXml);
      const slideBlocks = slideToBlocks(parsed, nextId, slideNumber);
      blocks.push(...slideBlocks);
    } catch (e) {
      warnings.push({
        message: `슬라이드 ${slideNumber} 파싱 실패: ${e instanceof Error ? e.message : "unknown"}`,
        severity: "warn",
      });
    }
    // 마지막 슬라이드 뒤에는 separator 안 박음
    if (i < slideFiles.length - 1) {
      blocks.push({ id: nextId(), type: "separator", kind: "page" });
    }
  }

  return {
    schemaVersion: 1,
    source: {
      format: "pptx",
      filename: input.filename,
      byteSize: buffer.length,
      pageCount: slideFiles.length,
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.author ? { author: meta.author } : {}),
    },
    blocks,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// docProps 메타데이터
// ─────────────────────────────────────────────────────────────

async function readDocProps(zip: JSZip): Promise<{ title?: string; author?: string }> {
  const file = zip.file("docProps/core.xml");
  if (!file) return {};
  try {
    const xml = await file.async("string");
    // 단순 정규식 추출 — core.xml은 작고 구조 단순
    const title = xml.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1];
    const author = xml.match(/<dc:creator>([^<]*)<\/dc:creator>/)?.[1];
    return {
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    };
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 슬라이드 1장 → Block[]
// ─────────────────────────────────────────────────────────────

/**
 * 슬라이드 XML 파싱 결과를 받아 Block 배열로 변환.
 *
 * 슬라이드 트리 모양:
 *   p:sld
 *     p:cSld
 *       p:spTree
 *         p:sp[]            (텍스트 박스 등 도형)
 *         p:graphicFrame[]  (표/차트)
 *         p:pic[]           (이미지)
 *         p:grpSp[]         (그룹 — 안에 또 sp/graphicFrame 등이 있을 수 있음)
 */
function slideToBlocks(
  parsed: any,
  nextId: () => string,
  slideNumber: number,
): Block[] {
  const out: Block[] = [];
  const spTree = parsed?.["p:sld"]?.["p:cSld"]?.["p:spTree"];
  if (!spTree) return out;

  // 1단계: 슬라이드 안 모든 sp의 헤딩 신호를 수집해 "이 슬라이드에서 H가 될 박스 id" 결정.
  // 정책: 슬라이드 1장에 H는 최대 1개.
  //   (a) placeholder type="title" 또는 "ctrTitle" 박스가 있으면 그게 H
  //   (b) 없으면 slide 내 박스들 중 첫 단락 폰트 크기가 가장 크고 ≥ 24pt 인 박스가 H
  //   (c) 그래도 없으면 H 없음 (분류기 위임)
  const headingShapeIndex = pickHeadingShapeIndex(spTree);

  walkSpTree(spTree, out, nextId, slideNumber, { headingShapeIndex, currentSpIndex: { value: 0 } });
  return out;
}

/**
 * 슬라이드 내 sp 배열 인덱스 중 어느 것을 heading으로 볼지.
 * -1 이면 heading 없음.
 *
 * 결정 순서:
 *   (a) placeholder type="title" / "ctrTitle" — pptx의 명시적 제목 표시 (가장 강한 신호)
 *   (b) 폰트 크기 sz가 ≥ 24pt (2400) 이고 짧고 종결부호 없음 — sz가 sp에 직접 박혀있을 때
 *   (c) (b) 가 못 잡으면 (sz가 없거나, 있어도 모두 24pt 미만) — 첫 sp의 첫 단락이
 *       짧고(≤60자) 종결부호 없으면 H 후보로
 *   (d) 그래도 없으면 H 없음 (분류기 위임)
 *
 * (c) fallback이 필요한 이유: 잘 디자인된 pptx는 텍스트 박스에 sz를 직접 박지 않고
 * 슬라이드 마스터/레이아웃에서 상속받는다. 그리고 본문이 작은 슬라이드(연혁 등)에서는
 * sz가 있어도 24pt 미만일 수 있다. 마스터/레이아웃 inherit chain 추적은 비용이 크므로
 * (c) 휴리스틱으로 대체.
 */
function pickHeadingShapeIndex(spTree: any): number {
  const sps: any[] = spTree["p:sp"] ?? [];
  if (sps.length === 0) return -1;

  // (a) placeholder type="title" / "ctrTitle" 우선
  for (let i = 0; i < sps.length; i++) {
    const ph = sps[i]?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
    if (ph) {
      const phType = ph["@_type"];
      if (phType === "title" || phType === "ctrTitle") {
        return i;
      }
    }
  }

  // (b) 가장 큰 폰트 크기 (첫 단락 기준) 가진 박스, ≥ 24pt
  let bestIdx = -1;
  let bestSz = 0;
  for (let i = 0; i < sps.length; i++) {
    const sz = firstParagraphMaxFontSize(sps[i]);
    if (sz > bestSz) {
      bestSz = sz;
      bestIdx = i;
    }
  }
  if (bestSz >= 2400 && bestIdx >= 0) {
    const firstText = firstParagraphPlainText(sps[bestIdx]);
    if (firstText.trim().length <= 60 && !/[.!?。!?]\s*$/.test(firstText.trim())) {
      return bestIdx;
    }
  }

  // (c) (b) 가 못 잡았을 때 fallback 휴리스틱
  // sz 정보가 없거나(테마 상속 케이스) 모두 24pt 미만(본문이 작은 슬라이드)일 때
  // 첫 sp의 첫 단락이 짧고 종결부호 없으면 H 후보
  for (let i = 0; i < sps.length; i++) {
    const text = firstParagraphPlainText(sps[i]).trim();
    if (text.length === 0) continue;
    if (text.length <= 60 && !/[.!?。!?]\s*$/.test(text)) {
      return i;
    }
    // 첫 텍스트가 있는 박스가 H 조건을 못 채우면 그 슬라이드는 H 없음.
    // (다른 박스를 더 보지 않음 — 보통 슬라이드 제목은 첫 박스에 있고,
    // 거기서 못 잡으면 다른 박스에서 잡는 건 false positive 위험이 더 큼)
    return -1;
  }

  return -1;
}

/** 박스의 첫 비어있지 않은 단락에서 가장 큰 a:rPr/@sz 값 (pptx의 sz는 1/100 pt) */
function firstParagraphMaxFontSize(sp: any): number {
  const txBody = sp["p:txBody"];
  if (!txBody) return 0;
  const paragraphs: any[] = txBody["a:p"] ?? [];
  for (const p of paragraphs) {
    const runs: any[] = p["a:r"] ?? [];
    let maxSz = 0;
    let hasText = false;
    for (const r of runs) {
      const t = extractRunText(r);
      if (t.length === 0) continue;
      hasText = true;
      const sz = r["a:rPr"]?.["@_sz"];
      if (sz) {
        const n = parseInt(sz, 10);
        if (n > maxSz) maxSz = n;
      }
    }
    if (hasText) return maxSz;
  }
  return 0;
}

function firstParagraphPlainText(sp: any): string {
  const txBody = sp["p:txBody"];
  if (!txBody) return "";
  const paragraphs: any[] = txBody["a:p"] ?? [];
  for (const p of paragraphs) {
    const runs: any[] = p["a:r"] ?? [];
    let text = "";
    for (const r of runs) {
      text += extractRunText(r);
    }
    if (text.trim().length > 0) return text;
  }
  return "";
}

function extractRunText(r: any): string {
  const tValue = r["a:t"];
  if (typeof tValue === "string") return tValue;
  if (tValue && typeof tValue === "object" && "#text" in tValue) {
    return String(tValue["#text"]);
  }
  return "";
}

/**
 * spTree 또는 grpSp(그룹) 안의 자식들을 순회.
 * 같은 부모 안의 여러 종류 자식(sp/graphicFrame/pic/grpSp)을 모두 찾아 처리.
 *
 * 주의: fast-xml-parser는 자식 태그를 객체 키로 평탄화한다 — XML 순서가 사라짐.
 * pptx의 spTree는 각 종류가 따로 모여있는 게 아니라 임의로 섞일 수 있는데,
 * 1차에서는 이 한계를 받아들이고 "도형 → 표 → 이미지" 순으로 처리한다.
 *
 * 시각적 순서가 깨지는 케이스 예: 슬라이드에 [텍스트A, 표, 텍스트B] 가 있으면
 * 우리는 [텍스트A, 텍스트B, 표] 로 출력함. 분류기가 이 정도 어긋남은 흡수.
 *
 * 100% 시각 순서 정렬이 필요해지면 좌표(p:spPr/a:xfrm/a:off)로 정렬 추가.
 */
type WalkContext = {
  /** 슬라이드 안에서 heading으로 승격할 sp의 인덱스 (top-level만). -1 = 없음 */
  headingShapeIndex: number;
  /** 현재 처리 중인 sp의 top-level 인덱스 (mutable) */
  currentSpIndex: { value: number };
};

function walkSpTree(
  node: any,
  out: Block[],
  nextId: () => string,
  slideNumber: number,
  ctx: WalkContext,
): void {
  // p:sp — 텍스트 박스
  const sps: any[] = node["p:sp"] ?? [];
  for (const sp of sps) {
    const isHeadingShape = ctx.currentSpIndex.value === ctx.headingShapeIndex;
    const blocks = spToBlocks(sp, nextId, slideNumber, isHeadingShape);
    out.push(...blocks);
    ctx.currentSpIndex.value++;
  }

  // p:graphicFrame — 표 또는 차트
  const frames: any[] = node["p:graphicFrame"] ?? [];
  for (const frame of frames) {
    const block = graphicFrameToBlock(frame, nextId, slideNumber);
    if (block) out.push(block);
  }

  // p:pic — 이미지
  const pics: any[] = node["p:pic"] ?? [];
  for (const pic of pics) {
    out.push(picToBlock(pic, nextId, slideNumber));
  }

  // p:grpSp — 그룹 (재귀). 그룹 안의 sp는 currentSpIndex 카운팅에 안 넣음
  // (heading 후보는 top-level sp만)
  const groups: any[] = node["p:grpSp"] ?? [];
  for (const group of groups) {
    walkSpTree(group, out, nextId, slideNumber, ctx);
  }
}

// ─────────────────────────────────────────────────────────────
// p:sp → 텍스트 블록(들)
// ─────────────────────────────────────────────────────────────

/**
 * 텍스트 박스 1개 → 블록 N개.
 *
 * isHeadingShape == true 이고, 박스 첫 단락이 heading 후보면 H로 승격.
 * 그 외는 paragraph 또는 list.
 *
 * 연속된 리스트 항목은 ListBlock 1개로 묶음 (서로 다른 박스 안의 항목은 합치지 않음).
 */
function spToBlocks(
  sp: any,
  nextId: () => string,
  slideNumber: number,
  isHeadingShape: boolean,
): Block[] {
  const txBody = sp["p:txBody"];
  if (!txBody) return [];

  const paragraphs: any[] = txBody["a:p"] ?? [];
  if (paragraphs.length === 0) return [];

  const out: Block[] = [];
  let pendingListItems: ListItem[] | null = null;
  let pendingListOrdered = false;
  let isFirstNonEmptyParagraph = true;

  for (const p of paragraphs) {
    const runs = collectRuns(p);
    const text = runs.map((r) => r.text).join("").trim();
    if (text.length === 0) {
      // 빈 단락은 박스 첫 단락 판정에 영향 X
      continue;
    }

    const pPr = p["a:pPr"];
    const indentLevel = pPr?.["@_lvl"] ? parseInt(pPr["@_lvl"], 10) : 0;
    const hasNoBullet = pPr?.["a:buNone"] !== undefined;
    const hasOrderedNum = pPr?.["a:buAutoNum"] !== undefined;
    const hasBulletChar = pPr?.["a:buChar"] !== undefined;
    const isListLikely =
      !hasNoBullet && (indentLevel > 0 || hasOrderedNum || hasBulletChar);

    if (isListLikely) {
      if (pendingListItems === null) {
        pendingListItems = [];
        pendingListOrdered = hasOrderedNum;
      }
      pendingListItems.push({ level: indentLevel, runs });
      isFirstNonEmptyParagraph = false;
      continue;
    }

    // 리스트가 끊기면 누적된 ListBlock 출력
    if (pendingListItems !== null) {
      out.push({
        id: nextId(),
        type: "list",
        ordered: pendingListOrdered,
        items: pendingListItems,
      });
      pendingListItems = null;
    }

    // heading 판정 — 이 박스가 슬라이드의 heading 박스로 선택됐고, 박스의 첫 단락
    if (isHeadingShape && isFirstNonEmptyParagraph) {
      out.push({
        id: nextId(),
        type: "heading",
        level: 1,
        runs: runs.map((r) => ({ text: r.text })), // bold 마크 제거 (H 자체가 강조)
        sourceLocation: `pptx:slide${slideNumber}`,
      });
    } else {
      out.push({
        id: nextId(),
        type: "paragraph",
        runs,
        sourceLocation: `pptx:slide${slideNumber}`,
      });
    }
    isFirstNonEmptyParagraph = false;
  }

  // 박스 끝에서 누적된 리스트가 있으면 마저 출력
  if (pendingListItems !== null) {
    out.push({
      id: nextId(),
      type: "list",
      ordered: pendingListOrdered,
      items: pendingListItems,
    });
  }

  return out;
}

/**
 * 단락 안의 run들을 순회해 TextRun[] 만들기.
 *
 * pptx의 a:r 구조:
 *   <a:r>
 *     <a:rPr b="1" sz="1800" i="1" u="sng">  ← 속성
 *     <a:t>실제 텍스트</a:t>
 *   </a:r>
 */
function collectRuns(p: any): TextRun[] {
  const runs: any[] = p["a:r"] ?? [];
  const out: TextRun[] = [];

  for (const r of runs) {
    const rPr = r["a:rPr"];
    // a:t 가 한 글자라도 있으면 문자열, 없으면 빈 객체. 정규화.
    const tValue = r["a:t"];
    let text: string;
    if (typeof tValue === "string") {
      text = tValue;
    } else if (tValue && typeof tValue === "object" && "#text" in tValue) {
      text = String(tValue["#text"]);
    } else {
      text = "";
    }
    if (text.length === 0) continue;

    const bold = rPr?.["@_b"] === "1";
    const italic = rPr?.["@_i"] === "1";
    // u="sng" / "dbl" / "heavy" 등이 있으면 underline. "none"이면 밑줄 없음.
    const u = rPr?.["@_u"];
    const underline = u !== undefined && u !== "none";

    out.push({
      text,
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(underline ? { underline: true } : {}),
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// p:graphicFrame → 표 (또는 무시)
// ─────────────────────────────────────────────────────────────

/**
 * graphicFrame 은 표 / 차트 / 다이어그램 등을 담는 컨테이너.
 * 우리는 표(a:tbl)만 처리하고 나머지는 1차 무시.
 */
function graphicFrameToBlock(
  frame: any,
  nextId: () => string,
  slideNumber: number,
): Block | null {
  const graphicData = frame["a:graphic"]?.["a:graphicData"];
  if (!graphicData) return null;
  const tbl = graphicData["a:tbl"];
  if (!tbl) {
    // 차트 등은 1차 무시. 분류기가 빈 자리를 알아채지 않아도 큰 문제 없음.
    return null;
  }

  // 열 정보
  const gridCols: any[] = tbl["a:tblGrid"]?.["a:gridCol"] ?? [];
  const cols = gridCols.length;

  // 행 — a:tr 은 isArray 설정으로 항상 배열
  const trs: any[] = tbl["a:tr"] ?? [];
  const rows = trs.length;

  if (rows === 0 || cols === 0) return null;

  const cells: string[][] = [];
  let headerRows = 0;
  let firstRowAllBold = trs.length > 0;

  for (let r = 0; r < trs.length; r++) {
    const tcs: any[] = trs[r]["a:tc"] ?? [];
    const rowCells: string[] = [];
    for (const tc of tcs) {
      // gridSpan 등 셀 병합은 1차 무시 — 단순 평탄 출력
      const cellText = cellToText(tc);
      rowCells.push(cellText);
    }
    // 길이 정규화
    while (rowCells.length < cols) rowCells.push("");
    cells.push(rowCells);

    // 첫 행 헤더 추정 — docx와 같은 패턴: 모든 셀이 굵은 글씨이면 헤더
    if (r === 0) {
      for (const tc of tcs) {
        if (!cellAllBold(tc)) {
          firstRowAllBold = false;
          break;
        }
      }
    }
  }

  if (firstRowAllBold) headerRows = 1;

  return {
    id: nextId(),
    type: "table",
    rows,
    cols,
    cells,
    ...(headerRows > 0 ? { headerRows } : {}),
    sourceLocation: `pptx:slide${slideNumber}`,
  };
}

/**
 * 셀 안의 모든 단락을 줄바꿈으로 합쳐 단순 문자열로.
 * (NormalizedManuscript 결정 3 — 셀 = 단순 문자열)
 */
function cellToText(tc: any): string {
  const txBody = tc["a:txBody"];
  if (!txBody) return "";
  const paragraphs: any[] = txBody["a:p"] ?? [];
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = collectRuns(p);
    const text = runs.map((r) => r.text).join("");
    if (text.length > 0) lines.push(text);
  }
  return lines.join("\n");
}

/**
 * 셀의 모든 비공백 텍스트가 bold인지.
 */
function cellAllBold(tc: any): boolean {
  const txBody = tc["a:txBody"];
  if (!txBody) return false;
  const paragraphs: any[] = txBody["a:p"] ?? [];
  let sawText = false;
  for (const p of paragraphs) {
    const runs = collectRuns(p);
    for (const run of runs) {
      if (run.text.trim().length === 0) continue;
      sawText = true;
      if (!run.bold) return false;
    }
  }
  return sawText;
}

// ─────────────────────────────────────────────────────────────
// p:pic → 이미지 placeholder
// ─────────────────────────────────────────────────────────────

function picToBlock(pic: any, nextId: () => string, slideNumber: number): Block {
  // 이미지의 alt — p:nvPicPr/p:cNvPr/@_descr 또는 @_title
  const cNvPr = pic["p:nvPicPr"]?.["p:cNvPr"];
  const alt =
    (typeof cNvPr?.["@_descr"] === "string" && cNvPr["@_descr"]) ||
    (typeof cNvPr?.["@_title"] === "string" && cNvPr["@_title"]) ||
    "";

  return {
    id: nextId(),
    type: "image",
    alt,
    originalSrc: "(embedded)",
    sourceLocation: `pptx:slide${slideNumber}`,
  };
}
