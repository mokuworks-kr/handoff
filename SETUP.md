# SETUP — 처음 한 번만

이 문서는 빈 GitHub 레포에 코드를 올린 직후부터, 배포된 사이트에서 Google 로그인 → 대시보드 진입까지 가는 모든 단계입니다. 순서대로 따라주세요.

소요 시간: **약 30~45분** (계정 생성 시간 제외).

---

## 0. 준비물

- GitHub 계정 + 빈 private repo (이미 있음)
- 신용/체크카드 (Vercel 무료 / Supabase 무료 / Anthropic는 충전식)
- Google 계정

---

## 1. 코드를 GitHub에 올리기

압축 해제 후 디렉토리 안에서:

```bash
git init
git add .
git commit -m "M1: infra + auth + empty dashboard"
git branch -M main
git remote add origin git@github.com:<your-username>/<your-repo>.git
git push -u origin main
```

푸시되면 GitHub에서 코드가 보여야 합니다.

---

## 2. Supabase 프로젝트 생성 + DB 마이그레이션

### 2-1. 프로젝트 만들기

1. https://supabase.com 가입 → New project
2. 입력:
   - **Name**: `handoff` (자유)
   - **Database Password**: 강한 비밀번호 (절대 분실 금지, 1Password 같은 곳에 저장)
   - **Region**: `Northeast Asia (Seoul)` 추천
3. 생성 완료까지 1~2분 대기

### 2-2. 마이그레이션 실행

좌측 메뉴 **SQL Editor → New query** 열고:

1. `supabase/migrations/0001_init.sql` 전체 복붙 → **Run**
   - "Success. No rows returned" 보이면 성공
2. **New query** 다시 → `supabase/migrations/0002_storage.sql` 전체 복붙 → **Run**

검증:
- 좌측 **Table Editor** 들어가면 `profiles`, `credit_transactions`, `projects`, `shares` 등 테이블 8개 보임
- 좌측 **Storage** 들어가면 `originals`, `exports`, `thumbnails`, `shared-images` 버킷 4개 보임
- 좌측 **Database → Functions** 에서 `deduct_credits`, `handle_new_user` 함수 보임

### 2-3. API 키 복사 (메모해두기)

좌측 **Project Settings → API**:

| 라벨 | 환경변수 이름 |
|---|---|
| `Project URL` | `NEXT_PUBLIC_SUPABASE_URL` |
| `Project API keys → anon public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `Project API keys → service_role secret` | `SUPABASE_SERVICE_ROLE_KEY` ⚠️ 절대 공개 X |

> service_role 키는 RLS를 우회합니다. 노출되면 모든 데이터에 무제한 접근 가능. 절대 클라이언트 코드/공개 레포에 두지 마세요.

---

## 3. Google OAuth 설정 (이게 가장 헷갈림)

### 3-1. Google Cloud 프로젝트

1. https://console.cloud.google.com 접속
2. 상단에서 **New Project** → 이름 `handoff` → 만들기
3. 좌측 메뉴 **APIs & Services → OAuth consent screen**:
   - **User Type**: External → Create
   - 앱 이름, 사용자 지원 이메일, 개발자 연락처 입력
   - Scopes: 기본만 두고 Save and Continue
   - Test users: 본인 Google 이메일 추가 (배포 후 검증용)
   - 완료
4. 좌측 메뉴 **Credentials → Create Credentials → OAuth client ID**:
   - **Application type**: Web application
   - **Name**: `handoff-web`
   - **Authorized redirect URIs** 에 다음을 추가:
     ```
     https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
     ```
     (`<your-supabase-project-ref>` 는 Supabase Project URL의 `https://` 와 `.supabase.co` 사이 부분)
   - Create
5. 모달에 뜨는 **Client ID**, **Client secret** 메모해두기

### 3-2. Supabase에 Google Provider 등록

Supabase 대시보드 → **Authentication → Providers → Google**:
- Enable
- **Client ID for OAuth**: 위에서 복사한 값
- **Client Secret for OAuth**: 위에서 복사한 값
- Save

### 3-3. Site URL과 Redirect URLs 등록

Supabase 대시보드 → **Authentication → URL Configuration**:
- **Site URL**: 일단 `http://localhost:3000` (배포 후 바꿈)
- **Redirect URLs** 에 다음을 모두 추가:
  ```
  http://localhost:3000/auth/callback
  https://your-vercel-domain.vercel.app/auth/callback
  ```
  (Vercel 도메인은 4단계에서 확정 후 다시 와서 추가)

---

## 4. Anthropic API 키

1. https://console.anthropic.com 가입
2. **Settings → API Keys → Create Key**
3. 키 메모 (한 번만 보여줌)
4. **Plans & Billing** 에서 결제수단 등록 + 최소 충전 ($5~10이면 M1~M3 충분)

