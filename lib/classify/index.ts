/**
 * 분류기 — NormalizedManuscript → ClassifiedManuscript.
 *
 * Claude Sonnet 4.5에 tool use로 스키마 강제. 시스템 프롬프트로 우리 정책
 * (약한 enum + 자유 label + hints) 학습시킴.
 *
 * ─────────────────────────────────────────────────────────────
 * 호출 1회의 흐름
 * ─────────────────────────────────────────────────────────────
 *
 * 1) NormalizedManuscript의 blocks를 LLM이 읽기 좋은 평문으로 직렬화
 *    (블록 ID + 종류 + 내용 한 줄씩)
 * 2) 시스템 프롬프트 + 평문 사용자 메시지 + tool 정의 → callTool
 * 3) tool input(JSON)으로 sections 배열 받음
 * 4) 검증: ID 실재, 겹침 없음, 정렬, kind enum 유효
 * 5) ClassifiedManuscript 반환 (원본 normalized + sections)
 *
 * 모델/프로바이더는 환경변수 LLM_PROVIDER 로 결정 (기본 "gemini").
 * 미래에 Anthropic 결제 풀리면 LLM_PROVIDER=anthropic 으로 즉시 전환.
 */

import { callTool } from "@/lib/llm";
import type { Block, NormalizedManuscript } from "@/lib/parsers/normalized";
import {
  type ClassifiedManuscript,
  type Section,
  type SectionKind,
  SECTION_KINDS,
  sectionId,
} from "./types";

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

export type ClassifyOptions = {
  /** 호출 식별자 — 디버깅용 (예: "project-abc-123") */
  callerLabel?: string;
};

