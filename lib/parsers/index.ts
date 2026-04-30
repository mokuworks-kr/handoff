/**
 * 파서 라우터 — 입력(파일 또는 텍스트)을 받아 NormalizedManuscript 반환.
 *
 * 단일 진입점 `parseManuscript()`. 호출자(API 라우트, 입력 UI)가 분기 안 짜도 됨.
 *
 * ─────────────────────────────────────────────────────────────
 * 라우팅 로직
 * ─────────────────────────────────────────────────────────────
 *
 * 1) 텍스트 입력 → 직접 NormalizedManuscript로 변환 (문단별 split)
 * 2) 파일 입력 → 매직 바이트로 진짜 형식 판별:
 *    - %PDF-                    → pdf
 *    - PK + zip 내용 검사
 *      - mimetype 첫 파일       → hwpx (application/hwp+zip)
 *      - ppt/presentation.xml  → pptx
 *      - word/document.xml     → docx
 *      - 그 외 zip              → 에러
 *    - 다른 매직 바이트         → 에러
 *
 * 3) 확장자와 매직 바이트 불일치 시:
 *    - **매직 바이트 우선** — 확장자는 사용자가 잘못 붙였을 수 있음
 *    - warning 추가해서 사용자에게 고지
 *
 * 4) `.hwp` (옛날 한컴 바이너리) → 명확한 에러:
 *    "지원하지 않는 형식입니다. 한컴오피스에서 .hwpx로 저장 후 다시 시도해주세요."
 */

import {
  blockId,
  type Block,
  type ManuscriptWarning,
  type NormalizedManuscript,
} from "./normalized";
import { parseDocx } from "./docx";
import { parsePdf } from "./pdf";
import { parsePptx } from "./pptx";
import { parseHwpx } from "./hwpx";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type ParseInput =
  | {
      kind: "file";
      buffer: Buffer | ArrayBuffer;
      filename: string;
    }
  | {
      kind: "text";
      content: string;
      /** 텍스트 입력의 가짜 파일명. 미지정 시 "untitled.txt" */
      filename?: string;
    };

