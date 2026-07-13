import { Platform } from 'react-native';

// 백엔드 주소 중앙 설정.
// 값을 바꾸려면 루트의 .env 에서 EXPO_PUBLIC_API_BASE 를 수정한다 (변경 후 Metro 재시작 필요).
// EXPO_PUBLIC_* 환경 변수는 번들 시점에 인라인되므로 런타임에는 바꿀 수 없다.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.33:8080';

// WebSocket 주소는 API_BASE에서 파생시켜 관리 지점을 하나로 유지한다.
export const WS_BASE = API_BASE.replace(/^http/, 'ws') + '/ws';

// 웹 프론트 배포 오리진 — 백엔드 WS 허용 오리진 목록에 등록된 값.
export const WEB_APP_ORIGIN = 'https://app.financialw.kro.kr';

// 시세 WebSocket 생성 헬퍼.
// 네이티브 RN 은 핸드셰이크의 Origin 헤더를 접속 URL 에서 파생시켜 보내는데
// (wss://www.financialw.kro.kr → Origin: https://www.financialw.kro.kr),
// 이 값이 백엔드 WS 허용 오리진에 없어 핸드셰이크가 403 으로 거부된다.
// 허용된 웹 프론트 오리진을 명시해 네이티브에서도 연결이 통과되게 한다.
// (브라우저는 Origin 을 스스로 설정하고 커스텀 헤더를 허용하지 않으므로 웹은 기본 생성)
// RN 런타임의 WebSocket 은 세 번째 인자(options.headers)를 지원하지만
// 타입 정의(lib.dom)에는 없어 any 캐스팅으로 우회한다.
export const createPriceSocket = (): WebSocket =>
  Platform.OS === 'web'
    ? new WebSocket(WS_BASE)
    : new (WebSocket as any)(WS_BASE, null, {
        headers: { Origin: WEB_APP_ORIGIN },
      });
