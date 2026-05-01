# Handoff DESIGN.md 표준 (fork v1)

이 문서는 **Handoff가 디자인 스타일을 정의하는 표준 형식**입니다.
`public/design-md/<slug>.md` 파일 하나가 디자인 스타일 1개와 1:1 대응합니다.

> **fork 정책 (§11 결정)** — 이 표준은 Google Stitch DESIGN.md 알파에서 영감을 받았지만 **추적하지 않습니다**. Stitch의 후속 변경에 우리가 따라가지 않습니다. 인쇄 도메인의 안정성을 우선합니다. Stitch 알파를 처음 본 사람은 섹션 이름이 비슷해 보일 수 있지만, 우리 의미가 우선입니다.

---

## 파일 구조

각 디자인 스타일 파일은 다음 형태입니다.

```
---
slug: minimal-mono
name: Minimal Mono
description: 한 줄 설명
version: 1.0.0
author: handoff-builtin
license: MIT
---

# 1. Identity
...

# 2. Color
...

(섹션 8개 + print 확장)
```

상단 YAML 프론트매터의 필수/선택 필드:

| 필드 | 필수 | 의미 |
|---|---|---|
| `slug` | ✅ | 영문 케밥 케이스. 파일명과 일치 (`minimal-mono.md` ↔ `slug: minimal-mono`) |
| `name` | ✅ | 사람이 읽는 이름 |
| `description` | ✅ | 한 줄 설명 |
| `version` | ⚠️ 권장 | semver. 1차 builtin 모두 `1.0.0` |
| `author` | ⚠️ 권장 | 작자 식별자. 1차 builtin 모두 `handoff-builtin` |
| `license` | ⚠️ 권장 | 라이선스. 1차 builtin 모두 `MIT` |

본문은 `# 1. Identity` 부터 `# 8. Components` 까지 8개 섹션 + `# Print` 확장 섹션.

> **§1 약속 — 어조/Voice 섹션 없음** (M2.5 결정)
> Handoff는 사용자 원고를 절대 다듬지 않는다는 §1 차별점을 시스템 구조 자체로 강제합니다. DESIGN.md에 어조 가이드 섹션을 두면, 미래에 어디선가 "이 가이드대로 원고 톤을 맞추자"는 합리화 경로가 열립니다. 그 경로를 처음부터 만들지 않습니다.
>
> 자동 캡션/부제 추천 같은 *보조 텍스트* 생성 기능을 정말 만들기로 결정하는 시점(M3 이후)에, **그 기능 단위로** 어조 가이드 여부를 따로 결정합니다. DESIGN.md의 영구 섹션으로 박지 않습니다.

> **author/license/version 정책 (M3a-3 결정)**
>
> 1차 출시에서 builtin 카탈로그만 있어 모든 디자인이 같은 메타데이터(handoff-builtin / MIT / 1.0.0)를 가집니다. 이 필드는 미래 커뮤니티 카탈로그 도입 시 변종 디자인이 자기 작자/라이선스를 명시하기 위한 사전 작업입니다.
>
> 자세한 정책은 `lib/types/design-tokens.ts` 의 `DesignAuthor` 와 `license` 필드 헤더 참조.

---

## 섹션 8개

### 1. Identity
이 스타일이 *무엇인지* 한 단락. 누구를 위한, 어떤 톤의, 어떤 매체에 어울리는 디자인인지.
LLM 시스템 프롬프트에 그대로 들어갑니다.

### 2. Color
컬러 팔레트. **HEX 값**으로 적습니다. 인쇄용 CMYK·Pantone은 `# Print` 섹션에서.

```
- background: #FFFFFF
- surface:    #FAFAFA
- text:       #0A0A0A
- textMuted:  #525252
- accent:     #000000
- border:     #EAEAEA
```

`extra` 키 아래에 추가 색상 자유 (예: `extra.warning: #...`).

### 3. Typography
폰트와 본문 크기.

```
- headingFamily: Pretendard
- bodyFamily:    Pretendard
- monoFamily:    JetBrains Mono   # 선택
- bodySize:      10.5             # pt
- bodyLineHeight: 1.6             # 배수
```

### 4. Grid Vocabulary  ← M2.5 신규
**책 한 권에서 허용된 컬럼 비율 화이트리스트.** 정수쌍 배열.
각 배열의 합은 `Format.columns` (보통 12)와 같아야 합니다.

```yaml
- [12]      # 풀폭
- [6, 6]    # 반반
- [8, 4]    # 8:4
```

권장 3~5개. 적을수록 책이 단순·통일적, 많을수록 다양 ↔ 통일감 ↓.
페이지네이션 LLM은 이 어휘 안에서만 비율을 고릅니다.
**자세한 정책: `lib/types/design-tokens.ts` 헤더 참조.**

