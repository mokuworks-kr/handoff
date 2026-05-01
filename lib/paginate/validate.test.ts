/**
 * validate.ts 검증 테스트 (M3b-2-d).
 *
 * paginate.test.ts (M3b-2-c) 가 paginateBook 통합 흐름을 검증한다면,
 * 이 파일은 validateLlmOutput() 을 직접 호출해 새로 박은 검증 6종을 단위 검증.
 *
 * 검증 대상:
 *   - PATTERN_NOT_IN_VOCABULARY (§11 약속 1번)
 *   - SLOT_MISMATCH (3 케이스: 잘못된 슬롯 ID / 잘못된 블록 종류 / 필수 슬롯 비움)
 *   - BLOCK_DUPLICATED
 *   - BLOCK_NOT_FOUND
 *   - SPLIT_REASON_INCONSISTENT
 *   - PAGE_NUMBER_GAP
 *   - VARIANT_INVALID
 *   - INTENTIONAL_OMISSION (info, error 아님)
 *   - hidden + slotBlockRefs 모순
 *   - 정상 케이스에서 0 issues (회귀 방지)
 *
 * 실행: `npx tsx lib/paginate/validate.test.ts`
 */

import type { ClassifiedManuscript } from "@/lib/classify/types";
import type { DesignTokens } from "@/lib/types/design-tokens";
import { getPatternsForVocabulary } from "@/lib/layout/patterns";

import { validateLlmOutput } from "./validate";
import type { LlmBookOutput, ValidationCode } from "./types";

// ─────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────

const TOKENS_FULL: DesignTokens = {
  slug: "default",
  name: "Default",
  palette: {
    background: "#FFFFFF",
    surface: "#FAFAFA",
    text: "#0A0A0A",
    textMuted: "#525252",
    accent: "#000000",
    border: "#EAEAEA",
  },
  typography: {
    headingFamily: "Pretendard",
    bodyFamily: "Pretendard",
    bodySize: 10.5,
    bodyLineHeight: 1.6,
  },
  gridVocabulary: [[12], [6, 6], [8, 4], [4, 4, 4], [3, 3, 3, 3]],
};

const TOKENS_NARROW: DesignTokens = {
  ...TOKENS_FULL,
  gridVocabulary: [[12], [6, 6]], // wide-narrow / thirds / quarters 어휘 밖
};

// 다양한 블록 종류 포함한 매니스크립트 (각 검증 케이스용)
const MANUSCRIPT: ClassifiedManuscript = {
  schemaVersion: 1,
  source: { format: "text", filename: "test.txt" },
  blocks: [
    { id: "b0001", type: "heading", level: 1, runs: [{ text: "표지 제목" }] },
    { id: "b0002", type: "paragraph", runs: [{ text: "표지 부제" }] },
    { id: "s0001", type: "separator", kind: "page" },
    { id: "b0003", type: "heading", level: 2, runs: [{ text: "회사 개요" }] },
    { id: "b0004", type: "paragraph", runs: [{ text: "본문 한 단락" }] },
    {
      id: "b0005",
      type: "image",
      alt: "사옥 사진",
      originalSrc: "https://example.com/office.jpg",
    },
    {
      id: "b0006",
      type: "table",
      rows: 2,
      cols: 2,
      cells: [
        ["헤더1", "헤더2"],
        ["값1", "값2"],
      ],
      headerRows: 1,
    },
    { id: "b0007", type: "paragraph", runs: [{ text: "마무리 단락" }] },
  ],
  sections: [
    { id: "sec1", fromBlockId: "b0001", toBlockId: "b0002", kind: "cover-like", label: "표지", summary: "" },
    { id: "sec2", fromBlockId: "b0003", toBlockId: "b0007", kind: "narrative-like", label: "본문", summary: "" },
  ],
};

const PATTERNS = getPatternsForVocabulary(TOKENS_FULL.gridVocabulary!);

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────

