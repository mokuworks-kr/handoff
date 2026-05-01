/**
 * 페이지네이션 LLM 출력 검증 (M3b-2-d).
 *
 * ─────────────────────────────────────────────────────────────
 * 책임
 * ─────────────────────────────────────────────────────────────
 *
 * paginateBook() 의 LLM 출력(LlmBookOutput) 을 받아 §16.3 검증 5종 + 메타 검증 수행.
 * error severity 가 1개라도 있으면 paginateBook() 이 VALIDATION_FAILED 로 throw.
 *
 * 검증을 LLM 단계에서 잡는 이유 (realize() 까지 가지 않고):
 *   - realize() 에러 메시지는 사용자에게 불친절
 *   - LLM 출력 메타 디버깅이 더 풍부 (어떤 페이지·슬롯·블록인지)
 *   - 부분 실패 정보를 호출자(/api/paginate, M3c) 가 활용 가능
 *
 * ─────────────────────────────────────────────────────────────
 * 검증 항목 (§16.3 5종 + 메타)
 * ─────────────────────────────────────────────────────────────
 *
 * (b) 콤포지션 슬러그 카탈로그 실재  — INVALID_PATTERN_SLUG (error)
 * (b) 어휘 안의 콤포지션인지        — PATTERN_NOT_IN_VOCABULARY (error, §11 약속 1번)
 * (c) 슬롯 매핑이 패턴 정의와 일치   — SLOT_MISMATCH (error)
 *      - LLM 의 슬롯 ID 가 콤포지션 정의에 있는가
 *      - 슬롯 종류와 블록 종류가 맞는가 (text 슬롯에 image 블록 X)
 *      - 필수 슬롯 (optional=false) 이 비어있고 hiddenSlotIds 에도 없는가
 *      - hiddenSlotIds 와 slotBlockRefs 가 모순되지 않는가
 * (d) 프레임 겹침 — 1차 콤포지션은 안 겹치게 박혀서 실질 검증 불필요. 콤포지션 자체의
 *      assertRealizable() 이 build 시 이미 검증.
 * (e) 모든 블록 어딘가          — BLOCK_ORPHANED (error, §1 약속)
 * (e) 블록 중복                  — BLOCK_DUPLICATED (error)
 *      참조한 블록 ID 가 매니스크립트에 실재    — BLOCK_NOT_FOUND (error)
 *
 * 메타:
 *   - splitReason="page-separator" 정합성 — SPLIT_REASON_INCONSISTENT (warn)
 *   - pageNumber 순차                       — PAGE_NUMBER_GAP (warn)
 *   - variants 유효성                        — VARIANT_INVALID (error, realize() 가 던지므로 미리 잡음)
 *   - intentionalOmissions                   — INTENTIONAL_OMISSION (info, 통계용)
 *
 * ─────────────────────────────────────────────────────────────
 * severity 정책
 * ─────────────────────────────────────────────────────────────
 *
 * error: 페이지 빌드가 실패하거나 §1/§11 약속을 위반. paginateBook() throw.
 * warn:  빌드는 가능, 메타가 의심스러움. 디버깅 표시.
 * info:  통계용 (의도된 누락 등).
 */

import type { Block } from "@/lib/parsers/normalized";
import {
  isPatternSlugValid,
  isPatternInVocabulary,
  findPatternBySlug,
} from "@/lib/layout/patterns";
import type { CompositionPattern } from "@/lib/layout/composition";

import type {
  LlmBookOutput,
  LlmPageOutput,
  PaginateInput,
  ValidationIssue,
  ValidationResult,
} from "./types";

export type ValidateInput = {
  book: LlmBookOutput;
  manuscript: PaginateInput["manuscript"];
  patterns: PaginateInput["patterns"];
  designTokens: PaginateInput["designTokens"];
};

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export function validateLlmOutput(input: ValidateInput): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 블록 ID 인덱스 — 한 번 만들고 재사용
  const blockMap = new Map<string, Block>();
  for (const b of input.manuscript.blocks) {
    blockMap.set(b.id, b);
  }

  // 페이지별 검증 (슬러그 / 어휘 / 슬롯 / variants)
  for (const page of input.book.pages) {
    validatePage(page, input, blockMap, issues);
  }

  // 페이지 시퀀스 메타 검증 (pageNumber, splitReason)
  validatePageSequence(input.book.pages, input.manuscript.blocks, issues);

  // 책 단위 — 블록 사용 검증 (orphan / duplicate)
  validateBlockUsage(input.book, input.manuscript.blocks, issues);

  // intentionalOmissions 통계 (info)
  for (const om of input.book.intentionalOmissions ?? []) {
    issues.push({
      severity: "info",
      code: "INTENTIONAL_OMISSION",
      message: `의도된 누락 ${om.blockIds.length}개: ${om.reason}`,
    });
  }

  const hasError = issues.some((i) => i.severity === "error");
  const validPageCount = hasError ? 0 : input.book.pages.length;

  return { issues, hasError, validPageCount };
}

