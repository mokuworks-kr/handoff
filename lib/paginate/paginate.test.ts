/**
 * paginateBook() 단위 검증 (M3b-2-c).
 *
 * input.callTool DI 로 LLM 응답 모킹. production 에서는 callTool override 안 함.
 *
 * 검증 5종:
 *   1. 입력 검증 3가지 에러
 *   2. 행복 경로: 3페이지 책 빌드, 슬롯 콘텐츠 변환, 책자형 side, styles 동기화
 *   3. INVALID_PATTERN_SLUG → VALIDATION_FAILED
 *   4. BLOCK_ORPHANED → VALIDATION_FAILED (§1 약속 강제)
 *   5. intentionalOmissions 명시 → 검증 통과
 *
 * 실행: `npx tsx lib/paginate/paginate.test.ts`
 */

import type {
  CallToolInput,
  CallToolOutput,
} from "@/lib/llm/call-tool";
import type { ClassifiedManuscript } from "@/lib/classify/types";
import type { DesignTokens } from "@/lib/types/design-tokens";
import type { Document } from "@/lib/types/document";
import { getPatternsForVocabulary } from "@/lib/layout/patterns";

import { paginateBook } from "./index";
import { PaginateError } from "./types";
import type { LlmBookOutput, PaginateInput } from "./types";

// ─────────────────────────────────────────────────────────────
// 픽스처
// ─────────────────────────────────────────────────────────────

const A4_FORMAT: Document["format"] = {
  width: 210,
  height: 297,
  unit: "mm",
  bleed: { top: 3, bottom: 3, inside: 3, outside: 3 },
  margins: { top: 20, bottom: 20, inside: 25, outside: 15 },
  columns: 12,
  gutter: 4,
  baselineGrid: 4.2,
};

const DEFAULT_TOKENS: DesignTokens = {
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
  rhythmGuide: "차분한 호흡",
  print: {
    paragraphStyles: [{ id: "body", name: "본문" }],
    characterStyles: [],
    fonts: [],
    colors: [],
  },
};

const TEST_MANUSCRIPT: ClassifiedManuscript = {
  schemaVersion: 1,
  source: { format: "text", filename: "test.txt" },
  blocks: [
    { id: "b0001", type: "heading", level: 1, runs: [{ text: "한빛테크" }] },
    { id: "b0002", type: "paragraph", runs: [{ text: "2026 IR 자료" }] },
    { id: "s0001", type: "separator", kind: "page" },
    { id: "b0003", type: "heading", level: 2, runs: [{ text: "회사 개요" }] },
    { id: "b0004", type: "paragraph", runs: [{ text: "한빛테크는 2018년 설립." }] },
    { id: "b0005", type: "paragraph", runs: [{ text: "현재 350개 고객사 보유." }] },
    { id: "s0002", type: "separator", kind: "page" },
    { id: "b0006", type: "heading", level: 2, runs: [{ text: "주요 사업" }] },
    { id: "b0007", type: "paragraph", runs: [{ text: "5개 주요 사업 영역." }] },
  ],
  sections: [
    { id: "sec1", fromBlockId: "b0001", toBlockId: "b0002", kind: "cover-like", label: "표지", summary: "" },
    { id: "sec2", fromBlockId: "b0003", toBlockId: "b0005", kind: "narrative-like", label: "회사 개요", summary: "" },
    { id: "sec3", fromBlockId: "b0006", toBlockId: "b0007", kind: "narrative-like", label: "주요 사업", summary: "" },
  ],
};

const PATTERNS = getPatternsForVocabulary(DEFAULT_TOKENS.gridVocabulary!);

// ─────────────────────────────────────────────────────────────
// callTool 주입 헬퍼
// ─────────────────────────────────────────────────────────────

function makeCallToolMock(
  response: LlmBookOutput,
): (input: CallToolInput) => Promise<CallToolOutput> {
  return async (_input: CallToolInput) => ({
    toolInput: response,
    model: "gemini-2.5-pro-mock",
    inputTokens: 5000,
    outputTokens: 800,
    rawCostUsd: 0.0143,
    stopReason: "stop",
  });
}

