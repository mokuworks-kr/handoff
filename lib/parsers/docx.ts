/**
 * docx 파서 — Microsoft Word(.docx) → NormalizedManuscript.
 *
 * 전략: mammoth로 docx → semantic HTML 변환한 뒤, cheerio로 HTML을 우리 블록으로.
 *
 * 왜 HTML 경유:
 *   - mammoth가 이미 docx의 구조(스타일/표/리스트/이미지)를 의미적 HTML로 매핑.
 *     우리가 docx XML을 직접 파싱하지 않아도 됨.
 *   - HTML은 다른 파서들(나중에 BR, MD 등)과도 공유 가능한 중간 표현.
 *
 * mammoth의 default 매핑이 충분 — Heading 1~6, p, ul/ol/li, table, img,
 * strong/em/u 등이 자동으로 잡힘. 본문 스타일을 별도 매핑할 필요 없음.
 *
 * ─────────────────────────────────────────────────────────────
 * 한계 (1차에서 의도적으로 빠진 것)
 * ─────────────────────────────────────────────────────────────
 *
 * - 이미지: <img>는 ImageBlock으로 잡되, src(보통 base64 data URI)는 보존하지
 *   않는다. 1차 정책 — 이미지 placeholder만. 실제 추출은 별도 흐름(M3 후반).
 * - 각주/미주: 본문에서 분리. 1차 무시. 회사소개서/IR에 거의 없음.
 * - 헤더/푸터: docx의 페이지 헤더/푸터는 mammoth가 본문에서 분리. 1차 무시.
 * - 텍스트 박스: docx의 floating text box는 mammoth가 인라인으로 흘려넣음.
 *   순서가 어긋날 수 있으나 회사소개서/IR 원고에서 거의 안 씀.
 * - 페이지 구분: docx의 page break는 mammoth가 무시. 1차에서는 단순 본문 흐름만.
 *   (필요 시 mammoth transform으로 잡을 수 있으나 분류기는 heading 신호로 충분)
 */

import * as mammoth from "mammoth";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import {
  blockId,
  type Block,
  type ListItem,
  type ManuscriptWarning,
  type NormalizedManuscript,
  type ParagraphBlock,
  type TextRun,
} from "./normalized";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type DocxParseInput = {
  /** 원본 파일 바이트 (Node Buffer 또는 ArrayBuffer) */
  buffer: Buffer | ArrayBuffer;
  /** 사용자가 업로드한 원본 파일명 */
  filename: string;
};