// ─────────────────────────────────────────────────────────────
// 페이지 1장 검증
// ─────────────────────────────────────────────────────────────

function validatePage(
  page: LlmPageOutput,
  input: ValidateInput,
  blockMap: Map<string, Block>,
  issues: ValidationIssue[],
): void {
  // (b) INVALID_PATTERN_SLUG — 카탈로그에 실재
  if (!isPatternSlugValid(page.pattern)) {
    issues.push({
      severity: "error",
      code: "INVALID_PATTERN_SLUG",
      message: `pageNumber=${page.pageNumber}: 콤포지션 슬러그 '${page.pattern}' 가 카탈로그에 없음`,
      pageNumber: page.pageNumber,
    });
    return; // 이후 검증은 패턴이 있어야 진행 가능
  }

  // (b) PATTERN_NOT_IN_VOCABULARY — §11 약속 1번
  const vocabulary = input.designTokens.gridVocabulary ?? [];
  if (vocabulary.length > 0 && !isPatternInVocabulary(page.pattern, vocabulary)) {
    issues.push({
      severity: "error",
      code: "PATTERN_NOT_IN_VOCABULARY",
      message: `pageNumber=${page.pageNumber}: 콤포지션 '${page.pattern}' 가 designTokens.gridVocabulary 안에 없음 (§11 약속 1번 — 어휘는 책 단위 고정)`,
      pageNumber: page.pageNumber,
    });
  }

  const pattern = findPatternBySlug(page.pattern)!;

  // (c) SLOT_MISMATCH — 슬롯 ID, 슬롯 종류, 필수성, hiddenSlotIds 모순
  validateSlotMappings(page, pattern, blockMap, issues);

  // 메타: VARIANT_INVALID
  validateVariants(page, pattern, issues);
}

/**
 * 슬롯 매핑 검증.
 *
 * 1. LLM 이 사용한 슬롯 ID 가 콤포지션 정의에 있는가
 * 2. 각 슬롯의 블록 종류가 슬롯 종류와 맞는가 (+ 블록 ID 가 실재하는가)
 * 3. 필수 슬롯 (optional=false) 이 비어있고 hiddenSlotIds 에도 없는가
 * 4. hiddenSlotIds 와 slotBlockRefs 가 모순되지 않는가 (둘 다 있으면 모순)
 */
function validateSlotMappings(
  page: LlmPageOutput,
  pattern: CompositionPattern,
  blockMap: Map<string, Block>,
  issues: ValidationIssue[],
): void {
  const definedSlotIds = new Set(pattern.slots.map((s) => s.id));
  const hiddenSlotIds = new Set(page.hiddenSlotIds ?? []);

  // 1. LLM 의 슬롯 ID 가 정의에 있는가
  for (const slotId of Object.keys(page.slotBlockRefs ?? {})) {
    if (!definedSlotIds.has(slotId)) {
      issues.push({
        severity: "error",
        code: "SLOT_MISMATCH",
        message: `pageNumber=${page.pageNumber}: 콤포지션 '${page.pattern}' 에 슬롯 '${slotId}' 가 정의되지 않음. 정의된 슬롯: [${[...definedSlotIds].join(", ")}]`,
        pageNumber: page.pageNumber,
        slotId,
      });
    }
  }

  // hiddenSlotIds 도 마찬가지 — 정의에 있는 슬롯이어야 함
  for (const slotId of hiddenSlotIds) {
    if (!definedSlotIds.has(slotId)) {
      issues.push({
        severity: "error",
        code: "SLOT_MISMATCH",
        message: `pageNumber=${page.pageNumber}: hiddenSlotIds 에 있는 슬롯 '${slotId}' 가 콤포지션 '${page.pattern}' 정의에 없음`,
        pageNumber: page.pageNumber,
        slotId,
      });
    }
  }

  // 2~4. 슬롯별 검증
  for (const slot of pattern.slots) {
    const blockIds = page.slotBlockRefs?.[slot.id] ?? [];
    const isHidden = hiddenSlotIds.has(slot.id);

    // 4. hidden 인데 blockIds 도 있으면 모순
    if (isHidden && blockIds.length > 0) {
      issues.push({
        severity: "error",
        code: "SLOT_MISMATCH",
        message: `pageNumber=${page.pageNumber}: 슬롯 '${slot.id}' 가 hiddenSlotIds 에 있는데 slotBlockRefs 에도 블록 ${blockIds.length}개 매핑됨 (모순)`,
        pageNumber: page.pageNumber,
        slotId: slot.id,
      });
      continue;
    }

    if (isHidden) continue; // 의도적 비움

    // 3. 필수 슬롯이 비어있는가
    if (blockIds.length === 0) {
      const isOptional = slot.optional === true;
      if (!isOptional) {
        issues.push({
          severity: "error",
          code: "SLOT_MISMATCH",
          message: `pageNumber=${page.pageNumber}: 필수 슬롯 '${slot.id}' (kind=${slot.kind}) 가 비어있고 hiddenSlotIds 에도 없음. optional 슬롯이라면 hiddenSlotIds 에 추가 필요`,
          pageNumber: page.pageNumber,
          slotId: slot.id,
        });
      }
      continue;
    }

    // 2. 슬롯 종류와 블록 종류 일치 + 블록 ID 실재
    validateSlotKindBlockKind(page, slot.id, slot.kind, blockIds, blockMap, issues);
  }
}

