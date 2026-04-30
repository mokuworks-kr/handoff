/**
 * hwpx 파서 — 한컴오피스 한글(.hwpx) → NormalizedManuscript.
 *
 * 전략: jszip으로 zip 풀고, fast-xml-parser로 Contents/sectionN.xml 파싱.
 * pptx와 동일한 패턴 (둘 다 zip + XML).
 *
 * ─────────────────────────────────────────────────────────────
 * hwpx의 본질
 * ─────────────────────────────────────────────────────────────
 *
 * - hwpx = 한컴오피스 2010+ 표준 형식. OOXML 계열 (zip + XML).
 *   국내 정부/공공/일부 기업 표준이라 한국 비즈니스 시나리오에서 빈번히 등장.
 * - 명세: KS X 6101 (OWPML — Open Word Processor Markup Language).
 *   공식 PDF: https://www.hancom.com/etc/hwpDownload.do
 * - hwpx는 docx와 본질적으로 비슷한 구조: "흐르는 본문". 페이지 개념 약함.
 *   섹션(section)이 큰 단위. 보통 문서 1개 = section 1개지만, 긴 문서는 여러 섹션.
 *
 * **`.hwp` (옛날 바이너리)는 1차 미지원** — 핸드오프 §5 결정.
 * `.hwp` 받으면 사용자에게 한컴오피스에서 "다른 이름으로 저장 → hwpx" 안내.
 *
 * ─────────────────────────────────────────────────────────────
 * OWPML 핵심 태그 (이 파서가 이해하는 것)
 * ─────────────────────────────────────────────────────────────
 *
 *   hs:sec         — 섹션 (본문 컨테이너)
 *   hp:p           — 단락
 *     paraPrIDRef    — 단락 스타일 ID (header.xml의 paraPr 참조)
 *     styleIDRef     — 단락에 적용된 스타일 ID
 *     pageBreak      — "1"이면 이 단락 직전에 페이지 구분
 *   hp:run         — run (스타일 적용 범위)
 *     charPrIDRef    — 문자 스타일 ID (header.xml의 charPr 참조)
 *   hp:t           — 실제 텍스트
 *   hp:linesegarray — 줄 분할 정보. 시각용. 무시.
 *   hp:tbl         — 표
 *     hp:tr          — 행
 *     hp:tc          — 셀
 *       hp:subList     — 셀 내용 (안에 또 hp:p들)
 *   hp:pic         — 이미지 (단독)
 *   hp:ctrl        — 컨트롤 (각주, 머리말 등 — 1차 무시)
 *
 * ─────────────────────────────────────────────────────────────
 * 1차 정책 (M3a-1)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) section 경계 = SeparatorBlock("section"). 보통 hwpx 1개 = section 1개라 separator
 *    안 들어가는 게 일반적. pageBreak="1" 단락은 SeparatorBlock("page")로 변환.
 *
 * 2) 빈 단락(`<hp:t/>` 또는 비어있는 `<hp:t></hp:t>`)은 버림 — hwpx의 빈 줄 표현이라
 *    분류기에 노이즈.
 *
 * 3) 인라인 스타일(bold/italic/underline) — header.xml의 charPr을 미리 파싱해 매핑 표 만들고,
 *    각 run의 charPrIDRef를 그 표로 조회. **시드에서는 bold가 없어 1차 검증 안 됨** —
 *    사용자 hwpx로 검증할 때 패턴 보고 보강.
 *
 * 4) 표 → TableBlock. 셀 안의 단락들을 줄바꿈으로 합쳐 단순 문자열.
 *
 * 5) heading 추정 — 1차에서는 안 함.
 *    hwpx는 paraPrIDRef로 단락 스타일을 참조하므로 "스타일 이름이 'Heading 1'인지" 봐야
 *    정확하지만 header.xml 파싱 비용이 있음. 사용자가 한컴에서 "제목 1" 스타일을 명시적으로
 *    쓴 hwpx로 검증한 후 추가. 1차에서는 모든 단락 P, 분류기 위임.
 *
 * 6) 이미지/컨트롤 1차 무시.
 *    docx와 같은 정책 — placeholder만 잡고 실제 추출은 별도 흐름.
 *    OWPML의 이미지/컨트롤 태그가 다양해 1차에서 안전하게 무시. 누락된 영역은
 *    분류기가 인식 못해도 큰 문제 없음 (이미지만으로 구성된 hwpx는 거의 없음).
 */

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  blockId,
  type Block,
  type ManuscriptWarning,
  type NormalizedManuscript,
  type TextRun,
} from "./normalized";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type HwpxParseInput = {
  buffer: Buffer | ArrayBuffer;
  filename: string;
};

