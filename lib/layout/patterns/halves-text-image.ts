/**
 * halves-text-image — 텍스트 + 이미지 균등 콤포지션.
 *
 * 페이지를 균등 2분할. 한쪽은 텍스트, 한쪽은 이미지.
 * 회사소개서 / IR 에서 매우 빈번:
 *   - 회사 소개 단락 + 사옥 사진
 *   - 비전 본문 + 컨셉 이미지
 *   - 인물 약력 + 인물 사진 (people-like 섹션)
 *
 * §11 약속 2번 적용: 같은 콤포지션이라도 인물 약력/사진, 회사 소개/사옥, 제품 설명/제품
 * 이미지 등 다양한 의미로 사용.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정
 * ─────────────────────────────────────────────────────────────
 *
 * - **slots 2개 (text, image)**: text 가 왼쪽 6칸, image 가 오른쪽 6칸.
 * - **이미지를 한쪽으로 고정**: 1차에서는 text=왼쪽, image=오른쪽 으로 고정.
 *   사용자 케이스(반복 카탈로그)처럼 책 전체에서 일관된 위치가 자연스러움.
 *   좌우 반전이 필요해지면 미래에 별도 콤포지션 halves-image-text 추가
 *   (어휘 안의 변형이라 §11 약속 1번 안 깸).
 *
 *   왜 좌우를 variants 로 안 두나: halves 는 대칭 비율이라 _variants.ts 의
 *   asymmetryDirection 이 적용 안 됨 (asymmetryDirection 은 비대칭 전용).
 *   대칭 비율의 좌우 반전은 별개 메커니즘이고 1차에서 별도 콤포지션으로 풂.
 *
 * - **fit: "cover"**: 이미지가 잘려도 프레임을 채움.
 * - **이미지 슬롯이 오른쪽**: 한국어 가로쓰기 시선 흐름 — 글 → 이미지(강조)로 종결.
 * - **totalRows = 12**: 통일.
 */

import type { CompositionPattern } from "@/lib/layout/composition";

export const halvesTextImage: CompositionPattern = {
  slug: "halves-text-image",
  name: "텍스트 + 이미지",
  description:
    "페이지를 균등 2분할. 왼쪽 텍스트, 오른쪽 이미지. 회사 소개+사옥, 인물 약력+사진, 제품 설명+이미지 등에 사용.",
  role: "media",
  totalRows: 12,
  slots: [
    {
      id: "text",
      kind: "text",
      label: "텍스트",
      paragraphStyleId: "body",
      area: { column: 1, columnSpan: 6, row: 1, rowSpan: -1 },
    },
    {
      id: "image",
      kind: "image",
      label: "이미지",
      area: { column: 7, columnSpan: 6, row: 1, rowSpan: -1 },
      fit: "cover",
    },
  ],
};
