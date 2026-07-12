import { Redirect } from 'expo-router';

// 카카오 OAuth 완료 후 백엔드가 /login-success 로 리다이렉트한다.
// 네이티브는 webview.tsx가 URL만 감지해 처리하지만, 웹은 실제 라우트가 필요하다.
export default function LoginSuccess() {
  return <Redirect href="/home" />;
}
