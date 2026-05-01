/**
 * quarters-image-image-image-image — 4슬롯 균등 이미지 콤포지션.
 *
 * 페이지를 균등 4분할. 네 슬롯 모두 이미지.
 *
 * 회사소개서 / 카탈로그 빈출:
 *   - 임원 4명 사진 그리드 (이름은 다음 페이지 약력에서 매칭)
 *   - 제품 4개 사진 라인업
 *   - 매장 4개 / 공장 4개 등 시설 사진
 *   - 인증서 / 수상 4개 사진
 *
 * §11 약속 2번 적용: 같은 콤포지션이지만 어떤 이미지 4장이 들어가느냐로 다양화.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 4개 (q1, q2, q3, q4)**: 각 3칸. 모두 ImageSlot.
 * - **fit: "cover"**: 그리드 통일감 보장.
 * - **variants 없음**: 균등.
 * - **이미지 + 캡션 혼합 1차 미지원**: 위 thirds-image-image-image 와 같은 한계.
 *   임원 4명 카드(사진+이름+직책)는 사진만 박고 이름·직책은 캡션 페이지나 인접 텍스트로.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const quartersImageImageImageImage: CompositionPattern = {
  slug: "quarters-image-image-image-image",
  name: "4단 이미지",
  description:
    "페이지를 균등 4분할. 네 슬롯 모두 이미지. 임원 사진 그리드, 제품 4개 라인업, 시설 4개, 인증서 4개 등에 사용.",
  role: "media",
  totalRows: 12,
  slots: [
    {
      id: "q1",
      kind: "image",
      label: "1번",
      area: { column: 1, columnSpan: 3, row: 1, rowSpan: -1 },
      fit: "cover",
    },
    {
      id: "q2",
      kind: "image",
      label: "2번",
      area: { column: 4, columnSpan: 3, row: 1, rowSpan: -1 },
      fit: "cover",
    },
    {
      id: "q3",
      kind: "image",
      label: "3번",
      area: { column: 7, columnSpan: 3, row: 1, rowSpan: -1 },
      fit: "cover",
    },
    {
      id: "q4",
      kind: "image",
      label: "4번",
      area: { column: 10, columnSpan: 3, row: 1, rowSpan: -1 },
      fit: "cover",
    },
  ],
};