export async function classifyManuscript(
  normalized: NormalizedManuscript,
  options: ClassifyOptions = {},
): Promise<ClassifiedManuscript> {
  // 빈 원고는 LLM 호출 안 함
  if (normalized.blocks.length === 0) {
    return { ...normalized, sections: [] };
  }

  // 블록을 LLM이 읽기 좋은 평문으로
  const userMessage = serializeBlocksForLlm(normalized.blocks);

  // tool 호출 — model 미지정 시 프로바이더 어댑터의 기본 모델 사용
  const result = await callTool<{ sections: LlmSectionOutput[] }>({
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    tool: {
      name: "submit_classification",
      description:
        "원고를 의미 단위 섹션으로 분류한 결과를 제출합니다. 각 섹션은 콘텐츠 모양(kind), 라벨, 요약, 그리고 보조 신호(hints)를 가집니다.",
      input_schema: TOOL_SCHEMA,
    },
    maxTokens: 4000,
    forceToolUse: true,
    callerLabel: options.callerLabel ?? "classify",
  });

  // 검증 + Section 객체로 변환
  const sections = validateAndNormalizeSections(
    result.output.sections,
    normalized.blocks,
  );

  return {
    ...normalized,
    sections,
    classification: {
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      classifiedAt: new Date().toISOString(),
      rawCostUsd: result.rawCostUsd,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────────────────────────

/**
 * 분류기 정책을 LLM에게 학습시키는 프롬프트.
 *
 * 길이 4000자 이상이면 Anthropic은 자동 캐싱 (어댑터에서 처리).
 * Gemini는 1차에서 캐싱 미적용.
 *
 * 의도적으로 한국어로 작성 — 1차 타깃이 한국 비즈니스 시나리오라 예시도 한국어로.
 * 영어 원고 들어와도 동작 (LLM이 다언어).
 */
const SYSTEM_PROMPT = `당신은 인쇄 디자인 전 단계의 원고를 분석해서, 페이지 디자인 LLM이 쓰기 좋은 형태로 의미 단위(섹션)를 묶어주는 전문가입니다.

# 역할

원고는 단락·제목·표·이미지·리스트의 평탄한 시퀀스로 들어옵니다 (각 블록에 b0001 같은 ID가 붙어 있음). 당신은 이 블록들을 인접한 묶음(섹션)으로 그룹지어, 각 섹션에 다음을 부여합니다:

- **kind**: 콘텐츠의 모양 (아래 7개 중 하나)
- **label**: 사람이 읽는 한국어 자연어 라벨 (예: "연혁", "주요 사업")
- **summary**: 한 줄 설명 (예: "연도별 주요 사건 5개")
- **hints**: 페이지 디자인에 도움 되는 보조 신호 (선택)

# kind 정의 (7개 — 약하게 닫힌 enum)

- **cover-like**: 표지스러운. 회사명 + 문서명, 타이틀 페이지, 챕터 시작 페이지.
- **timeline-like**: 시간순 항목. 연혁, 로드맵, 분기별 실적.
- **people-like**: 사람들의 묶음. 팀 소개, 임원, 자문위원.
- **data-like**: 수치·표가 주연. 재무제표, KPI, 통계 표.
- **narrative-like**: 긴 본문 단락. 회사 소개, 사업 비전, 미션.
- **list-like**: 항목 리스트. 제품 라인업, 사업 영역, 인증 목록.
- **other**: 위 어느 것도 아님. 연락처, 부록, 약관, 단독 차트 등.

# 핵심 원칙

1. **콘텐츠의 모양으로 분류**, 비즈니스 도메인으로 분류하지 마세요. 환경 보고서의 "탄소 배출량 표"와 IR의 "재무제표"는 모두 data-like 입니다.

2. **인접한 블록만 한 섹션이 됩니다**. 떨어진 블록을 하나로 묶지 마세요. 같은 주제라도 중간에 다른 내용이 끼면 두 섹션으로 분리합니다.

3. **한 블록은 한 섹션에만 속합니다**. 섹션끼리 겹치면 안 됩니다.

4. **모든 블록을 다 섹션에 넣을 필요는 없습니다**. 분류가 애매한 블록은 빼도 됩니다 (페이지 디자인이 그 블록을 "other"로 처리). 하지만 명확한 블록은 누락하지 마세요.

5. **섹션은 너무 잘게 쪼개지 마세요**. 표지(블록 1~2개) 외에는 보통 3~10개 블록이 한 섹션입니다. 단락 하나가 한 섹션이 되는 경우는 드뭅니다.

6. **label은 사용자가 본 그대로 한국어로**. 원고에 "연혁"이라고 쓰여있으면 "연혁"으로. 영어 원고면 영어로.

7. **summary는 매우 간결하게** (한 줄, 30자 이내). "연도별 항목 5개", "임원 4명 약력", "재무 4년치 표" 같은 식.

8. **원고를 다듬거나 요약하거나 새로 쓰지 마세요**. 당신은 라벨만 붙입니다.

# hints (선택, 빈 객체 허용)

- itemCount: 항목 개수 (list/timeline/people 류에서)
- hasTable: 표 포함 여부
- largestTable: "행x열" 문자열
- hasImage: 이미지 포함 여부
- hasYears: 연도가 본문에 있나 (timeline-like 강한 신호)
- hasTitle: 섹션이 명시적 제목으로 시작하나
- totalCharCount: 섹션 안 단락 총 글자 수

# 출력 형식

submit_classification tool을 호출하세요. 자유 텍스트 답변 금지.

각 섹션은 fromBlockId와 toBlockId로 범위를 지정합니다. 두 ID 사이의 모든 블록이 그 섹션에 포함됩니다 (양 끝 포함).

# 예시

입력 블록:
- b0001 [heading] 주식회사 한빛테크
- b0002 [paragraph] 2026 IR 자료
- b0003 [heading] 회사 개요
- b0004 [paragraph] 한빛테크는 2018년 설립...
- b0005 [paragraph] 현재 350개 고객사...
- b0006 [heading] 연혁
- b0007 [list] 5개 항목 (2018년, 2019년, 2021년, 2024년, 2025년 ...)

올바른 출력:
[
  { fromBlockId: "b0001", toBlockId: "b0002", kind: "cover-like",
    label: "표지", summary: "회사명 + 문서명",
    hints: { hasTitle: true } },
  { fromBlockId: "b0003", toBlockId: "b0005", kind: "narrative-like",
    label: "회사 개요", summary: "회사 소개 단락 2개",
    hints: { hasTitle: true } },
  { fromBlockId: "b0006", toBlockId: "b0007", kind: "timeline-like",
    label: "연혁", summary: "연도별 항목 5개",
    hints: { hasTitle: true, itemCount: 5, hasYears: true } }
]
`;

// ─────────────────────────────────────────────────────────────
// tool 스키마
// ─────────────────────────────────────────────────────────────

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    sections: {
      type: "array",
      description: "분류된 섹션들. 시각적 순서 (fromBlockId가 빠른 순)대로 정렬.",
      items: {
        type: "object",
        properties: {
          fromBlockId: {
            type: "string",
            description: '섹션 시작 블록 ID (예: "b0001")',
          },
          toBlockId: {
            type: "string",
            description: '섹션 끝 블록 ID (양 끝 포함)',
          },
          kind: {
            type: "string",
            enum: SECTION_KINDS as unknown as string[],
            description: "콘텐츠 모양",
          },
          label: {
            type: "string",
            description: "사람이 읽는 한국어 라벨 (자유 자연어)",
          },
          summary: {
            type: "string",
            description: "한 줄 설명 (30자 이내)",
          },
          hints: {
            type: "object",
            description: "페이지 디자인 보조 신호 (선택)",
            properties: {
              itemCount: { type: "number" },
              hasTable: { type: "boolean" },
              largestTable: { type: "string" },
              hasImage: { type: "boolean" },
              hasYears: { type: "boolean" },
              hasTitle: { type: "boolean" },
              totalCharCount: { type: "number" },
            },
          },
        },
        required: ["fromBlockId", "toBlockId", "kind", "label", "summary"],
      },
    },
  },
  required: ["sections"],
};

type LlmSectionOutput = {
  fromBlockId: string;
  toBlockId: string;
  kind: string;
  label: string;
  summary: string;
  hints?: Record<string, unknown>;
};

// ─────────────────────────────────────────────────────────────
// 블록 → LLM 평문
// ─────────────────────────────────────────────────────────────

/**
 * NormalizedManuscript.blocks를 LLM이 읽기 좋은 평문으로 직렬화.
 *
 * 형식:
 *   - {id} [{type}] {짧은 미리보기 또는 메타데이터}
 *
 * 본문은 100자 정도로 잘라서 보냄 — 분류는 의미 보면 충분, 전체 보낼 필요 없음.
 * 이 정책이 토큰 절약 (시드 46블록 기준 ~3000 토큰 → ~1500 토큰).
 *
 * 표는 행/열 수만 표시 (셀 내용 다 보내면 토큰 폭발). 단 첫 행 헤더는 보냄
 * (data-like 분류에 핵심 신호).
 */
function serializeBlocksForLlm(blocks: Block[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        const text = b.runs.map((r) => r.text).join("");
        lines.push(`- ${b.id} [heading H${b.level}] ${truncate(text, 100)}`);
        break;
      }
      case "paragraph": {
        const text = b.runs.map((r) => r.text).join("");
        lines.push(`- ${b.id} [paragraph] ${truncate(text, 100)}`);
        break;
      }
      case "list": {
        const itemCount = b.items.length;
        const preview = b.items
          .slice(0, 3)
          .map((i) => i.runs.map((r) => r.text).join(""))
          .map((s) => truncate(s, 30))
          .join(" / ");
        lines.push(`- ${b.id} [list ${b.ordered ? "ordered" : "bullet"}, ${itemCount} items] ${preview}${itemCount > 3 ? " ..." : ""}`);
        break;
      }
      case "table": {
        const headerPreview = b.cells[0]?.map((c) => truncate(c, 20)).join(" | ") ?? "";
        lines.push(`- ${b.id} [table ${b.rows}x${b.cols}, header=${b.headerRows ?? 0}] ${headerPreview}`);
        break;
      }
      case "image": {
        lines.push(`- ${b.id} [image]${b.alt ? ` alt="${truncate(b.alt, 60)}"` : ""}`);
        break;
      }
      case "separator": {
        lines.push(`- ${b.id} [separator ${b.kind}]`);
        break;
      }
    }
  }
  return `다음 블록들을 분류해주세요. 모든 블록 ID는 정확히 그대로 사용하세요.\n\n${lines.join("\n")}`;
}

