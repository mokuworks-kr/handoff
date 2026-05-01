/**
 * 페이지네이션 진입점 (M3b-2-c).
 *
 * ─────────────────────────────────────────────────────────────
 * 책임 분리 (types.ts 정책 박제)
 * ─────────────────────────────────────────────────────────────
 *
 * 이 함수는 DB 안 건드림.
 * 호출자(/api/paginate 라우트, M3b-2-e) 가:
 *   1. paginateBook() 호출
 *   2. 결과 받아 Document.pages = pages, Document.styles = stylesPatch
 *   3. projects 테이블 update
 *   4. 크레딧 차감 (output.llm 정보로)
 *
 * §15.3 (분류 라우트) 패턴과 동일한 책임 분리.
 *
 * ─────────────────────────────────────────────────────────────
 * 호출 흐름
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 입력 검증 — INPUT_INVALID / VOCABULARY_EMPTY / PATTERN_LIST_EMPTY
 * 2. user message 구성 (§16.5 동적 주입 — 시스템 프롬프트는 메타만)
 * 3. callTool() — gemini-2.5-pro thinking, submit_book_pagination tool 강제
 * 4. LLM 출력 파싱 → LlmBookOutput
 * 5. 검증 (M3b-2-d 의 validateLlmOutput) — error 있으면 VALIDATION_FAILED
 * 6. 변환: LlmPageOutput → ResolvedPageBlueprint
 *    - 블록 ID 리스트 → 슬롯 종류별 콘텐츠 추출 (§1 약속 강제: LLM 텍스트 직접 출력 X)
 * 7. realize() 호출해 Frame[] 생성
 * 8. Page 빌드 + side 정합성 강제 (책자형이면 코드가 자동 산출)
 * 9. Document.styles 카탈로그 동기화 (DesignTokens.print → styles)
 * 10. PaginateOutput 반환
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정 (앞 대화 7개)
 * ─────────────────────────────────────────────────────────────
 *
 * 1. 호출 1번에 책 전체 — 이 함수가 callTool 1회 호출
 * 2. 슬롯 콘텐츠 = 블록 ID 참조 — 이 함수가 ID → 콘텐츠 변환 (§1 약속)
 * 3. 페이지 분할: SeparatorBlock 1순위 → 콘텐츠 양 → M3c — LLM 이 결정, 검증이 메타 정합성만
 * 4. 검증 5종 — M3b-2-d 함수 활용
 * 5. 모델 gemini-2.5-pro thinking 강제 — 호출 시 박힘
 * 6. /api/paginate 본체 + lab 은 M3b-3 — 이 함수가 라우트의 핵심 의존성
 * 7. 저장 책임 분리 — 이 함수는 PaginateOutput 만 반환
 */

import type { Frame, TextRun } from "@/lib/types/frames";
import type {
  CompositionPattern,
  ContentSlot,
  PageBlueprint,
} from "@/lib/layout/composition";
import { realize } from "@/lib/layout/grid";
import { findPatternBySlug } from "@/lib/layout/patterns";
import { callTool, LlmCallError } from "@/lib/llm";
import { blocksInSection } from "@/lib/classify/types";
import type {
  Block,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  TableBlock,
  TextRun as ManuscriptTextRun,
} from "@/lib/parsers/normalized";
import type { Page } from "@/lib/types/document";

import { PAGINATE_SYSTEM_PROMPT } from "./prompt";
import { TOOL_SCHEMA } from "./tool-schema";
import { validateLlmOutput } from "./validate";
import {
  PaginateError,
  type LlmBookOutput,
  type LlmPageOutput,
  type PaginateInput,
  type PaginateOutput,
  type ResolvedPageBlueprint,
} from "./types";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

// 1차 검증 단계 모델 정책 (M3b-3 박힘):
//   gemini-2.5-flash. 어댑터(lib/llm/providers/gemini.ts)의 화이트리스트가 자동으로
//   thinkingBudget=0 을 박아 thinking 비활성. 비용·속도 모두 pro 대비 큰 폭 개선.
//
// 왜 flash 인가 (시점 결정 박제):
//   1) Vercel Hobby 플랜 60초 함수 한도. pro thinking + retry 합치면 timeout 위험.
//   2) P7 에서 어휘를 [12] 단일 슬롯으로 좁힘 — thinking 없이도 충분한 결정.
//   3) Gemini 503 OVERLOADED 발생률이 pro 대비 낮아 retry 후 통과 확률 높음.
//
// 추후 다중 슬롯 어휘 부활 시 (M2 본격 디자인 작업)
//   - thinking 이 필요해지면 어댑터에 keepThinking 옵션 추가 후 flash + thinking 재활성, 또는
//   - Vercel Pro 플랜 전환 후 pro 모델 복귀, 또는
//   - LLM_PROVIDER=anthropic 으로 갈아타기 (Anthropic 결제 해결 후).
const MODEL_PAGINATE = "gemini-2.5-flash";
const MAX_OUTPUT_TOKENS = 32000; // 시드 30~40페이지 기준 충분 (page 당 ~500토큰 ×40 = 20K)