export async function parseManuscript(input: ParseInput): Promise<NormalizedManuscript> {
  if (input.kind === "text") {
    return parseText(input.content, input.filename ?? "untitled.txt");
  }

  // 파일 입력 — 매직 바이트로 형식 판별
  const buffer = Buffer.isBuffer(input.buffer)
    ? input.buffer
    : Buffer.from(input.buffer);

  const detectedFormat = await detectFormat(buffer, input.filename);
  const extensionFormat = formatFromExtension(input.filename);

  // 확장자와 매직 바이트 불일치 경고용
  const formatMismatch =
    extensionFormat !== null && extensionFormat !== detectedFormat;

  let result: NormalizedManuscript;
  switch (detectedFormat) {
    case "docx":
      result = await parseDocx({ buffer, filename: input.filename });
      break;
    case "pdf":
      result = await parsePdf({ buffer, filename: input.filename });
      break;
    case "pptx":
      result = await parsePptx({ buffer, filename: input.filename });
      break;
    case "hwpx":
      result = await parseHwpx({ buffer, filename: input.filename });
      break;
    case "hwp":
      throw new ManuscriptParseError(
        "HWP_LEGACY_NOT_SUPPORTED",
        "지원하지 않는 형식입니다 (.hwp 옛날 바이너리). 한컴오피스에서 '.hwpx'로 다시 저장한 뒤 업로드해주세요.",
      );
    case "unknown":
      throw new ManuscriptParseError(
        "UNKNOWN_FORMAT",
        `지원하지 않는 파일 형식입니다. 지원 형식: docx, pdf, pptx, hwpx (현재 파일: ${input.filename})`,
      );
  }

  // 형식 불일치 경고
  if (formatMismatch) {
    const warnings: ManuscriptWarning[] = [
      ...(result.warnings ?? []),
      {
        message: `파일 확장자(.${extensionFormat})와 실제 형식(.${detectedFormat})이 다릅니다. 실제 형식대로 처리했습니다.`,
        severity: "warn",
      },
    ];
    result = { ...result, warnings };
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// 형식 판별
// ─────────────────────────────────────────────────────────────

export type DetectedFormat = "docx" | "pdf" | "pptx" | "hwpx" | "hwp" | "unknown";

/**
 * 매직 바이트와 zip 내용으로 진짜 파일 형식 판별.
 */
async function detectFormat(
  buffer: Buffer,
  filename: string,
): Promise<DetectedFormat> {
  if (buffer.length < 4) return "unknown";

  // PDF: "%PDF-"
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf";
  }

  // ZIP 시그니처: "PK\x03\x04"
  const isZip =
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  if (isZip) {
    return await detectZipFormat(buffer);
  }

  // .hwp 옛날 바이너리: CFB/OLE2 시그니처 D0 CF 11 E0 A1 B1 1A E1
  if (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0 &&
    buffer[4] === 0xa1 &&
    buffer[5] === 0xb1 &&
    buffer[6] === 0x1a &&
    buffer[7] === 0xe1
  ) {
    // 확장자가 .hwp 인지 추가 확인 (다른 OLE2 형식과 구분)
    if (filename.toLowerCase().endsWith(".hwp")) {
      return "hwp";
    }
    // OLE2이지만 .hwp 아님 — 다른 옛날 오피스(doc/xls/ppt). 미지원.
    return "unknown";
  }

  return "unknown";
}

/**
 * ZIP 파일 안을 들여다보고 docx/pptx/hwpx 구분.
 *
 * 라이브러리(JSZip 등)를 부르면 무겁고 비동기. 우리는 ZIP 헤더를 직접 읽어
 * 첫 몇 개 파일 이름만 본다. ZIP 헤더 구조 (Local File Header):
 *   offset 0  : 4 bytes signature "PK\x03\x04"
 *   offset 26 : 2 bytes file name length
 *   offset 30 : N bytes file name (UTF-8)
 *   ... (compressed data, then next entry)
 *
 * 처음 ~10개 entry만 읽고 판단. 모든 OOXML 형식이 첫 ~5개 안에 식별 파일을 가진다.
 */
async function detectZipFormat(buffer: Buffer): Promise<DetectedFormat> {
  const fileNames: string[] = [];
  let offset = 0;
  const maxEntries = 20;

  while (offset + 30 < buffer.length && fileNames.length < maxEntries) {
    // Local File Header signature 확인
    if (
      buffer[offset] !== 0x50 ||
      buffer[offset + 1] !== 0x4b ||
      buffer[offset + 2] !== 0x03 ||
      buffer[offset + 3] !== 0x04
    ) {
      break;
    }

    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const compressedSize = buffer.readUInt32LE(offset + 18);

    if (offset + 30 + fileNameLength > buffer.length) break;

    const fileName = buffer.toString(
      "utf8",
      offset + 30,
      offset + 30 + fileNameLength,
    );
    fileNames.push(fileName);

    offset += 30 + fileNameLength + extraFieldLength + compressedSize;
  }

  // 판별 우선순위:
  //   1) hwpx — 첫 파일이 mimetype (OWPML 표준 + 시드/실제 모두 확인됨)
  //   2) docx — word/document.xml 존재
  //   3) pptx — ppt/presentation.xml 존재
  //
  // hwpx가 mimetype 검사를 먼저 하는 이유: hwpx는 [Content_Types].xml 도 있을 수 있고
  // (확장 포맷의 경우) 헷갈릴 여지가 있어, 가장 명확한 시그니처(mimetype 첫 파일)를 우선.

  if (fileNames[0] === "mimetype") {
    return "hwpx";
  }
  if (fileNames.includes("word/document.xml")) {
    return "docx";
  }
  if (fileNames.includes("ppt/presentation.xml")) {
    return "pptx";
  }

  return "unknown";
}

/**
 * 파일명 확장자 → 형식. 매직 바이트와 비교용.
 * 모르는 확장자는 null.
 */
function formatFromExtension(filename: string): DetectedFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".pptx")) return "pptx";
  if (lower.endsWith(".hwpx")) return "hwpx";
  if (lower.endsWith(".hwp")) return "hwp";
  return null;
}

// ─────────────────────────────────────────────────────────────
// 텍스트 입력
// ─────────────────────────────────────────────────────────────

/**
 * 평문 텍스트 → NormalizedManuscript.
 *
 * 정책 (M3a-1):
 *   - 빈 줄(연속 \n)을 단락 경계로 사용
 *   - 한 단락 = 한 ParagraphBlock
 *   - heading 추정 안 함 (워드에서 복사하면 heading 정보가 없음 — 분류기 위임)
 *   - 인라인 스타일 없음 (평문이라)
 *   - 표/리스트 안 만듦 (평문에서 추정 어려움)
 *
 * 사용자가 "워드 본문을 통째로 복붙" 하는 시나리오를 받기 위함.
 * 표 같은 구조가 필요하면 원본 docx 업로드 권장 — 미리보기 UI에서 안내.
 */
function parseText(content: string, filename: string): NormalizedManuscript {
  // \r\n → \n 정규화
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 빈 줄로 단락 분리
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const blocks: Block[] = [];
  let counter = 0;
  for (const para of paragraphs) {
    // 단락 안의 줄바꿈은 공백 1개로 (CJK든 영문이든 동일 — 평문이라 정확한 추정 불가)
    const merged = para.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    if (merged.length === 0) continue;
    blocks.push({
      id: blockId(counter++),
      type: "paragraph",
      runs: [{ text: merged }],
    });
  }

  return {
    schemaVersion: 1,
    source: {
      format: "text",
      filename,
      byteSize: Buffer.byteLength(content, "utf8"),
    },
    blocks,
  };
}

// ─────────────────────────────────────────────────────────────
// 에러 타입
// ─────────────────────────────────────────────────────────────

/**
 * 파싱 단계에서 호출자에게 의미 있는 신호를 주기 위한 에러 클래스.
 * code는 UI에서 분기하거나 i18n 키로 사용.
 */
export class ManuscriptParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ManuscriptParseError";
    this.code = code;
  }
}
