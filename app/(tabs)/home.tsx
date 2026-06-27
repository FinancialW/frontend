import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const API_BASE = 'http://192.168.0.33:8080';
const WS_BASE = 'ws://192.168.0.33:8080/ws';

interface Member {
  id: number;
  memberName: string;
}

interface SearchResult {
  description: string;
  symbol: string;
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

  // 검색
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

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
          `${API_BASE}/stock/search?q=${newSymbol.trim()}`,
          { credentials: 'include' }
        );

        if (res.ok) {
          const data = await res.json();
          const resultsArray = data.result || [];
          setSearchResults(resultsArray);
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
      connectWebSocket(symbols);
    }
  };
  const fetchInitialPrices = async (symbols: string[]) => {
    if (symbols.length === 0) return;
    
    try {
      const res = await fetch(`${API_BASE}/stock/latest-prices?symbols=${symbols.join(',')}`);
      
      if (res.ok) {
        const initialPrices = await res.json(); 
        setPrices(prev => ({
          ...prev,
          ...initialPrices
        }));
      }
    } catch (e) {
      console.error("초기 가격을 불러오는데 실패했습니다.", e);
    }
  };


  const connectWebSocket = (symbols: string[]) => {
    wsRef.current?.close();

    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'ENTER', symbols }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'PRICE') {
          setPrices(prev => {
            setPrevPrices(prev); // 이전값 저장
            return {
              ...prev,
              [data.symbol]: parseFloat(data.price),
            };
          });
        }
      } catch {}
    };
  };

  // ⭐️ 검색 선택
  const handleSelectAndAddSymbol = async (symbol: string) => {
    Keyboard.dismiss();
    setSearchResults([]);
    setNewSymbol('');

    if (watchlist.includes(symbol)) {
      Alert.alert('이미 추가된 종목입니다.');
      return;
    }

    const res = await fetch(`${API_BASE}/watchlist?symbol=${symbol}`, {
      method: 'POST',
      credentials: 'include',
    });

    if (res.ok) {
      setWatchlist(prev => [...prev, symbol]);
      await fetchInitialPrices([symbol]); // 새로 추가된 종목의 가격도 불러오기

      wsRef.current?.send(
        JSON.stringify({ type: 'ADD', symbol })
      );
    }
  };

  const handleRemoveSymbol = async (symbol: string) => {
    const res = await fetch(`${API_BASE}/watchlist?symbol=${symbol}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (res.ok) {
      setWatchlist(prev => prev.filter(s => s !== symbol));

      setPrices(prev => {
        const copy = { ...prev };
        delete copy[symbol];
        return copy;
      });

      wsRef.current?.send(
        JSON.stringify({ type: 'REMOVE', symbol })
      );
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
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.title}>
          {member?.memberName}님의 관심 종목
        </Text>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={{ color: 'red' }}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {/* 검색 */}
      <View style={styles.searchBox}>
        <Ionicons
          name="search"
          size={20}
          color="#999"
          style={styles.searchIcon}
        />
        <TextInput
          value={newSymbol}
          onChangeText={setNewSymbol}
          placeholder="종목 검색 (예: AAPL)"
          placeholderTextColor="#999"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {newSymbol.length > 0 && (
          <TouchableOpacity
            onPress={() => setNewSymbol('')}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={20} color="#bbb" />
          </TouchableOpacity>
        )}
        {isSearching && (
          <ActivityIndicator size="small" style={styles.searchSpinner} />
        )}
      </View>

      {searchResults.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.symbol}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.dropdownItem}
                onPress={() =>
                  handleSelectAndAddSymbol(item.symbol)
                }
              >
                <Text>{item.symbol}</Text>
                <Text style={{ color: '#888' }}>
                  {item.description}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* 리스트 */}
      <FlatList
        data={watchlist}
        keyExtractor={(item) => item}
        renderItem={({ item }) => {
          const price = prices[item];
          const prev = prevPrices[item];

          const color =
            prev !== undefined
              ? price > prev
                ? '#ff4d4f'
                : '#1890ff'
              : '#333';

          return (
            <View style={styles.item}>
              {/* 왼쪽 클릭 영역 */}
              <TouchableOpacity
                style={{ flex: 1 }}
                activeOpacity={0.7}
                onPress={() =>
                  router.push({
                    pathname: '/detail',
                    params: { 
                      symbol: item, 
                      initialPrice : price
                    },
                  })
                }
              >
                <Text style={styles.symbol}>{item}</Text>

                {price !== undefined ? (
                  <Text style={{ color }}>
                    {price.toFixed(2)} USD
                  </Text>
                ) : (
                  <ActivityIndicator size="small" />
                )}
              </TouchableOpacity>

              {/* 삭제 버튼 */}
              <TouchableOpacity
                onPress={() => handleRemoveSymbol(item)}
              >
                <Text style={{ color: 'red' }}>삭제</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: '#f5f5f5',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchSpinner: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#222',
    paddingVertical: 0,
  },
  dropdown: {
    backgroundColor: '#fff',
    marginTop: 5,
    borderRadius: 8,
    maxHeight: 200,
  },
  dropdownItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  item: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  symbol: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});