export async function paginateBook(input: PaginateInput): Promise<PaginateOutput> {
  // ── 1. 입력 검증 ────────────────────────────────────────────
  validateInput(input);

  // ── 2. user message 구성 (§16.5 동적 주입) ─────────────────
  const userMessage = buildUserMessage(input);

  // ── 3. LLM 호출 ─────────────────────────────────────────────
  //
  // callTool 진짜 시그니처 (lib/llm/types.ts 참조):
  //   { provider?, model?, system, messages, tool, maxTokens, forceToolUse?, callerLabel? }
  //
  // - provider 미지정 → 환경변수 LLM_PROVIDER (기본 anthropic 또는 gemini)
  // - model 미지정 → 어댑터의 기본 모델
  //   페이지네이션은 1차 검증 단계에서 flash 명시 (위 정책 메모 참조).
  //   어댑터가 flash 모델은 자동으로 thinking 비활성 처리.
  // - forceToolUse: true (분류기와 동일, 자유 텍스트 응답 안 받음)
  // - idempotencyKey: lib/llm 미지원. 라우트의 크레딧 차감 멱등성에서만 사용.
  const callToolFn = input.callTool ?? callTool;
  let toolOutput;
  try {
    toolOutput = await callToolFn<LlmBookOutput>({
      provider: input.provider,
      model: MODEL_PAGINATE,
      system: PAGINATE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      tool: {
        name: TOOL_SCHEMA.name,
        description: TOOL_SCHEMA.description,
        input_schema: TOOL_SCHEMA.parameters,
      },
      maxTokens: MAX_OUTPUT_TOKENS,
      // Vercel Hobby 60초 함수 한도 안전 마진. 어댑터 기본 3 (총 4시도, backoff 합 ~20초)
      // 은 LLM 본 호출 시간과 합쳐 timeout 위험. 1로 줄여 총 2시도, backoff ~500ms.
      // 503 등 일시적 장애 시 사용자가 다시 누르는 흐름으로.
      maxRetries: 1,
      forceToolUse: true,
      callerLabel: input.callerLabel ?? "paginate-book",
    });
  } catch (e: unknown) {
    if (e instanceof LlmCallError) {
      throw new PaginateError("LLM_FAILED", `LLM 호출 실패: ${e.message}`, {
        cause: e,
      });
    }
    throw new PaginateError("LLM_FAILED", "LLM 호출 중 알 수 없는 오류", {
      cause: e,
    });
  }

  // ── 4. LLM 출력 파싱 ─────────────────────────────────────────
  const llmBook = parseLlmOutput(toolOutput.output);

  // ── 4.5 sectionIds → slotBlockRefs 자동 매핑 (M3b-3 P10) ────
  // LLM 은 sectionIds 만 박음. 코드가 그것을 풀어 슬롯에 박음.
  // expandSectionIdsToSlots() 가 in-place 로 page.slotBlockRefs 채움.
  // 검증·UI 흐름은 변경 없음 — 같은 형태로 채워지므로.
  try {
    expandSectionIdsToSlots(llmBook, input.manuscript, input.patterns);
  } catch (e) {
    // 자동 매핑 자체에서 throw 된 경우 (예: 다중 슬롯 콤포지션)
    if (e instanceof PaginateError) throw e;
    throw new PaginateError(
      "REALIZE_FAILED",
      `sectionIds 자동 매핑 실패: ${e instanceof Error ? e.message : "unknown"}`,
      { cause: e },
    );
  }

  // 진단 로그 — 페이지 수 + 첫 페이지의 sectionIds + 자동 매핑된 slotBlockRefs 형태.
  // 검증 통과·실패 무관. 비용 0.
  console.log(
    `[paginate] LLM 출력: pages=${llmBook.pages.length}, ` +
      `p1.sectionIds=[${(llmBook.pages[0]?.sectionIds ?? []).join(",")}], ` +
      `p1.slotBlockCounts=${JSON.stringify(
        Object.fromEntries(
          Object.entries(llmBook.pages[0]?.slotBlockRefs ?? {}).map(([k, v]) => [
            k,
            (v as string[]).length,
          ]),
        ),
      )}`,
  );

  // ── 5. 검증 ──────────────────────────────────────────────────
  const validation = validateLlmOutput({
    book: llmBook,
    manuscript: input.manuscript,
    patterns: input.patterns,
    designTokens: input.designTokens,
  });

  if (validation.hasError) {
    const errorCount = validation.issues.filter((i) => i.severity === "error").length;
    console.error(
      `[paginate] 검증 실패: error=${errorCount}, codes=${[
        ...new Set(
          validation.issues.filter((i) => i.severity === "error").map((i) => i.code),
        ),
      ].join(",")}`,
    );
    throw new PaginateError(
      "VALIDATION_FAILED",
      `페이지네이션 검증 실패: error ${errorCount}건`,
      { validation, llmRaw: llmBook },
    );
  }

  // ── 6. 변환: LlmPageOutput → ResolvedPageBlueprint ─────────
  const resolved = resolveBlueprints(llmBook.pages, input);

  // ── 7~8. realize() + Page 빌드 ──────────────────────────────
  const pages = buildPages(resolved, input);

  // ── 9. styles 동기화 ─────────────────────────────────────────
  const stylesPatch = syncStylesFromDesignTokens(input.designTokens);

  // ── 10. 반환 ─────────────────────────────────────────────────
  return {
    pages,
    stylesPatch,
    llm: {
      model: toolOutput.model,
      inputTokens: toolOutput.usage.inputTokens,
      outputTokens: toolOutput.usage.outputTokens,
      cacheReadTokens: toolOutput.usage.cacheReadTokens,
      rawCostUsd: toolOutput.rawCostUsd,
      stopReason: toolOutput.stopReason,
    },
    // lab/디버그용 — 검증 통과한 LLM raw 출력. 본 라우트는 무시.
    // rationale, slotBlockRefs, splitReason 등 LLM 의도 메타 보존.
    llmRaw: llmBook,
    validation,
  };
}

