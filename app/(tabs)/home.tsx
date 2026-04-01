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
  
  // 상태 관리
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  
  // 실시간 가격 데이터를 저장할 상태
  const [prices, setPrices] = useState<Record<string, number>>({});

  // 검색 관련 상태
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // 웹소켓 연결 참조
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    initializeData();

    // 화면 이탈 시 웹소켓 종료
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  //  검색어 디바운스 및 API 호출 (오류 수정됨)
  useEffect(() => {
    if (!newSymbol.trim()) {
      setSearchResults([]);
      return;
    }

    const debounceTimer = setTimeout(async () => { // async 추가
      setIsSearching(true); // 괄호 및 true 추가
      try {
        const res = await fetch(`${API_BASE}/stock/search?q=${newSymbol.trim()}`, { 
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          console.log('검색 결과:', data);
          setSearchResults(data.result || []);
        }
      } catch (e) {
        console.error('검색 중 에러:', e);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(debounceTimer);
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
      console.error(e);
      router.replace('/');
    } finally {
      setLoading(false);
    }
  };

  const fetchWatchlistAndConnect = async () => {
    try {
      const res = await fetch(`${API_BASE}/watchlist`, {
        credentials: 'include',
      });

      if (res.ok) {
        const symbols: string[] = await res.json();
        setWatchlist(symbols);
        connectWebSocket(symbols);
      }
    } catch (e) {
      console.error('관심 종목 조회 실패:', e);
    }
  };

  const connectWebSocket = (symbols: string[]) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(' 웹소켓 연결 성공');
      ws.send(JSON.stringify({ type: 'ENTER', symbols: symbols }));
    };

    ws.onmessage = (event) => {
      //  백엔드에서 보내주는 새로운 포맷에 맞게 파싱 로직 수정
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'PRICE') {
          setPrices(prev => ({
            ...prev,
            [data.symbol]: parseFloat(data.price) 
          }));
        }
      } catch (e) {
        console.log('메시지 파싱 에러 또는 일반 텍스트:', event.data);
      }
    };

    ws.onerror = (error) => console.error(' 웹소켓 에러:', error);
    ws.onclose = () => console.log('🔌 웹소켓 연결 종료');
  };

  //  검색 결과에서 선택했을 때 실행되는 함수 추가
  const handleSelectAndAddSymbol = async (symbolToAdd: string) => {
    Keyboard.dismiss(); 
    setSearchResults([]); 
    setNewSymbol(''); 

    if (watchlist.includes(symbolToAdd)) {
      Alert.alert('알림', '이미 추가된 종목입니다.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/watchlist?symbol=${symbolToAdd}`, {
        method: 'POST',
        credentials: 'include',
      });

      if (res.ok) {
        setWatchlist(prev => [...prev, symbolToAdd]);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'ADD', symbol: symbolToAdd }));
        }
      } else {
        Alert.alert('오류', '종목 추가에 실패했습니다.');
      }
    } catch (e) {
      console.error('추가 중 에러:', e);
    }
  };

  const handleAddSymbol = async () => {
    const symbolToAdd = newSymbol.trim().toUpperCase();
    if (!symbolToAdd) return;
    handleSelectAndAddSymbol(symbolToAdd); // 중복 로직 제거
  };

  const handleRemoveSymbol = async (symbolToRemove: string) => {
    try {
      const res = await fetch(`${API_BASE}/watchlist?symbol=${symbolToRemove}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setWatchlist(prev => prev.filter(s => s !== symbolToRemove));
        
        setPrices(prev => {
          const newPrices = { ...prev };
          delete newPrices[symbolToRemove];
          return newPrices;
        });

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'REMOVE', symbol: symbolToRemove }));
        }
      } else {
        Alert.alert('오류', '종목 삭제에 실패했습니다.');
      }
    } catch (e) {
      console.error('삭제 중 에러:', e);
    }
  };

  const handleLogout = async () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {
      console.error('로그아웃 에러', e);
    } finally {
      router.replace('/');
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#FEE500" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <Text style={styles.nickname}>{member?.memberName}님의 관심 종목</Text>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>로그아웃</Text>
        </TouchableOpacity>
      </View>

      {/* ⭐️ 종목 검색 및 추가 영역 */}
      <View style={styles.searchSection}>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="종목코드 또는 회사명 검색 (예: Apple)"
            value={newSymbol}
            onChangeText={setNewSymbol}
            autoCapitalize="none"
          />
          {isSearching ? (
            <ActivityIndicator size="small" color="#FEE500" style={{ marginRight: 10 }} />
          ) : (
            <TouchableOpacity style={styles.addButton} onPress={handleAddSymbol}>
              <Text style={styles.addButtonText}>추가</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ⭐️ 검색 결과 드롭다운 UI 추가 */}
        {searchResults.length > 0 && (
          <View style={styles.dropdownContainer}>
            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => `${item.symbol}-${index}`}
              keyboardShouldPersistTaps="handled" 
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.dropdownItem} 
                  onPress={() => handleSelectAndAddSymbol(item.symbol)}
                >
                  <Text style={styles.dropdownSymbol}>{item.symbol}</Text>
                  <Text style={styles.dropdownDesc} numberOfLines={1}>{item.description}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>

      <FlatList
        data={watchlist}
        keyExtractor={(item) => item}
        renderItem={({ item }) => (
          <View style={styles.listItem}>
            <View>
              <Text style={styles.symbolText}>{item}</Text>
              <Text style={styles.priceText}>
                {prices[item] ? `$${prices[item].toFixed(2)}` : '로딩 중...'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => handleRemoveSymbol(item)}
            >
              <Text style={styles.deleteButtonText}>삭제</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>관심 종목이 없습니다.</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
    paddingTop: 60,
  },
  profileCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  nickname: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  logoutButton: {
    backgroundColor: '#ff4d4f',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  logoutText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  // ⭐️ 검색 영역용 스타일
  searchSection: {
    zIndex: 10, 
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 15,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    marginRight: 10,
  },
  addButton: {
    backgroundColor: '#FEE500',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  addButtonText: {
    fontWeight: 'bold',
    color: '#333',
  },
  // ⭐️ 검색 결과 드롭다운 스타일
  dropdownContainer: {
    position: 'absolute',
    top: 55, 
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    maxHeight: 200, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  dropdownItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  dropdownSymbol: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  dropdownDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  symbolText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  priceText: {
    fontSize: 16,
    color: '#0066cc',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#ffe6e6',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  deleteButtonText: {
    color: '#ff4d4f',
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    marginTop: 40,
  },
});