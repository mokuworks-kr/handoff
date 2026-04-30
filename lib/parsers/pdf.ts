/**
 * pdf 파서 — PDF 문서 → NormalizedManuscript.
 *
 * 전략: pdf-parse@2 로 페이지별 평문 텍스트 추출 + 휴리스틱 단락/heading 분리.
 *
 * ─────────────────────────────────────────────────────────────
 * PDF의 본질적 한계 (이 파일을 읽기 전 알아야 함)
 * ─────────────────────────────────────────────────────────────
 *
 * docx와 달리 PDF는 의미적 구조(단락/제목/표/리스트)를 거의 담지 않는다.
 * 기본적으로 "x,y 좌표에 글자 하나"의 모음일 뿐. 시각적 결과만 있고
 * 구조 정보는 거의 없다.
 *
 * 그 결과:
 *   ✅ 텍스트 추출  — 잘 됨
 *   ⚠️ 단락 분리   — 줄 사이 공백/길이로 추정
 *   ⚠️ heading    — "짧고 종결부호 없음" 휴리스틱 (정밀도 낮음)
 *   ❌ 표         — pdf-parse는 셀 좌표를 안 줌. 평문으로 흘려넣음.
 *                  사용자에게 경고로 고지.
 *   ❌ 리스트      — 불릿 문자(•, -)로만 추정. 들여쓰기 추정 X.
 *
 * 이는 회사소개서/IR 1차 타깃에서 PDF가 "주 입력"이 아니라 "보조 입력"이라는
 * 전제 위에 만든 파서다. PDF로 받은 IR을 우리 시스템에서 "재조판"하고 싶다면
 * 사용자는 원본 docx를 받아오거나 텍스트 직접 입력하는 게 권장.
 *
 * pdf-parse@2 가 폰트/좌표를 노출하지 않아 폰트 크기 기반 heading 추정은 미지원.
 * 정밀도 더 필요하면 pdfjs-dist 직접 사용으로 업그레이드(M3 후반 또는 M6+).
 *
 * ─────────────────────────────────────────────────────────────
 * 정책 (M3a-1 결정)
 * ─────────────────────────────────────────────────────────────
 *
 * 1) 페이지 경계는 SeparatorBlock("page")로 보존.
 *    분류기가 페이지 단위로 섹션 잡을 때 활용.
 *
 * 2) 표는 일반 paragraph로 흘려넣되, 파일 처음에 warning 메시지 한 번 박음.
 *    "PDF 안의 표는 구조가 깨져 평문으로 들어옵니다." — 미리보기에서 사용자가 봄.
 *
 * 3) heading 추정은 inferHeadings (docx와 동일한 후처리) 적용.
 *    bold 신호 없이 "짧음 + 종결부호 없음 + 컨텍스트 고립"만으로 추정.
 */

import { PDFParse } from "pdf-parse";
import {
  blockId,
  type Block,
  type ManuscriptWarning,
  type NormalizedManuscript,
} from "./normalized";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type PdfParseInput = {
  buffer: Buffer | ArrayBuffer;
  filename: string;
};

