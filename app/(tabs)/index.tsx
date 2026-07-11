import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { API_BASE } from '@/constants/config';

const COLOR_TEXT = '#191f28';
const COLOR_SUBTLE = '#8b95a1';
const COLOR_BEAR = '#3182f6';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // 버튼 누름 스케일
  const scale = useSharedValue(1);
  const btnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

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
      console.log('인증 체크 실패 (로그아웃 상태)');
      setChecking(false);
    }
  };

  // ✅ 버튼을 눌렀을 때 플랫폼별로 다르게 동작하는 함수
  const handleKakaoLogin = () => {
    if (Platform.OS === 'web') {
      // 웹: 브라우저 자체를 로그인 주소로 이동
      window.location.href = `${API_BASE}/auth/kakao`;
    } else {
      // 모바일: WebView 화면으로 이동
      router.push('/webview');
    }
  };

  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={COLOR_BEAR} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 브랜드 영역 */}
      <View style={styles.brand}>
        <Animated.View
          entering={FadeInDown.duration(500).springify().damping(14)}
          style={styles.logo}
        >
          <Text style={styles.logoText}>$</Text>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(220).duration(500).springify().damping(16)}
          style={styles.subtitle}
        >
          관심 종목의 실시간 시세와{'\n'}지지선, 저항선을 확인해보세요
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(320).duration(500).springify().damping(16)}
          style={styles.byline}
        >
          by 원빈
        </Animated.Text>
      </View>

      {/* 로그인 버튼 */}
      <Animated.View
        entering={FadeIn.delay(420).duration(500)}
        style={styles.bottom}
      >
        <AnimatedPressable
          style={[styles.kakaoButton, btnStyle]}
          onPressIn={() => {
            scale.value = withSpring(0.97, { damping: 18, stiffness: 320 });
          }}
          onPressOut={() => {
            scale.value = withSpring(1, { damping: 16, stiffness: 280 });
          }}
          onPress={handleKakaoLogin}
        >
          <Text style={styles.kakaoBubble}>💬</Text>
          <Text style={styles.kakaoText}>카카오로 3초 만에 시작하기</Text>
        </AnimatedPressable>
        <Text style={styles.notice}>로그인 시 서비스 이용약관에 동의하게 됩니다</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 24,
  },
  brand: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: COLOR_BEAR,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    shadowColor: COLOR_BEAR,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  logoText: {
    fontSize: 40,
    fontWeight: '900',
    color: '#fff',
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLOR_TEXT,
    textAlign: 'center',
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  byline: {
    fontSize: 14,
    fontWeight: '600',
    color: COLOR_SUBTLE,
    textAlign: 'center',
    marginTop: 14,
  },
  bottom: {
    width: '100%',
    paddingBottom: 40,
  },
  kakaoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEE500',
    paddingVertical: 16,
    borderRadius: 16,
  },
  kakaoBubble: {
    fontSize: 16,
  },
  kakaoText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#191600',
  },
  notice: {
    fontSize: 12,
    color: '#c4ccd4',
    textAlign: 'center',
    marginTop: 16,
  },
});
