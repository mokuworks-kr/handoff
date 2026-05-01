/**
 * submit_book_pagination tool schema (M3b-2-c).
 *
 * ─────────────────────────────────────────────────────────────
 * 정책
 * ─────────────────────────────────────────────────────────────
 *
 * §15.2 분류기 패턴 따름 — JSON Schema 로 LLM 출력 형태 강제.
 * tool use 강제: 자유 텍스트 응답 금지, 이 tool 호출 1회만 허용.
 *
 * 출력 형태는 LlmBookOutput (types.ts) 와 1:1 매핑.
 *
 * ─────────────────────────────────────────────────────────────
 * 박힌 결정 (앞 7개 결정 박제)
 * ─────────────────────────────────────────────────────────────
 *
 * - **slotBlockRefs**: 텍스트가 아니라 블록 ID 리스트. §1 약속 시스템 강제 — LLM 이
 *   텍스트를 직접 출력할 자리 없음.
 * - **splitReason**: enum 4종 ("page-separator" | "section-boundary" |
 *   "content-fit" | "merged"). 페이지 분할 우선순위 메타 보존.
 * - **role**: enum 6종. CompositionPattern.role 과 일치.
 * - **side**: enum 2종.
 * - **intentionalOmissions**: 명시적 누락만 허용. 검증 단계에서 §1 약속 강제.
 * - **rationale**: 옵셔널 — LLM 의도 메모. 사용자 편집 시(M3c) 표시.
 *
 * ─────────────────────────────────────────────────────────────
 * additionalProperties 정책
 * ─────────────────────────────────────────────────────────────
 *
 * 모든 객체에 additionalProperties: false. LLM 이 schema 외 필드 추가 금지 →
 * 스키마 외 데이터로 의도를 표현하려는 우회 방지.
 *
 * 단 slotBlockRefs 는 동적 키(슬롯 ID)이므로 additionalProperties 로 string[] 허용.
 */

export const TOOL_SCHEMA = {
  name: "submit_book_pagination",
  description:
    "책 한 권 분량의 페이지 시퀀스를 제출합니다. 각 페이지는 콤포지션 슬러그 + 슬롯별 블록 ID 매핑 + 메타로 정의됩니다. 텍스트를 직접 출력하지 마세요 — 블록 ID 만 참조합니다.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: {
      pages: {
        type: "array",
        description: "책의 페이지 시퀀스. pageNumber 1 부터 순차.",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "pageNumber",
            "pattern",
            "role",
            "side",
            "slotBlockRefs",
            "splitReason",
          ],
          properties: {
            pageNumber: {
              type: "integer",
              minimum: 1,
              description: "페이지 시퀀스 번호 (1부터). 검증에서 순차성 확인.",
            },
            pattern: {
              type: "string",
              description:
                "콤포지션 카탈로그 안의 slug. 예: 'full-text', 'wide-narrow-text-image'",
            },
            role: {
              type: "string",
              enum: [
                "cover",
                "section-opener",
                "body",
                "media",
                "data",
                "closing",
              ],
              description: "페이지 의도. 콤포지션의 role 과 일치하는 게 자연스럽습니다.",
            },
            side: {
              type: "string",
              enum: ["left", "right"],
              description:
                "좌/우 페이지. 책자형이면 코드가 자동 정정함 (1쪽=right, 2쪽=left, ...).",
            },
            variants: {
              type: "object",
              description:
                "콤포지션의 variants 선택값. 예: { asymmetryDirection: 'wide-left' }",
              additionalProperties: { type: "string" },
            },
            slotBlockRefs: {
              type: "object",
              description:
                "슬롯별 블록 ID 매핑. 텍스트를 직접 쓰지 말고 manuscript.blocks 의 ID 만 참조합니다. 슬롯 종류와 블록 종류가 맞아야 합니다 (text 슬롯에는 heading/paragraph/list, image 슬롯에는 image, table 슬롯에는 table 블록). **빈 객체 {} 또는 모든 슬롯이 빈 배열인 객체는 절대 출력하지 마세요** — 그런 페이지는 의미가 없으므로 페이지 자체를 만들지 않거나 다른 페이지에 콘텐츠를 합쳐야 합니다. 콤포지션이 정의한 모든 필수 슬롯(optional=false)이 채워져 있어야 하며, optional 슬롯을 비우려면 hiddenSlotIds 에 명시.",
              minProperties: 1,
              additionalProperties: {
                type: "array",
                items: { type: "string" },
              },
            },
            hiddenSlotIds: {
              type: "array",
              description:
                "의도적으로 비운 슬롯 ID 목록. 슬롯의 optional=true 인 경우만 허용.",
              items: { type: "string" },
            },
            splitReason: {
              type: "string",
              enum: ["page-separator", "section-boundary", "content-fit", "merged"],
              description:
                "이 페이지의 분할 근거. 'page-separator' = 작성자 SeparatorBlock('page') 따름 (1순위), 'section-boundary' = 분류된 섹션 경계, 'content-fit' = 콘텐츠 양으로 자동 분할, 'merged' = 짧은 섹션 결합.",
            },
            rationale: {
              type: "string",
              description:
                "이 페이지 결정의 짧은 의도 메모. 사용자 편집 시(M3c) 표시됩니다. 50자 이내 권장.",
            },
          },
        },
      },
      intentionalOmissions: {
        type: "array",
        description:
          "본문에서 의도적으로 제외한 블록 + 사유. 침묵 누락은 검증 실패 — 누락 의도가 있으면 반드시 여기에 명시.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["blockIds", "reason"],
          properties: {
            blockIds: {
              type: "array",
              minItems: 1,
              items: { type: "string" },
            },
            reason: {
              type: "string",
              description:
                "왜 이 블록을 본문에서 뺐는지 짧은 사유 (예: '부록이라 본문 외 처리').",
            },
          },
        },
      },
    },
  },
} as const;
