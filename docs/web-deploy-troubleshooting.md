# 웹(Vercel) 배포 트러블슈팅 기록

> 2026-07-12 ~ 07-13, 아이폰 친구들도 쓸 수 있게 웹 배포를 진행하며 겪은 문제와 해결 과정.
> 배포 주소: **https://app.financialw.kro.kr** (Vercel, `main` 브랜치 자동 배포)

## 배경: 왜 웹 배포인가

- 목표: 앱스토어 없이 친구들이 앱을 쓰게 하기.
- 안드로이드는 APK를 직접 배포하면 되지만, **iOS는 개발자 계정($99/년) 없이는 사이드로딩이 비현실적** (무료 계정은 7일마다 Mac에 연결해 재서명 필요).
- 이 앱은 네이티브 전용 기능이 없고 카카오 로그인도 웹 분기가 이미 구현돼 있어, **아이폰 사용자는 웹으로 커버**하기로 결정.
- 네이티브 앱(iOS)은 본인만 Xcode로 설치해 사용.

---

## 문제 1: Vercel 배포가 404

**증상**: `financialwfe.vercel.app` 접속 시 Vercel `404: NOT_FOUND`.

**원인**: 저장소에 `build` 스크립트도 `vercel.json`도 없어서 Vercel이 빌드 방법을 모름 → 배포 결과물이 비어 있었음. Vercel은 Expo 프로젝트를 자동 인식하지 못한다.

**해결**: `vercel.json` 추가.

```json
{
  "framework": null,
  "buildCommand": "npx expo export --platform web",
  "outputDirectory": "dist",
  "cleanUrls": true,
  "trailingSlash": false
}
```

`.gitignore`에 `/dist`도 추가 (빌드는 Vercel이 하므로 커밋하지 않음).

## 문제 2: `expo export` 자체가 실패

**증상**: `Error: Layout ./_layout.tsx has invalid anchor '(tabs)'`

**원인**: 루트 `app/_layout.tsx`의 `unstable_settings.anchor = '(tabs)'`(Expo 스타터 잔재). `(tabs)` 그룹에 `_layout.tsx`가 없어서 정적 export가 앵커를 해석하지 못함.

**해결**: `unstable_settings` 블록 제거.

## 문제 3: 화면 상단에 `(tabs)/index` 라우트 이름 노출

**증상**: 배포된 웹에서 헤더에 `(tabs)/index` 같은 라우트 이름이 그대로 표시됨.

**원인**: `_layout.tsx`가 존재하지 않는 `(tabs)` 그룹 라우트에 `headerShown: false`를 걸고 있어서 실제 화면에는 아무 옵션도 적용되지 않았음.

**해결**: 실제 라우트별로 옵션 지정 —
`(tabs)/index`·`(tabs)/home`은 헤더 숨김, `detail`은 "종목 상세", `webview`는 "카카오 로그인" 제목. 네이티브에도 동일 적용됨.

## 문제 4: 카카오 로그인 후 404 (`/login-success`)

**증상**: 웹에서 카카오 로그인 완료 → Vercel `404: NOT_FOUND`.

**원인**: 백엔드가 OAuth 완료 후 `<프론트>/login-success`로 리다이렉트하는데, 프론트에 해당 라우트가 없었음. **네이티브에서는 `webview.tsx`가 URL 패턴만 감지**하고 페이지를 렌더링하지 않아 문제가 없었지만, 웹은 브라우저가 그 주소를 실제로 연다.

**해결**: `app/login-success.tsx` 추가 — `/home`으로 즉시 `<Redirect>`.

## 문제 5: PC 크롬은 로그인되는데 아이폰은 안 됨 (핵심 문제)

**증상**: 아이폰 Safari에서 카카오 로그인을 해도 계속 로그인 화면으로 돌아옴.

**원인**: 프론트(`financialwfe.vercel.app`)와 백엔드(`www.financialw.kro.kr`)가 **다른 사이트**라 인증 쿠키가 서드파티 쿠키가 됨.
- PC 크롬: 서드파티 쿠키 허용 → 정상
- iOS Safari(및 iOS 크롬 — 같은 WebKit): **서드파티 쿠키 전면 차단** → `/auth/me`에 쿠키가 안 실려 401 → 로그인 화면으로 튕김

**해결**: 프론트를 백엔드와 **같은 사이트**로 이동 — `app.financialw.kro.kr`을 Vercel 커스텀 도메인으로 연결.
1. Vercel → 프로젝트 → Settings → Domains → `app.financialw.kro.kr` 추가
2. 내도메인.한국 관리 패널 → 별칭(CNAME) → 이름 `app`, 값은 Vercel이 제시한 CNAME (끝의 점 제거, 기존 IP연결(A) 레코드는 그대로 유지 — 백엔드 연결임)
3. DNS 전파 후 Vercel이 SSL 인증서 자동 발급 (수 분 소요, "Generating SSL Certificate" 표시는 정상)

`app.financialw.kro.kr`과 `www.financialw.kro.kr`은 같은 등록 도메인(`financialw.kro.kr`) 소속이라 브라우저가 같은 사이트로 취급 → Safari도 쿠키를 차단하지 않음.

---

## 운영 참고사항

- **Vercel 환경변수**: `EXPO_PUBLIC_API_BASE=https://www.financialw.kro.kr` (Settings → Environment Variables). 커밋된 `.env`의 `localhost`보다 대시보드 변수가 우선한다. 값 변경 시 재배포 필요 (빌드 시점에 인라인됨).
- **`.env`는 로컬 개발용**: 웹 배포에는 영향 없음. 본인 아이폰용 네이티브 빌드 시에만 `.env`를 공개 주소로 바꾼다.
- **친구들에게 공유할 주소는 `https://app.financialw.kro.kr`**. 기존 `financialwfe.vercel.app`도 살아 있지만 아이폰 로그인이 안 되므로 공유하지 말 것.
- **배포 흐름**: `main`에 푸시하면 Vercel이 자동 빌드·배포.

## 백엔드에 필요했던 설정 (참고)

- CORS: 허용 오리진에 프론트 주소 추가 + `Access-Control-Allow-Credentials: true`
- 카카오 로그인 성공 리다이렉트: `https://app.financialw.kro.kr/login-success`
- nginx가 `/ws` WebSocket 업그레이드 프록시 지원 (확인 완료)