function ok(label: string) {
  console.log(`  OK  ${label}`);
}
function fail(label: string, message: string): never {
  throw new Error(`FAIL: ${label} — ${message}`);
}
function expectIssue(
  result: ReturnType<typeof validateLlmOutput>,
  code: ValidationCode,
  label: string,
): void {
  const found = result.issues.find((i) => i.code === code);
  if (!found) {
    const got = result.issues.map((i) => i.code).join(", ");
    fail(label, `'${code}' 이슈 없음 (got: [${got}])`);
  }
  ok(`${label} → ${code} (${found.severity})`);
}
function expectError(result: ReturnType<typeof validateLlmOutput>, label: string): void {
  if (!result.hasError) fail(label, "hasError=false");
}
function expectNoError(result: ReturnType<typeof validateLlmOutput>, label: string): void {
  if (result.hasError) {
    const errs = result.issues
      .filter((i) => i.severity === "error")
      .map((i) => `${i.code}: ${i.message}`)
      .join("\n    ");
    fail(label, `에러 있음:\n    ${errs}`);
  }
}

// ─────────────────────────────────────────────────────────────
// Test 1 — 정상 케이스: 0 errors (회귀 방지)
// ─────────────────────────────────────────────────────────────

(async () => {
console.log("Test 1: 정상 케이스 — 0 errors");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
        slotBlockRefs: { main: ["b0001", "b0002"] },
        splitReason: "page-separator",
      },
      {
        pageNumber: 2, pattern: "halves-text-image", role: "media", side: "left",
        slotBlockRefs: { text: ["b0003", "b0004"], image: ["b0005"] },
        splitReason: "page-separator",
      },
      {
        pageNumber: 3, pattern: "wide-narrow-table-text", role: "data", side: "right",
        variants: { asymmetryDirection: "wide-left" },
        slotBlockRefs: { wide: ["b0006"], narrow: ["b0007"] },
        splitReason: "content-fit",
      },
    ],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectNoError(result, "정상 책");
  ok(`hasError=false, issues=${result.issues.length} (info 만)`);
}

// ─────────────────────────────────────────────────────────────
// Test 2 — PATTERN_NOT_IN_VOCABULARY
// ─────────────────────────────────────────────────────────────

console.log("\nTest 2: PATTERN_NOT_IN_VOCABULARY (§11 약속 1번)");
{
  // 어휘에 [12]/[6,6] 만 있는데 wide-narrow ([8,4]) 사용
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "wide-narrow-text-image", role: "body", side: "right",
        variants: { asymmetryDirection: "wide-left" },
        slotBlockRefs: { wide: ["b0001", "b0002", "b0003", "b0004", "b0007"], narrow: ["b0005"] },
        splitReason: "content-fit",
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0006"], reason: "표는 다른 자료" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_NARROW });
  expectError(result, "어휘 밖 콤포지션");
  expectIssue(result, "PATTERN_NOT_IN_VOCABULARY", "어휘 밖 wide-narrow");
}

// ─────────────────────────────────────────────────────────────
// Test 3 — SLOT_MISMATCH 케이스 1: 잘못된 슬롯 ID
// ─────────────────────────────────────────────────────────────

console.log("\nTest 3: SLOT_MISMATCH — 정의에 없는 슬롯 ID");
{
  const book: LlmBookOutput = {
    pages: [
      {
        // halves-text-text 는 left/right 슬롯. center 는 없음.
        pageNumber: 1, pattern: "halves-text-text", role: "body", side: "right",
        slotBlockRefs: { left: ["b0001"], center: ["b0002"], right: ["b0003"] },
        splitReason: "page-separator",
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0004", "b0005", "b0006", "b0007"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "잘못된 슬롯 ID");
  expectIssue(result, "SLOT_MISMATCH", "halves-text-text 에 'center' 슬롯");
}

// ─────────────────────────────────────────────────────────────
// Test 4 — SLOT_MISMATCH 케이스 2: 슬롯 종류와 블록 종류 불일치
// ─────────────────────────────────────────────────────────────

console.log("\nTest 4: SLOT_MISMATCH — text 슬롯에 image 블록");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "full-text", role: "body", side: "right",
        // main 은 text 슬롯인데 image 블록 b0005 매핑
        slotBlockRefs: { main: ["b0005"] },
        splitReason: "content-fit",
      },
    ],
    intentionalOmissions: [
      { blockIds: ["b0001", "b0002", "b0003", "b0004", "b0006", "b0007"], reason: "테스트용" },
    ],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "text 슬롯에 image 블록");
  expectIssue(result, "SLOT_MISMATCH", "text 슬롯 + image 블록");
}

