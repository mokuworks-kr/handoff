/**
 * thirds-image-image-image — 3슬롯 균등 이미지 콤포지션.
 *
 * 페이지를 균등 3분할. 세 슬롯 모두 이미지.
 *
 * 회사소개서 / 카탈로그 빈출:
 *   - 제품 3개 사진 (제품 라인업, 시각 위주)
 *   - 사업 영역 3개 시각화 (인포그래픽 / 일러스트)
 *   - 사옥 / 공장 / 매장 3개 사진
 *
 * §11 약속 2번 적용: 같은 콤포지션이라도 어떤 이미지가 들어가는가로 차별화.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 3개 (left, center, right)**: 각 4칸. 모두 ImageSlot.
 * - **fit: "cover"**: 이미지가 잘려도 프레임을 채움. 그리드 통일감 보장.
 * - **variants 없음**: 균등.
 * - **이미지 + 캡션 혼합 1차 미지원**: 이미지마다 캡션이 달리는 케이스(예: 제품명+사진)는
 *   1차에 슬롯 시스템 한계로 표현 어려움. 사용자 흐름:
 *     - 옵션 a) 이미지만 박고 다음 페이지에 텍스트 (페이지 분할)
 *     - 옵션 b) wide-narrow-text-image 를 쓰는 페이지로 처리 (제품 1개씩 페이지)
 *   미래에 카드형 슬롯이 필요해지면 별도 콤포지션 / 슬롯 종류 추가.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const thirdsImageImageImage: CompositionPattern = {
  slug: "thirds-image-image-image",
  name: "3단 이미지",
  description:
    "페이지를 균등 3분할. 세 슬롯 모두 이미지. 제품 3개 사진, 사업 영역 시각화, 사옥/공장/매장 3개 사진 등에 사용.",
  role: "media",
  totalRows: 12,
  slots: [
    {
      id: "left",
      kind: "image",
      label: "왼쪽",
      area: { column: 1, columnSpan: 4, row: 1, rowSpan: -1 },
      fit: "cover",
    },
    {
      id: "center",
      kind: "image",
      label: "가운데",
      area: { column: 5, columnSpan: 4, row: 1, rowSpan: -1 },
      fit: "cover",
    },
    {
      id: "right",
      kind: "image",
      label: "오른쪽",
      area: { column: 9, columnSpan: 4, row: 1, rowSpan: -1 },
      fit: "cover",
    },
  ],
};