/**
 * 슬롯 종류와 블록 종류 매칭 검증 + 블록 ID 실재 검증.
 *
 * 매칭 규칙:
 *   - text 슬롯 : heading / paragraph / list 만
 *   - image 슬롯: image 만, 1개만
 *   - table 슬롯: table 만, 1개만
 *   - chart 슬롯: 1차 미지원 — 매니스크립트에 chart 블록이 없으므로 어떤 블록도 안 맞음
 *   - shape 슬롯: 콘텐츠 없음 (장식). 어떤 블록도 매핑 안 돼야 함
 */
function validateSlotKindBlockKind(
  page: LlmPageOutput,
  slotId: string,
  slotKind: "text" | "image" | "table" | "chart" | "shape",
  blockIds: string[],
  blockMap: Map<string, Block>,
  issues: ValidationIssue[],
): void {
  for (const id of blockIds) {
    const block = blockMap.get(id);
    if (!block) {
      issues.push({
        severity: "error",
        code: "BLOCK_NOT_FOUND",
        message: `pageNumber=${page.pageNumber} 슬롯 '${slotId}': 블록 ID '${id}' 가 매니스크립트에 없음`,
        pageNumber: page.pageNumber,
        slotId,
        blockId: id,
      });
      continue;
    }

    if (!isBlockKindCompatible(slotKind, block.type)) {
      issues.push({
        severity: "error",
        code: "SLOT_MISMATCH",
        message: `pageNumber=${page.pageNumber} 슬롯 '${slotId}' (kind=${slotKind}): 블록 '${id}' 의 종류가 '${block.type}' 라 맞지 않음`,
        pageNumber: page.pageNumber,
        slotId,
        blockId: id,
      });
    }
  }

  // image / table 슬롯은 블록 1개만
  if ((slotKind === "image" || slotKind === "table") && blockIds.length > 1) {
    issues.push({
      severity: "error",
      code: "SLOT_MISMATCH",
      message: `pageNumber=${page.pageNumber} 슬롯 '${slotId}' (kind=${slotKind}): 블록 1개만 허용, ${blockIds.length}개 매핑됨`,
      pageNumber: page.pageNumber,
      slotId,
    });
  }
}

function isBlockKindCompatible(
  slotKind: "text" | "image" | "table" | "chart" | "shape",
  blockType: Block["type"],
): boolean {
  switch (slotKind) {
    case "text":
      // 1차 검증 단계 정책 (M3b-3 P11): text 슬롯이 모든 콘텐츠 블록 종류 허용.
      // 본래는 heading/paragraph/list 만이지만, 어휘를 [12] 단일 슬롯으로 좁힌 1차에서는
      // table/image 같은 블록도 main 슬롯에 박혀야 함 — 그 외 슬롯이 카탈로그에 없으므로.
      // expandSectionIdsToSlots 가 자동으로 모든 블록을 text 슬롯에 박음.
      // M2 본격 디자인 작업 시 (다중 슬롯 어휘 활성화) 원래 엄격함 복구 필요.
      return (
        blockType === "heading" ||
        blockType === "paragraph" ||
        blockType === "list" ||
        blockType === "table" ||
        blockType === "image"
      );
    case "image":
      return blockType === "image";
    case "table":
      return blockType === "table";
    case "chart":
      return false; // 1차 미지원
    case "shape":
      return false;
  }
}