export async function parseDocx(input: DocxParseInput): Promise<NormalizedManuscript> {
  // mammoth는 Node Buffer를 받음. ArrayBuffer면 변환.
  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer);

  const warnings: ManuscriptWarning[] = [];

  // mammoth: docx → HTML
  // convertToHtml의 결과 messages는 변환 중 만난 이슈 (지원 안 되는 스타일 등).
  // 사용자에게 보여줄 만한 건 warning으로 옮김.
  const result = await mammoth.convertToHtml({ buffer });
  for (const m of result.messages) {
    // mammoth는 info/warning/error 셋. 그대로 매핑.
    const severity: ManuscriptWarning["severity"] =
      m.type === "error" ? "error" : m.type === "warning" ? "warn" : "info";
    warnings.push({ message: m.message, severity });
  }

  // HTML → blocks
  const blocks = htmlToBlocks(result.value, warnings);

  return {
    schemaVersion: 1,
    source: {
      format: "docx",
      filename: input.filename,
      byteSize: buffer.length,
    },
    blocks,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// HTML → blocks
// ─────────────────────────────────────────────────────────────

function htmlToBlocks(html: string, warnings: ManuscriptWarning[]): Block[] {
  // mammoth는 wrapping html/body 없이 본문만 줌. cheerio는 어쨌든 fragment로 파싱.
  const $ = cheerio.load(html, null, false);

  const blocks: Block[] = [];
  let counter = 0;
  const nextId = () => blockId(counter++);

  // 최상위 자식만 순회. mammoth 출력은 보통 평탄한 시퀀스
  // (h1, p, ul, table, img, ...) 라 깊이 들어갈 필요 없음.
  // 단 표 안의 셀, 리스트 안의 항목은 별도 함수로 들어감.
  $.root()
    .children()
    .each((_, el) => {
      const block = elementToBlock(el, $, nextId, warnings);
      if (block) {
        if (Array.isArray(block)) blocks.push(...block);
        else blocks.push(block);
      }
    });

  // 후처리: heading 추정 (Word "제목 1/2/3" 스타일을 안 쓰고
  // 굵은 글씨로 제목을 표현하는 케이스 대응)
  return inferHeadings(blocks);
}

// ─────────────────────────────────────────────────────────────
// heading 추정 후처리
// ─────────────────────────────────────────────────────────────

/**
 * Word 시맨틱 스타일을 안 쓴 docx에서 제목스러운 단락을 HeadingBlock으로 승격.
 *
 * 회사소개서/IR/카탈로그 작성자들이 Word의 "제목 1/제목 2" 대신 평범한 단락에
 * 굵게+큰 글씨를 직접 적용하는 경우가 매우 흔하다. 이걸 안 잡으면 분류기가
 * "여기서 새 섹션이 시작됨" 신호를 못 받는다.
 *
 * 추정 규칙 (모든 신호가 모여야 H로 승격):
 *   1) 단락의 모든 텍스트가 bold (공백/구두점 제외)
 *   2) 텍스트 길이 60자 이하
 *   3) 마침표·물음표·느낌표로 끝나지 않음 (제목은 보통 종결부호 없음)
 *   4) 앞뒤 컨텍스트에서 "고립" — 직전이 H/표/이미지/리스트거나 첫 블록,
 *      또는 직후가 H/표/이미지/리스트/일반 단락
 *
 * level 추정:
 *   첫 H는 1, 그 다음부터는 단순히 모두 2로 시작.
 *   완벽한 트리 추론은 1차에서 안 함 — 분류기가 어차피 sectionType을
 *   재구성하므로 평면 H1/H2면 충분.
 *
 * 보수적 운영:
 *   - 의심스러우면 P로 둠 (false positive보다 false negative가 안전).
 *   - 한 단락이라도 강한 본문 신호(긴 길이, 종결부호)가 있으면 H 후보 아님.
 */
function inferHeadings(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let firstHeadingPromoted = false;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "paragraph") {
      out.push(b);
      continue;
    }

    if (!isHeadingCandidate(b, blocks, i)) {
      out.push(b);
      continue;
    }

    // 승격
    const level: 1 | 2 = firstHeadingPromoted ? 2 : 1;
    firstHeadingPromoted = true;
    out.push({
      id: b.id,
      type: "heading",
      level,
      // bold 마크는 H 자체가 시각적 강조라 인라인 표기 제거
      runs: b.runs.map((r) => ({ text: r.text })),
    });
  }

  return out;
}

function isHeadingCandidate(p: ParagraphBlock, blocks: Block[], i: number): boolean {
  // 1) 모든 텍스트가 bold
  const text = p.runs.map((r) => r.text).join("");
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // 비공백 텍스트가 있는 run은 모두 bold여야 함
  const hasNonBoldNonWhitespace = p.runs.some(
    (r) => r.text.trim().length > 0 && !r.bold,
  );
  if (hasNonBoldNonWhitespace) return false;

  // 2) 길이 제한
  if (trimmed.length > 60) return false;

  // 3) 종결부호 없음
  if (/[.!?。!?]\s*$/.test(trimmed)) return false;

  // 4) 컨텍스트 — 앞뒤 중 하나라도 H/표/이미지/리스트/separator면 OK,
  //    또는 첫/마지막 블록이면 OK
  const prev = i > 0 ? blocks[i - 1] : null;
  const next = i < blocks.length - 1 ? blocks[i + 1] : null;

  const isStructuralBoundary = (b: Block | null) => {
    if (b === null) return true;
    return b.type !== "paragraph";
  };

  // 직전 또는 직후가 구조적 경계여야 함
  // (둘 다 일반 단락 사이에 끼인 굵은 짧은 단락은 본문 강조일 가능성이 큼)
  if (!isStructuralBoundary(prev) && !isStructuralBoundary(next)) {
    // 단 예외: 직후가 짧은 굵은 단락(연속 H 후보)이면 OK
    if (next && next.type === "paragraph" && isShortBoldParagraph(next)) {
      return true;
    }
    return false;
  }

  return true;
}