const baseInput: PaginateInput = {
  manuscript: TEST_MANUSCRIPT,
  designTokens: DEFAULT_TOKENS,
  patterns: PATTERNS,
  format: A4_FORMAT,
  artifactType: "bound",
};

function ok(label: string) {
  console.log(`  OK  ${label}`);
}
function fail(label: string, message: string): never {
  throw new Error(`FAIL: ${label} — ${message}`);
}

// ─────────────────────────────────────────────────────────────
// Test 1
// ─────────────────────────────────────────────────────────────

console.log("Test 1: 입력 검증");
{
  // INPUT_INVALID
  try {
    await paginateBook({ ...baseInput, manuscript: { ...TEST_MANUSCRIPT, blocks: [] } });
    fail("INPUT_INVALID", "throw 안 함");
  } catch (e) {
    if (!(e instanceof PaginateError) || e.code !== "INPUT_INVALID")
      fail("INPUT_INVALID", `got ${e}`);
    ok("빈 manuscript → INPUT_INVALID");
  }

  // VOCABULARY_EMPTY
  try {
    await paginateBook({
      ...baseInput,
      designTokens: { ...DEFAULT_TOKENS, gridVocabulary: [] },
    });
    fail("VOCABULARY_EMPTY", "throw 안 함");
  } catch (e) {
    if (!(e instanceof PaginateError) || e.code !== "VOCABULARY_EMPTY")
      fail("VOCABULARY_EMPTY", `got ${e}`);
    ok("빈 어휘 → VOCABULARY_EMPTY");
  }

  // PATTERN_LIST_EMPTY
  try {
    await paginateBook({ ...baseInput, patterns: [] });
    fail("PATTERN_LIST_EMPTY", "throw 안 함");
  } catch (e) {
    if (!(e instanceof PaginateError) || e.code !== "PATTERN_LIST_EMPTY")
      fail("PATTERN_LIST_EMPTY", `got ${e}`);
    ok("빈 patterns → PATTERN_LIST_EMPTY");
  }
}

// ─────────────────────────────────────────────────────────────
// Test 2 — 행복 경로
// ─────────────────────────────────────────────────────────────

console.log("\nTest 2: 행복 경로 — 3페이지");
{
  const output = await paginateBook({
    ...baseInput,
    callTool: makeCallToolMock({
      pages: [
        {
          pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
          slotBlockRefs: { main: ["b0001", "b0002"] },
          splitReason: "page-separator", rationale: "표지",
        },
        {
          pageNumber: 2, pattern: "full-text", role: "body", side: "left",
          slotBlockRefs: { main: ["b0003", "b0004", "b0005"] },
          splitReason: "page-separator",
        },
        {
          pageNumber: 3, pattern: "full-text", role: "body", side: "right",
          slotBlockRefs: { main: ["b0006", "b0007"] },
          splitReason: "page-separator",
        },
      ],
    }),
  });

  if (output.pages.length !== 3) fail("page count", `got ${output.pages.length}`);
  ok(`pages.length = 3`);

  if (output.pages[0].side !== "right") fail("p1 side", `got ${output.pages[0].side}`);
  if (output.pages[1].side !== "left") fail("p2 side", `got ${output.pages[1].side}`);
  if (output.pages[2].side !== "right") fail("p3 side", `got ${output.pages[2].side}`);
  ok(`책자형 side: right / left / right`);

  const p1 = output.pages[0];
  const textFrame = p1.frames.find((f) => f.id === "p001-main");
  if (!textFrame || textFrame.type !== "text") fail("p1 frame", "main 텍스트 못 찾음");
  const content = (textFrame as { content: string | Array<{ text: string }> }).content;
  const flat = typeof content === "string" ? content : content.map((r) => r.text).join("");
  if (!flat.includes("한빛테크") || !flat.includes("2026 IR 자료")) {
    fail("p1 content", `flat = ${flat}`);
  }
  ok(`p1 main = "${flat.replace(/\n/g, "\\n")}"`);

  if (output.stylesPatch.paragraphStyles.length !== 1)
    fail("styles", `paragraphStyles.length = ${output.stylesPatch.paragraphStyles.length}`);
  ok(`styles 동기화 — paragraphStyles 1개`);

  if (output.llm.model !== "gemini-2.5-pro-mock") fail("llm.model", `${output.llm.model}`);
  ok(`llm 메타 보존 (model, tokens, cost)`);
}

