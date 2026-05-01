/**
 * grid-12-text — 풀폭 텍스트 콤포지션.
 *
 * ─────────────────────────────────────────────────────────────
 * 무엇 / 왜
 * ─────────────────────────────────────────────────────────────
 *
 * 페이지 본문 영역을 12칸 풀폭으로 쓰는 텍스트 전용 콤포지션.
 * 슬롯 1개 (`main`) — TextSlot.
 *
 * 다양한 페이지 역할(role)에 동일 콤포지션 사용:
 *   - 표지 텍스트 (회사명 + 문서명)
 *   - 장 시작 페이지 (큰 제목)
 *   - 본문 (긴 단락)
 *   - 마무리 (연락처 텍스트)
 *
 * §11 약속 2번 ("다양성은 슬롯 안 콘텐츠로") 의 적용처: 같은 콤포지션이지만
 * main 슬롯에 들어가는 텍스트 길이/스타일이 다름. paragraphStyleId 는 1차 default 인
 * "body" 로 두되, LLM 이 PageBlueprint.content 에서 헤딩 스타일이 필요하면
 * { content: "...", headingLevel: 1 } 형태로 명시 가능 (composition.ts 의
 * TextSlot 정의 참조).
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slot 1개 (main)**: TextSlot. 풀폭, 풀높이.
 * - **variants 없음**: 풀폭이라 좌우 결정 의미 없음.
 * - **totalRows = 12**: 1차 모든 콤포지션 통일 (책 세로 호흡 일관성).
 * - **세로 변형은 1차에서 안 박음**: row 1, rowSpan -1. 미래 variants 로 추가 가능.
 * - **role = "body"**: 카탈로그 표기상 가장 빈번한 사용처. 표지·장 시작에도 동일 사용.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const grid12Text: CompositionPattern = {
  slug: "grid-12-text",
  name: "풀폭 텍스트",
  description:
    "페이지 본문 영역을 12칸 풀폭 텍스트로 사용. 표지·장 시작·본문·마무리 등 다양한 페이지 역할에 사용. 다양성은 들어가는 텍스트의 길이·헤딩 레벨로.",
  role: "body",
  totalRows: 12,
  slots: [
    {
      id: "main",
      kind: "text",
      label: "본문",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 12, row: 1, rowSpan: -1 },
    },
  ],
};