/**
 * variants 검증 — 콤포지션 정의에 있는 ID/value 인지.
 */
function validateVariants(
  page: LlmPageOutput,
  pattern: CompositionPattern,
  issues: ValidationIssue[],
): void {
  if (!page.variants) return;

  const definedVariants = new Map<string, Set<string>>();
  for (const v of pattern.variants ?? []) {
    definedVariants.set(v.id, new Set(v.options.map((o) => o.value)));
  }

  for (const [variantId, value] of Object.entries(page.variants)) {
    const definedValues = definedVariants.get(variantId);
    if (!definedValues) {
      issues.push({
        severity: "error",
        code: "VARIANT_INVALID",
        message: `pageNumber=${page.pageNumber}: variants ID '${variantId}' 가 콤포지션 '${page.pattern}' 정의에 없음`,
        pageNumber: page.pageNumber,
      });
      continue;
    }
    if (!definedValues.has(value)) {
      issues.push({
        severity: "error",
        code: "VARIANT_INVALID",
        message: `pageNumber=${page.pageNumber}: variants '${variantId}' 의 값 '${value}' 가 콤포지션 정의에 없음. 허용값: [${[...definedValues].join(", ")}]`,
        pageNumber: page.pageNumber,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 페이지 시퀀스 메타 검증
// ─────────────────────────────────────────────────────────────

function validatePageSequence(
  pages: LlmPageOutput[],
  blocks: Block[],
  issues: ValidationIssue[],
): void {
  // PAGE_NUMBER_GAP — 1, 2, 3... 순차
  for (let i = 0; i < pages.length; i++) {
    const expected = i + 1;
    if (pages[i].pageNumber !== expected) {
      issues.push({
        severity: "warn",
        code: "PAGE_NUMBER_GAP",
        message: `시퀀스 ${i} 번째 페이지의 pageNumber=${pages[i].pageNumber} (기대값: ${expected}). LLM 이 pageNumber 를 비순차로 출력 — 코드는 시퀀스 순으로 처리하지만 LLM 의도 점검 필요`,
        pageNumber: pages[i].pageNumber,
      });
    }
  }

  // SPLIT_REASON_INCONSISTENT — page-separator 정합성
  validateSplitReasons(pages, blocks, issues);
}

/**
 * splitReason="page-separator" 정합성.
 *
 * 페이지 N 의 splitReason 이 "page-separator" 면, 페이지 N-1 의 마지막 블록과
 * 페이지 N 의 첫 블록 사이에 SeparatorBlock("page") 가 실제로 있어야 함.
 *
 * 1페이지는 검증 제외 (책 시작이라 직전 separator 없어도 자연스러움).
 *
 * 검증 방식: 페이지의 첫 블록을 찾아 매니스크립트 시퀀스에서의 인덱스를 본다.
 * 그 직전 블록(separator 가 아닌 콘텐츠 블록 만나기 전까지) 들 중에 page separator 가
 * 있으면 정합. 없으면 LLM 메타 거짓 의심.
 */
function validateSplitReasons(
  pages: LlmPageOutput[],
  blocks: Block[],
  issues: ValidationIssue[],
): void {
  // 블록 ID → 매니스크립트 시퀀스 인덱스
  const blockIndex = new Map<string, number>();
  for (let i = 0; i < blocks.length; i++) {
    blockIndex.set(blocks[i].id, i);
  }

  for (let p = 1; p < pages.length; p++) {
    const page = pages[p];
    if (page.splitReason !== "page-separator") continue;

    // 이 페이지의 첫 블록 ID 찾기
    const firstBlockId = findFirstBlockOfPage(page, blockIndex);
    if (!firstBlockId) continue; // 비어있는 페이지면 건너뜀 (다른 검증이 잡음)

    const idx = blockIndex.get(firstBlockId);
    if (idx === undefined || idx === 0) continue;

    // 직전에 SeparatorBlock("page") 있는지 — 인접 블록(들) 중에 separator 가 있나
    let hasPageSeparator = false;
    for (let i = idx - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.type === "separator") {
        if (b.kind === "page") hasPageSeparator = true;
        break; // separator 하나 만나면 종료 (page 든 다른 종류든)
      }
      // separator 가 아닌 블록 만나면 — 직전 페이지의 일부였어야 정상.
      // 첫 블록 직전이 separator 아니라 콘텐츠면 page-separator 메타가 거짓.
      break;
    }

    if (!hasPageSeparator) {
      issues.push({
        severity: "warn",
        code: "SPLIT_REASON_INCONSISTENT",
        message: `pageNumber=${page.pageNumber}: splitReason='page-separator' 인데 첫 블록 '${firstBlockId}' 직전에 SeparatorBlock('page') 없음. LLM 메타가 거짓일 가능성`,
        pageNumber: page.pageNumber,
      });
    }
  }
}

/**
 * 페이지의 매니스크립트 시퀀스상 첫 블록 ID.
 *
 * slotBlockRefs 의 모든 슬롯·블록 ID 중 매니스크립트 인덱스가 가장 작은 것.
 * (LLM 이 슬롯 안 블록 순서나 슬롯 순서를 다르게 줄 수 있어 안전을 위해 정렬)
 */
function findFirstBlockOfPage(
  page: LlmPageOutput,
  blockIndex: Map<string, number>,
): string | undefined {
  let minIdx = Infinity;
  let firstId: string | undefined;
  for (const ids of Object.values(page.slotBlockRefs ?? {})) {
    for (const id of ids) {
      const idx = blockIndex.get(id);
      if (idx !== undefined && idx < minIdx) {
        minIdx = idx;
        firstId = id;
      }
    }
  }
  return firstId;
}

// ─────────────────────────────────────────────────────────────
// 책 단위 블록 사용 검증
// ─────────────────────────────────────────────────────────────

/**
 * BLOCK_ORPHANED + BLOCK_DUPLICATED 검증.
 *
 * 모든 콘텐츠 블록 (separator 제외) 이:
 *   - 정확히 한 페이지에 들어갔거나 (정상)
 *   - intentionalOmissions 에 명시됐거나 (정상)
 *   - 어디에도 없음 (BLOCK_ORPHANED — 침묵 누락, §1 약속 위반)
 *   - 두 페이지 이상에 들어감 (BLOCK_DUPLICATED)
 *
 * separator 블록은 페이지 분할 신호이므로 페이지 콘텐츠로 들어가지 않음 — 검증 제외.
 */
function validateBlockUsage(
  book: LlmBookOutput,
  blocks: Block[],
  issues: ValidationIssue[],
): void {
  // 블록 ID → 사용 횟수
  const usageCount = new Map<string, number>();
  for (const page of book.pages) {
    for (const slotIds of Object.values(page.slotBlockRefs ?? {})) {
      for (const id of slotIds) {
        usageCount.set(id, (usageCount.get(id) ?? 0) + 1);
      }
    }
  }

  // intentionalOmissions
  const omittedIds = new Set<string>();
  for (const om of book.intentionalOmissions ?? []) {
    for (const id of om.blockIds) omittedIds.add(id);
  }

  // BLOCK_ORPHANED — 사용 안 됐고 누락도 명시 안 됨
  // intentionalOmissions 는 1차 검증 단계 (M3b-3 P9) 에서 schema 에서 제거됨.
  // 다만 omittedIds.has() 체크는 안전망으로 보존 — LLM 이 (스키마 외라도) 출력하면
  // 허용해줌. 검증 코드는 그 케이스에 깨지지 않음.
  for (const block of blocks) {
    if (block.type === "separator") continue;
    const used = (usageCount.get(block.id) ?? 0) > 0;
    if (used) continue;
    if (omittedIds.has(block.id)) continue;
    issues.push({
      severity: "error",
      code: "BLOCK_ORPHANED",
      message: `블록 ${block.id} (type=${block.type}) 가 어떤 페이지의 slotBlockRefs 에도 박혀있지 않음 — §1 약속 위반 (모든 콘텐츠 블록은 페이지 슬롯에 박혀야 함)`,
      blockId: block.id,
    });
  }

  // BLOCK_DUPLICATED — 두 페이지 이상에 들어감
  for (const [blockId, count] of usageCount) {
    if (count <= 1) continue;
    issues.push({
      severity: "error",
      code: "BLOCK_DUPLICATED",
      message: `블록 ${blockId} 가 ${count}개 페이지에서 중복 사용됨. 1차 정책에서 블록 중복 허용 안 함`,
      blockId,
    });
  }
}