// ─────────────────────────────────────────────────────────────
// 1단계 — 입력 검증
// ─────────────────────────────────────────────────────────────

function validateInput(input: PaginateInput): void {
  if (!input.manuscript || input.manuscript.blocks.length === 0) {
    throw new PaginateError(
      "INPUT_INVALID",
      "매니스크립트가 비어있습니다 (blocks.length === 0)",
    );
  }

  const vocabulary = input.designTokens.gridVocabulary;
  if (!vocabulary || vocabulary.length === 0) {
    throw new PaginateError(
      "VOCABULARY_EMPTY",
      "designTokens.gridVocabulary 가 비어있습니다",
    );
  }

  if (!input.patterns || input.patterns.length === 0) {
    throw new PaginateError(
      "PATTERN_LIST_EMPTY",
      "입력 patterns 가 비어있습니다 (어휘에 매칭되는 콤포지션 0개일 가능성)",
    );
  }
}

// ─────────────────────────────────────────────────────────────
// 자동 매핑 — sectionIds → slotBlockRefs (M3b-3 P10)
// ─────────────────────────────────────────────────────────────

/**
 * LLM 출력의 각 페이지에 대해 sectionIds 를 해석하고 slotBlockRefs 를 자동으로 채움.
 *
 * 비유: LLM 은 "1페이지=표지섹션, 2페이지=PEG섹션..." 큰 그림만 결정.
 * 이 함수가 "표지섹션의 어느 블록을 어느 슬롯에 박을지" 를 자동 처리.
 *
 * 처리 순서:
 *   1) 각 페이지의 sectionIds 의 각 섹션에서 블록들을 순서대로 모음 (blocksInSection)
 *   2) separator 블록 자동 제외
 *   3) 콤포지션 슬롯 종류 보고 분배:
 *      - **단일 슬롯** (full-text, full-image): 슬롯 종류에 맞는 모든 블록 + (text 슬롯이면)
 *        호환 안 되는 블록도 모두 수용 (1차 정책 — 누락 회피).
 *      - **다중 슬롯** (halves-text-text, halves-text-image — M3b-5 1단계 부활):
 *        블록을 종류별로 분류한 뒤 슬롯 종류별 슬롯에 분배.
 *        text 블록은 text 슬롯에 *순서대로 균등 분할* (블록 개수 기준).
 *        image/table 블록은 1개씩 슬롯에 박음 (image/table 슬롯은 1개 블록 규칙).
 *        호환 안 되는 블록(예: text-text 콤포지션인데 image 블록 있음)은
 *        첫 text 슬롯에 박음 — 누락 회피 (M3b-3 P11 정책 유지, 다중 슬롯에도 적용).
 *
 * 부작용 (mutates):
 *   - 입력 page 객체의 slotBlockRefs / hiddenSlotIds 를 박음.
 *   - LlmBookOutput 자체 구조는 변경 없음 (검증·UI 흐름 그대로).
 *
 * 에러:
 *   - sectionIds 안에 manuscript.sections 에 없는 ID 있으면 throw (검증에서 잡혀야 할 조기 차단).
 *   - 슬롯 종류가 모르는 종류(chart/shape — 1차 미지원) 면 빈 슬롯으로 두고 검증에서 잡힘.
 */
