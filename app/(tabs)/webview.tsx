import { useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';

export default function WebViewScreen() {
  const router = useRouter();

  return (
    <WebView
      source={{ uri: 'http://192.168.0.33:8080/auth/kakao' }}
      onNavigationStateChange={(navState) => {
        // 로그인 완료 후 redirect 감지
        if (navState.url.includes('/login-success')) {
          console.log("로그인 완료!");

          // 홈으로 이동
          router.replace('/home');
        }
      }}
    />
  );
}