export async function parsePdf(input: PdfParseInput): Promise<NormalizedManuscript> {
  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer);

  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const warnings: ManuscriptWarning[] = [];

  let info: Awaited<ReturnType<typeof parser.getInfo>>;
  let text: Awaited<ReturnType<typeof parser.getText>>;
  try {
    info = await parser.getInfo();
    text = await parser.getText();
  } finally {
    await parser.destroy();
  }

  // PDF는 표 구조가 깨질 수 있다는 경고를 항상 한 번 박음.
  // 단순 1페이지 PDF여도 괜찮음 — 분류기가 보고 무시할 수 있음.
  warnings.push({
    message:
      "PDF 안의 표는 구조가 깨져 일반 텍스트로 들어옵니다. 표가 중요하다면 원본 docx 또는 직접 입력을 권장합니다.",
    severity: "info",
  });

  // 페이지별로 블록 추출 + 페이지 경계 separator
  const blocks: Block[] = [];
  let counter = 0;
  const nextId = () => blockId(counter++);

  for (let i = 0; i < text.pages.length; i++) {
    const pageText = text.pages[i].text;
    const pageBlocks = pageTextToBlocks(pageText, nextId, i + 1);
    blocks.push(...pageBlocks);
    // 마지막 페이지 뒤에는 separator 안 박음
    if (i < text.pages.length - 1) {
      blocks.push({ id: nextId(), type: "separator", kind: "page" });
    }
  }

  // PDF에서는 heading 추정을 하지 않는다.
  //
  // 이유: docx와 달리 PDF는 bold 신호가 없어 "짧음 + 종결부호 없음"만으로
  // 추정해야 하는데, 표의 셀이나 데이터 행도 짧고 종결부호 없는 경우가 많아
  // false positive가 너무 많이 생긴다. (실측: 시드 IR PDF에서 표 셀이
  // 대부분 H로 잘못 승격됨.)
  //
  // PDF에서는 모든 단락을 P로 두고 분류기 LLM이 문맥을 보고 새 섹션 시작을
  // 인식하도록 한다. 분류기는 "짧은 단락이 짧은 단락 위에 있다"는 패턴을
  // 충분히 잘 인식하므로 분류 정확도에 큰 영향 없을 것으로 기대.
  //
  // 폰트 크기 정보를 얻을 수 있게 되면(pdfjs-dist 직접 사용으로 업그레이드 시)
  // heading 추정을 다시 켜도 됨.
  const finalBlocks = blocks;

  // info dict에서 메타데이터 추출
  const sourceInfo = info.info ?? {};
  const title = typeof sourceInfo.Title === "string" ? sourceInfo.Title : undefined;
  const author = typeof sourceInfo.Author === "string" ? sourceInfo.Author : undefined;

  return {
    schemaVersion: 1,
    source: {
      format: "pdf",
      filename: input.filename,
      byteSize: buffer.length,
      pageCount: text.pages.length,
      ...(title ? { title } : {}),
      ...(author ? { author } : {}),
    },
    blocks: finalBlocks,
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────
// 페이지 평문 → blocks
// ─────────────────────────────────────────────────────────────

/**
 * 페이지 안의 평문을 줄 단위로 끊고, 각 줄을 paragraph로.
 *
 * pdf-parse v2의 페이지 텍스트는 줄바꿈으로 행 분리되어 옴. 같은 페이지 내에서
 * 빈 줄(\n\n)이 거의 없어 "빈 줄 = 단락 경계" 휴리스틱은 작동하지 않는다.
 *
 * 채택한 정책: **"한 줄 = 한 단락"**.
 *
 * 근거:
 *   - 회사소개서/IR PDF는 보통 디자인된 결과물이라 한 줄에 한 의미 단위가 들어감
 *   - 본문 단락이 줄바꿈으로 깨졌을 가능성은 있지만, 분류기 LLM이 인접 단락을
 *     한 섹션으로 묶을 때 자연스럽게 흡수
 *   - 한국어/일본어는 영어식 word-wrap이 거의 없어 "한 줄 = 한 의미"가 더 잘 맞음
 *
 * 단 다음 케이스는 합침:
 *   - 줄 끝이 하이픈으로 끝나고 다음 줄이 소문자 시작: 영문 word-wrap (exam-\nple)
 *
 * 더 정교한 단락 추정(좌표 기반)은 pdfjs-dist 직접 사용으로 업그레이드할 때.
 */
function pageTextToBlocks(
  pageText: string,
  nextId: () => string,
  pageNumber: number,
): Block[] {
  const out: Block[] = [];

  // \r\n → \n 정규화
  const normalized = pageText.replace(/\r\n/g, "\n");

  // 줄 단위로 끊기. 빈 줄은 무시 (의미 없음 — pdf-parse가 가끔 만들어내는 것일 뿐)
  const lines = normalized
    .split("\n")
    .map((l) => cleanLine(l))
    .filter((l) => l.length > 0);

  // 영문 word-wrap 합침 처리
  const merged = mergeWordWrappedLines(lines);

  for (const line of merged) {
    out.push({
      id: nextId(),
      type: "paragraph",
      runs: [{ text: line }],
      sourceLocation: `pdf:p${pageNumber}`,
    });
  }

  return out;
}

/**
 * 줄 단위 정제.
 *
 * 디자인된 PDF는 폰트 매핑이 깨져 의미 없는 글리프가 박혀 들어온다.
 * 텍스트 추출의 본질적 한계라 우리 파서가 완전히 고칠 수는 없지만,
 * 패턴이 일정한 "알려진 깨짐"은 후처리로 수정한다. 분류기의 노이즈를 줄이는 게 목적.
 *
 * §1 약속(원고 안 다듬음) 위배 아님 — "원고 변경"이 아니라 "렌더링 오류 수정".
 *
 * 처리:
 *   1) 제어문자(C0/C1) + PUA(U+E000~U+F8FF) 제거 — 의미 없는 아이콘 자리
 *   2) 알려진 깨진 글리프 매핑 (디노티시아 브로슈어 검증으로 확인된 패턴):
 *        é → •     (불릿)
 *        Ç → :     (콜론)
 *        ¦ → -     (하이픈)
 *        \b → →    (화살표)
 *      이 매핑은 디자인 폰트 따라 다를 수 있어 "1차 시드" 케이스 대응만.
 *      다른 깨짐 패턴이 발견되면 여기 추가.
 *   3) 정제 후 빈 문자열이거나 공백만이면 빈 줄로 (호출자가 필터)
 *
 * 트리밍은 안 함 — 줄 끝/시작 공백을 보존해야 word-wrap 합침이 정확하게 동작.
 * 단 결과가 모두 공백이면 빈 줄로 버림.
 */
function cleanLine(line: string): string {
  let s = line;

  // 알려진 깨진 글리프 → 의미 글리프 (1대1 치환)
  // 매핑 테이블이 길어지면 별도 상수로 분리
  s = s.replace(/é/g, "•");
  s = s.replace(/Ç/g, ":");
  s = s.replace(/¦/g, "-");
  s = s.replace(/\u0008/g, "→"); // \b

  // C0 제어문자 (U+0000-U+001F, \t와 \n 제외) 제거
  // \t는 보존 (탭으로 정렬된 텍스트), \n은 이미 split됨
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  // C1 제어문자 (U+0080-U+009F) 제거 — 깨진 매핑의 잔재
  s = s.replace(/[\u0080-\u009F]/g, "");

  // PUA (U+E000-U+F8FF) 제거 — 폰트 회사 정의 사설 글리프 (로고 등). 의미 없음.
  s = s.replace(/[\uE000-\uF8FF]/g, "");

  const trimmed = s.trim();
  return trimmed.length === 0 ? "" : s;
}

/**
 * 영문 word-wrap만 합치고, 그 외는 그대로.
 * "exam-\nple" → "example"
 *
 * 입력 lines는 양 끝 공백을 정리하지 않은 상태일 수 있으므로 내부에서 trim.
 */
function mergeWordWrappedLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.endsWith("-") && /^[a-z]/.test(line)) {
      out[out.length - 1] = last.slice(0, -1) + line;
    } else {
      out.push(line);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// heading 추정에 대한 메모 (현재 미적용)
// ─────────────────────────────────────────────────────────────
//
// PDF에는 폰트/스타일 정보가 거의 없어 docx의 inferHeadings 같은 추정이
// 부정확하다. 1차 정책으로 PDF는 heading을 박지 않고 분류기 LLM에 맡긴다.
//
// 미래에 pdfjs-dist 직접 사용으로 폰트 크기를 얻게 되면, 본문 폰트 크기보다
// 큰 텍스트를 H로 승격하는 정확한 추정을 추가할 것.
