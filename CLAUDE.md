# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 이 저장소에서 작업할 때는 사용자 지침에 따라 한국어로 응답한다.

## 개요

주식 관심 종목, 실시간 시세, 캔들 차트, 카카오 OAuth 로그인을 제공하는 Expo / React Native 모바일(+웹) 앱이다. UI 문구와 코드 주석은 모두 한국어로 작성되어 있다. 별도의 백엔드(이 저장소에 없음)와 HTTP + WebSocket으로 통신한다.

기술 스택: Expo SDK 54, expo-router v6(파일 기반 라우팅), React 19, React Native 0.81, TypeScript(strict). New Architecture와 React Compiler가 모두 활성화되어 있다 (`app.json` → `experiments`).

## 명령어

```bash
npm install            # 의존성 설치
npx expo start         # Metro 개발 서버 실행 (또는: npm start)
npm run android        # 실행 + Android 열기
npm run ios            # 실행 + iOS 열기
npm run web            # 실행 + 웹 열기
npm run lint           # eslint (eslint-config-expo flat config)
```

**테스트 프레임워크가 설정되어 있지 않다** — `npm test`도, 테스트 파일도 없다. Jest/Vitest가 있다고 가정하지 말 것.

`npm run reset-project`는 Expo 스타터에 딸려 온 도구로, 앱을 `app-example/`로 옮기고 `app/`을 비운다. 실행하지 말 것.

## 백엔드 결합 (가장 중요)

모든 화면이 백엔드 주소를 모듈 최상단 상수로 하드코딩하고 있다:

```ts
const API_BASE = 'http://192.168.0.33:8080';
const WS_BASE  = 'ws://192.168.0.33:8080/ws';
```

이 LAN IP가 `app/(tabs)/index.tsx`, `app/(tabs)/home.tsx`, `app/detail.tsx`, `app/(tabs)/webview.tsx`에 중복되어 있다. 백엔드 주소가 바뀌면 **네 파일을 모두 수정해야 한다.** 중앙 설정이나 환경 변수는 없다.

모든 인증 요청은 `fetch(..., { credentials: 'include' })`를 통한 쿠키 기반 인증을 사용한다. 코드에 베어러 토큰은 없다.

### 앱이 의존하는 백엔드 계약

- 인증: `GET /auth/me`(현재 회원), `GET /auth/reissue`(401 시 토큰 재발급), `GET /auth/kakao`(카카오 OAuth 시작), `POST /auth/logout`. OAuth 완료 후 백엔드는 `/login-success`가 포함된 URL로 리다이렉트하며, `webview.tsx`가 이를 감지해 홈으로 이동한다.
- 관심 종목: `GET /watchlist`(심볼 `string[]` 반환), `POST /watchlist?symbol=`, `DELETE /watchlist?symbol=`.
- 주식: `GET /stock/search?q=`, `GET /stock/latest-prices?symbols=AAA,BBB`, `GET /candles?symbol=&resolution=`(Yahoo Finance 형태의 `chart.result[0]` 페이로드), `GET /support-resistance?symbol=&resolution=`.
- WebSocket(`/ws`): 클라이언트는 `{type:'ENTER', symbols}`, `{type:'ADD', symbol}`, `{type:'REMOVE', symbol}`를 보내고, 서버는 `{type:'PRICE', symbol, price}`를 푸시한다.

## 라우팅 & 화면 구조

라우트는 `app/` 아래의 파일로 정의된다(expo-router). 실제 앱은 네 개의 화면뿐이다:

- `app/(tabs)/index.tsx` — 진입/로그인. 마운트 시 `/auth/me`를 확인하고, 실패하면 `/auth/reissue`로 폴백한 뒤 `/home`으로 이동하거나 카카오 로그인 버튼을 보여준다. **로그인은 플랫폼별로 분기한다:** 웹은 `window.location.href = .../auth/kakao`로 이동하고, 네이티브는 `/webview` 화면을 푸시한다.
- `app/(tabs)/home.tsx` — 관심 종목. WebSocket 연결, 디바운스된 심볼 검색(300ms), 추가/삭제, 실시간 시세 행을 담당한다. 행을 누르면 `symbol`과 `initialPrice` 파라미터와 함께 `/detail`로 이동한다.
- `app/detail.tsx` — 캔들 차트(`react-native-wagmi-charts`)와 기간 탭(1D/1W/1M/3M/1Y/MAX), 실시간 마지막 캔들 갱신용 자체 WebSocket, 그리고 커스텀 지지/저항 오버레이를 가진다. `(tabs)`가 아니라 **루트**에 위치한다.
- `app/(tabs)/webview.tsx` — 네이티브 전용 카카오 OAuth WebView.

참고: `(tabs)` 그룹에는 **`_layout.tsx`가 없어서** 실제로는 탭 바가 아니며, 화면들은 일반 스택 화면으로 렌더링된다. `app/_layout.tsx`가 유일한 내비게이터다(`(tabs)`와 `modal`을 등록하는 `Stack`).

그 외 나머지(`app/modal.tsx`, `components/` 전체, `components/ui/`, `constants/theme.ts`, `hooks/`)는 네 개의 실제 화면이 import하지 않는 **미사용 Expo 스타터 보일러플레이트**다. 의도적으로 도입하는 게 아니라면 앱의 디자인 시스템으로 취급하지 말 것.

## 컨벤션 / 주의점

- **시세 색상은 한국 관례를 따른다: 빨강 = 상승, 파랑 = 하락** — 미국 시장과 반대다. `home.tsx`의 행 색상 로직과 `detail.tsx`의 `COLOR_BULL`/`COLOR_BEAR`를 참고할 것.
- 경로 별칭 `@/*`는 저장소 루트를 가리킨다(`tsconfig.json`).
- `detail.tsx`의 `renderSupportResistanceZones()`에는 라벨 겹침 방지 로직이 직접 구현되어 있다(Y 기준 정렬 후, 겹치는 라벨을 `MIN_DISTANCE`만큼 아래로 밀어냄). 오버레이를 수정할 때 이 로직을 보존할 것.
- 백엔드를 호출하는 새 화면은 `API_BASE`/`WS_BASE` 상수와 `credentials: 'include'`를 직접 추가해야 한다 — 기존 화면을 그대로 따를 것.