// ─────────────────────────────────────────────────────────────
// Test 5 — SLOT_MISMATCH 케이스 3: 필수 슬롯 비움
// ─────────────────────────────────────────────────────────────

console.log("\nTest 5: SLOT_MISMATCH — 필수 슬롯 비움");
{
  const book: LlmBookOutput = {
    pages: [
      {
        // halves-text-image 는 text + image 슬롯 둘 다 필수.
        pageNumber: 1, pattern: "halves-text-image", role: "media", side: "right",
        slotBlockRefs: { text: ["b0001"] }, // image 슬롯 비움
        splitReason: "page-separator",
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0002", "b0003", "b0004", "b0005", "b0006", "b0007"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "필수 슬롯 비움");
  expectIssue(result, "SLOT_MISMATCH", "halves-text-image 의 image 슬롯 비움");
}

// ─────────────────────────────────────────────────────────────
// Test 6 — BLOCK_DUPLICATED
// ─────────────────────────────────────────────────────────────

console.log("\nTest 6: BLOCK_DUPLICATED");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
        slotBlockRefs: { main: ["b0001", "b0002"] },
        splitReason: "page-separator",
      },
      {
        pageNumber: 2, pattern: "halves-text-image", role: "media", side: "left",
        slotBlockRefs: { text: ["b0003", "b0001"], image: ["b0005"] }, // b0001 중복
        splitReason: "page-separator",
      },
      {
        pageNumber: 3, pattern: "wide-narrow-table-text", role: "data", side: "right",
        variants: { asymmetryDirection: "wide-left" },
        slotBlockRefs: { wide: ["b0006"], narrow: ["b0004", "b0007"] },
        splitReason: "content-fit",
      },
    ],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "블록 중복");
  expectIssue(result, "BLOCK_DUPLICATED", "b0001 두 페이지 사용");
}

// ─────────────────────────────────────────────────────────────
// Test 7 — BLOCK_NOT_FOUND
// ─────────────────────────────────────────────────────────────

console.log("\nTest 7: BLOCK_NOT_FOUND");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
        slotBlockRefs: { main: ["b0001", "b9999"] }, // b9999 는 없음
        splitReason: "page-separator",
      },
    ],
    intentionalOmissions: [
      { blockIds: ["b0002", "b0003", "b0004", "b0005", "b0006", "b0007"], reason: "테스트용" },
    ],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "없는 블록 ID");
  expectIssue(result, "BLOCK_NOT_FOUND", "b9999 존재 안 함");
}

// ─────────────────────────────────────────────────────────────
// Test 8 — SPLIT_REASON_INCONSISTENT
// ─────────────────────────────────────────────────────────────

console.log("\nTest 8: SPLIT_REASON_INCONSISTENT (warn)");
{
  // 페이지 2 가 splitReason='page-separator' 라고 주장하지만
  // b0004 직전에 SeparatorBlock('page') 없음 (b0003 직전엔 있음)
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
        slotBlockRefs: { main: ["b0001", "b0002", "b0003"] },
        splitReason: "page-separator",
      },
      {
        pageNumber: 2, pattern: "full-text", role: "body", side: "left",
        slotBlockRefs: { main: ["b0004", "b0007"] },
        splitReason: "page-separator", // 거짓 — b0004 직전엔 separator 없음
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0005", "b0006"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectIssue(result, "SPLIT_REASON_INCONSISTENT", "거짓 page-separator");
  // warn 이라 hasError=false 여야 함 (다른 error 없으면)
  if (result.hasError) {
    const errs = result.issues.filter((i) => i.severity === "error").map((i) => i.code).join(", ");
    fail("warn only", `다른 error 있음: ${errs}`);
  }
  ok(`SPLIT_REASON_INCONSISTENT 는 warn → hasError=false`);
}