function isShortBoldParagraph(p: ParagraphBlock): boolean {
  const text = p.runs.map((r) => r.text).join("").trim();
  if (text.length === 0 || text.length > 60) return false;
  return !p.runs.some((r) => r.text.trim().length > 0 && !r.bold);
}

function elementToBlock(
  el: Element,
  $: cheerio.CheerioAPI,
  nextId: () => string,
  warnings: ManuscriptWarning[],
): Block | Block[] | null {
  const tag = el.tagName?.toLowerCase();
  if (!tag) return null;

  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(tag[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
      const runs = collectRuns(el, $);
      if (runs.length === 0) return null; // 빈 heading 스킵
      return { id: nextId(), type: "heading", level, runs };
    }

    case "p": {
      // 단락 안에 <img> 단독으로 들어있으면 ImageBlock으로 분리.
      // mammoth가 이미지를 <p><img/></p> 로 감싸는 경우가 있음.
      const onlyImage = isOnlyImage(el, $);
      if (onlyImage) {
        return imgToBlock(onlyImage, $, nextId);
      }
      const runs = collectRuns(el, $);
      // 빈 단락(공백뿐) 스킵 — 분류기에 노이즈
      if (runs.length === 0 || runsAllWhitespace(runs)) return null;
      return { id: nextId(), type: "paragraph", runs };
    }

    case "ul":
    case "ol":
      return listToBlock(el, $, tag === "ol", nextId);

    case "table":
      return tableToBlock(el, $, nextId, warnings);

    case "img":
      return imgToBlock(el, $, nextId);

    case "hr":
      return { id: nextId(), type: "separator", kind: "rule" };

    default:
      // 모르는 태그는 자식들로 한 단계 내려감.
      // (mammoth가 div 같은 wrapper를 만드는 케이스 대응)
      const childBlocks: Block[] = [];
      $(el)
        .children()
        .each((_, child) => {
          const b = elementToBlock(child, $, nextId, warnings);
          if (b) {
            if (Array.isArray(b)) childBlocks.push(...b);
            else childBlocks.push(b);
          }
        });
      return childBlocks.length > 0 ? childBlocks : null;
  }
}

// ─────────────────────────────────────────────────────────────
// 인라인 → TextRun[]
// ─────────────────────────────────────────────────────────────

/**
 * 한 element의 자식들을 순회하며 TextRun 배열 생성.
 *
 * 같은 스타일(bold/italic/underline)이 연속되면 합칠 수 있지만,
 * mammoth 출력에서는 보통 자연스럽게 합쳐져 있음. 1차에서는 합치지 않음 —
 * 디자인 단계에서 어차피 다시 평탄화함.
 */
function collectRuns(el: Element, $: cheerio.CheerioAPI): TextRun[] {
  const runs: TextRun[] = [];
  walkInline(el, $, { bold: false, italic: false, underline: false }, runs);
  // 빈 텍스트 run 제거
  return runs.filter((r) => r.text.length > 0);
}

type StyleState = { bold: boolean; italic: boolean; underline: boolean };

function walkInline(
  el: Element,
  $: cheerio.CheerioAPI,
  style: StyleState,
  out: TextRun[],
): void {
  for (const node of $(el).contents().toArray()) {
    if (node.type === "text") {
      const text = (node.data ?? "").replace(/\s+/g, " ");
      if (text.length === 0) continue;
      out.push({
        text,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.underline ? { underline: true } : {}),
      });
    } else if (node.type === "tag") {
      const childTag = node.tagName.toLowerCase();
      const nextStyle = nextStyleFor(childTag, style);
      // <br> 은 단락 내 줄바꿈 — 1차 정책상 공백 1개로 접음.
      if (childTag === "br") {
        // 직전 run에 공백 추가 (없으면 무시)
        const last = out[out.length - 1];
        if (last && !/\s$/.test(last.text)) last.text += " ";
        continue;
      }
      walkInline(node, $, nextStyle, out);
    }
  }
}