function expandSectionIdsToSlots(
  book: LlmBookOutput,
  manuscript: PaginateInput["manuscript"],
  patterns: readonly CompositionPattern[],
): void {
  const sectionMap = new Map(manuscript.sections.map((s) => [s.id, s]));
  const patternMap = new Map(patterns.map((p) => [p.slug, p]));

  for (const page of book.pages) {
    const pattern = patternMap.get(page.pattern);
    if (!pattern) {
      // 검증에서 PATTERN_NOT_FOUND 로 잡힘 — 여기서는 그냥 빈 매핑 박고 넘어감
      page.slotBlockRefs = {};
      continue;
    }

    // sectionIds 에 박힌 ID 들의 블록을 순서대로 모음
    const collectedBlocks: Block[] = [];
    for (const sectionId of page.sectionIds ?? []) {
      const section = sectionMap.get(sectionId);
      if (!section) {
        // 검증에서 잡힘 — 빈 매핑 그대로
        continue;
      }
      const sectionBlocks = blocksInSection(manuscript.blocks, section);
      // separator 자동 제외
      for (const b of sectionBlocks) {
        if (b.type !== "separator") collectedBlocks.push(b);
      }
    }

    // 슬롯 분배 — 단일 vs 다중 분기 (M3b-5 1단계: 다중 부활)
    const { slotBlockRefs, hiddenSlotIds } = distributeBlocksToSlots(
      pattern,
      collectedBlocks,
    );
    page.slotBlockRefs = slotBlockRefs;
    if (hiddenSlotIds.length > 0) {
      page.hiddenSlotIds = hiddenSlotIds;
    }
  }
}

/**
 * 콤포지션의 슬롯들에 블록들을 분배.
 *
 * @returns { slotBlockRefs, hiddenSlotIds }
 *   - slotBlockRefs: { [slotId]: blockId[] } — 빈 매핑 슬롯은 포함 안 함 (optional 슬롯이면 hidden)
 *   - hiddenSlotIds: optional 인데 매핑 블록 0개인 슬롯 ID 목록
 */
function distributeBlocksToSlots(
  pattern: CompositionPattern,
  collectedBlocks: Block[],
): { slotBlockRefs: Record<string, string[]>; hiddenSlotIds: string[] } {
  const slotBlockRefs: Record<string, string[]> = {};
  const hiddenSlotIds: string[] = [];

  // 슬롯 종류별 분류 — 정의된 순서 보존 (배치 위치 순서)
  const textSlots = pattern.slots.filter((s) => s.kind === "text");
  const imageSlots = pattern.slots.filter((s) => s.kind === "image");
  const tableSlots = pattern.slots.filter((s) => s.kind === "table");

  // 블록 종류별 분류 — 수집 순서 보존
  const textBlocks: Block[] = [];
  const imageBlocks: Block[] = [];
  const tableBlocks: Block[] = [];
  const otherBlocks: Block[] = []; // chart/shape 등 1차 미지원 종류

  for (const b of collectedBlocks) {
    if (b.type === "heading" || b.type === "paragraph" || b.type === "list") {
      textBlocks.push(b);
    } else if (b.type === "image") {
      imageBlocks.push(b);
    } else if (b.type === "table") {
      tableBlocks.push(b);
    } else {
      otherBlocks.push(b);
    }
  }

  // 1) text 블록 → text 슬롯 균등 분할
  // 블록 개수 기준으로 순서대로 자름. 슬롯 1개면 다, 2개면 절반씩, n개면 1/n 씩.
  // 잔여 블록(나누어 떨어지지 않을 때)은 마지막 슬롯에 몰아넣음.
  // 균등 분할 후 호환 안 되는 블록(image/table 슬롯 부족)은 첫 text 슬롯에 추가로 박음 — 누락 회피.
  const textChunks = chunkEvenly(textBlocks, textSlots.length);
  textSlots.forEach((slot, idx) => {
    slotBlockRefs[slot.id] = textChunks[idx]?.map((b) => b.id) ?? [];
  });

  // 2) image 블록 → image 슬롯 1:1 (image 슬롯은 1개 블록 규칙)
  // image 슬롯 < image 블록 수: 남는 이미지는 첫 text 슬롯에 박음 (누락 회피, 1차 정책)
  const imageOverflow: Block[] = [];
  imageSlots.forEach((slot, idx) => {
    const block = imageBlocks[idx];
    slotBlockRefs[slot.id] = block ? [block.id] : [];
  });
  for (let i = imageSlots.length; i < imageBlocks.length; i++) {
    imageOverflow.push(imageBlocks[i]);
  }

  // 3) table 블록 → table 슬롯 1:1 (동일 규칙)
  const tableOverflow: Block[] = [];
  tableSlots.forEach((slot, idx) => {
    const block = tableBlocks[idx];
    slotBlockRefs[slot.id] = block ? [block.id] : [];
  });
  for (let i = tableSlots.length; i < tableBlocks.length; i++) {
    tableOverflow.push(tableBlocks[i]);
  }

  // 4) 호환 안 되는 블록 처리 — 누락 회피 정책 (M3b-3 P11 → M3b-5 1단계 유지)
  //    image 슬롯 없는데 image 블록 있음, table 슬롯 없는데 table 블록 있음, chart/shape 등.
  //    모두 첫 text 슬롯에 박음. text 슬롯도 없는 케이스(예: full-image)는 누락 OK
  //    (BLOCK_ORPHANED 검증에서 잡혀 사용자에게 retry 안내).
  const overflowAll: Block[] = [
    ...(imageSlots.length === 0 ? imageBlocks : imageOverflow),
    ...(tableSlots.length === 0 ? tableBlocks : tableOverflow),
    ...otherBlocks,
  ];
  if (overflowAll.length > 0 && textSlots.length > 0) {
    const firstTextSlot = textSlots[0];
    const existing = slotBlockRefs[firstTextSlot.id] ?? [];
    slotBlockRefs[firstTextSlot.id] = [
      ...existing,
      ...overflowAll.map((b) => b.id),
    ];
  }

  // 5) 빈 슬롯 정리 — optional 인 빈 슬롯은 hiddenSlotIds 로, 키는 제거
  for (const slot of pattern.slots) {
    const blockIds = slotBlockRefs[slot.id] ?? [];
    if (blockIds.length === 0) {
      if (slot.optional) {
        hiddenSlotIds.push(slot.id);
        delete slotBlockRefs[slot.id];
      } else {
        // 필수 슬롯인데 박을 블록이 없음 — 검증에서 SLOT_MISMATCH 로 잡힘
        // (예: halves-text-image 인데 image 블록 0개. retry 가 다른 콤포지션 선택 유도)
        // 빈 배열을 그대로 유지해 검증이 정확히 잡도록.
        slotBlockRefs[slot.id] = [];
      }
    }
  }

  return { slotBlockRefs, hiddenSlotIds };
}

