import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { API_BASE, createPriceSocket } from '@/constants/config';

// 토스 팔레트 (detail.tsx와 통일)
const COLOR_TEXT = '#191f28';
const COLOR_SUBTLE = '#8b95a1';
const COLOR_BG = '#f2f4f6';
const COLOR_CARD = '#ffffff';
const COLOR_BULL = '#f04452'; // 상승 = 빨강 (한국 관례)
const COLOR_BEAR = '#3182f6'; // 하락 = 파랑
const COLOR_BORDER = '#e5e8eb';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const haptic = () => {
  if (Platform.OS !== 'web') {
    Haptics.selectionAsync().catch(() => {});
  }
};

interface Member {
  id: number;
  memberName: string;
}

interface SearchResult {
  description: string;
  symbol: string;
}

// 천 단위 구분 + 소수점 2자리
const formatPrice = (n: number) => {
  const [intPart, decPart] = n.toFixed(2).split('.');
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decPart}`;
};

// 관심 종목 행: 가격 변동 시 빨강/파랑으로 깜빡이고, 누르면 살짝 눌린다.
function WatchRow({
  symbol,
  price,
  prevPrice,
  prevClose,
  index,
  onPress,
  onRemove,
}: {
  symbol: string;
  price?: number;
  prevPrice?: number;
  prevClose?: number;
  index: number;
  onPress: () => void;
  onRemove: () => void;
}) {
  const flash = useSharedValue(0);
  const scale = useSharedValue(1);

  const changed = price !== undefined && prevPrice !== undefined && price !== prevPrice;
  const up = changed ? price! >= prevPrice! : true;

  // 가격이 바뀔 때마다 배경을 잠깐 물들였다 되돌린다.
  useEffect(() => {
    if (changed) {
      flash.value = withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(0, { duration: 650 })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [price]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: interpolateColor(
      flash.value,
      [0, 1],
      [COLOR_CARD, up ? '#fdecee' : '#eaf2fe']
    ),
  }));

  // 가격 색상은 "전일 종가" 대비로 정한다 (한국 관례: 상승=빨강, 하락=파랑, 동일=기본색).
  const priceColor =
    price !== undefined && prevClose !== undefined
      ? price > prevClose
        ? COLOR_BULL
        : price < prevClose
        ? COLOR_BEAR
        : COLOR_TEXT
      : COLOR_TEXT;

  // 전일 종가 대비 등락액·등락률 (색상은 위 priceColor를 그대로 재사용)
  const hasChange =
    price !== undefined && prevClose !== undefined && prevClose !== 0;
  const change = hasChange ? price! - prevClose! : 0;
  const pct = hasChange ? (change / prevClose!) * 100 : 0;
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '–';
  const sign = change > 0 ? '+' : change < 0 ? '-' : '';

  return (
    <Animated.View
      entering={FadeInDown.delay(Math.min(index, 8) * 55)
        .springify()
        .damping(18)}
      exiting={FadeOut.duration(180)}
      layout={LinearTransition.springify().damping(20)}
    >
      <AnimatedPressable
        style={[styles.item, cardStyle]}
        onPress={onPress}
        onPressIn={() => {
          haptic();
          scale.value = withSpring(0.97, { damping: 18, stiffness: 320 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 16, stiffness: 280 });
        }}
      >
        <View style={styles.itemLeft}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{symbol.slice(0, 2)}</Text>
          </View>
          <View>
            <Text style={styles.symbol}>{symbol}</Text>
            <Text style={styles.symbolSub}>실시간</Text>
          </View>
        </View>

        <View style={styles.itemRight}>
          {price !== undefined ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.price, { color: priceColor }]}>
                {formatPrice(price)}
              </Text>
              <Text style={styles.currency}>USD</Text>
              {hasChange && Number.isFinite(pct) && (
                <Text style={[styles.change, { color: priceColor }]}>
                  {`${arrow} ${sign}${formatPrice(Math.abs(change))} (${sign}${Math.abs(
                    pct
                  ).toFixed(2)}%)`}
                </Text>
              )}
            </View>
          ) : (
            <ActivityIndicator size="small" color={COLOR_SUBTLE} />
          )}

          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              haptic();
              onRemove();
            }}
            hitSlop={10}
            style={styles.removeBtn}
          >
            <Ionicons name="close" size={16} color={COLOR_SUBTLE} />
          </Pressable>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function Home() {
  const router = useRouter();

  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState('');

  // 실시간 가격
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  // 전일 종가 (가격 색상 기준)
  const [prevCloses, setPrevCloses] = useState<Record<string, number>>({});

  // 검색
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [focused, setFocused] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  // setState 업데이터 안에서 다른 setState를 호출하지 않도록, 최신 스냅샷을 ref로 유지한다.
  const pricesRef = useRef<Record<string, number>>({});
  const watchlistRef = useRef<string[]>([]);

  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  // 검색창 포커스 시 테두리 강조
  const focusAnim = useSharedValue(0);
  const searchBoxStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      focusAnim.value,
      [0, 1],
      [COLOR_BORDER, COLOR_BEAR]
    ),
  }));

  useEffect(() => {
    initializeData();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!newSymbol.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `${API_BASE}/stock/search?q=${encodeURIComponent(newSymbol.trim())}`,
          { credentials: 'include' }
        );

        if (res.ok) {
          const data = await res.json();
          const resultsArray: SearchResult[] = data.result || [];
          // 같은 심볼이 증권 유형별로 중복해서 내려오는 경우가 있어 심볼 기준으로 중복 제거
          // (key={item.symbol} 충돌 방지 + 드롭다운에 같은 항목이 두 줄 뜨는 것 방지)
          const unique = Array.from(
            new Map(resultsArray.map((r) => [r.symbol, r])).values()
          );
          setSearchResults(unique);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [newSymbol]);

  const initializeData = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: 'include',
      });

      if (!res.ok) {
        router.replace('/');
        return;
      }

      const memberData = await res.json();
      setMember(memberData);

      await fetchWatchlistAndConnect();
    } catch (e) {
      router.replace('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchWatchlistAndConnect = async () => {
    const res = await fetch(`${API_BASE}/watchlist`, {
      credentials: 'include',
    });

    if (res.ok) {
      const symbols: string[] = await res.json();
      setWatchlist(symbols);
      fetchInitialPrices(symbols);
      fetchPrevCloses(symbols);
      connectWebSocket(symbols);
    }
  };

  // 전일 종가를 불러온다. 캔들(Yahoo 형태) 응답의 meta.previousClose를 사용한다.
  const fetchPrevCloses = async (symbols: string[]) => {
    if (symbols.length === 0) return;

    try {
      const results = await Promise.all(
        symbols.map(async (sym) => {
          try {
            const res = await fetch(
              `${API_BASE}/candles?symbol=${sym}&resolution=1D`,
              { credentials: 'include' }
            );
            if (!res.ok) return null;

            const json = await res.json();
            const meta = json?.chart?.result?.[0]?.meta;
            const prevClose =
              meta?.previousClose ??
              meta?.chartPreviousClose ??
              meta?.regularMarketPreviousClose;

            return typeof prevClose === 'number' && Number.isFinite(prevClose)
              ? ([sym, prevClose] as const)
              : null;
          } catch {
            return null;
          }
        })
      );

      setPrevCloses((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    } catch (e) {
      console.error('전일 종가를 불러오는데 실패했습니다.', e);
    }
  };

  const fetchInitialPrices = async (symbols: string[]) => {
    if (symbols.length === 0) return;

    try {
      const res = await fetch(
        `${API_BASE}/stock/latest-prices?symbols=${symbols.join(',')}`,
        { credentials: 'include' }
      );

      if (res.ok) {
        const initialPrices = await res.json();
        setPrices((prev) => ({
          ...prev,
          ...initialPrices,
        }));
      }
    } catch (e) {
      console.error('초기 가격을 불러오는데 실패했습니다.', e);
    }
  };

  const connectWebSocket = (symbols: string[]) => {
    wsRef.current?.close();

    const ws = createPriceSocket();
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ENTER', symbols }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'PRICE') {
          const price = parseFloat(data.price);
          if (!Number.isFinite(price)) return;

          setPrevPrices(pricesRef.current); // 이전값 저장
          setPrices((prev) => ({
            ...prev,
            [data.symbol]: price,
          }));
        }
      } catch {}
    };

    ws.onerror = (e: any) => {
      console.log(`[홈 WS] 에러: ${e?.message ?? 'WebSocket 연결 오류'}`);
    };

    ws.onclose = (e) => {
      console.log(`[홈 WS] 종료: code=${e.code} reason=${e.reason || '(없음)'}`);
    };
  };

  // 네이티브에서는 앱이 백그라운드로 가면 소켓이 끊긴다.
  // 포그라운드 복귀 시 소켓이 닫혀 있으면 재연결하고 가격도 새로 받아온다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;

      const ws = wsRef.current;
      const closed = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
      if (closed && watchlistRef.current.length > 0) {
        fetchInitialPrices(watchlistRef.current);
        connectWebSocket(watchlistRef.current);
      }
    });

    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⭐️ 검색 선택
  const handleSelectAndAddSymbol = async (symbol: string) => {
    Keyboard.dismiss();
    setSearchResults([]);
    setNewSymbol('');

    if (watchlist.includes(symbol)) {
      Alert.alert('이미 추가된 종목입니다.');
      return;
    }

    const res = await fetch(`${API_BASE}/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (res.ok) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => {}
        );
      }
      setWatchlist((prev) => [...prev, symbol]);
      await fetchInitialPrices([symbol]); // 새로 추가된 종목의 가격도 불러오기
      fetchPrevCloses([symbol]); // 전일 종가도 불러오기 (색상 기준)

      wsRef.current?.send(JSON.stringify({ type: 'ADD', symbol }));
    }
  };

  const handleRemoveSymbol = async (symbol: string) => {
    const res = await fetch(`${API_BASE}/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (res.ok) {
      setWatchlist((prev) => prev.filter((s) => s !== symbol));

      setPrices((prev) => {
        const copy = { ...prev };
        delete copy[symbol];
        return copy;
      });

      setPrevCloses((prev) => {
        const copy = { ...prev };
        delete copy[symbol];
        return copy;
      });

      wsRef.current?.send(JSON.stringify({ type: 'REMOVE', symbol }));
    }
  };

  const handleLogout = async () => {
    wsRef.current?.close();

    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });

    router.replace('/');
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLOR_BEAR} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <Animated.View
        entering={FadeInDown.duration(420).springify().damping(18)}
        style={styles.header}
      >
        <View>
          <Text style={styles.greeting}>안녕하세요</Text>
          <Text style={styles.title}>
            {member?.memberName ?? ''}님의 관심 종목
          </Text>
        </View>
        <Pressable onPress={handleLogout} hitSlop={8} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color={COLOR_SUBTLE} />
        </Pressable>
      </Animated.View>

      {/* 검색 */}
      <Animated.View
        entering={FadeInDown.delay(80).duration(420).springify().damping(18)}
        style={[styles.searchBox, searchBoxStyle]}
      >
        <Ionicons
          name="search"
          size={20}
          color={focused ? COLOR_BEAR : COLOR_SUBTLE}
          style={styles.searchIcon}
        />
        <TextInput
          value={newSymbol}
          onChangeText={setNewSymbol}
          onFocus={() => {
            setFocused(true);
            focusAnim.value = withTiming(1, { duration: 180 });
          }}
          onBlur={() => {
            setFocused(false);
            focusAnim.value = withTiming(0, { duration: 180 });
          }}
          placeholder="종목 검색 (예: AAPL)"
          placeholderTextColor={COLOR_SUBTLE}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {isSearching ? (
          <ActivityIndicator size="small" color={COLOR_SUBTLE} />
        ) : newSymbol.length > 0 ? (
          <Pressable onPress={() => setNewSymbol('')} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="#c4ccd4" />
          </Pressable>
        ) : null}
      </Animated.View>

      {searchResults.length > 0 && (
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.dropdown}
        >
          {searchResults.slice(0, 6).map((item, i) => (
            <Animated.View
              key={item.symbol}
              entering={FadeInDown.delay(i * 35).duration(220)}
            >
              <Pressable
                style={({ pressed }) => [
                  styles.dropdownItem,
                  pressed && { backgroundColor: COLOR_BG },
                ]}
                onPress={() => handleSelectAndAddSymbol(item.symbol)}
              >
                <Text style={styles.dropdownSymbol}>{item.symbol}</Text>
                <Text style={styles.dropdownDesc} numberOfLines={1}>
                  {item.description}
                </Text>
              </Pressable>
            </Animated.View>
          ))}
        </Animated.View>
      )}

      {/* 리스트 */}
      <Animated.FlatList
        data={watchlist}
        keyExtractor={(item) => item}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        itemLayoutAnimation={LinearTransition.springify().damping(20)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Animated.View
            entering={FadeIn.delay(150).duration(400)}
            style={styles.empty}
          >
            <Ionicons name="star-outline" size={40} color="#c4ccd4" />
            <Text style={styles.emptyText}>아직 관심 종목이 없어요</Text>
            <Text style={styles.emptySub}>위에서 종목을 검색해 추가해보세요</Text>
          </Animated.View>
        }
        renderItem={({ item, index }) => (
          <WatchRow
            symbol={item}
            price={prices[item]}
            prevPrice={prevPrices[item]}
            prevClose={prevCloses[item]}
            index={index}
            onPress={() =>
              router.push({
                pathname: '/detail',
                params: { symbol: item, initialPrice: prices[item] },
              })
            }
            onRemove={() => handleRemoveSymbol(item)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 60,
    backgroundColor: COLOR_BG,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLOR_BG,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  greeting: {
    fontSize: 13,
    fontWeight: '600',
    color: COLOR_SUBTLE,
    marginBottom: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: COLOR_TEXT,
    letterSpacing: -0.5,
  },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLOR_CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLOR_CARD,
    paddingHorizontal: 14,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLOR_BORDER,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLOR_TEXT,
    paddingVertical: 0,
  },
  dropdown: {
    backgroundColor: COLOR_CARD,
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 4,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dropdownSymbol: {
    fontSize: 15,
    fontWeight: '800',
    color: COLOR_TEXT,
  },
  dropdownDesc: {
    flex: 1,
    fontSize: 13,
    color: COLOR_SUBTLE,
  },
  listContent: {
    paddingTop: 12,
    paddingBottom: 40,
    gap: 10,
  },
  item: {
    flexDirection: 'row',
    backgroundColor: COLOR_CARD,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLOR_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4e5968',
  },
  symbol: {
    fontSize: 16,
    fontWeight: '800',
    color: COLOR_TEXT,
    letterSpacing: -0.3,
  },
  symbolSub: {
    fontSize: 12,
    fontWeight: '600',
    color: COLOR_SUBTLE,
    marginTop: 1,
  },
  itemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  price: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  currency: {
    fontSize: 11,
    fontWeight: '600',
    color: COLOR_SUBTLE,
    marginTop: 1,
  },
  change: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
    letterSpacing: -0.2,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLOR_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4e5968',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 13,
    color: COLOR_SUBTLE,
  },
});