function nextStyleFor(tag: string, current: StyleState): StyleState {
  switch (tag) {
    case "strong":
    case "b":
      return { ...current, bold: true };
    case "em":
    case "i":
      return { ...current, italic: true };
    case "u":
      return { ...current, underline: true };
    default:
      return current;
  }
}

function runsAllWhitespace(runs: TextRun[]): boolean {
  return runs.every((r) => /^\s*$/.test(r.text));
}

// ─────────────────────────────────────────────────────────────
// list
// ─────────────────────────────────────────────────────────────

function listToBlock(
  el: Element,
  $: cheerio.CheerioAPI,
  ordered: boolean,
  nextId: () => string,
): Block {
  const items: ListItem[] = [];
  collectListItems(el, $, 0, items);
  return { id: nextId(), type: "list", ordered, items };
}

/**
 * 중첩된 <ul>/<ol>을 평탄화 — level만 기록.
 *
 * 한 <li> 안에 다시 <ul>/<ol>이 있으면, 본문은 현재 level의 ListItem으로,
 * 중첩 리스트는 level+1로 재귀.
 */
function collectListItems(
  listEl: Element,
  $: cheerio.CheerioAPI,
  level: number,
  out: ListItem[],
): void {
  $(listEl)
    .children("li")
    .each((_, li) => {
      // <li> 본문 = 자식 중 ul/ol을 제외한 것들의 인라인 텍스트
      const $li = $(li);
      const $bodyOnly = $li.clone();
      $bodyOnly.find("ul, ol").remove();
      // body는 임시 cheerio 인스턴스라 walkInline에 넣을 element로 변환
      const bodyEl = $bodyOnly[0];
      if (bodyEl && bodyEl.type === "tag") {
        const runs: TextRun[] = [];
        walkInline(bodyEl as Element, $, { bold: false, italic: false, underline: false }, runs);
        const filtered = runs.filter((r) => r.text.trim().length > 0);
        if (filtered.length > 0) {
          out.push({ level, runs: filtered });
        }
      }
      // 중첩 리스트
      $li.children("ul, ol").each((_i, nested) => {
        const isOrdered = nested.tagName.toLowerCase() === "ol";
        // ordered/unordered 변경은 1차에서 무시 — 평탄 list 모델로는 표현 못함.
        // 같은 ListBlock에 섞이게 됨. 보통 회사소개서/IR에서 문제 없음.
        void isOrdered;
        collectListItems(nested as Element, $, level + 1, out);
      });
    });
}

// ─────────────────────────────────────────────────────────────
// table
// ─────────────────────────────────────────────────────────────

function tableToBlock(
  el: Element,
  $: cheerio.CheerioAPI,
  nextId: () => string,
  warnings: ManuscriptWarning[],
): Block {
  const id = nextId();

  // 모든 <tr>을 순서대로 (thead/tbody/tfoot 안에 있어도)
  const $rows = $(el).find("tr");
  const rows = $rows.length;
  let cols = 0;
  const cells: string[][] = [];

  $rows.each((rIdx, tr) => {
    const rowCells: string[] = [];
    $(tr)
      .children("td, th")
      .each((_c, cell) => {
        // 중첩 표가 있으면 경고 + 평탄화
        if ($(cell).find("table").length > 0) {
          warnings.push({
            message: "표 안에 표가 있어 평탄화됐습니다.",
            blockId: id,
            severity: "warn",
          });
        }
        // 셀 내 모든 텍스트를 줄바꿈 보존하며 수집
        const text = cellToString(cell as Element, $);
        rowCells.push(text);
      });
    cells.push(rowCells);
    if (rowCells.length > cols) cols = rowCells.length;
  });

  // 행 길이 정규화 (짧은 행은 빈 셀로 패딩)
  for (const row of cells) {
    while (row.length < cols) row.push("");
  }

  // headerRows 추정 — mammoth가 docx 표 첫 행을 <thead>나 <th>로 분리하지 않으므로
  // 휴리스틱 3단:
  //   1) <thead>가 있으면 그 안의 행 수
  //   2) 첫 행이 모두 <th>면 1
  //   3) 첫 행의 모든 셀 텍스트가 <strong>/<b>로만 감싸여있으면 1 (mammoth docx 케이스)
  let headerRows = $(el).find("thead tr").length;
  if (headerRows === 0) {
    const firstTr = $rows.first();
    const firstCells = firstTr.children("td, th");
    if (firstCells.length > 0 && firstTr.children("th").length === firstCells.length) {
      headerRows = 1;
    } else if (firstCells.length > 0) {
      // 모든 셀의 텍스트가 strong/b로 감싸여있는지 확인
      let allBold = true;
      firstCells.each((_, cell) => {
        const text = $(cell).text().trim();
        if (text.length === 0) return; // 빈 셀은 무시
        // 셀 안의 텍스트 중 strong/b 밖에 있는 비공백 텍스트가 있으면 헤더 아님
        const $cell = $(cell);
        const $clone = $cell.clone();
        $clone.find("strong, b").remove();
        const remainingText = $clone.text().trim();
        if (remainingText.length > 0) allBold = false;
      });
      if (allBold) headerRows = 1;
    }
  }

  return {
    id,
    type: "table",
    rows,
    cols,
    cells,
    ...(headerRows > 0 ? { headerRows } : {}),
  };
}

