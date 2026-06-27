import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { CandlestickChart } from "react-native-wagmi-charts";

// 본인의 서버 주소에 맞게 수정하세요.
const API_BASE = "http://192.168.0.33:8080";
const WS_BASE = "ws://192.168.0.33:8080/ws";

type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

// 지지/저항선 타입
type SupportResistanceZone = {
  avgPrice: number;
  bottomPrice: number;
  topPrice: number;
  touchCount: number;
};

const getIntervalMs = (resolution: string) => {
  switch (resolution) {
    case "1D": return 5 * 60 * 1000;
    case "1W": return 15 * 60 * 1000;
    case "1M": return 60 * 60 * 1000;
    case "3M":
    case "1Y": return 24 * 60 * 60 * 1000;
    case "MAX": return 30 * 24 * 60 * 60 * 1000;
    default: return 60 * 1000;
  }
};

const SCREEN_WIDTH = Dimensions.get("window").width - 40;
const CANDLE_WIDTH = 12;
const CHART_HEIGHT = 300; // 차트 높이를 상수로 관리

const COLOR_BULL = "#ff3b30"; // 상승 (빨강)
const COLOR_BEAR = "#007aff"; // 하락 (파랑)

export default function Detail() {
  const { symbol, initialPrice } = useLocalSearchParams();
  const symbolParam = Array.isArray(symbol) ? symbol[0] : symbol;
  const parsedInitialPrice = initialPrice
    ? parseFloat(Array.isArray(initialPrice) ? initialPrice[0] : initialPrice)
    : null;

  const wsRef = useRef<WebSocket | null>(null);

  const [resolution, setResolution] = useState<
    "1D" | "1W" | "1M" | "3M" | "1Y" | "MAX"
  >("1D");

  const [data, setData] = useState<Candle[]>([]);
  const [zones, setZones] = useState<SupportResistanceZone[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(parsedInitialPrice);

  const updateLastCandle = useCallback(
    (price: number) => {
      setData((prev) => {
        if (!prev.length) return prev;

        const last = prev[prev.length - 1];
        const now = Date.now();
        const intervalMs = getIntervalMs(resolution);

        if (now >= last.timestamp + intervalMs) {
          const newCandle = {
            timestamp: last.timestamp + intervalMs,
            open: last.close,
            high: Math.max(last.close, price),
            low: Math.min(last.close, price),
            close: price,
          };
          return [...prev, newCandle];
        }

        const updated = {
          ...last,
          close: price,
          high: Math.max(last.high, price),
          low: Math.min(last.low, price),
        };

        return [...prev.slice(0, -1), updated];
      });
    },
    [resolution]
  );

  const fetchData = async (isSilentUpdate = false) => {
    if (!symbolParam) return;
    if (!isSilentUpdate) setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/candles?symbol=${symbolParam}&resolution=${resolution}`
      );
      const json = await res.json();

      if (!json.chart || !json.chart.result) return;

      const result = json.chart.result[0];
      if (!result) return;

      const quote = result.indicators?.quote?.[0];
      if (!quote) return;

      const candleData: Candle[] = result.timestamp.map(
        (t: number, i: number) => ({
          timestamp: t * 1000,
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
        })
      );

      setData(candleData);
      if (candleData.length > 0) {
        setCurrentPrice((prev) =>
          prev === null ? candleData[candleData.length - 1].close : prev
        );
      }
    } catch (e) {
      console.error("데이터 불러오기 실패:", e);
    } finally {
      if (!isSilentUpdate) setLoading(false);
    }
  };

  const fetchZones = async () => {
    if (!symbolParam) return;
    try {
      const res = await fetch(
        `${API_BASE}/support-resistance?symbol=${symbolParam}&resolution=${resolution}`
      );
      const json = await res.json();
      setZones(json);
    } catch (e) {
      console.error("지지/저항선 데이터 불러오기 실패:", e);
    }
  };

  useEffect(() => {
    fetchData(false);
    fetchZones();
  }, [resolution]);

  useEffect(() => {
    if (["1D", "1W"].includes(resolution)) {
      const interval = setInterval(() => {
        fetchData(true);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [resolution]);

  useEffect(() => {
    if (!symbolParam) return;

    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "ENTER",
          symbols: [symbolParam],
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const parsedData = JSON.parse(event.data);
        if (parsedData.type === "PRICE") {
          const price = parseFloat(parsedData.price);
          setCurrentPrice(price);
          updateLastCandle(price);
        }
      } catch {}
    };

    return () => ws.close();
  }, [symbolParam, updateLastCandle]);

  const resolutions = [
    { label: "1일", value: "1D" },
    { label: "1주", value: "1W" },
    { label: "1개월", value: "1M" },
    { label: "3개월", value: "3M" },
    { label: "1년", value: "1Y" },
    { label: "전체", value: "MAX" },
  ];

  const chartWidth = Math.max(data.length * CANDLE_WIDTH, CANDLE_WIDTH);

  const minPrice = data.length > 0 ? Math.min(...data.map((d) => d.low)) : 0;
  const maxPrice = data.length > 0 ? Math.max(...data.map((d) => d.high)) : 0;
  const priceRange = maxPrice - minPrice;

  // 🔥 겹침 방지 알고리즘이 적용된 지지/저항선 렌더링 함수
  const renderSupportResistanceZones = () => {
    if (!data.length || priceRange === 0 || !zones.length) return null;

    // 1. 라벨의 데이터를 담을 배열과 도형(배경/선)을 담을 배열 준비
    const labelsData: { id: string; y: number; text: string }[] = [];
    const shapesViews: React.ReactNode[] = [];

    zones.forEach((zone, index) => {
      const topY = CHART_HEIGHT * (1 - (zone.topPrice - minPrice) / priceRange);
      const bottomY = CHART_HEIGHT * (1 - (zone.bottomPrice - minPrice) / priceRange);
      const avgY = CHART_HEIGHT * (1 - (zone.avgPrice - minPrice) / priceRange);
      const zoneHeight = Math.max(bottomY - topY, 1);

      // 면적(Zone)과 중심선 뷰 추가 (도형은 겹쳐도 상관없음)
      shapesViews.push(
        <View key={`shape-${index}`} style={StyleSheet.absoluteFill} pointerEvents="none">
          <View
            style={{
              position: "absolute",
              top: topY,
              width: "100%",
              height: zoneHeight,
              backgroundColor: "rgba(255, 165, 0, 0.2)",
            }}
          />
          <View
            style={{
              position: "absolute",
              top: avgY,
              width: "100%",
              height: 1,
              backgroundColor: "rgba(255, 165, 0, 0.8)",
              borderStyle: "dashed",
            }}
          />
        </View>
      );

      // 숫자 텍스트(Label) 데이터 수집 (초기 Y 좌표 설정)
      labelsData.push({ id: `top-${index}`, y: topY - 14, text: zone.topPrice.toFixed(2) });
      labelsData.push({ id: `bot-${index}`, y: bottomY + 2, text: zone.bottomPrice.toFixed(2) });
    });

    // 2. 동적 위치 조정 알고리즘 (위에서 아래로 스캔)
    const MIN_DISTANCE = 16; // 텍스트 간 겹치지 않기 위한 최소 픽셀 거리 (폰트 크기+여백 고려)
    
    // Y좌표를 기준으로 오름차순(위에서 아래로) 정렬
    labelsData.sort((a, b) => a.y - b.y);

    // 이전 라벨과 거리가 가깝다면 아래로 밀어냄
    for (let i = 1; i < labelsData.length; i++) {
      const prev = labelsData[i - 1];
      const curr = labelsData[i];

      if (curr.y - prev.y < MIN_DISTANCE) {
        curr.y = prev.y + MIN_DISTANCE; // 겹치면 안 겹치는 위치까지 Y좌표 수정
      }
    }

    // 3. 조정된 좌표를 바탕으로 실제 Text 컴포넌트 생성
    const labelViews = labelsData.map((label) => (
      <Text
        key={label.id}
        style={{
          position: "absolute",
          top: label.y,
          left: 4,
          fontSize: 10,
          color: "#c2410c",
          fontWeight: "bold",
          backgroundColor: "rgba(255, 255, 255, 0.8)",
          paddingHorizontal: 2,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        {label.text}
      </Text>
    ));

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {shapesViews}
        {labelViews}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{symbolParam}</Text>
      <Text style={styles.price}>
        현재가: {currentPrice !== null ? `${currentPrice.toFixed(2)} USD` : "로딩중..."}
      </Text>

      <View style={styles.tabContainer}>
        {resolutions.map((r) => (
          <TouchableOpacity
            key={r.value}
            style={[styles.tab, resolution === r.value && styles.activeTab]}
            onPress={() => setResolution(r.value as any)}
          >
            <Text style={{ color: resolution === r.value ? "#fff" : "#333" }}>
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : data.length > 0 ? (
        resolution === "1D" ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View
              style={{
                minWidth: SCREEN_WIDTH,
                height: CHART_HEIGHT,
                flexDirection: "row",
              }}
            >
              <View style={{ width: chartWidth, height: CHART_HEIGHT, overflow: "hidden" }}>
                <CandlestickChart.Provider data={data}>
                  <CandlestickChart width={chartWidth} height={CHART_HEIGHT}>
                    <CandlestickChart.Candles
                      positiveColor={COLOR_BULL}
                      negativeColor={COLOR_BEAR}
                    />
                  </CandlestickChart>
                </CandlestickChart.Provider>
                {/* 차트 위에 지지/저항 영역 렌더링 */}
                {renderSupportResistanceZones()}
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={{ width: SCREEN_WIDTH, height: CHART_HEIGHT, overflow: "hidden" }}>
            <CandlestickChart.Provider data={data}>
              <CandlestickChart width={SCREEN_WIDTH} height={CHART_HEIGHT}>
                <CandlestickChart.Candles
                  positiveColor={COLOR_BULL}
                  negativeColor={COLOR_BEAR}
                />
              </CandlestickChart>
            </CandlestickChart.Provider>
            {/* 차트 위에 지지/저항 영역 렌더링 */}
            {renderSupportResistanceZones()}
          </View>
        )
      ) : (
        <View style={{ height: CHART_HEIGHT, justifyContent: "center", alignItems: "center" }}>
          <Text>데이터가 없습니다.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 10,
  },
  price: {
    fontSize: 18,
    marginBottom: 15,
  },
  tabContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 20,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#eee",
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  activeTab: {
    backgroundColor: "#333",
  },
});