> M1 단계에서는 LLM 호출이 없지만, 환경변수가 있어야 헬스체크가 OK 뜹니다.

---

## 5. Vercel 배포

### 5-1. 프로젝트 연결

1. https://vercel.com 가입 (GitHub 계정으로)
2. **Add New → Project** → GitHub repo 선택 → **Import**
3. **Framework Preset**: Next.js (자동 감지)
4. **Build / Output Settings**: 기본값 그대로

### 5-2. 환경변수 입력

같은 화면 **Environment Variables** 섹션에 다음 5개 추가:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (2-3에서 복사) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (2-3에서 복사) |
| `SUPABASE_SERVICE_ROLE_KEY` | (2-3에서 복사) |
| `ANTHROPIC_API_KEY` | (4에서 복사) |
| `NEXT_PUBLIC_SITE_URL` | 일단 비워두고 배포 후 채움 |

**Deploy** 클릭. 1~2분 기다림.

### 5-3. 도메인 확정 + URL 마무리

배포 완료 → 받은 도메인 (예: `handoff-abc.vercel.app`) 확인.

1. **Vercel → Project Settings → Environment Variables**:
   - `NEXT_PUBLIC_SITE_URL` 을 `https://handoff-abc.vercel.app` 로 수정 (끝에 슬래시 X)
   - 저장 후 **Deployments → 최신 → ⋯ → Redeploy** (환경변수 반영용)
2. **Supabase → Authentication → URL Configuration**:
   - **Site URL** 을 `https://handoff-abc.vercel.app` 로 수정
   - **Redirect URLs** 에 `https://handoff-abc.vercel.app/auth/callback` 가 들어가있는지 확인

---

## 6. 동작 검증

### 6-1. 헬스체크

`https://handoff-abc.vercel.app/api/health` 접속.

```json
{
  "status": "ok",
  "env": {
    "NEXT_PUBLIC_SUPABASE_URL": true,
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": true,
    "SUPABASE_SERVICE_ROLE_KEY": true,
    "ANTHROPIC_API_KEY": true,
    "NEXT_PUBLIC_SITE_URL": true
  },
  "supabase": { "ok": true, "error": null },
  "milestone": 1
}
```

`status: "ok"` 가 떠야 정상. `false`나 `error` 가 있으면 그게 첫 번째 막힌 곳.

### 6-2. 로그인 흐름

1. `https://handoff-abc.vercel.app/` → "시작하기" 버튼
2. `/login` → "Google로 계속하기"
3. Google 로그인 → 동의 → 자동으로 `/dashboard` 로 진입
4. 상단바 우측에 **크레딧 1,000** 표시되면 트리거가 정상 작동한 것
5. 좌측 상단 **Handoff** 클릭하면 대시보드, **로그아웃** 누르면 `/` 로

### 6-3. DB 확인

Supabase **Table Editor → profiles**: 본인 행 1개, `credit_balance = 1000`.
**credit_transactions**: `type = 'signup'`, `delta = 1000` 행 1개.

---

## 7. 로컬 개발

```bash
npm install
cp .env.example .env.local
# .env.local에 위 5개 값 입력 (NEXT_PUBLIC_SITE_URL은 http://localhost:3000)
npm run dev
```

`http://localhost:3000` 에서 동일하게 동작.

> 로컬에서 OAuth가 동작하려면 Supabase **Redirect URLs** 에 `http://localhost:3000/auth/callback` 가 있어야 합니다 (3-3 참고).

---

## 자주 막히는 지점

### "redirect_uri_mismatch" 에러
- Google Cloud Credentials의 redirect URI가 Supabase callback URL과 정확히 일치하는지 확인
- `.supabase.co/auth/v1/callback` 형태여야 함 (끝에 슬래시 X)

### 로그인 후 무한 루프 / 즉시 로그아웃
- Vercel 환경변수에 `NEXT_PUBLIC_SITE_URL` 이 실제 배포 도메인으로 정확히 설정됐는지
- Supabase **Site URL** 이 배포 도메인으로 설정됐는지
- 환경변수 변경 후 **Redeploy** 했는지

### 헬스체크는 OK인데 로그인 후 크레딧이 0
- `handle_new_user` 트리거가 안 걸렸을 가능성
- Supabase SQL Editor에서:
  ```sql
  select tgname from pg_trigger where tgrelid = 'auth.users'::regclass;
  ```
- `on_auth_user_created` 가 보여야 정상. 없으면 0001_init.sql 마지막 부분 다시 실행

### `cookies() should be awaited` 에러
- Next.js 15 + @supabase/ssr 0.10+ 조합. 코드에는 이미 await 적용돼있음. 이 에러가 뜨면 의존성이 옛 버전인지 확인.

---

## 다음 단계

마일스톤 1 완료 ✅. 다음 마일스톤(M3 — 원고 입력부터 캔버스 편집까지)으로 넘어갈 준비가 됐다고 알려주세요.