/**
 * 표 셀 → 단순 문자열.
 *
 * 셀 안의 단락/줄바꿈/리스트는 \n 으로 합침.
 * 인라인 스타일은 버림 (1차 정책).
 */
function cellToString(cell: Element, $: cheerio.CheerioAPI): string {
  const lines: string[] = [];
  $(cell)
    .children()
    .each((_, child) => {
      if (child.type !== "tag") return;
      const tag = child.tagName.toLowerCase();
      if (tag === "p") {
        const text = $(child).text().replace(/\s+/g, " ").trim();
        if (text.length > 0) lines.push(text);
      } else if (tag === "ul" || tag === "ol") {
        $(child)
          .find("li")
          .each((_li, li) => {
            const text = $(li).text().replace(/\s+/g, " ").trim();
            if (text.length > 0) lines.push(`- ${text}`);
          });
      } else if (tag === "br") {
        lines.push("");
      } else {
        const text = $(child).text().replace(/\s+/g, " ").trim();
        if (text.length > 0) lines.push(text);
      }
    });
  // 자식이 텍스트만 있으면 위 each에서 안 잡혔을 수 있음 — fallback
  if (lines.length === 0) {
    const text = $(cell).text().replace(/\s+/g, " ").trim();
    if (text.length > 0) lines.push(text);
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────
// image
// ─────────────────────────────────────────────────────────────

/**
 * <p> 안에 <img> 만 있는지 확인.
 * (텍스트 자식 무시 — 공백뿐이면 단독 이미지로 간주)
 */
function isOnlyImage(el: Element, $: cheerio.CheerioAPI): Element | null {
  const $children = $(el).contents();
  let foundImg: Element | null = null;
  for (const c of $children.toArray()) {
    if (c.type === "text") {
      if (!/^\s*$/.test(c.data ?? "")) return null;
    } else if (c.type === "tag") {
      if (c.tagName.toLowerCase() === "img") {
        if (foundImg) return null; // 두 번째 이미지 — 단독 아님
        foundImg = c;
      } else {
        return null; // 이미지 외 다른 태그 — 단독 아님
      }
    }
  }
  return foundImg;
}

function imgToBlock($el: Element, $: cheerio.CheerioAPI, nextId: () => string): Block {
  const $img = $($el);
  const alt = ($img.attr("alt") ?? "").trim();
  // mammoth 기본 출력은 이미지를 base64 data URI로 임베드.
  // 1차 정책에 따라 src는 보존하지 않음 — placeholder만.
  // 단 originalSrc에 짧은 식별자 박아둠 (디버깅용)
  const src = $img.attr("src") ?? "";
  const isDataUri = src.startsWith("data:");
  return {
    id: nextId(),
    type: "image",
    alt,
    ...(isDataUri ? { originalSrc: "(embedded)" } : src ? { originalSrc: src } : {}),
  };
}
