# Handoff

AI 기반 인쇄 디자인 자동 생성 도구. 회사소개서/IR/카탈로그 등 다페이지 인쇄물을 자연어로 생성하고 어도비 파일로 핸드오프합니다.

> **현재 상태**: 마일스톤 1 (인프라 + 인증 + 빈 대시보드)

## 셋업

처음 세팅하시는 거라면 **[SETUP.md](./SETUP.md)** 를 순서대로 따라주세요. GitHub/Vercel/Supabase/Google OAuth/Anthropic 가입부터 첫 배포까지 단계별 가이드가 있습니다.

## 빠른 시작 (이미 셋업이 끝난 경우)

```bash
npm install
cp .env.example .env.local
# .env.local에 실제 값 채워넣기
npm run dev
```

## 스택

- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase (Postgres + Auth + Storage)
- Anthropic Claude Sonnet 4.5
- Tailwind CSS
- Vercel (배포)

## 프로젝트 구조

```
app/                  # Next.js App Router
  (marketing)/        # 랜딩
  (auth)/login/       # 로그인 화면
  auth/callback/      # OAuth 콜백
  auth/signout/       # 로그아웃
  dashboard/          # 메인 대시보드
  api/                # API Routes
components/           # React 컴포넌트
  ui/                 # 기본 UI (Button 등)
  shared/             # 공용 컴포넌트 (Topbar 등)
lib/
  types/              # 추상 레이아웃 모델 등 타입
  supabase/           # Supabase 클라이언트 3종
  anthropic/          # Anthropic 클라이언트
  utils/              # 공용 유틸
supabase/migrations/  # DB 마이그레이션 SQL
```

## 마일스톤

- [x] **M1** 인프라 + 인증 + 빈 대시보드
- [ ] **M2** 디자인 자산 (8~12 스타일, 30 템플릿)
- [ ] **M3** 원고 입력 → 자동 생성 → 캔버스 → 편집
- [ ] **M4** 출력 (PDF/JSX/플립북) + 크레딧/결제
- [ ] **M5** 베타 출시