export async function parseHwpx(input: HwpxParseInput): Promise<NormalizedManuscript> {
  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer);

  const warnings: ManuscriptWarning[] = [];
  const zip = await JSZip.loadAsync(buffer);

  // 섹션 파일 목록 — Contents/section0.xml, section1.xml, ...
  const sectionFiles = Object.keys(zip.files)
    .filter((name) => /^Contents\/section\d+\.xml$/.test(name))
    .sort((a, b) => {
      const aNum = parseInt(a.match(/section(\d+)\.xml/)![1], 10);
      const bNum = parseInt(b.match(/section(\d+)\.xml/)![1], 10);
      return aNum - bNum;
    });

  if (sectionFiles.length === 0) {
    throw new Error("hwpx 안에 섹션을 찾지 못했습니다. 손상된 파일이거나 .hwp(바이너리)일 수 있습니다.");
  }

  // header.xml 파싱 — charPr 매핑 표(bold/italic/underline 등)
  const charPrMap = await readCharPrMap(zip).catch(() => new Map<string, CharStyle>());

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => {
      // 여러 번 등장할 수 있는 태그를 항상 배열로
      return ["hp:p", "hp:run", "hp:tbl", "hp:tr", "hp:tc", "hp:subList", "hp:pic", "hp:ctrl"].includes(name);
    },
  });

  const blocks: Block[] = [];
  let counter = 0;
  const nextId = () => blockId(counter++);

  for (let i = 0; i < sectionFiles.length; i++) {
    const sectionXml = await zip.file(sectionFiles[i])!.async("string");
    const sectionNumber = i + 1;
    try {
      const parsed = parser.parse(sectionXml);
      const sectionBlocks = sectionToBlocks(parsed, nextId, sectionNumber, charPrMap);
      blocks.push(...sectionBlocks);
    } catch (e) {
      warnings.push({
        message: `섹션 ${sectionNumber} 파싱 실패: ${e instanceof Error ? e.message : "unknown"}`,
        severity: "warn",
      });
    }
    // 마지막 섹션 뒤에는 separator 안 박음
    if (i < sectionFiles.length - 1) {
      blocks.push({ id: nextId(), type: "separator", kind: "section" });
    }
  }

  // 메타데이터 — META-INF/manifest.xml 또는 settings.xml에서 읽을 수 있지만
  // hwpx 메타데이터는 드물게 박힘. 1차에서는 파일명/크기/섹션 수만.
  return {
    schemaVersion: 1,
    source: {
      format: "hwpx",
      filename: input.filename,
      byteSize: buffer.length,
      pageCount: sectionFiles.length, // 섹션 수를 페이지로 표시 (정확히는 다르지만 유사)
    },
    blocks,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// header.xml — charPr 스타일 매핑
// ─────────────────────────────────────────────────────────────

type CharStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

/**
 * header.xml의 charPr 정의를 파싱해 ID → 스타일 매핑.
 *
 * OWPML의 charPr는 다음과 같이 자식 태그로 스타일 표시:
 *   <hh:charPr hh:id="1" ...>
 *     <hh:bold/>          ← 있으면 bold
 *     <hh:italic/>        ← 있으면 italic
 *     <hh:underline hh:type="SOLID" .../>  ← 있으면 underline
 *   </hh:charPr>
 *
 * 시드에는 bold/italic/underline이 없어 빈 매핑이 들어가지만, 사용자 hwpx에서는
 * 검증 가능. 패턴이 다르면 사용자 검증 단계에서 코드 보강.
 */
async function readCharPrMap(zip: JSZip): Promise<Map<string, CharStyle>> {
  const file = zip.file("Contents/header.xml");
  if (!file) return new Map();

  const xml = await file.async("string");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: false,
    isArray: (name) => name === "hh:charPr",
  });

  const result = new Map<string, CharStyle>();
  try {
    const parsed = parser.parse(xml);
    const charPrs: any[] = parsed?.["hh:head"]?.["hh:refList"]?.["hh:charProperties"]?.["hh:charPr"] ?? [];
    for (const cp of charPrs) {
      const id = cp["@_hh:id"];
      if (typeof id !== "string") continue;
      result.set(id, {
        // OWPML: <hh:bold/> 같은 자식 태그가 있으면 그 키가 객체에 존재
        bold: cp["hh:bold"] !== undefined,
        italic: cp["hh:italic"] !== undefined,
        underline: cp["hh:underline"] !== undefined,
      });
    }
  } catch {
    // header.xml 파싱 실패는 치명적이지 않음. 빈 매핑으로 진행.
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// section → blocks
// ─────────────────────────────────────────────────────────────

function sectionToBlocks(
  parsed: any,
  nextId: () => string,
  sectionNumber: number,
  charPrMap: Map<string, CharStyle>,
): Block[] {
  const out: Block[] = [];
  const sec = parsed?.["hs:sec"];
  if (!sec) return out;

  // OWPML 구조 (실측):
  //   hs:sec
  //     hp:p              ← 단락
  //       hp:run          ← run (스타일 적용 범위)
  //         hp:t            ← 텍스트
  //         hp:tbl          ← 표 (인라인 임베드 객체!)
  //         hp:pic          ← 이미지 (인라인 임베드)
  //         hp:ctrl         ← 컨트롤 (각주, 페이지번호 등)
  //       hp:linesegarray ← 줄 분할 정보 (시각용, 무시)
  //
  // 즉 표/이미지는 sec의 직접 자식이 아니라 hp:p > hp:run 안에 들어있다.
  // 한 단락에 여러 run이 있고, run 하나에 텍스트와 표가 섞일 수도 있다.
  // 단락 순서를 보존하기 위해 단락 단위로 처리하면서 안의 run을 차례로 본다.

  const paragraphs: any[] = sec["hp:p"] ?? [];

  for (const p of paragraphs) {
    // pageBreak="1" 단락은 페이지 분리 신호
    if (p["@_hp:pageBreak"] === "1") {
      out.push({ id: nextId(), type: "separator", kind: "page" });
    }

    // 한 단락 안에서 run을 순서대로 처리:
    //   - hp:tbl 발견 → TableBlock 출력
    //   - hp:pic 발견 → ImageBlock placeholder 출력
    //   - hp:t 텍스트 → 누적해서 마지막에 ParagraphBlock 출력
    //
    // 이렇게 하면 한 단락 안에 [텍스트] [표] [텍스트] 순서가 있어도 보존됨.
    const runs: any[] = p["hp:run"] ?? [];
    let pendingTextRuns: TextRun[] = [];

    const flushPending = () => {
      const text = pendingTextRuns.map((r) => r.text).join("").trim();
      if (text.length === 0) {
        pendingTextRuns = [];
        return;
      }
      out.push({
        id: nextId(),
        type: "paragraph",
        runs: pendingTextRuns,
        sourceLocation: `hwpx:s${sectionNumber}`,
      });
      pendingTextRuns = [];
    };

    for (const r of runs) {
      // 텍스트 추출
      const t = extractRunText(r);
      if (t.length > 0) {
        const charPrId = r["@_hp:charPrIDRef"];
        const style = (typeof charPrId === "string" ? charPrMap.get(charPrId) : undefined) ?? {
          bold: false,
          italic: false,
          underline: false,
        };
        pendingTextRuns.push({
          text: t,
          ...(style.bold ? { bold: true } : {}),
          ...(style.italic ? { italic: true } : {}),
          ...(style.underline ? { underline: true } : {}),
        });
      }

      // 표 — run에 임베드되어 있을 수 있음. 한 run에 여러 표가 있을 가능성도 대비.
      const tbls: any[] = r["hp:tbl"] ?? [];
      for (const tbl of tbls) {
        // 표 직전에 누적된 텍스트가 있으면 먼저 출력
        flushPending();
        const block = tableToBlock(tbl, nextId, sectionNumber, charPrMap);
        if (block) out.push(block);
      }

      // 이미지 — 마찬가지로 인라인 임베드
      const pics: any[] = r["hp:pic"] ?? [];
      for (const _pic of pics) {
        flushPending();
        out.push({
          id: nextId(),
          type: "image",
          alt: "",
          originalSrc: "(embedded)",
          sourceLocation: `hwpx:s${sectionNumber}`,
        });
      }
    }

    // 단락 끝 — 남은 텍스트 출력
    flushPending();
  }

  return out;
}

/**
 * run 객체에서 hp:t 텍스트만 추출.
 * (이전엔 collectRuns 안에 있었지만, 이제 텍스트와 임베드 객체를 분리 처리해야 해서 별도 함수)
 */
function extractRunText(r: any): string {
  const tValue = r["hp:t"];
  if (typeof tValue === "string") return tValue;
  if (tValue && typeof tValue === "object" && "#text" in tValue) {
    return String(tValue["#text"]);
  }
  return "";
}

// ─────────────────────────────────────────────────────────────
// table
// ─────────────────────────────────────────────────────────────

/**
 * hp:tbl → TableBlock.
 *
 * OWPML 표 구조:
 *   <hp:tbl rowCnt="N" colCnt="M">
 *     <hp:tr>
 *       <hp:tc>
 *         <hp:subList>
 *           <hp:p> ... </hp:p>     ← 셀 내용
 *         </hp:subList>
 *       </hp:tc>
 *     </hp:tr>
 *   </hp:tbl>
 *
 * 셀 병합(colSpan/rowSpan)은 1차 미지원 — 평탄화.
 * 시드에 표가 없어 명세 기반으로 작성. 사용자 hwpx로 검증 시 패턴 다르면 보강.
 */
function tableToBlock(
  tbl: any,
  nextId: () => string,
  sectionNumber: number,
  charPrMap: Map<string, CharStyle>,
): Block | null {
  const trs: any[] = tbl["hp:tr"] ?? [];
  if (trs.length === 0) return null;

  // rowCnt/colCnt 속성에서 행/열 수 (있으면)
  const declaredRows = tbl["@_hp:rowCnt"] ? parseInt(tbl["@_hp:rowCnt"], 10) : trs.length;
  let cols = tbl["@_hp:colCnt"] ? parseInt(tbl["@_hp:colCnt"], 10) : 0;

  const cells: string[][] = [];
  for (const tr of trs) {
    const tcs: any[] = tr["hp:tc"] ?? [];
    const rowCells: string[] = [];
    for (const tc of tcs) {
      rowCells.push(cellToText(tc, charPrMap));
    }
    if (rowCells.length > cols) cols = rowCells.length;
    cells.push(rowCells);
  }

  // 길이 정규화
  for (const row of cells) {
    while (row.length < cols) row.push("");
  }

  return {
    id: nextId(),
    type: "table",
    rows: declaredRows,
    cols,
    cells,
    sourceLocation: `hwpx:s${sectionNumber}`,
  };
}

/**
 * 셀 안의 단락들을 줄바꿈으로 합쳐 단순 문자열.
 * (NormalizedManuscript 결정 3 — 셀 = 단순 문자열)
 *
 * 셀 안의 인라인 스타일은 1차에서 버림 (회사소개서/IR 표는 평문 절대다수).
 * 셀 안에 또 표가 중첩될 수 있지만 1차에서 무시 (재귀 평탄화 안 함).
 */
function cellToText(tc: any, _charPrMap: Map<string, CharStyle>): string {
  const subLists: any[] = tc["hp:subList"] ?? [];
  const lines: string[] = [];
  for (const subList of subLists) {
    const ps: any[] = subList["hp:p"] ?? [];
    for (const p of ps) {
      const runs: any[] = p["hp:run"] ?? [];
      let text = "";
      for (const r of runs) {
        text += extractRunText(r);
      }
      if (text.length > 0) lines.push(text);
    }
  }
  return lines.join("\n");
}
