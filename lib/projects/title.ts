/**
 * ClassifiedManuscript → 자동 제목.
 *
 * `Project.title` 의 초기값을 만든다. 사용자가 수정 가능 (UI에서).
 *
 * 주의: 이 함수는 *대시보드 구분용 제목*만 만든다. 인쇄물에 박히는 제목은
 * 페이지네이션 LLM(M3b)이 만드는 표지 페이지의 텍스트 프레임에 들어가고,
 * 그 텍스트는 분류기가 잡은 cover-like 섹션의 *원본 텍스트를 그대로* 사용한다
 * (§1 약속 — 원고 안 다듬음).
 *
 * 추출 우선순위:
 *   1) cover-like 섹션의 첫 heading 텍스트
 *   2) cover-like 섹션의 첫 paragraph 텍스트
 *   3) 첫 번째 heading (kind 무관)
 *   4) 첫 번째 paragraph (kind 무관)
 *   5) source.filename (확장자 제거)
 *   6) "제목 없음"
 *
 * 추출된 텍스트는 30자로 잘라 ".." 추가.
 */

import type { ClassifiedManuscript } from "@/lib/classify/types";
import type { Block } from "@/lib/parsers/normalized";

const MAX_TITLE_LENGTH = 30;

export function extractProjectTitle(manuscript: ClassifiedManuscript): string {
  // 1) cover-like 섹션 안에서 찾기
  const coverSection = manuscript.sections.find((s) => s.kind === "cover-like");
  if (coverSection) {
    const blocks = blocksInRange(
      manuscript.blocks,
      coverSection.fromBlockId,
      coverSection.toBlockId,
    );
    const fromCover = pickFirstTextFrom(blocks);
    if (fromCover) return truncate(fromCover);
  }

  // 2~4) 전체 블록에서 첫 heading 또는 paragraph
  const fromAny = pickFirstTextFrom(manuscript.blocks);
  if (fromAny) return truncate(fromAny);

  // 5) 파일명
  const filename = manuscript.source.filename;
  if (filename && filename !== "untitled.txt") {
    const stripped = filename.replace(/\.[^.]+$/, "").trim();
    if (stripped.length > 0) return truncate(stripped);
  }

  // 6) fallback
  return "제목 없음";
}

/**
 * 블록 배열에서 첫 의미 있는 텍스트 1개 추출.
 * heading > paragraph 우선. 둘 다 없으면 null.
 */
function pickFirstTextFrom(blocks: Block[]): string | null {
  // 우선 heading
  for (const b of blocks) {
    if (b.type === "heading") {
      const text = b.runs.map((r) => r.text).join("").trim();
      if (text.length > 0) return text;
    }
  }
  // 다음 paragraph
  for (const b of blocks) {
    if (b.type === "paragraph") {
      const text = b.runs.map((r) => r.text).join("").trim();
      if (text.length > 0) return text;
    }
  }
  return null;
}

function blocksInRange(
  blocks: Block[],
  fromId: string,
  toId: string,
): Block[] {
  const fromIdx = blocks.findIndex((b) => b.id === fromId);
  const toIdx = blocks.findIndex((b) => b.id === toId);
  if (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx) return [];
  return blocks.slice(fromIdx, toIdx + 1);
}

function truncate(text: string): string {
  // 줄바꿈 → 공백 정규화
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return normalized.slice(0, MAX_TITLE_LENGTH) + "…";
}
