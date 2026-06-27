# Financial — 주식 관심 종목 & 실시간 차트 앱

주식 **관심 종목**, **실시간 시세**, **토스 스타일 차트**, **카카오 OAuth 로그인**을 제공하는 Expo / React Native 모바일(+웹) 앱입니다. 별도의 백엔드(이 저장소에 없음)와 **HTTP + WebSocket**으로 통신합니다.

> UI 문구와 코드 주석은 모두 한국어로 작성되어 있습니다.

## 주요 기능

- **카카오 OAuth 로그인** — 웹은 리다이렉트, 네이티브는 WebView로 분기. 쿠키 기반 인증(`credentials: 'include'`).
- **관심 종목** — 종목 검색(300ms 디바운스), 추가/삭제, 실시간 시세 행.
- **실시간 시세** — WebSocket으로 가격 푸시 수신.
- **상세 차트 화면**
  - 토스 스타일 **라인/영역 차트** (등락에 따라 빨강=상승 / 파랑=하락)
  - 기간 탭: 1일 / 1주 / 1개월 / 3개월 / 1년 / 전체
  - **최고점·최저점·현재점** 가로선 + 라벨
  - **드래그 스크럽** — 차트를 누른 채 움직이면 해당 시점의 가격·시각이 헤더에 표시되고, 떼면 현재가로 복귀
  - **지지/저항 존(밴드)** — 상단 경계=저항(빨강), 하단 경계=지지(파랑)

## 기술 스택

- **Expo SDK 54**, **expo-router v6** (파일 기반 라우팅)
- **React 19**, **React Native 0.81**, **TypeScript (strict)**
- New Architecture + React Compiler 활성화 (`app.json` → `experiments`)
- 차트: `react-native-wagmi-charts` (+ `react-native-svg`)
- 제스처/애니메이션: `react-native-gesture-handler`, `react-native-reanimated`

## 시작하기

```bash
npm install          # 의존성 설치
npx expo start       # Metro 개발 서버 실행 (또는: npm start)
```

실행 후 출력되는 옵션에서 플랫폼을 선택하거나, 아래 스크립트를 사용하세요.

```bash
npm run android      # 실행 + Android 열기
npm run ios          # 실행 + iOS 열기
npm run web          # 실행 + 웹 열기
npm run lint         # eslint (eslint-config-expo)
```

> **테스트 프레임워크는 설정되어 있지 않습니다** — `npm test`나 테스트 파일이 없습니다.
> `npm run reset-project`는 Expo 스타터에 딸려 온 도구로, 앱을 `app-example/`로 옮기고 `app/`을 비웁니다. **실행하지 마세요.**

## 백엔드 설정

모든 화면이 백엔드 주소를 모듈 최상단 상수로 **하드코딩**합니다.

```ts
const API_BASE = 'http://192.168.0.33:8080';
const WS_BASE  = 'ws://192.168.0.33:8080/ws';
```

이 LAN IP가 `app/(tabs)/index.tsx`, `app/(tabs)/home.tsx`, `app/detail.tsx`, `app/(tabs)/webview.tsx`에 중복되어 있습니다. **백엔드 주소가 바뀌면 네 파일을 모두 수정해야 합니다.** (중앙 설정/환경 변수 없음)

### 백엔드 계약

- **인증**: `GET /auth/me`, `GET /auth/reissue`(401 시 재발급), `GET /auth/kakao`(OAuth 시작), `POST /auth/logout`. OAuth 완료 후 백엔드는 `/login-success`가 포함된 URL로 리다이렉트.
- **관심 종목**: `GET /watchlist`(심볼 `string[]`), `POST /watchlist?symbol=`, `DELETE /watchlist?symbol=`.
- **주식**: `GET /stock/search?q=`, `GET /stock/latest-prices?symbols=AAA,BBB`, `GET /candles?symbol=&resolution=`(Yahoo Finance 형태의 `chart.result[0]`), `GET /support-resistance?symbol=&resolution=`.
- **WebSocket (`/ws`)**: 클라이언트가 `{type:'ENTER', symbols}` / `{type:'ADD', symbol}` / `{type:'REMOVE', symbol}`를 보내면, 서버가 `{type:'PRICE', symbol, price}`를 푸시.

## 화면 구조 (expo-router)

라우트는 `app/` 아래 파일로 정의됩니다. 실제 사용하는 화면은 네 개입니다.

| 경로 | 설명 |
|------|------|
| `app/(tabs)/index.tsx` | 진입/로그인. `/auth/me` → 실패 시 `/auth/reissue` 폴백 후 홈 이동, 또는 카카오 로그인 버튼 |
| `app/(tabs)/home.tsx` | 관심 종목. WebSocket 연결, 검색, 추가/삭제, 실시간 시세 |
| `app/detail.tsx` | 토스 스타일 라인 차트 상세 (기간 탭, 스크럽, 지지/저항 존). **루트에 위치** |
| `app/(tabs)/webview.tsx` | 네이티브 전용 카카오 OAuth WebView |

> `(tabs)` 그룹에는 `_layout.tsx`가 없어 실제 탭 바가 아니며, 일반 스택 화면으로 렌더링됩니다. 유일한 내비게이터는 `app/_layout.tsx`입니다. 그 외 `components/`, `constants/`, `hooks/` 등은 대부분 **미사용 Expo 스타터 보일러플레이트**입니다.

## 컨벤션

- **시세 색상은 한국 관례**: 🔴 빨강 = 상승, 🔵 파랑 = 하락 (미국 시장과 반대).
- 경로 별칭 `@/*`는 저장소 루트를 가리킵니다(`tsconfig.json`).
- 백엔드를 호출하는 새 화면은 `API_BASE`/`WS_BASE` 상수와 `credentials: 'include'`를 직접 추가합니다.

자세한 작업 가이드는 [`CLAUDE.md`](./CLAUDE.md)를 참고하세요.
