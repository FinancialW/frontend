import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { LineChart } from "react-native-wagmi-charts";
import Svg, { Line } from "react-native-svg";

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
const CHART_HEIGHT = 300; // 보이는 차트 높이
// wagmi LineChart는 height에서 하단 40px를 축 라벨용으로 예약한다.
// 따라서 차트 높이를 +40 주고 yGutter=0으로 두면 그릴 수 있는 영역이 정확히 CHART_HEIGHT가 된다.
const X_AXIS_RESERVED = 40;
const LINE_CHART_HEIGHT = CHART_HEIGHT + X_AXIS_RESERVED;

// 토스 팔레트 (한국 관례: 빨강 = 상승, 파랑 = 하락)
const COLOR_BULL = "#f04452"; // 상승 (빨강)
const COLOR_BEAR = "#3182f6"; // 하락 (파랑)
const COLOR_TEXT = "#191f28";
const COLOR_SUBTLE = "#8b95a1";
const COLOR_PILL_BG = "#f2f4f6";
const COLOR_LINE = "#e5e8eb";

// 천 단위 구분 + 소수점 2자리 포맷 (Hermes의 toLocaleString 옵션 미지원 회피)
const formatPrice = (n: number) => {
  const [intPart, decPart] = n.toFixed(2).split(".");
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decPart}`;
};

// 스크럽 시 표시할 시점 라벨 (장중 단위는 시:분, 일 단위 이상은 날짜)
const formatScrubDate = (ts: number, resolution: string) => {
  const d = new Date(ts);
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const pad2 = (v: number) => `${v}`.padStart(2, "0");
  if (resolution === "1D" || resolution === "1W") {
    return `${M}월 ${D}일 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getFullYear()}. ${M}. ${D}`;
};

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

  // 스크럽(차트 위 드래그) 상태
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

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
      // 백엔드가 배열을 바로 주지 않고 감싸는 경우까지 방어한다.
      const list: SupportResistanceZone[] = Array.isArray(json)
        ? json
        : json?.zones ?? json?.data ?? [];
      console.log(`[지지/저항] ${symbolParam} ${resolution}: ${list.length}개`, list);
      setZones(list);
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
  const resolutionLabel =
    resolutions.find((r) => r.value === resolution)?.label ?? "";

  // 결측치(null)를 제외한 유효 캔들만 사용한다.
  // (스크럽 중 매 프레임 setState로 리렌더되어도 배열 참조가 유지되도록 memo)
  const validData = useMemo(
    () =>
      data.filter(
        (d) =>
          Number.isFinite(d.open) &&
          Number.isFinite(d.high) &&
          Number.isFinite(d.low) &&
          Number.isFinite(d.close)
      ),
    [data]
  );

  // 라인 차트용 데이터: 종가 기준
  const lineData = useMemo(
    () => validData.map((d) => ({ timestamp: d.timestamp, value: d.close })),
    [validData]
  );

  // 기간 내 최고/최저/현재
  const dataHigh = validData.length ? Math.max(...validData.map((d) => d.high)) : 0;
  const dataLow = validData.length ? Math.min(...validData.map((d) => d.low)) : 0;
  const lastPrice =
    currentPrice ??
    (validData.length ? validData[validData.length - 1].close : null);
  const basePrice = validData.length ? validData[0].open : null;

  // 등락 계산 (기간 시작 대비)
  const change =
    lastPrice !== null && basePrice !== null ? lastPrice - basePrice : 0;
  const changePct =
    lastPrice !== null && basePrice ? (change / basePrice) * 100 : 0;
  const isUp = change >= 0;
  const accentColor = isUp ? COLOR_BULL : COLOR_BEAR;

  // 스크럽 중이면 해당 시점의 캔들을 헤더에 표시한다 (놓으면 다시 현재가).
  const activeCandle =
    scrubbing && activeIndex !== null && validData.length > 0
      ? validData[
          Math.min(Math.max(Math.round(activeIndex), 0), validData.length - 1)
        ]
      : null;
  const headerPrice = activeCandle ? activeCandle.close : lastPrice;

  // 차트 세로 도메인: 최고/최저에 여백(pad)을 줘서 라벨이 잘리지 않게 한다.
  const dataRange = dataHigh - dataLow;
  const pad = dataRange > 0 ? dataRange * 0.12 : Math.max(Math.abs(dataHigh) * 0.01, 1);
  const domainMin = dataLow - pad;
  const domainMax = dataHigh + pad;
  const domainSpan = domainMax - domainMin || 1;

  // 가격 → 차트 내부 Y 좌표 (yGutter=0, 그릴 수 있는 높이 = CHART_HEIGHT)
  const yFor = (price: number) =>
    CHART_HEIGHT * (1 - (price - domainMin) / domainSpan);

  // 🔥 최고점 / 최저점 / 현재점 가로선 + 라벨 (토스 스타일)
  const renderPriceMarkers = () => {
    if (!validData.length || dataRange < 0) return null;

    const highY = yFor(dataHigh);
    const lowY = yFor(dataLow);
    const curY = lastPrice !== null ? yFor(lastPrice) : null;

    // 라벨 위치(겹침 회피): 현재가가 최고/최저에 붙으면 반대편으로 비킨다.
    let curTop = curY !== null ? curY - 10 : 0;
    if (curY !== null) {
      if (curY <= highY + 24) curTop = curY + 4; // 최고 근처 → 선 아래
      else if (curY >= lowY - 24) curTop = curY - 24; // 최저 근처 → 선 위
    }

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* 최고점 */}
        <View style={[styles.markerLine, { top: highY, backgroundColor: COLOR_LINE }]} />
        <View style={[styles.markerBadge, { top: highY - 22, backgroundColor: "rgba(255,255,255,0.9)" }]}>
          <Text style={[styles.markerLabel, { color: COLOR_SUBTLE }]}>최고 </Text>
          <Text style={[styles.markerValue, { color: COLOR_TEXT }]}>{formatPrice(dataHigh)}</Text>
        </View>

        {/* 최저점 */}
        <View style={[styles.markerLine, { top: lowY, backgroundColor: COLOR_LINE }]} />
        <View style={[styles.markerBadge, { top: lowY + 4, backgroundColor: "rgba(255,255,255,0.9)" }]}>
          <Text style={[styles.markerLabel, { color: COLOR_SUBTLE }]}>최저 </Text>
          <Text style={[styles.markerValue, { color: COLOR_TEXT }]}>{formatPrice(dataLow)}</Text>
        </View>

        {/* 현재점 */}
        {curY !== null && lastPrice !== null && (
          <>
            <View style={[styles.markerLine, { top: curY, height: 1.5, backgroundColor: accentColor, opacity: 0.7 }]} />
            <View style={[styles.markerBadge, styles.currentBadge, { top: curTop, backgroundColor: accentColor }]}>
              <Text style={styles.currentBadgeText}>{formatPrice(lastPrice)}</Text>
            </View>
          </>
        )}
      </View>
    );
  };

  // 지지/저항 — 존(밴드)으로 표현. 상단 경계=저항(뚫으면 상승/빨강), 하단 경계=지지(뚫으면 하락/파랑)
  const renderSupportResistanceZones = () => {
    if (!validData.length || !zones.length) return null;

    // 1. 라벨 데이터 수집: 존마다 상단(저항)·하단(지지) 두 개씩.
    const labelsData = zones.flatMap((zone, index) => [
      { id: `top-${index}`, y: yFor(zone.topPrice), price: zone.topPrice, role: "저항", color: COLOR_BULL },
      { id: `bot-${index}`, y: yFor(zone.bottomPrice), price: zone.bottomPrice, role: "지지", color: COLOR_BEAR },
    ]);

    // 2. 겹침 방지 알고리즘 (위→아래 스캔, 가까우면 아래로 밀어냄) — 라벨 위치만 조정한다.
    const MIN_DISTANCE = 18;
    labelsData.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labelsData.length; i++) {
      const prev = labelsData[i - 1];
      const curr = labelsData[i];
      if (curr.y - prev.y < MIN_DISTANCE) {
        curr.y = prev.y + MIN_DISTANCE;
      }
    }

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* 존 밴드 (상단~하단 영역) */}
        {zones.map((zone, index) => {
          const topY = yFor(zone.topPrice);
          const bottomY = yFor(zone.bottomPrice);
          return (
            <View
              key={`band-${index}`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: topY,
                height: Math.max(bottomY - topY, 2),
                backgroundColor: "rgba(139,149,161,0.12)",
              }}
            />
          );
        })}
        {/* 존 경계선: 상단(저항)=빨강, 하단(지지)=파랑 (실제 가격 위치에 그대로) */}
        <Svg width={SCREEN_WIDTH} height={CHART_HEIGHT}>
          {zones.map((zone, index) => {
            const topY = yFor(zone.topPrice);
            const bottomY = yFor(zone.bottomPrice);
            return (
              <React.Fragment key={`edge-${index}`}>
                <Line x1={0} x2={SCREEN_WIDTH} y1={topY} y2={topY} stroke={COLOR_BULL} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
                <Line x1={0} x2={SCREEN_WIDTH} y1={bottomY} y2={bottomY} stroke={COLOR_BEAR} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
              </React.Fragment>
            );
          })}
        </Svg>
        {/* 경계 가격 라벨 */}
        {labelsData.map((label) => (
          <View key={label.id} style={[styles.srLabel, { top: label.y - 9 }]}>
            <Text style={[styles.srRole, { color: label.color }]}>{label.role}</Text>
            <Text style={styles.srPrice}>{formatPrice(label.price)}</Text>
          </View>
        ))}
      </View>
    );
  };

  // 스크럽 가이드 (드래그 중 세로 점선)
  const renderScrubOverlay = () => {
    if (!scrubbing || activeIndex === null || validData.length === 0) return null;
    const idx = Math.min(Math.max(Math.round(activeIndex), 0), validData.length - 1);
    const denom = Math.max(validData.length - 1, 1);
    const x = (idx / denom) * SCREEN_WIDTH;
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SCREEN_WIDTH} height={CHART_HEIGHT}>
          <Line
            x1={x}
            x2={x}
            y1={0}
            y2={CHART_HEIGHT}
            stroke={COLOR_SUBTLE}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
        </Svg>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 헤더: 종목 / 현재가(또는 스크럽 시점가) / 등락(또는 시점) — 토스 스타일 */}
      <Text style={styles.symbol}>{symbolParam}</Text>
      {headerPrice !== null ? (
        <>
          <View style={styles.priceRow}>
            <Text style={styles.bigPrice}>{formatPrice(headerPrice)}</Text>
            <Text style={styles.currency}>USD</Text>
          </View>
          {activeCandle ? (
            <Text style={[styles.changeText, { color: COLOR_SUBTLE }]}>
              {formatScrubDate(activeCandle.timestamp, resolution)}
            </Text>
          ) : (
            <Text style={[styles.changeText, { color: accentColor }]}>
              {isUp ? "▲" : "▼"} {formatPrice(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%) · {resolutionLabel}
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.loadingPrice}>로딩중...</Text>
      )}

      {/* 차트 */}
      {loading ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={COLOR_SUBTLE} />
        </View>
      ) : validData.length > 0 ? (
        <View style={styles.chartCard}>
          <View style={{ width: SCREEN_WIDTH, height: CHART_HEIGHT, overflow: "hidden" }}>
            <LineChart.Provider
              data={lineData}
              yRange={{ min: domainMin, max: domainMax }}
              onCurrentIndexChange={(i) => setActiveIndex(i)}
            >
              <LineChart width={SCREEN_WIDTH} height={LINE_CHART_HEIGHT} yGutter={0}>
                <LineChart.Path color={accentColor} width={2}>
                  <LineChart.Gradient color={accentColor} />
                </LineChart.Path>
                {/* 토스식 스크럽: 드래그하면 점이 따라오고 헤더가 해당 시점가로 바뀐다 */}
                <LineChart.CursorCrosshair
                  color={accentColor}
                  snapToPoint
                  onActivated={() => setScrubbing(true)}
                  onEnded={() => {
                    setScrubbing(false);
                    setActiveIndex(null);
                  }}
                />
              </LineChart>
            </LineChart.Provider>
            {/* 차트 위에 지지/저항선 렌더링 */}
            {renderSupportResistanceZones()}
            {/* 최고/최저/현재 가로선 + 라벨 */}
            {renderPriceMarkers()}
            {/* 스크럽 세로 가이드 */}
            {renderScrubOverlay()}
          </View>
        </View>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={{ color: COLOR_SUBTLE }}>데이터가 없습니다.</Text>
        </View>
      )}

      {/* 기간 선택 (토스 스타일 pill) */}
      <View style={styles.tabContainer}>
        {resolutions.map((r) => {
          const active = resolution === r.value;
          return (
            <TouchableOpacity
              key={r.value}
              style={[styles.tab, active && styles.activeTab]}
              onPress={() => setResolution(r.value as any)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.activeTabText]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
  symbol: {
    fontSize: 15,
    fontWeight: "600",
    color: COLOR_SUBTLE,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
  },
  bigPrice: {
    fontSize: 32,
    fontWeight: "800",
    color: COLOR_TEXT,
    letterSpacing: -0.5,
  },
  currency: {
    fontSize: 16,
    fontWeight: "600",
    color: COLOR_SUBTLE,
    marginLeft: 6,
    marginBottom: 5,
  },
  changeText: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
    marginBottom: 16,
  },
  loadingPrice: {
    fontSize: 18,
    color: COLOR_SUBTLE,
    marginTop: 8,
    marginBottom: 16,
  },
  chartCard: {
    marginBottom: 20,
  },
  emptyBox: {
    height: CHART_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },
  // 가로선
  markerLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
  },
  // 라벨 배지 (오른쪽 정렬)
  markerBadge: {
    position: "absolute",
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  markerLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  markerValue: {
    fontSize: 12,
    fontWeight: "700",
  },
  currentBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  currentBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },
  // 기간 탭
  tabContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tab: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "transparent",
  },
  activeTab: {
    backgroundColor: COLOR_PILL_BG,
  },
  tabText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLOR_SUBTLE,
  },
  activeTabText: {
    color: COLOR_TEXT,
    fontWeight: "700",
  },
  // 지지/저항 라벨 (왼쪽 정렬, 가격 마커와 겹치지 않게)
  srLabel: {
    position: "absolute",
    left: 4,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: COLOR_LINE,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  srRole: {
    fontSize: 10,
    fontWeight: "700",
    color: COLOR_SUBTLE,
    marginRight: 4,
  },
  srPrice: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4e5968",
  },
});
