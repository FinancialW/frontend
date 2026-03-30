import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
        method: 'POST',
        credentials: 'include',
      });

      if (reissueRes.ok) {
        router.replace('/home');
        return;
      }
      
      // 모든 단계 실패 시 로그인 버튼 노출
      setChecking(false);
    } catch (e) {
      console.log("인증 체크 실패 (로그아웃 상태)");
      setChecking(false);
    }
  };

  // 토큰 확인 중 로딩 스피너
  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FEE500" />
      </View>
    );
  }

  // 토큰 없음 → 카카오 로그인 버튼 표시
  return (
    <View style={styles.container}>
      <Text style={styles.title}>로그인</Text>
      <TouchableOpacity
        style={styles.kakaoButton}
        onPress={() => router.push('/webview')}
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