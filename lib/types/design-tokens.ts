/**
 * 디자인 토큰 — design.md의 코드 표현.
 * 스펙 §7: Google Stitch DESIGN.md 9개 섹션 + 인쇄용 확장 섹션(`print`).
 *
 * ───── 정책: read-only 카탈로그 ─────
 * DesignTokens는 "스타일의 원본 카탈로그"다. 사용자가 프로젝트 안에서
 * 단락 스타일을 편집하면 그 변경은 `Document.styles`에만 반영되고
 * DesignTokens는 건드리지 않는다.
 *
 * 어댑터/렌더러는 다음 우선순위로 스타일을 조회한다:
 *   1) Document.styles  (mutable, 사용자 편집 결과)
 *   2) DesignTokens.print  (read-only, 카탈로그 기본값)
 * 같은 id가 두 곳에 있으면 (1)이 이긴다. 분기 후 (2)는 참고만.
 *
 * 새 프로젝트 생성 시 DesignTokens.print의 내용을 Document.styles로 1회 복사.
 *
 * MVP 범위: 일단 핵심 토큰만 정의. 세부는 마일스톤 2 디자인 작업과 병행해 채움.
 *
 * ─────────────────────────────────────────────────────────────
 * M2.5 추가: gridVocabulary + rhythmGuide
 * ─────────────────────────────────────────────────────────────
 *
 * "디자인 스타일은 색·타이포만이 아니라 책 1권의 호흡까지 포함한 한 세트"
 * 라는 결정에 따라 두 필드가 디자인 토큰의 일부가 됐다.
 *
 * 1) gridVocabulary (책 단위 그리드 어휘)
 *    페이지 컬럼 분할 비율의 화이트리스트. 정수쌍 배열.
 *    예: [[12], [6, 6], [8, 4]] — 풀폭, 반반, 8:4 세 가지만 허용.
 *
 *    페이지네이션 LLM은 이 어휘 안에서만 비율을 고른다.
 *    페이지마다 비율이 변덕스럽게 달라지지 않게 해 책 한 권의 통일감을 강제.
 *
 *    합 검증: 각 비율의 spans 합 === Format.columns (보통 12)
 *    이 검증은 lib/layout/grid.ts 의 호출 시점에 실행. 어휘 자체에는
 *    columns가 없어 — Format에 따라 해석되는 상대 비율이라.
 *
 * 2) rhythmGuide (호흡 가이드)
 *    페이지 시퀀스의 호흡을 enum/규칙이 아니라 자연어 한두 문장으로 기술.
 *    LLM 시스템 프롬프트에 그대로 붙어 들어간다.
 *
 *    예: "이 스타일은 여백을 사랑하는 차분한 호흡이다. 본문 페이지 사이에
 *         이미지가 자주 끼지 않으며, 정보 밀도가 낮은 편이 좋다."
 *
 *    리듬 규칙을 enum으로 박지 않은 이유:
 *    - 디자인 호흡은 규칙이 아니라 감각이라 코드화하면 책이 기계적이 됨
 *    - 원고마다 적합한 호흡이 다른데 규칙을 박으면 모든 책이 같아짐
 *    - LLM은 자연어 가이드를 enum 10개보다 더 정확히 이해함
 *
 *    예외적으로 enum이 필요하다고 판명되면 그때 추가 (M3 페이지네이션 검증
 *    돌리며 결정). 지금은 자연어로 시작.
 *
 * 3) 분리 안 하는 정책
 *    그리드 어휘와 호흡 가이드는 색·타이포와 함께 디자인 토큰의 일부.
 *    "Minimal Mono × 빠른 호흡" 같은 자유 조합 미지원.
 *    변종이 필요하면 새 디자인 스타일로 추가 (예: "Minimal Mono Fast").
 *    이유: 시각 스타일과 호흡은 디자이너가 같이 만지는 한 세트라서.
 *
 * ─────────────────────────────────────────────────────────────
 * M3a-3 추가: author + license + version (커뮤니티 확장 대비)
 * ─────────────────────────────────────────────────────────────
 *
 * 디자인 카탈로그가 미래에 커뮤니티로 확장될 때 필요한 메타데이터를
 * 1차 출시 시점에 미리 박아둔다. 1차에서는 builtin 카탈로그가 모두
 * author: { id: "handoff-builtin" } 로 채워지지만, 미래 사용자/디자이너가
 * 자기 디자인을 올릴 때 같은 필드를 그대로 사용한다.
 *
 * 이 필드는 §A "확장 축"의 5번째 축(공유 어댑터)을 위한 사전 작업이다.
 * 지금 박아두면 미래 데이터 마이그레이션 비용 0.
 */

import type { Color, Font, ParagraphStyle, CharacterStyle } from "./styles";

/**
 * 디자인 작자 정보.
 *
 * 1차 builtin 카탈로그: { id: "handoff-builtin", name: "Handoff" }
 * 미래 커뮤니티 업로드: 사용자 ID + 표시 이름 + 선택적 URL
 */
export type DesignAuthor = {
  /** 작자 식별자. builtin은 "handoff-builtin", 커뮤니티는 user UUID 등 */
  id: string;
  /** 사람이 읽는 이름 */
  name: string;
  /** 작자 프로필/포트폴리오 URL (선택) */
  url?: string;
};