### 5. Rhythm  ← M2.5 신규
**페이지 시퀀스의 호흡을 자연어로 1~3문장.** LLM 시스템 프롬프트에 그대로 들어갑니다.

> 예 (Minimal Mono):
> "이 스타일은 여백을 사랑하는 차분한 호흡이다. 본문 페이지가 길게 이어져도 무방하며, 이미지는 강조점에서만 풀블리드로 등장한다."

리듬을 enum/규칙이 아니라 자연어로 두는 이유는 `lib/types/design-tokens.ts` 헤더 참조 (요지: 디자인 호흡은 규칙이 아니라 감각이라 코드화하면 책이 기계적이 됨).

### 6. Spacing
간격 시스템. 모든 단위는 `Format.unit` (보통 mm).

```
- unit: 4         # 1 단위 = 4mm. 모든 spacing은 이 배수.
- micro:  1       # 4mm
- small:  2       # 8mm
- medium: 4       # 16mm
- large:  8       # 32mm
```

### 7. Imagery
이미지 사용 가이드. 자연어. 회사소개서·IR 문맥에서 어떤 이미지를 쓸지.

> 예: "흑백 또는 모노톤 처리. 인물보다 풍경·오브제 위주. 풀블리드 빈도는 낮게."

LLM이 Unsplash 검색 쿼리를 짤 때 + 사용자가 자기 사진 업로드할 때 둘 다의 가이드.

### 8. Components
재사용 가능한 미세 컴포넌트의 시각 약속. 자연어 + 토큰 참조.

> 예:
> - 인용: 좌측에 1pt accent 색 라인. 본문보다 1단계 작은 크기.
> - 캡션: 본문 색의 textMuted 사용. italic.
> - 페이지 번호: 안쪽 가장자리(insideEdge). textMuted.

(M3·M4에서 컴포넌트 시스템이 본격화될 때 채워짐 — 지금은 가벼운 메모만 OK.)

---

## # Print (인쇄 확장 섹션)

위 8개 섹션 다음에 추가되는 인쇄 전용 정보.

### CMYK & Pantone
HEX → CMYK·Pantone 매핑.

```yaml
"#0A0A0A":
  c: 0
  m: 0
  y: 0
  k: 100
  pantone: Black 6 C
```

### Paragraph Styles
단락 스타일 카탈로그. `lib/types/styles.ts` 의 `ParagraphStyle` 타입과 1:1.

```yaml
- id: body
  name: 본문
  fontFamily: Pretendard
  fontSize: 10.5      # pt
  lineHeight: 1.6     # 배수
  alignment: left
  spaceAfter: 4       # mm
```

### Character Styles
인라인 강조 스타일. `CharacterStyle` 타입과 1:1.

### Fonts
사용 폰트 + 라이선스. 인쇄 PDF 임베드·InDesign 누락 폰트 처리에 사용.

```yaml
- family: Pretendard
  displayName: Pretendard Variable
  license: OFL
  redistributable: true
  fallbacks: [Noto Sans KR, system-ui]
```

### Colors
색상 스와치 카탈로그. **모든 frame/style이 `colorId`로 참조하는 출처.**

```yaml
- id: ink-900
  name: Ink 900
  hex: "#0A0A0A"
  cmyk: { c: 0, m: 0, y: 0, k: 100 }
  pantone: Black 6 C
- id: surface
  name: Surface
  hex: "#FFFFFF"
```

---

## 검증 규칙

스타일 파일이 유효하려면:

1. 프론트매터 `slug`/`name`/`description` 모두 있어야 함
2. `slug`는 파일명과 일치 (확장자 제외)
3. 섹션 8개 모두 있어야 함 (`# Print`는 선택)
4. **Color 섹션의 6개 필수 키**(background/surface/text/textMuted/accent/border) 모두 있어야 함
5. `Grid Vocabulary` 의 각 비율 합 = 12 (또는 사용 Format의 columns)
6. `Print > Colors` 의 `id`는 영문 케밥 케이스. paragraphStyles/characterStyles의 `colorId`는 이 카탈로그에 존재해야 함
7. `version` 가 있으면 semver 형식 ("1.0.0")
8. `license` 가 있으면 SPDX 식별자 또는 자유 문자열

검증 함수는 `lib/design-md/validate.ts` (M2 디자인 작업과 함께 추가 예정).

---

## 추가 시 절차

1. `default.md` 복제 → `<slug>.md`
2. 프론트매터 `slug`/`name`/`description` 수정
3. 섹션 1~8 + Print 채움
4. 로컬에서 `npm run typecheck` (M2 디자인 작업 후 추가될 검증 함수가 통과해야 함)
5. PR

---

## 현재 카탈로그

- `default.md` — 기준 디자인. 무채색·미니멀·차분한 호흡. 모든 새 스타일의 시드.

(M2에서 추가 예정: `minimal-mono`, `warm-editorial`, `clean-corporate` 등 8~12개)
