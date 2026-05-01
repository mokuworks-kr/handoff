/**
 * full-image — 풀폭 이미지 콤포지션 (풀블리드).
 *
 * 페이지 전체를 한 장의 이미지로 채우는 콤포지션. **풀블리드** —
 * 트림 박스를 넘어 블리드까지 이미지가 확장됨.
 *
 * 회사소개서 / IR 표지의 가장 흔한 형태:
 *   - 회사 사진 / 제품 사진 / 로고 등이 표지를 가득 채움
 *   - 텍스트 없이 이미지만 (텍스트 필요하면 별도 페이지)
 *
 * 또는 본문 중간 강조 페이지:
 *   - 환경 보고서의 자연 사진
 *   - IR 의 사옥 / 공장 사진
 *
 * §11 약속 2번 의 적용처: full-text 와 같은 비율 [12] 이지만 슬롯 종류가 image 라
 * 시각적으로 완전히 다른 페이지.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slot 1개 (image)**: ImageSlot. **bleedToEdge: true** — 트림 박스 + 블리드 박스.
 * - **fit: "cover"**: 이미지가 잘려도 프레임을 가득 채움. 표지에 자연스러움.
 * - **alt 필수 아님**: 1차에서 풀블리드 표지는 장식적 역할 다수. 접근성 강화 시 변경.
 * - **variants 없음**: 풀블리드라 좌우 결정 의미 없음.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const fullImage: CompositionPattern = {
  slug: "full-image",
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
