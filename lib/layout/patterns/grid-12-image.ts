/**
 * grid-12-image — 풀폭 이미지 콤포지션 (풀블리드).
 *
 * ─────────────────────────────────────────────────────────────
 * 무엇 / 왜
 * ─────────────────────────────────────────────────────────────
 *
 * 페이지 전체를 한 장의 이미지로 채우는 콤포지션. **풀블리드** —
 * 트림 박스를 넘어 블리드까지 이미지가 확장됨.
 *
 * 회사소개서 / IR 표지의 가장 흔한 형태:
 *   - 회사 사진 / 제품 사진 / 로고 등이 표지를 가득 채움
 *   - 텍스트 없이 이미지만 (텍스트가 필요하면 별도 페이지 또는 미래 grid-12-image-overlay)
 *
 * 또는 본문 중간 강조 페이지 (장 사이의 시각적 환기):
 *   - 환경 보고서의 자연 사진
 *   - IR 의 사옥 / 공장 사진
 *
 * §11 약속 2번 ("다양성은 슬롯 콘텐츠로") 의 정확한 적용처: grid-12-text 와
 * 같은 비율 [12] 이지만 슬롯 종류가 image 라 시각적으로 완전히 다른 페이지.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slot 1개 (image)**: ImageSlot. **bleedToEdge: true** — composition.ts /
 *   grid.ts 가 트림 박스를 넘어 블리드까지 확장 (-bleed 좌표 ~ width+bleed).
 *   기존 grid.test.ts 의 5번 테스트 (bleedToEdge) 가 검증한 동작.
 * - **fit: "cover"**: 이미지가 잘려도 프레임을 가득 채움. 표지에 자연스러움.
 * - **alt 필수 아님**: 1차에서는 alt 누락 허용 (LLM 이 매번 의미 있는 alt 만들어주리라
 *   기대 어렵고, 풀블리드 표지 이미지는 장식적 역할이 많아 alt 비어도 큰 문제 없음).
 *   접근성이 중요해지는 시점에 altRequired: true 로 변경.
 * - **variants 없음**: 풀블리드라 좌우 결정 의미 없음.
 * - **totalRows = 12**: 모든 1차 콤포지션 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const grid12Image: CompositionPattern = {
  slug: "grid-12-image",
  name: "풀폭 이미지 (풀블리드)",
  description:
    "페이지 전체를 한 장의 이미지로 채움. 트림 박스를 넘어 블리드까지 확장. 표지 / 강조 페이지에 사용.",
  role: "media",
  totalRows: 12,
  slots: [
    {
      id: "image",
      kind: "image",
      label: "이미지",
      area: { column: 1, columnSpan: 12, row: 1, rowSpan: -1 },
      bleedToEdge: true,
      fit: "cover",
    },
  ],
};