function truncate(s: string, maxLen: number): string {
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "…";
}

// ─────────────────────────────────────────────────────────────
// 출력 검증 + 정규화
// ─────────────────────────────────────────────────────────────

/**
 * LLM 출력의 sections를 검증해 Section[]로 변환.
 *
 * 검증 항목:
 *   1) fromBlockId / toBlockId가 실재 — 없으면 그 섹션 버림
 *   2) toBlockId가 fromBlockId보다 뒤 — 아니면 버림
 *   3) kind가 우리 enum에 있음 — 없으면 "other"로 fallback
 *   4) 두 섹션이 겹치지 않음 — 겹치면 뒤에 오는 거 버림
 *   5) fromBlockId 인덱스 순으로 정렬
 *   6) 각 섹션에 sectionId 부여 (s0001, s0002, ...)
 *
 * LLM이 30%를 틀려도 나머지 70%는 살리는 정책. throw 안 함.
 */
function validateAndNormalizeSections(
  llmSections: LlmSectionOutput[],
  blocks: Block[],
): Section[] {
  // 블록 ID → 인덱스 맵
  const idToIndex = new Map<string, number>();
  blocks.forEach((b, i) => idToIndex.set(b.id, i));

  // 1단계: 유효한 섹션만 모음
  type Candidate = { fromIdx: number; toIdx: number; raw: LlmSectionOutput };
  const candidates: Candidate[] = [];

  for (const raw of llmSections) {
    const fromIdx = idToIndex.get(raw.fromBlockId);
    const toIdx = idToIndex.get(raw.toBlockId);
    if (fromIdx === undefined || toIdx === undefined) continue;
    if (toIdx < fromIdx) continue;
    candidates.push({ fromIdx, toIdx, raw });
  }

  // 2단계: 정렬 (fromIdx 오름차순)
  candidates.sort((a, b) => a.fromIdx - b.fromIdx);

  // 3단계: 겹침 제거 (앞 섹션 우선, 뒤 섹션이 겹치면 버림)
  const accepted: Candidate[] = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.fromIdx <= lastEnd) continue; // 겹침
    accepted.push(c);
    lastEnd = c.toIdx;
  }

  // 4단계: Section 객체로 변환
  return accepted.map((c, i) => {
    const kind: SectionKind = (SECTION_KINDS as readonly string[]).includes(c.raw.kind)
      ? (c.raw.kind as SectionKind)
      : "other";

    const section: Section = {
      id: sectionId(i),
      fromBlockId: c.raw.fromBlockId,
      toBlockId: c.raw.toBlockId,
      kind,
      label: c.raw.label?.trim() || "(라벨 없음)",
      summary: c.raw.summary?.trim() || "",
    };

    if (c.raw.hints && typeof c.raw.hints === "object") {
      section.hints = sanitizeHints(c.raw.hints);
    }

    return section;
  });
}

function sanitizeHints(raw: Record<string, unknown>): Section["hints"] {
  const out: NonNullable<Section["hints"]> = {};
  if (typeof raw.itemCount === "number") out.itemCount = raw.itemCount;
  if (typeof raw.hasTable === "boolean") out.hasTable = raw.hasTable;
  if (typeof raw.largestTable === "string") out.largestTable = raw.largestTable;
  if (typeof raw.hasImage === "boolean") out.hasImage = raw.hasImage;
  if (typeof raw.hasYears === "boolean") out.hasYears = raw.hasYears;
  if (typeof raw.hasTitle === "boolean") out.hasTitle = raw.hasTitle;
  if (typeof raw.totalCharCount === "number") out.totalCharCount = raw.totalCharCount;
  return Object.keys(out).length > 0 ? out : undefined;
}
