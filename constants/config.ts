// 백엔드 주소 중앙 설정.
// 값을 바꾸려면 루트의 .env 에서 EXPO_PUBLIC_API_BASE 를 수정한다 (변경 후 Metro 재시작 필요).
// EXPO_PUBLIC_* 환경 변수는 번들 시점에 인라인되므로 런타임에는 바꿀 수 없다.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'http://192.168.0.33:8080';

// WebSocket 주소는 API_BASE에서 파생시켜 관리 지점을 하나로 유지한다.
export const WS_BASE = API_BASE.replace(/^http/, 'ws') + '/ws';