export type DesignTokens = {
  /** design.md 슬러그 (예: "minimal-mono", "warm-editorial") */
  slug: string;
  /** 사람이 읽는 이름 */
  name: string;
  /** 한 줄 설명 */
  description?: string;

  /**
   * 디자인 버전 — semver 권장 ("1.0.0").
   * 카탈로그 변경 시 +1. 사용자 문서는 origin.designVersion 으로 어느 버전을
   * 시작점으로 했는지 기억.
   *
   * 1차 출시 시점에는 모든 builtin 디자인이 "1.0.0" 으로 시작.
   */
  version?: string;

  /**
   * 작자. 1차 builtin은 { id: "handoff-builtin", name: "Handoff" }.
   * 커뮤니티 업로드 시 사용자가 채움.
   */
  author?: DesignAuthor;

  /**
   * 라이선스. 미지정 시 builtin 정책 (Handoff 기본 라이선스) 적용.
   * 커뮤니티 업로드 시 작자가 명시.
   *
   * 권장 값:
   *   "MIT"               — 자유 사용, 거의 제약 없음
   *   "CC-BY-4.0"         — 저작자 표시 후 자유 사용
   *   "CC-BY-NC-4.0"      — 저작자 표시 + 비상업적 사용만
   *   "CC-BY-SA-4.0"      — 표시 + 동일 라이선스로 재배포
   *   "All Rights Reserved" — 작자 명시적 허락 필요
   *
   * 1차 builtin은 "MIT" 로 시작 (Handoff 자체 라이선스에 종속).
   */
  license?: string;

  /**
   * 컬러 팔레트 (HEX).
   * 주의: 프레임은 이 팔레트를 직접 참조하지 않는다.
   * 어댑터/생성기가 이 팔레트를 기반으로 print.colors[] 카탈로그를 만들고,
   * 프레임은 colorId로 그 카탈로그를 참조한다.
   */
  palette: {
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
    border: string;
    /** 추가 색상 (이름 → HEX) */
    extra?: Record<string, string>;
  };

  /** 폰트 패밀리 */
  typography: {
    headingFamily: string;
    bodyFamily: string;
    monoFamily?: string;
    /** 본문 기본 크기 (pt) */
    bodySize: number;
    /** 본문 기본 행간 (배수, 예: 1.5) */
    bodyLineHeight: number;
  };

  /**
   * 그리드 어휘 — 책 단위 컬럼 비율 화이트리스트.
   *
   * 정수쌍 배열. 각 배열의 합 = Format.columns (보통 12).
   * 페이지네이션 LLM은 이 어휘 안에서만 비율을 고른다.
   *
   * 예 (12단 그리드 기준):
   *   [[12]]                              — 풀폭만 (제일 단순한 책)
   *   [[12], [6, 6]]                      — 풀폭 + 반반
   *   [[12], [6, 6], [8, 4]]              — 풀폭 + 반반 + 8:4
   *   [[12], [6, 6], [8, 4], [4, 4, 4]]   — 위 + 3분할
   *
   * 비어있거나 미지정 = 페이지네이션 LLM 호출 시 에러 (필수 정보).
   * 어휘가 적을수록 책이 단순·통일적이고, 많을수록 표현 다양 ↔ 통일감 ↓.
   * 디자이너 권장: 3~5개.
   */
  gridVocabulary?: number[][];

  /**
   * 호흡 가이드 — LLM 시스템 프롬프트에 그대로 붙어 들어가는 자연어.
   *
   * 페이지 시퀀스가 어떤 호흡으로 흘러야 하는지 1~3문장으로 기술.
   * 정보 밀도, 비주얼 페이지 빈도, 본문 호흡 길이 등을 자유롭게.
   *
   * 예 (Minimal Mono):
   *   "이 스타일은 여백을 사랑하는 차분한 호흡이다.
   *    본문 페이지가 길게 이어져도 무방하며,
   *    이미지는 강조점에서만 풀블리드로 등장한다."
   *
   * 예 (Warm Editorial):
   *   "잡지 같은 부드러운 호흡. 본문 사이에 이미지·인용이 자주 끼며,
   *    페이지마다 표정이 달라야 한다."
   *
   * 예 (Clean Corporate):
   *   "정보 밀도가 높은 비즈니스 문서. 표·차트 페이지가 자주 등장하며,
   *    본문은 압축적이고 군더더기 없다."
   *
   * 미지정 시 LLM은 기본 균형(중간 호흡)으로 동작.
   */
  rhythmGuide?: string;

  /** 인쇄 확장 — 마일스톤 2에서 본격적으로 채워짐 */
  print?: {
    /** CMYK + Pantone 매핑 (HEX → CMYK/Pantone) */
    cmyk?: Record<string, { c: number; m: number; y: number; k: number; pantone?: string }>;
    /** 단락 스타일 카탈로그 (read-only) */
    paragraphStyles?: ParagraphStyle[];
    /** 문자 스타일 카탈로그 (read-only) */
    characterStyles?: CharacterStyle[];
    /** 사용 폰트 (라이선스 포함) */
    fonts?: Font[];
    /** 색상 스와치 카탈로그 (모든 colorId의 출처) */
    colors?: Color[];
  };
};