// ─────────────────────────────────────────────────────────────
// Test 3
// ─────────────────────────────────────────────────────────────

console.log("\nTest 3: INVALID_PATTERN_SLUG");
{
  try {
    await paginateBook({
      ...baseInput,
      callTool: makeCallToolMock({
        pages: [
          {
            pageNumber: 1, pattern: "made-up-pattern", role: "body", side: "right",
            slotBlockRefs: {}, splitReason: "content-fit",
          },
        ],
      }),
    });
    fail("INVALID_PATTERN_SLUG", "통과해버림");
  } catch (e) {
    if (!(e instanceof PaginateError) || e.code !== "VALIDATION_FAILED")
      fail("INVALID_PATTERN_SLUG", `got ${e}`);
    if (!e.validation?.issues.some((i) => i.code === "INVALID_PATTERN_SLUG"))
      fail("INVALID_PATTERN_SLUG", `이슈 없음`);
    ok(`'made-up-pattern' → INVALID_PATTERN_SLUG → VALIDATION_FAILED`);
  }
}

// ─────────────────────────────────────────────────────────────
// Test 4
// ─────────────────────────────────────────────────────────────

console.log("\nTest 4: BLOCK_ORPHANED — §1 약속 강제");
{
  try {
    await paginateBook({
      ...baseInput,
      callTool: makeCallToolMock({
        pages: [
          {
            pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
            slotBlockRefs: { main: ["b0001", "b0002"] },
            splitReason: "page-separator",
          },
          {
            pageNumber: 2, pattern: "full-text", role: "body", side: "left",
            slotBlockRefs: { main: ["b0003", "b0004", "b0005"] },
            splitReason: "page-separator",
          },
          {
            pageNumber: 3, pattern: "full-text", role: "body", side: "right",
            slotBlockRefs: { main: ["b0006"] }, // b0007 누락
            splitReason: "page-separator",
          },
        ],
      }),
    });
    fail("BLOCK_ORPHANED", "통과해버림");
  } catch (e) {
    if (!(e instanceof PaginateError) || e.code !== "VALIDATION_FAILED")
      fail("BLOCK_ORPHANED", `got ${e}`);
    const o = e.validation?.issues.find((i) => i.code === "BLOCK_ORPHANED" && i.blockId === "b0007");
    if (!o) fail("BLOCK_ORPHANED", `b0007 이슈 없음`);
    ok(`b0007 침묵 누락 → BLOCK_ORPHANED → VALIDATION_FAILED`);
  }
}

// ─────────────────────────────────────────────────────────────
// Test 5
// ─────────────────────────────────────────────────────────────

console.log("\nTest 5: intentionalOmissions 명시 → 통과");
{
  const output = await paginateBook({
    ...baseInput,
    callTool: makeCallToolMock({
      pages: [
        {
          pageNumber: 1, pattern: "full-text", role: "cover", side: "right",
          slotBlockRefs: { main: ["b0001", "b0002"] },
          splitReason: "page-separator",
        },
        {
          pageNumber: 2, pattern: "full-text", role: "body", side: "left",
          slotBlockRefs: { main: ["b0003", "b0004", "b0005"] },
          splitReason: "page-separator",
        },
        {
          pageNumber: 3, pattern: "full-text", role: "body", side: "right",
          slotBlockRefs: { main: ["b0006"] },
          splitReason: "page-separator",
        },
      ],
      intentionalOmissions: [{ blockIds: ["b0007"], reason: "본 자료에서 제외" }],
    }),
  });

  if (output.pages.length !== 3) fail("page count", `got ${output.pages.length}`);
  ok(`intentionalOmissions 명시 → 검증 통과 (3페이지 빌드)`);
}

console.log("\n전체 5개 테스트 모두 통과.");
