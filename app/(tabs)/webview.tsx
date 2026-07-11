import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

import { API_BASE } from '@/constants/config';

export default function WebViewScreen() {
  const router = useRouter();

  return (
    <WebView
      source={{ uri: `${API_BASE}/auth/kakao` }}
      // 로그인으로 발급된 세션 쿠키를 앱의 fetch(credentials: 'include')와 공유한다.
      // 이 설정이 없으면 iOS(WKWebView)에서 로그인에 성공해도 /auth/me 가 401이 난다.
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      onNavigationStateChange={(navState) => {
        // 로그인 완료 후 redirect 감지
        if (navState.url.includes('/login-success')) {
          console.log('로그인 완료!');

          // 홈으로 이동
          router.replace('/home');
        }
      }}
    />
  );
}