/**
 * 배열을 n 개의 청크로 균등 분할 — 순서 보존.
 *
 * 잔여 항목은 마지막 청크에 몰아넣음.
 *   chunkEvenly([a,b,c,d], 2) → [[a,b], [c,d]]
 *   chunkEvenly([a,b,c,d,e], 2) → [[a,b], [c,d,e]]
 *   chunkEvenly([a,b,c], 2) → [[a], [b,c]]
 *   chunkEvenly([a], 2) → [[a], []]
 *   chunkEvenly([], 2) → [[], []]
 *   chunkEvenly([a,b,c], 0) → []  (n=0 가드)
 *   chunkEvenly([a,b,c], 1) → [[a,b,c]]
 */
function chunkEvenly<T>(items: T[], n: number): T[][] {
  if (n <= 0) return [];
  if (n === 1) return [items];
  const chunks: T[][] = [];
  const baseSize = Math.floor(items.length / n);
  for (let i = 0; i < n; i++) {
    const start = i * baseSize;
    // 마지막 청크: 남은 거 다 가져감
    const end = i === n - 1 ? items.length : start + baseSize;
    chunks.push(items.slice(start, end));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────
// 2단계 — user message 구성 (§16.5 동적 주입)
// ─────────────────────────────────────────────────────────────

/**
 * user message 에 designTokens · patterns · manuscript 를 모두 주입.
 *
 * §16.5 정책: 시스템 프롬프트는 메타 가이드만, 구체 데이터는 user message.
 * 디자인 100개 / 책 100가지 시나리오에서도 시스템 프롬프트 변경 0.
 *
 * 형태는 분류기 패턴 따라 한국어 헤더 + JSON 블록.
 */
function buildUserMessage(input: PaginateInput): string {
  const tokensSection = `# 디자인 토큰 (designTokens)

\`\`\`json
${JSON.stringify(slimDesignTokens(input.designTokens), null, 2)}
\`\`\``;

  const patternsSection = `# 콤포지션 카탈로그 (patterns)

이 책의 어휘에 매칭되는 콤포지션 ${input.patterns.length}개. 이 안의 slug 만 사용 가능.

\`\`\`json
${JSON.stringify(slimPatterns(input.patterns), null, 2)}
\`\`\``;

  const manuscriptSection = `# 분류된 원고 (manuscript)

블록은 평탄한 시퀀스. 각 블록의 ID 를 슬롯 매핑에 사용. SeparatorBlock 의 위치를 페이지 분할 1순위 신호로 활용.

\`\`\`json
${JSON.stringify(slimManuscript(input.manuscript), null, 2)}
\`\`\``;

  const formatSection = `# 페이지 판형 (format)

\`\`\`json
${JSON.stringify(input.format, null, 2)}
\`\`\`

artifactType: "${input.artifactType}"`;

  return [tokensSection, patternsSection, manuscriptSection, formatSection].join(
    "\n\n",
  );
}

/**
 * designTokens 슬림화 — LLM 에 필요한 필드만.
 * print.* 의 거대한 paragraphStyles 등은 LLM 결정에 불필요해 제외 (토큰 절약).
 */
function slimDesignTokens(tokens: PaginateInput["designTokens"]) {
  return {
    slug: tokens.slug,
    name: tokens.name,
    description: tokens.description,
    palette: tokens.palette,
    typography: tokens.typography,
    gridVocabulary: tokens.gridVocabulary,
    rhythmGuide: tokens.rhythmGuide,
  };
}

/**
 * patterns 슬림화 — LLM 결정에 필요한 필드만.
 */
function slimPatterns(patterns: readonly CompositionPattern[]) {
  return patterns.map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    role: p.role,
    slots: p.slots.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      optional: s.optional ?? false,
    })),
    variants: p.variants?.map((v) => ({
      id: v.id,
      label: v.label,
      options: v.options.map((o) => ({ value: o.value, label: o.label })),
    })),
  }));
}

