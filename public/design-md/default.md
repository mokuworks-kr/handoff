---
slug: default
name: Default
description: 기준 디자인. 무채색·미니멀·차분한 호흡. 모든 새 스타일의 복제 시드.
version: 1.0.0
author: handoff-builtin
license: MIT
---

# 1. Identity

회사소개서·IR·카탈로그처럼 신뢰감이 우선인 비즈니스 인쇄물의 기본값.
형광·비비드를 배제한 무채색 팔레트, 한 가지 본문 폰트(Pretendard),
넉넉한 여백. 어떤 산업·어떤 톤의 원고가 들어와도 무난하게 받아내는,
스타일 카탈로그의 안전한 출발점.

콘텐츠가 주연. 디자인은 무대.

# 2. Color

- background: #FFFFFF
- surface:    #FAFAFA
- text:       #0A0A0A
- textMuted:  #525252
- accent:     #000000
- border:     #EAEAEA

# 3. Typography

- headingFamily: Pretendard
- bodyFamily:    Pretendard
- bodySize:      10.5
- bodyLineHeight: 1.6

# 4. Grid Vocabulary

```yaml
- [12]      # 풀폭 — 본문, 표지, 장 시작
- [6, 6]    # 반반 — 좌우 동등 비교, 이미지+텍스트
- [8, 4]    # 8:4 — 본문 + 사이드바, 큰 이미지 + 캡션
```

3가지로 시작. 부족하면 같은 톤 안에서 변종(default-rich 등)을 만들어 비율 추가.

# 5. Rhythm

차분하고 균형 잡힌 호흡. 본문 페이지가 길게 이어져도 무방하며,
이미지·차트는 강조점에서만 등장한다.
정보 밀도는 중간 — 비즈니스 문서로 읽기 편한 수준.

# 6. Spacing

- unit:   4         # 모든 spacing은 이 mm의 배수
- micro:  1         # 4mm
- small:  2         # 8mm
- medium: 4         # 16mm
- large:  8         # 32mm

# 7. Imagery

자연광 사진 위주. 인물보다 환경·오브제. 채도 낮춤.
풀블리드는 절제 — 책 한 권에 2~3장 정도가 적당.
회사소개서라면 사무실 풍경·제품 사진·팀 단체사진 등 표준 비즈니스 이미지.

# 8. Components

- 인용: 본문보다 1단계 큰 크기, 좌측 1pt accent 라인.
- 캡션: textMuted 색, 본문보다 한 단계 작게.
- 페이지 번호: 안쪽 가장자리(insideEdge), textMuted, 본문 크기.
- 장 제목: 풀폭, 페이지 상단 1/3 지점, headingFamily Bold.

(M3·M4에서 컴포넌트 시스템이 본격화될 때 보강.)

---

# Print

## CMYK & Pantone

```yaml
"#FFFFFF":
  c: 0
  m: 0
  y: 0
  k: 0
"#FAFAFA":
  c: 0
  m: 0
  y: 0
  k: 2
"#0A0A0A":
  c: 0
  m: 0
  y: 0
  k: 100
  pantone: Black 6 C
"#525252":
  c: 0
  m: 0
  y: 0
  k: 70
"#EAEAEA":
  c: 0
  m: 0
  y: 0
  k: 8
```

## Paragraph Styles

```yaml
- id: h1
  name: 제목 1
  fontFamily: Pretendard
  fontSize: 24
  lineHeight: 1.3
  alignment: left
  colorId: ink-900
  spaceAfter: 8
  keepWithNext: 1

- id: h2
  name: 제목 2
  fontFamily: Pretendard
  fontSize: 16
  lineHeight: 1.4
  alignment: left
  colorId: ink-900
  spaceAfter: 4
  keepWithNext: 1

- id: body
  name: 본문
  fontFamily: Pretendard
  fontSize: 10.5
  lineHeight: 1.6
  alignment: left
  colorId: ink-900
  spaceAfter: 4

- id: caption
  name: 캡션
  fontFamily: Pretendard
  fontSize: 8.5
  lineHeight: 1.5
  alignment: left
  colorId: ink-600
```

## Character Styles

```yaml
- id: emphasis
  name: 강조
  weight: 600

- id: muted
  name: 약하게
  colorId: ink-600
```

## Fonts

```yaml
- family: Pretendard
  displayName: Pretendard Variable
  license: OFL
  redistributable: true
  fallbacks: [Noto Sans KR, system-ui, sans-serif]
```

## Colors

```yaml
- id: surface-canvas
  name: Canvas
  hex: "#FAFAFA"
  cmyk: { c: 0, m: 0, y: 0, k: 2 }

- id: surface
  name: Surface
  hex: "#FFFFFF"
  cmyk: { c: 0, m: 0, y: 0, k: 0 }

- id: ink-900
  name: Ink 900
  hex: "#0A0A0A"
  cmyk: { c: 0, m: 0, y: 0, k: 100 }
  pantone: Black 6 C

- id: ink-600
  name: Ink 600
  hex: "#525252"
  cmyk: { c: 0, m: 0, y: 0, k: 70 }

- id: ink-400
  name: Ink 400
  hex: "#A3A3A3"
  cmyk: { c: 0, m: 0, y: 0, k: 36 }

- id: border
  name: Border
  hex: "#EAEAEA"
  cmyk: { c: 0, m: 0, y: 0, k: 8 }
```
