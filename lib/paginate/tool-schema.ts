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
            "sectionIds",
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
            sectionIds: {
              type: "array",
              description:
                "이 페이지가 담는 manuscript section ID 목록 (manuscript.sections 의 id 참조). 예: ['s001'] 또는 ['s002', 's003']. 한 페이지가 여러 섹션을 담을 수도 (짧은 섹션들 결합), 한 섹션이 여러 페이지로 나뉠 수도 있음 (긴 섹션 분할 — 그 경우 같은 sectionId 가 인접 페이지들에 반복됨). 빈 배열 절대 금지 — 모든 페이지는 최소 1개 섹션을 담아야 함. 코드가 이 sectionIds 로부터 슬롯별 블록 매핑을 자동으로 채우므로 텍스트나 블록 ID 를 직접 박지 마세요.",
              minItems: 1,
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
      // intentionalOmissions 필드는 1차 검증 단계에서 schema 에서 제거됨 (M3b-3 P9).
      // 이전: LLM 이 본문 외 처리할 블록을 명시할 수 있었음.
      // 문제: Gemini 가 모든 블록을 intentionalOmissions 로 밀어넣고 페이지 슬롯은 빈 객체로
      //       출력하는 잘못된 패턴 발생 (P5~P8 모든 시도에서 일관됨).
      // 처치: LLM 의 "도망갈 곳" 자체를 제거. 모든 manuscript 블록은 페이지 slotBlockRefs 에
      //       박혀야 하며 (separator 블록은 검증 단계에서 자동 제외 처리),
      //       이 필드를 schema 에서 빼서 LLM 이 사용할 수 없게 함.
      // 부활 조건: 다중 슬롯 어휘 본격 도입 시 + retry-with-feedback 으로 LLM 잘못 사용
      //         교정 가능해진 후. 진짜 본문 외 콘텐츠 처리는 아직 1차에서 미박.
    },
  },
} as const;