/**
 * manuscript 슬림화 — LLM 에 블록 ID + 종류 + 핵심 콘텐츠만.
 *
 * runs 의 굵기·기울기 같은 미세 메타는 LLM 결정에 불필요하므로 텍스트만 평탄화.
 * 파서가 채운 sourceLocation 도 제외 (디버깅용 메타).
 *
 * §1 약속 정신 부합: LLM 에 텍스트 자체를 보여주되 그것을 어디에 배치할지(블록 ID 참조)만 결정.
 */
function slimManuscript(manuscript: PaginateInput["manuscript"]) {
  return {
    source: manuscript.source,
    sections: manuscript.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      summary: s.summary,
      fromBlockId: s.fromBlockId,
      toBlockId: s.toBlockId,
    })),
    blocks: manuscript.blocks.map((b) => slimBlock(b)),
  };
}

function slimBlock(b: Block): Record<string, unknown> {
  switch (b.type) {
    case "heading":
      return {
        id: b.id,
        type: b.type,
        level: b.level,
        text: flattenRuns(b.runs),
      };
    case "paragraph":
      return { id: b.id, type: b.type, text: flattenRuns(b.runs) };
    case "list":
      return {
        id: b.id,
        type: b.type,
        ordered: b.ordered,
        items: b.items.map((it) => ({
          level: it.level,
          text: flattenRuns(it.runs),
        })),
      };
    case "table":
      return {
        id: b.id,
        type: b.type,
        rows: b.rows,
        cols: b.cols,
        cells: b.cells, // 작아서 그대로
        headerRows: b.headerRows,
      };
    case "image":
      return {
        id: b.id,
        type: b.type,
        alt: b.alt,
        caption: b.caption,
        // originalSrc 는 long URL 일 수 있어 제외 — 변환 단계에서 코드가 사용
      };
    case "separator":
      return { id: b.id, type: b.type, kind: b.kind };
  }
}

function flattenRuns(runs: ManuscriptTextRun[]): string {
  return runs.map((r) => r.text).join("");
}

// ─────────────────────────────────────────────────────────────
// 4단계 — LLM 출력 파싱
// ─────────────────────────────────────────────────────────────

/**
 * tool input 을 LlmBookOutput 으로 캐스팅.
 *
 * tool schema 통과한 객체이므로 형태는 보장되지만 런타임 안전을 위해 핵심 필드만 검증.
 * 정밀 검증은 다음 단계 validateLlmOutput() 가 수행.
 */
