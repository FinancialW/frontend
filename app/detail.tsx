import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { LineChart } from "react-native-wagmi-charts";
import Svg, { Line, Polyline } from "react-native-svg";

import { API_BASE, WS_BASE } from "@/constants/config";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const haptic = () => {
  if (Platform.OS !== "web") {
    Haptics.selectionAsync().catch(() => {});
  }
};

// 기간 탭: 누르면 살짝 줄었다 돌아오고, 활성 시 토스식 pill 배경
function PeriodTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      style={[styles.tab, active && styles.activeTab, animStyle]}
      onPressIn={() => {
        scale.value = withSpring(0.92, { damping: 18, stiffness: 340 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 280 });
      }}
      onPress={() => {
        haptic();
        onPress();
      }}
    >
      <Text style={[styles.tabText, active && styles.activeTabText]}>{label}</Text>
    </AnimatedPressable>
  );
}

// 차트 오버레이 토글(MA/지지저항/추세선)의 마지막 설정 저장 키
const TOGGLES_STORAGE_KEY = "chart.lineToggles.v1";

// 차트 오버레이 토글 칩: 켜짐 = 연회색 pill 채움, 꺼짐 = 테두리만 + 흐리게
function LegendToggle({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <AnimatedPressable
      style={[styles.toggleChip, active ? styles.toggleChipOn : styles.toggleChipOff, animStyle]}
      onPressIn={() => {
        scale.value = withSpring(0.94, { damping: 18, stiffness: 340 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 280 });
      }}
      onPress={() => {
        haptic();
        onPress();
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label} 표시 켜고 끄기`}
    >
      <View style={{ opacity: active ? 1 : 0.35 }}>{icon}</View>
      <Text style={[styles.toggleChipText, !active && styles.toggleChipTextOff]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

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

// 대각선 추세선 (/support-resistance/analysis 응답의 trendLines)
// slope 는 "캔들 1개당 가격 변화량"(인덱스 기준)이고, timestamp 는 초 단위다.
type TrendLine = {
  type: "SUPPORT" | "RESISTANCE";
  slope: number;
  startTimestamp: number;
  startPrice: number;
  endTimestamp: number;
  endPrice: number;
  currentProjectedPrice: number;
  touchCount: number;
  strength: number;
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
const SCREEN_H = Dimensions.get("window").height;
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

// 이동평균선(MA) 색 — 토스 팔레트에 MA 색이 없어 단기/중기 2개만 신규 추가
// (빨강 상승·파랑 하락·회색 보조색·차트 accentColor 와 비충돌하는 색으로 선정)
const COLOR_MA5 = "#f59f00"; // MA5 (단기) — 주황
const COLOR_MA20 = "#7048e8"; // MA20 (중기) — 보라

// 도움말 바텀시트가 화면 밖에 숨어 있을 때의 translateY 값
// 시트는 bottom:0 / maxHeight:82% 라 콘텐츠가 길면 600px 를 넘어 고정값으론 완전히 숨지 못한다.
// 화면 높이만큼 내리면 기기 크기와 무관하게 시트가 항상 화면 밖으로 완전히 빠진다.
const SHEET_HIDDEN_Y = SCREEN_H;

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

// 단순이동평균(SMA) — 슬라이딩 윈도우로 O(n) 계산.
// window 미만 구간(앞쪽)은 null, 이후부터 평균값을 채운다.
const computeSMA = (closes: number[], window: number): (number | null)[] => {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= window) sum -= closes[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
};

// 도움말 시트 범례 칩 종류 (차트 오버레이와 색을 1:1로 맞춘다)
type HelpLegend =
  | { kind: "dot"; color: string; text: string } // 색 점 (선/색상 표현)
  | { kind: "dash"; color: string; text: string } // 점선 표현 (지지·저항)
  | { kind: "band"; text: string }; // 회색 가격 구간 띠

type HelpSection = {
  title: string;
  body: string;
  legend?: HelpLegend[];
};

// 도움말 시트 콘텐츠 (데이터 주도 렌더링) — 순서가 곧 시트에 보이는 순서
const HELP_SECTIONS: HelpSection[] = [
  {
    title: "라인 차트와 스크럽",
    body: "선은 기간 동안의 종가 흐름이에요. 차트를 손가락으로 길게 눌러 좌우로 움직이면(스크럽) 그 시점의 가격과 날짜를 위쪽에서 확인할 수 있어요.",
  },
  {
    title: "기간 탭",
    body: "차트 아래 1일·1주·1개월·3개월·1년·전체 탭으로 보는 기간을 바꿔요. 기간을 바꾸면 차트와 지표가 그 기간에 맞춰 다시 계산돼요.",
  },
  {
    title: "등락률과 색상",
    body: "한국 증시 관례를 따라요. 오르면 빨강, 내리면 파랑이에요. 헤더의 큰 등락 숫자는 전일 종가 대비이고, 그 아래 회색 줄은 선택한 기간의 시작 대비 변화예요.",
    legend: [
      { kind: "dot", color: COLOR_BULL, text: "상승" },
      { kind: "dot", color: COLOR_BEAR, text: "하락" },
    ],
  },
  {
    title: "최고·최저선",
    body: "차트의 회색 가로선은 기간 내 최고가와 최저가 위치예요. 지금 가격(현재가)은 화면 위쪽의 큰 숫자로 확인할 수 있어요.",
  },
  {
    title: "이동평균선(MA)",
    body: "최근 종가의 평균을 이은 선이에요. 위 차트의 주황선 MA5는 최근 5개 값의 평균(단기 흐름), 보라선 MA20은 최근 20개 값의 평균(중기 흐름)을 보여줘요. 차트 위 범례를 눌러 끄고 켤 수 있어요.",
    legend: [
      { kind: "dot", color: COLOR_MA5, text: "MA5 (단기)" },
      { kind: "dot", color: COLOR_MA20, text: "MA20 (중기)" },
    ],
  },
  {
    title: "지지선과 저항선",
    body: "회색 띠는 가격이 자주 머물렀던 구간이에요. 띠 위쪽의 빨강 점선은 저항(천장)으로 뚫고 오르면 상승 신호가 될 수 있고, 아래쪽 파랑 점선은 지지(바닥)로 깨고 내려가면 하락 신호가 될 수 있는 가격대예요. 차트 위 범례를 눌러 끄고 켤 수 있어요.",
    legend: [
      { kind: "dash", color: COLOR_BULL, text: "저항(천장)" },
      { kind: "dash", color: COLOR_BEAR, text: "지지(바닥)" },
      { kind: "band", text: "가격 구간" },
    ],
  },
  {
    title: "추세선",
    body: "저점끼리 또는 고점끼리 일직선으로 늘어선 지점을 이은 대각선이에요. 파랑 점선(지지 추세선)은 가격이 내려올 때마다 반등했던 흐름을, 빨강 점선(저항 추세선)은 오를 때마다 막혔던 흐름을 보여줘요. 가격이 이 선을 뚫으면 추세가 바뀌는 신호일 수 있어요. 선 오른쪽 라벨의 가격은 추세선을 오늘까지 연장했을 때의 값이에요. 차트 위 범례를 눌러 끄고 켤 수 있어요.",
    legend: [
      { kind: "dash", color: COLOR_BEAR, text: "지지 추세선" },
      { kind: "dash", color: COLOR_BULL, text: "저항 추세선" },
    ],
  },
];

// 면책 문구 (시트 맨 아래 고정)
const HELP_DISCLAIMER =
  "이 화면의 정보는 투자 참고용이며 매매를 권유하지 않아요. 모든 투자 판단과 책임은 본인에게 있어요.";

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
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);

  const [loading, setLoading] = useState(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(parsedInitialPrice);

  // 스크럽(차트 위 드래그) 상태
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  // 전일 종가 (candles 응답 meta 에서 추출 — 추가 네트워크 요청 없음)
  const [prevClose, setPrevClose] = useState<number | null>(null);

  // 이동평균선(MA) 표시 토글
  const [showMA5, setShowMA5] = useState(true);
  const [showMA20, setShowMA20] = useState(true);
  // 지지/저항 존·추세선 표시 여부 — 처음엔 선이 많아 헷갈리지 않게 꺼두고, 원하면 범례에서 켠다
  const [showSR, setShowSR] = useState(false);
  const [showTrend, setShowTrend] = useState(false);

  // 마지막 토글 설정 복원 → 이후 변경될 때마다 저장.
  // 복원이 끝나기 전에는 저장하지 않는다 (기본값으로 덮어쓰는 것 방지).
  const togglesLoaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(TOGGLES_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.ma5 === "boolean") setShowMA5(saved.ma5);
        if (typeof saved.ma20 === "boolean") setShowMA20(saved.ma20);
        if (typeof saved.sr === "boolean") setShowSR(saved.sr);
        if (typeof saved.trend === "boolean") setShowTrend(saved.trend);
      })
      .catch(() => {})
      .finally(() => {
        togglesLoaded.current = true;
      });
  }, []);

  useEffect(() => {
    if (!togglesLoaded.current) return;
    AsyncStorage.setItem(
      TOGGLES_STORAGE_KEY,
      JSON.stringify({ ma5: showMA5, ma20: showMA20, sr: showSR, trend: showTrend })
    ).catch(() => {});
  }, [showMA5, showMA20, showSR, showTrend]);

  // 도움말 바텀시트 상태/애니메이션 공유값
  const [helpVisible, setHelpVisible] = useState(false);
  const sheetTranslateY = useSharedValue(SHEET_HIDDEN_Y);
  const backdropOpacity = useSharedValue(0);

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
        `${API_BASE}/candles?symbol=${symbolParam}&resolution=${resolution}`,
        { credentials: "include" }
      );
      const json = await res.json();

      if (!json.chart || !json.chart.result) return;

      const result = json.chart.result[0];
      if (!result) return;

      // 전일 종가: 1D 응답 meta 에서만 산출한다(home.tsx fetchPrevCloses 와 동일하게 1D + 동일 폴백 순서).
      // chartPreviousClose 는 '조회 구간 시작 직전의 종가'라 비-1D 탭(1주/1개월/…)에서는 range 에 종속되어
      // '전일 종가'가 아니라 구간 시작 전 종가(예: 1년 전 값)가 된다. 마운트 시 기본 resolution 이 1D 라
      // 항상 1D 로 먼저 조회되므로, 1D 에서 한 번 잡은 값을 다른 탭으로 바꿔도 그대로 유지한다.
      if (resolution === "1D") {
        const meta = result.meta;
        const pc =
          meta?.previousClose ??
          meta?.chartPreviousClose ??
          meta?.regularMarketPreviousClose;
        if (typeof pc === "number" && Number.isFinite(pc)) setPrevClose(pc);
      }

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
      // /analysis 는 지지/저항 존(levels)에 더해 대각선 추세선(trendLines)까지 내려준다.
      const res = await fetch(
        `${API_BASE}/support-resistance/analysis?symbol=${symbolParam}&resolution=${resolution}`,
        { credentials: "include" }
      );
      const json = await res.json();
      // 백엔드가 배열을 바로 주는 구버전 응답까지 방어한다.
      const list: SupportResistanceZone[] = Array.isArray(json)
        ? json
        : json?.levels ?? json?.zones ?? json?.data ?? [];
      const lines: TrendLine[] = Array.isArray(json?.trendLines)
        ? json.trendLines
        : [];
      console.log(
        `[지지/저항] ${symbolParam} ${resolution}: 존 ${list.length}개, 추세선 ${lines.length}개`
      );
      setZones(list);
      setTrendLines(lines);
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

    const connect = () => {
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
            // 비정상(NaN) 가격은 무시한다 — 헤더 등락/차트가 'NaN'으로 오염되지 않게.
            if (Number.isFinite(price)) {
              setCurrentPrice(price);
              updateLastCandle(price);
            }
          }
        } catch {}
      };
    };

    connect();

    // 백그라운드에서 끊긴 소켓을 포그라운드 복귀 시 재연결한다.
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const ws = wsRef.current;
      const closed =
        !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
      if (closed) connect();
    });

    return () => {
      sub.remove();
      wsRef.current?.close();
    };
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

  // 이동평균선 계산용 종가 배열 + MA5/MA20 (스크럽 중에도 validData 참조 유지 → 재계산 안 됨)
  const closes = useMemo(() => validData.map((d) => d.close), [validData]);
  const ma5 = useMemo(() => computeSMA(closes, 5), [closes]);
  const ma20 = useMemo(() => computeSMA(closes, 20), [closes]);

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

  // 등락 계산 (전일 종가 대비 — 헤더 메인 헤드라인용)
  const dayChange =
    lastPrice !== null && prevClose !== null ? lastPrice - prevClose : null;
  const dayPct =
    dayChange !== null && prevClose ? (dayChange / prevClose) * 100 : null;
  const dayColor =
    dayChange === null
      ? COLOR_TEXT
      : dayChange > 0
        ? COLOR_BULL
        : dayChange < 0
          ? COLOR_BEAR
          : COLOR_TEXT;

  // 도움말 바텀시트 열기/닫기 (닫힘은 애니메이션 종료 후 언마운트)
  const openHelp = () => {
    haptic();
    setHelpVisible(true);
    backdropOpacity.value = withTiming(0.45, { duration: 200 });
    sheetTranslateY.value = withSpring(0, { damping: 20, stiffness: 220 });
  };
  const closeHelp = () => {
    backdropOpacity.value = withTiming(0, { duration: 180 });
    sheetTranslateY.value = withTiming(SHEET_HIDDEN_Y, { duration: 220 }, (f) => {
      if (f) runOnJS(setHelpVisible)(false);
    });
  };
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

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

  // MA 폴리라인 좌표 문자열은 스크럽(activeIndex)과 무관하므로 미리 메모해 둔다.
  // (스크럽 중 매 프레임 리렌더에서 O(n) 문자열을 다시 만들지 않도록)
  const maPoints = useMemo(() => {
    const denom = Math.max(validData.length - 1, 1);
    const build = (arr: (number | null)[]) =>
      arr
        .map((v, i) =>
          v === null ? null : `${(i / denom) * SCREEN_WIDTH},${yFor(v)}`
        )
        .filter((p): p is string => p !== null)
        .join(" ");
    return {
      ma5Points: build(ma5),
      ma20Points: build(ma20),
      ma5Count: ma5.filter((v) => v !== null).length,
      ma20Count: ma20.filter((v) => v !== null).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ma5, ma20, validData.length, domainMin, domainSpan]);

  // 🔥 최고점 / 최저점 가로선 + 라벨 (토스 스타일)
  // 현재가는 헤더의 큰 숫자로 이미 보여주므로 차트에는 표시하지 않는다 (선·배지 모두 제거).
  const renderPriceMarkers = () => {
    if (!validData.length || dataRange < 0) return null;

    const highY = yFor(dataHigh);
    const lowY = yFor(dataLow);

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
      </View>
    );
  };

  // 지지/저항 — 존(밴드)으로 표현. 상단 경계=저항(뚫으면 상승/빨강), 하단 경계=지지(뚫으면 하락/파랑)
  const renderSupportResistanceZones = () => {
    if (!showSR || !validData.length || !zones.length) return null;

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

  // 대각선 추세선 — 시작 피벗과 현재 투영가(마지막 봉)를 잇는 직선.
  // 백엔드 slope 는 1Y 일봉의 '캔들 인덱스당' 기울기라, 같은 좌표계(인덱스 기반 x)에 그대로 그린다.
  // 시작점이 보이는 구간 밖(다른 기간 탭)이면 화면 왼쪽 끝에서 시간 보간한 가격으로 잘라 그린다.
  const renderTrendLines = () => {
    if (!showTrend || !validData.length || !trendLines.length) return null;

    const denom = Math.max(validData.length - 1, 1);
    const firstTs = validData[0].timestamp;
    const lastTs = validData[validData.length - 1].timestamp;

    const segments = trendLines
      .map((tl, index) => {
        const startTs = tl.startTimestamp * 1000; // 초 → ms
        if (lastTs <= startTs) return null; // 보이는 구간이 추세선 시작 이전이면 그리지 않음

        // (startTs, startPrice) ~ (lastTs, currentProjectedPrice) 직선 위의 시간 보간 가격
        const priceAt = (ts: number) =>
          tl.startPrice +
          ((tl.currentProjectedPrice - tl.startPrice) * (ts - startTs)) /
            (lastTs - startTs);

        let x1 = 0;
        let y1 = yFor(priceAt(firstTs));
        if (startTs >= firstTs) {
          // 시작 피벗이 보이는 구간 안이면 해당 캔들 인덱스에 정확히 앵커링
          let idx = validData.findIndex((d) => d.timestamp >= startTs);
          if (idx < 0) idx = validData.length - 1;
          x1 = (idx / denom) * SCREEN_WIDTH;
          y1 = yFor(tl.startPrice);
        }

        const y2 = yFor(tl.currentProjectedPrice);
        const color = tl.type === "RESISTANCE" ? COLOR_BULL : COLOR_BEAR;
        const role = tl.type === "RESISTANCE" ? "저항 추세선" : "지지 추세선";
        return { index, x1, y1, x2: SCREEN_WIDTH, y2, color, role, price: tl.currentProjectedPrice };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    if (!segments.length) return null;

    // 라벨(선 오른쪽 끝) 겹침 방지 — 지지/저항 라벨과 동일한 방식으로 아래로 밀어낸다.
    const MIN_DISTANCE = 18;
    const labels = segments
      .map((s) => ({ ...s, labelY: s.y2 }))
      .sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].labelY - labels[i - 1].labelY < MIN_DISTANCE) {
        labels[i].labelY = labels[i - 1].labelY + MIN_DISTANCE;
      }
    }

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SCREEN_WIDTH} height={CHART_HEIGHT}>
          {segments.map((s) => (
            <Line
              key={`tl-${s.index}`}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.85}
            />
          ))}
        </Svg>
        {labels.map((s) => (
          <View key={`tl-label-${s.index}`} style={[styles.tlLabel, { top: s.labelY - 9 }]}>
            <Text style={[styles.srRole, { color: s.color }]}>{s.role}</Text>
            <Text style={styles.srPrice}>{formatPrice(s.price)}</Text>
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

  // 이동평균선(MA5/MA20) 오버레이 — SR/스크럽과 동일한 좌표계(yFor, x=(i/denom)*SCREEN_WIDTH) 사용.
  // 전제: validData 가 finite close 만 남겨 중간 결측이 없으므로 computeSMA 의 null 은
  // 항상 앞쪽 연속 구간뿐 → null 제거 후 이어 그려도 선이 끊기거나 잘못 이어지지 않는다.
  const renderMovingAverages = () => {
    if (!validData.length) return null;
    const { ma5Points, ma20Points, ma5Count, ma20Count } = maPoints;

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={SCREEN_WIDTH} height={CHART_HEIGHT}>
          {showMA5 && ma5Count >= 2 && (
            <Polyline
              points={ma5Points}
              fill="none"
              stroke={COLOR_MA5}
              strokeWidth={1.5}
              opacity={0.9}
            />
          )}
          {showMA20 && ma20Count >= 2 && (
            <Polyline
              points={ma20Points}
              fill="none"
              stroke={COLOR_MA20}
              strokeWidth={1.5}
              opacity={0.9}
            />
          )}
        </Svg>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* 도움말 트리거 (우상단 ⓘ) */}
      <Pressable
        onPress={openHelp}
        hitSlop={8}
        style={styles.helpButton}
        accessibilityRole="button"
        accessibilityLabel="차트 도움말 열기"
      >
        <Ionicons name="help-circle-outline" size={24} color={COLOR_SUBTLE} />
      </Pressable>

      {/* 헤더: 종목 / 현재가(또는 스크럽 시점가) / 등락(또는 시점) — 토스 스타일 */}
      <Animated.Text
        entering={FadeInDown.duration(400).springify().damping(18)}
        style={styles.symbol}
      >
        {symbolParam}
      </Animated.Text>
      {headerPrice !== null ? (
        <Animated.View entering={FadeInDown.delay(60).duration(400).springify().damping(18)}>
          <View style={styles.priceRow}>
            <Text style={styles.bigPrice}>{formatPrice(headerPrice)}</Text>
            <Text style={styles.currency}>USD</Text>
          </View>
          {activeCandle ? (
            // 스크럽 중: 해당 시점 라벨
            <Text style={[styles.changeText, { color: COLOR_SUBTLE }]}>
              {formatScrubDate(activeCandle.timestamp, resolution)}
            </Text>
          ) : dayChange !== null && dayPct !== null ? (
            // 전일 종가 대비(메인) + 기간 시작 대비(보조)
            <>
              <Text
                style={[styles.changeText, styles.changeTextTight, { color: dayColor }]}
              >
                {`${dayChange > 0 ? "▲" : dayChange < 0 ? "▼" : "–"} ${
                  dayChange > 0 ? "+" : dayChange < 0 ? "-" : ""
                }${formatPrice(Math.abs(dayChange))} (${
                  dayChange > 0 ? "+" : dayChange < 0 ? "-" : ""
                }${Math.abs(dayPct).toFixed(2)}%)`}
              </Text>
              <Text style={styles.subChangeText}>
                {resolutionLabel} {change >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%
              </Text>
            </>
          ) : (
            // 전일 종가 부재 시: 기간 시작 대비를 메인으로 폴백 (보조 줄 생략)
            <Text style={[styles.changeText, { color: accentColor }]}>
              {isUp ? "▲" : "▼"} {formatPrice(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
              {changePct.toFixed(2)}%) · {resolutionLabel}
            </Text>
          )}
        </Animated.View>
      ) : (
        <Text style={styles.loadingPrice}>로딩중...</Text>
      )}

      {/* 오버레이 토글 칩 (누르면 해당 선을 끄고 켠다 — 마지막 설정은 저장됨) */}
      {validData.length > 0 && (
        <View style={styles.maLegend}>
          <LegendToggle
            label="MA5"
            active={showMA5}
            onPress={() => setShowMA5((v) => !v)}
            icon={<View style={[styles.maDot, { backgroundColor: COLOR_MA5 }]} />}
          />
          <LegendToggle
            label="MA20"
            active={showMA20}
            onPress={() => setShowMA20((v) => !v)}
            icon={<View style={[styles.maDot, { backgroundColor: COLOR_MA20 }]} />}
          />
          <LegendToggle
            label="지지/저항"
            active={showSR}
            onPress={() => setShowSR((v) => !v)}
            icon={<View style={[styles.toggleDash, { backgroundColor: COLOR_SUBTLE }]} />}
          />
          <LegendToggle
            label="추세선"
            active={showTrend}
            onPress={() => setShowTrend((v) => !v)}
            icon={
              <View
                style={[
                  styles.toggleDash,
                  { backgroundColor: COLOR_SUBTLE, transform: [{ rotate: "-25deg" }] },
                ]}
              />
            }
          />
        </View>
      )}

      {/* 차트 */}
      {loading ? (
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={COLOR_SUBTLE} />
        </View>
      ) : validData.length > 0 ? (
        <Animated.View entering={FadeIn.delay(120).duration(450)} style={styles.chartCard}>
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
            {/* 대각선 추세선: SR 밴드 위, MA 아래 */}
            {renderTrendLines()}
            {/* 이동평균선(MA): SR 밴드 위, 가격 마커 배지 아래 */}
            {renderMovingAverages()}
            {/* 최고/최저/현재 가로선 + 라벨 */}
            {renderPriceMarkers()}
            {/* 스크럽 세로 가이드 */}
            {renderScrubOverlay()}
          </View>
        </Animated.View>
      ) : (
        <View style={styles.emptyBox}>
          <Text style={{ color: COLOR_SUBTLE }}>데이터가 없습니다.</Text>
        </View>
      )}

      {/* 기간 선택 (토스 스타일 pill) */}
      <View style={styles.tabContainer}>
        {resolutions.map((r) => (
          <PeriodTab
            key={r.value}
            label={r.label}
            active={resolution === r.value}
            onPress={() => setResolution(r.value as any)}
          />
        ))}
      </View>

      {/* 도움말 바텀시트 (지지/저항 + 차트 용어 통합) */}
      <Modal
        transparent
        visible={helpVisible}
        animationType="none"
        onRequestClose={closeHelp}
      >
        <View style={{ flex: 1 }}>
          {/* 배경 (탭하면 닫힘) */}
          <AnimatedPressable
            style={[StyleSheet.absoluteFill, styles.modalBackdrop, backdropStyle]}
            onPress={closeHelp}
          />
          {/* 시트 — backdrop 의 형제로 두어 시트 내부 탭이 closeHelp 로 전파되지 않게 함 */}
          <Animated.View style={[styles.sheet, sheetStyle]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>차트, 어떻게 보나요?</Text>
              <Pressable
                onPress={closeHelp}
                hitSlop={8}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="닫기"
              >
                <Ionicons name="close" size={22} color={COLOR_SUBTLE} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {HELP_SECTIONS.map((section) => (
                <View key={section.title} style={styles.section}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionBody}>{section.body}</Text>
                  {section.legend ? (
                    <View style={styles.legendRow}>
                      {section.legend.map((item, i) => (
                        <View key={i} style={styles.legendChip}>
                          {item.kind === "dot" ? (
                            <View
                              style={[styles.legendDot, { backgroundColor: item.color }]}
                            />
                          ) : item.kind === "dash" ? (
                            <View
                              style={[styles.legendDash, { borderColor: item.color }]}
                            />
                          ) : (
                            <View style={styles.legendBand} />
                          )}
                          <Text style={styles.legendText}>{item.text}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
              <Text style={styles.disclaimer}>{HELP_DISCLAIMER}</Text>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
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
  // 2줄 헤더에서 메인 줄(전일 종가 대비)은 보조 줄과 붙도록 하단 여백을 줄인다.
  changeTextTight: {
    marginBottom: 2,
  },
  // 보조 줄(기간 시작 대비, 회색) — 차트 위 여백은 이 줄이 담당
  subChangeText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLOR_SUBTLE,
    marginTop: 2,
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
  // 추세선 라벨: srLabel과 동일하되 오른쪽 끝에 붙인다 (지지/저항 라벨과 좌우로 분리)
  tlLabel: {
    position: "absolute",
    right: 4,
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
  // 도움말 트리거 (우상단 ⓘ)
  helpButton: {
    position: "absolute",
    top: 60,
    right: 20,
    zIndex: 10,
  },
  // 이동평균선 범례 + 토글
  maLegend: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  // 토글 칩: 켜짐 = 연회색 pill 채움, 꺼짐 = 테두리만
  toggleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  toggleChipOn: {
    backgroundColor: COLOR_PILL_BG,
    borderColor: "transparent",
  },
  toggleChipOff: {
    backgroundColor: "transparent",
    borderColor: COLOR_LINE,
  },
  toggleChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLOR_TEXT,
  },
  toggleChipTextOff: {
    color: COLOR_SUBTLE,
    opacity: 0.6,
  },
  maDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  // 지지/저항·추세선 토글용 짧은 선 모양 (추세선은 rotate로 기울인다)
  toggleDash: {
    width: 12,
    height: 2,
    borderRadius: 1,
  },
  // 도움말 모달 / 바텀시트
  modalBackdrop: {
    backgroundColor: "#000",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 34 : 24,
    maxHeight: "82%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLOR_LINE,
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLOR_TEXT,
  },
  closeBtn: {
    padding: 4,
  },
  // 도움말 섹션
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLOR_TEXT,
    marginBottom: 6,
  },
  sectionBody: {
    fontSize: 13,
    color: "#4e5968",
    lineHeight: 20,
  },
  // 범례 칩 (차트 색과 1:1 매칭)
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 8,
  },
  legendChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendDash: {
    width: 16,
    height: 0,
    borderTopWidth: 2,
    borderStyle: "dashed",
  },
  legendBand: {
    width: 16,
    height: 12,
    borderRadius: 3,
    backgroundColor: "rgba(139,149,161,0.12)",
    borderWidth: 1,
    borderColor: COLOR_LINE,
  },
  legendText: {
    fontSize: 12,
    color: COLOR_SUBTLE,
  },
  // 면책 문구
  disclaimer: {
    fontSize: 12,
    color: COLOR_SUBTLE,
    lineHeight: 18,
    marginTop: 4,
  },
});