// ─────────────────────────────────────────────────────────────
// Test 9 — PAGE_NUMBER_GAP
// ─────────────────────────────────────────────────────────────

console.log("\nTest 9: PAGE_NUMBER_GAP (warn)");
{
  const book: LlmBookOutput = {
    pages: [
      { pageNumber: 1, pattern: "full-text", role: "cover", side: "right", slotBlockRefs: { main: ["b0001"] }, splitReason: "page-separator" },
      { pageNumber: 3, pattern: "full-text", role: "body", side: "left", slotBlockRefs: { main: ["b0002", "b0003", "b0004", "b0007"] }, splitReason: "page-separator" }, // 2 가 아니라 3
    ],
    intentionalOmissions: [{ blockIds: ["b0005", "b0006"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectIssue(result, "PAGE_NUMBER_GAP", "2 가 아니라 3");
}

// ─────────────────────────────────────────────────────────────
// Test 10 — VARIANT_INVALID
// ─────────────────────────────────────────────────────────────

console.log("\nTest 10: VARIANT_INVALID");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "wide-narrow-text-image", role: "body", side: "right",
        variants: { asymmetryDirection: "wide-up" }, // 'wide-up' 같은 값 없음
        slotBlockRefs: {
          wide: ["b0001", "b0002", "b0003", "b0004", "b0007"],
          narrow: ["b0005"],
        },
        splitReason: "content-fit",
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0006"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "잘못된 variant 값");
  expectIssue(result, "VARIANT_INVALID", "asymmetryDirection='wide-up'");
}

// ─────────────────────────────────────────────────────────────
// Test 11 — INTENTIONAL_OMISSION (info)
// ─────────────────────────────────────────────────────────────

console.log("\nTest 11: INTENTIONAL_OMISSION (info)");
{
  const book: LlmBookOutput = {
    pages: [
      { pageNumber: 1, pattern: "full-text", role: "cover", side: "right", slotBlockRefs: { main: ["b0001", "b0002"] }, splitReason: "page-separator" },
      { pageNumber: 2, pattern: "full-text", role: "body", side: "left", slotBlockRefs: { main: ["b0003", "b0004"] }, splitReason: "page-separator" },
      { pageNumber: 3, pattern: "halves-text-image", role: "media", side: "right", slotBlockRefs: { text: ["b0007"], image: ["b0005"] }, splitReason: "content-fit" },
    ],
    intentionalOmissions: [{ blockIds: ["b0006"], reason: "표는 별도 자료에서 처리" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectNoError(result, "intentionalOmissions 정상");
  expectIssue(result, "INTENTIONAL_OMISSION", "info 기록");
  // info severity 확인
  const info = result.issues.find((i) => i.code === "INTENTIONAL_OMISSION");
  if (info?.severity !== "info") fail("severity", `expected info, got ${info?.severity}`);
}

// ─────────────────────────────────────────────────────────────
// Test 12 — hidden + slotBlockRefs 모순
// ─────────────────────────────────────────────────────────────

console.log("\nTest 12: hidden + slotBlockRefs 모순");
{
  const book: LlmBookOutput = {
    pages: [
      {
        pageNumber: 1, pattern: "halves-text-image", role: "media", side: "right",
        slotBlockRefs: { text: ["b0001"], image: ["b0005"] },
        hiddenSlotIds: ["image"], // image 슬롯이 hidden 인데 매핑도 있음
        splitReason: "page-separator",
      },
    ],
    intentionalOmissions: [{ blockIds: ["b0002", "b0003", "b0004", "b0006", "b0007"], reason: "테스트용" }],
  };
  const result = validateLlmOutput({ book, manuscript: MANUSCRIPT, patterns: PATTERNS, designTokens: TOKENS_FULL });
  expectError(result, "hidden + 매핑 모순");
  expectIssue(result, "SLOT_MISMATCH", "image 가 hidden 인데 매핑도 있음");
}

console.log("\n전체 12개 테스트 모두 통과.");

})();