function parseLlmOutput(toolInput: unknown): LlmBookOutput {
  if (!toolInput || typeof toolInput !== "object") {
    throw new PaginateError(
      "LLM_FAILED",
      "LLM tool input 이 객체가 아닙니다",
    );
  }
  const obj = toolInput as { pages?: unknown; intentionalOmissions?: unknown };

  if (!Array.isArray(obj.pages)) {
    throw new PaginateError(
      "LLM_FAILED",
      "LLM tool input 에 pages 배열이 없습니다",
    );
  }

  // sectionIds / slotBlockRefs 안전성 — LLM 이 sectionIds 박았어도 spectator 가 보면
  // slotBlockRefs 가 undefined 일 수 있음 (스키마에서 LLM 이 박지 않으므로).
  // 빈 객체로 초기화 — expandSectionIdsToSlots 가 곧 채움.
  const pages = (obj.pages as Array<Record<string, unknown>>).map((p) => ({
    ...p,
    sectionIds: Array.isArray(p.sectionIds) ? p.sectionIds : [],
    slotBlockRefs:
      typeof p.slotBlockRefs === "object" && p.slotBlockRefs !== null
        ? (p.slotBlockRefs as Record<string, string[]>)
        : {},
  })) as LlmPageOutput[];

  return {
    pages,
    intentionalOmissions:
      (obj.intentionalOmissions as LlmBookOutput["intentionalOmissions"]) ??
      undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// 6단계 — 변환: LlmPageOutput → ResolvedPageBlueprint
// ─────────────────────────────────────────────────────────────

/**
 * 블록 ID 참조를 실제 콘텐츠로 변환.
 *
 * 핵심 — §1 약속 강제 메커니즘:
 *   LLM 은 절대 텍스트를 직접 출력하지 않음. ID 만 줌.
 *   이 함수가 ID → 원고 블록 → 콘텐츠 의 변환을 코드로 처리.
 *   → 사용자 원고가 변형될 자리가 시스템에 없음.
 *
 * 슬롯 종류별 변환:
 *   - text 슬롯 : blockIds → heading/paragraph/list 블록 → TextRun[] (스타일 보존)
 *   - image 슬롯: blockId 1개 → image 블록 → src/alt
 *   - table 슬롯: blockId 1개 → table 블록 → cells
 *   - chart 슬롯: 1차 미지원 (분류된 매니스크립트에 chart 블록 없음)
 *   - shape 슬롯: 콘텐츠 없음 (장식)
 */
function resolveBlueprints(
  llmPages: LlmPageOutput[],
  input: PaginateInput,
): ResolvedPageBlueprint[] {
  const blockMap = new Map<string, Block>();
  for (const b of input.manuscript.blocks) {
    blockMap.set(b.id, b);
  }

  return llmPages.map((page) => {
    const pattern = findPatternBySlug(page.pattern);
    if (!pattern) {
      // 검증 통과 후이므로 도달 불가, 방어적
      throw new PaginateError(
        "REALIZE_FAILED",
        `검증 후에도 패턴 슬러그 ${page.pattern} 을 카탈로그에서 못 찾음`,
      );
    }

    const content: Record<string, unknown> = {};
    for (const slot of pattern.slots) {
      const blockIds = page.slotBlockRefs[slot.id] ?? [];
      const isHidden = page.hiddenSlotIds?.includes(slot.id) ?? false;
      if (isHidden) continue; // optional 슬롯 의도된 비움

      content[slot.id] = resolveSlotContent(slot, blockIds, blockMap);
    }

    const blueprint: PageBlueprint = {
      pattern: page.pattern,
      content,
      ...(page.variants ? { variants: page.variants } : {}),
      ...(page.hiddenSlotIds ? { hiddenSlotIds: page.hiddenSlotIds } : {}),
    };

    return { source: page, blueprint, pattern };
  });
}

function resolveSlotContent(
  slot: ContentSlot,
  blockIds: string[],
  blockMap: Map<string, Block>,
): unknown {
  const blocks = blockIds
    .map((id) => blockMap.get(id))
    .filter((b): b is Block => b !== undefined);

  switch (slot.kind) {
    case "text": {
      // heading/paragraph/list 블록을 TextRun[] 으로 평탄화.
      // 1차 단순화: 각 블록을 \n 로 구분, runs 합침. heading 의 level 정보는
      // PageBlueprint.content 의 string 형태로는 유실되지만 paragraphStyleId 가
      // 슬롯에 박혀있어 grid.ts 가 처리. 향후 TextFrame 의 paragraphs[] 로 확장 가능.
      const runs: TextRun[] = [];
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        if (i > 0) runs.push({ text: "\n" });
        if (b.type === "heading" || b.type === "paragraph") {
          runs.push(...convertRuns(b.runs));
        } else if (b.type === "list") {
          for (let j = 0; j < b.items.length; j++) {
            if (j > 0) runs.push({ text: "\n" });
            const prefix = b.ordered ? `${j + 1}. ` : "• ";
            runs.push({ text: prefix }, ...convertRuns(b.items[j].runs));
          }
        }
        // 다른 종류(image/table/separator)가 들어오면 검증에서 SLOT_MISMATCH 가
        // 잡았어야 함. 도달했다면 무시 (방어적).
      }
      // grid.ts buildTextFrame 시그니처: string | { content }. TextRun[] 은 객체로 감싼다.
      return { content: runs };
    }
    case "image": {
      const b = blocks[0];
      if (!b || b.type !== "image") {
        // 검증에서 잡혔어야 함. 빈 콘텐츠 반환.
        return { src: "", alt: "" };
      }
      return {
        src: b.originalSrc ?? "",
        alt: b.alt,
        ...(b.caption ? { caption: b.caption } : {}),
      };
    }
    case "table": {
      const b = blocks[0];
      if (!b || b.type !== "table") {
        return { rows: 0, cols: 0, cells: [] };
      }
      return {
        rows: b.rows,
        cols: b.cols,
        cells: b.cells.map((row) => row.map((cellText) => ({ content: cellText }))),
        ...(b.headerRows ? { headerRows: b.headerRows } : {}),
      };
    }
    case "chart": {
      // 1차 미지원. 빈 차트 콘텐츠.
      return {
        chartType: "bar",
        data: [],
        config: { xKey: "x", yKeys: ["y"] },
      };
    }
    case "shape": {
      return {};
    }
  }
}

function convertRuns(runs: ManuscriptTextRun[]): TextRun[] {
  return runs.map((r) => {
    const override: { weight?: number; italic?: boolean } = {};
    if (r.bold) override.weight = 700;
    if (r.italic) override.italic = true;
    return {
      text: r.text,
      ...(Object.keys(override).length > 0 ? { override } : {}),
    };
  });
}

// ─────────────────────────────────────────────────────────────
// 7~8단계 — realize() + Page 빌드
// ─────────────────────────────────────────────────────────────

function buildPages(
  resolved: ResolvedPageBlueprint[],
  input: PaginateInput,
): Page[] {
  const pages: Page[] = [];

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];

    // side 자동 산출 (책자형) — 1쪽=right, 2쪽=left, 3쪽=right ...
    // artifactType "folded" 이거나 명시적 binding 없으면 LLM side 존중.
    const side = computeSide(i, input, r.source.side);

    const margins = resolveMargins(input, side);

    const realizeFormat = mapFormatForRealize(input.format, side);

    let frames: Frame[];
    try {
      frames = realize({
        blueprint: r.blueprint,
        pattern: r.pattern,
        format: realizeFormat,
        resolvedMargins: margins,
        side,
        framePrefix: `p${String(i + 1).padStart(3, "0")}-`,
      });
    } catch (e) {
      throw new PaginateError(
        "REALIZE_FAILED",
        `페이지 ${i + 1} (${r.pattern.slug}) realize 실패: ${(e as Error).message}`,
        { cause: e },
      );
    }

    pages.push({
      id: `p${String(i + 1).padStart(3, "0")}`,
      side,
      composition: r.pattern.slug,
      frames,
    });
  }

  return pages;
}

