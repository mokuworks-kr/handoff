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
 *    - PK + JSZip으로 zip 내용 검사
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
 *
 * ─────────────────────────────────────────────────────────────
 * detectZipFormat 정책 (M3a-3-2c 변경)
 * ─────────────────────────────────────────────────────────────
 *
 * 이전: ZIP 헤더를 직접 파싱해 첫 ~20개 entry 이름만 봤음.
 * 문제: PowerPoint 가 큰 파일에 ZIP64 형식을 쓰면 compressedSize 가 0xFFFFFFFF 로
 *       들어가 offset 계산이 망가져 두 번째 entry 부터 못 찾음. 작은 zip은 OK,
 *       큰 zip은 fileNames 가 1개만 모이고 ppt/presentation.xml 못 찾아 unknown 으로 떨어짐.
 *
 * 현재: JSZip 으로 정직하게 zip 풀고 모든 파일 이름 검사.
 *       장점: ZIP64·streaming·압축 형식 모두 호환. 정확함.
 *       비용: 메모리 + 시간 약간. 단 어차피 그 다음 단계(parsePptx 등)에서
 *             JSZip 다시 호출하므로 이중 작업 아님 — 라우팅 단계에서 한 번 풀고
 *             결과는 버려짐 (parser가 다시 풀음). 이중 풀기 비용 < 사용자 경험 개선.
 *       미래: 파서 함수가 미리 풀린 JSZip 객체를 받아 재활용하는 리팩토링 가능.
 *             지금은 안 함 — 단순함 우선.
 */

import JSZip from "jszip";
import {
  blockId,
  type Block,
  type ManuscriptWarning,
  type NormalizedManuscript,
} from "./normalized";
import { parseDocx } from "./docx";
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
    case "pdf": {
      // dynamic import — pdf-parse의 무거운 의존성을 라우트 로딩 시점에서 격리.
      const { parsePdf } = await import("./pdf");
      result = await parsePdf({ buffer, filename: input.filename });
      break;
    }
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
    if (filename.toLowerCase().endsWith(".hwp")) {
      return "hwp";
    }
    return "unknown";
  }

  return "unknown";
}

/**
 * ZIP 파일 안 들여다보고 docx/pptx/hwpx 구분.
 *
 * JSZip 기반 — 파일 이름 전부 보고 시그니처 매칭.
 * 우선순위:
 *   1) hwpx — 첫 entry 가 "mimetype" (OWPML 표준)
 *   2) docx — "word/document.xml" 존재
 *   3) pptx — "ppt/presentation.xml" 존재
 *   4) 그 외 → unknown
 *
 * JSZip 호출 실패(파일이 zip 흉내 내지만 깨졌거나 암호화 등) → unknown.
 */
async function detectZipFormat(buffer: Buffer): Promise<DetectedFormat> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return "unknown";
  }

  const fileNames = Object.keys(zip.files);

  // hwpx 가 가장 명확한 시그니처 — "mimetype" 가 첫 파일이고 내용이 application/hwp+zip
  // (단순화: 첫 파일 이름이 "mimetype" 인지만 검사)
  if (fileNames[0] === "mimetype") {
    return "hwpx";
  }

  // docx
  if (fileNames.includes("word/document.xml")) {
    return "docx";
  }

  // pptx
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
 *   - heading 추정 안 함 (분류기 위임)
 *   - 인라인 스타일 없음 (평문이라)
 *   - 표/리스트 안 만듦 (평문에서 추정 어려움)
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
