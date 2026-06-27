import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'; // Platform 추가

const API_BASE = 'http://192.168.0.33:8080';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const meRes = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
      if (meRes.ok) {
        router.replace('/home');
        return;
      }

      const reissueRes = await fetch(`${API_BASE}/auth/reissue`, {
        method: 'GET',
        credentials: 'include',
      });

      if (reissueRes.ok) {
        router.replace('/home');
        return;
      }
      
      setChecking(false);
    } catch (e) {
      console.log("인증 체크 실패 (로그아웃 상태)");
      setChecking(false);
    }
  };

  // ✅ 버튼을 눌렀을 때 플랫폼별로 다르게 동작하는 함수 추가
  const handleKakaoLogin = () => {
    if (Platform.OS === 'web') {
      // 1. 웹(컴퓨터)인 경우: WebView를 쓰지 않고 브라우저 자체를 로그인 주소로 이동시킵니다.
      window.location.href = `${API_BASE}/auth/kakao`; 
    } else {
      // 2. 모바일(에뮬레이터/스마트폰)인 경우: 기존처럼 WebView 화면으로 이동합니다.
      router.push('/webview');
    }
  };

  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FEE500" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>로그인</Text>
      <TouchableOpacity
        style={styles.kakaoButton}
        onPress={handleKakaoLogin} // ✅ 분기 처리된 함수 연결
      >
        <Text style={styles.kakaoText}>카카오로 로그인</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 30 },
  kakaoButton: { backgroundColor: '#FEE500', padding: 15, borderRadius: 10 },
  kakaoText: { fontWeight: 'bold' },
});