/**
 * 좌/우 페이지 산출.
 *
 * artifactType === "bound" 이면 표지/펼침면 규칙 강제:
 *   1쪽 = right (표지는 항상 우측 단독)
 *   2쪽 = left
 *   3쪽 = right
 *   ...
 *
 * artifactType === "folded" 이면 LLM side 존중 (접지 방식별 위치가 다양).
 *
 * LLM 의 side 의견과 코드 산출이 다르면 코드가 우선 (책자형 기본 규칙은 어길 수 없음).
 */
function computeSide(
  index: number,
  input: PaginateInput,
  llmSide: "left" | "right",
): "left" | "right" {
  if (input.artifactType === "bound") {
    return index % 2 === 0 ? "right" : "left";
  }
  return llmSide;
}

/**
 * 페이지 종류에 따른 마진 산출.
 *
 * format.margins 가 inside/outside (책자형 기준) 으로 박혀있으므로
 * 좌/우 페이지에 따라 left/right 값이 미러링됨.
 *
 * 좌측 페이지: inside 가 오른쪽, outside 가 왼쪽
 * 우측 페이지: inside 가 왼쪽, outside 가 오른쪽
 *
 * realize() 시그니처는 left/right 를 받으므로 변환.
 */
function resolveMargins(
  input: PaginateInput,
  side: "left" | "right",
): { top: number; right: number; bottom: number; left: number } {
  const m = input.format.margins;
  const top = m.top;
  const bottom = m.bottom;
  if (side === "right") {
    return { top, bottom, left: m.inside, right: m.outside };
  }
  return { top, bottom, left: m.outside, right: m.inside };
}

/**
 * Document.format → realize() 가 받는 단순 form 으로 변환.
 *
 * Document.format.bleed 는 책자형 미러링 표현(inside/outside).
 * realize() 는 페이지 1장 기준 left/right.
 *
 * 좌측 페이지: inside=오른쪽, outside=왼쪽
 * 우측 페이지: inside=왼쪽, outside=오른쪽
 */
function mapFormatForRealize(
  format: PaginateInput["format"],
  side: "left" | "right",
): {
  width: number;
  height: number;
  columns: number;
  gutter: number;
  bleed: { top: number; right: number; bottom: number; left: number };
} {
  const b = format.bleed;
  const bleed =
    side === "right"
      ? { top: b.top, bottom: b.bottom, left: b.inside, right: b.outside }
      : { top: b.top, bottom: b.bottom, left: b.outside, right: b.inside };
  return {
    width: format.width,
    height: format.height,
    columns: format.columns,
    gutter: format.gutter,
    bleed,
  };
}

// ─────────────────────────────────────────────────────────────
// 9단계 — Document.styles 동기화
// ─────────────────────────────────────────────────────────────

/**
 * DesignTokens.print.* 를 Document.styles 형태로 복사.
 *
 * 정책 §7-4:
 *   styles 는 새 프로젝트 1회 동기화. 사용자가 디자인 갈아끼우면 다시 동기화.
 *
 * 이 함수가 매 페이지네이션 호출마다 호출되므로 결과적으로 "디자인 갈아끼울 때마다 재동기화"
 * 가 자동 충족.
 */
function syncStylesFromDesignTokens(
  tokens: PaginateInput["designTokens"],
): PaginateOutput["stylesPatch"] {
  const print = tokens.print ?? {};
  return {
    paragraphStyles: print.paragraphStyles ?? [],
    characterStyles: print.characterStyles ?? [],
    fonts: print.fonts ?? [],
    colors: print.colors ?? [],
  };
}
