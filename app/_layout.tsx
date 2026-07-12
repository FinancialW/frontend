import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {/* title은 헤더를 숨긴 화면에도 지정한다 — iOS 뒤로가기 라벨·웹 문서 제목에
            라우트 이름((tabs)/home 등)이 그대로 노출되는 것을 막기 위함. */}
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)/index" options={{ headerShown: false, title: '로그인' }} />
          <Stack.Screen name="(tabs)/home" options={{ headerShown: false, title: '홈' }} />
          <Stack.Screen name="(tabs)/webview" options={{ title: '카카오 로그인' }} />
          <Stack.Screen name="login-success" options={{ headerShown: false, title: '로그인 중' }} />
          <Stack.Screen name="detail" options={{ title: '종목 상세' }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
