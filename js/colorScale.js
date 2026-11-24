// 통합 빨강→노랑→초록(RdYlGn) 색상 스케일 유틸리티
// 총점(낮음→높음), 환산월세(비쌈→저렴), 7요소 막대(1점→5점) 모두 동일 규칙 사용

const RDYLGN_STOPS = [
  [0.0, [215, 48, 39]],   // #d73027 (낮음 / 비쌈)
  [0.28, [249, 115, 22]], // #f97316 (주황)
  [0.55, [250, 204, 21]], // #facc15 (노랑)
  [0.8, [74, 222, 128]],  // #4ade80 (연초록)
  [1.0, [21, 128, 61]],   // #15803d (높음 / 저렴 - 진한 초록)
];

function lerpStops(stops, t) {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (clamped <= t1 || i === stops.length - 2) {
      const f = t1 > t0 ? (clamped - t0) / (t1 - t0) : 0;
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return 'rgb(215, 48, 39)';
}

export function getScoreColor(score, minScore, maxScore) {
  const span = maxScore - minScore;
  const t = span > 1e-4 ? (score - minScore) / span : 0.65;
  return lerpStops(RDYLGN_STOPS, t);
}

export function getRentColor(rent, minRent, maxRent) {
  if (rent == null || Number.isNaN(rent)) return '#cbd5e1';
  const span = maxRent - minRent;
  // 저렴할수록 t -> 1.0 (초록)
  const t = span > 1e-4 ? (maxRent - rent) / span : 0.5;
  return lerpStops(RDYLGN_STOPS, t);
}

export function getFactorBarColor(val) {
  return lerpStops(RDYLGN_STOPS, (val - 1.0) / 4.0);
}

export function getRoadRentColor(conv) {
  if (conv <= 48) return '#1b5e20';
  if (conv <= 58) return '#2e7d32';
  if (conv <= 68) return '#f59e0b';
  return '#dc2626';
}

const RDYLGN_CSS =
  'linear-gradient(to right, #d73027 0%, #f97316 28%, #facc15 55%, #4ade80 80%, #15803d 100%)';

export const LEGEND_GRADIENTS = {
  score: RDYLGN_CSS,
  rent: RDYLGN_CSS,
};

export function formatDistance(meters) {
  if (meters == null) return '-';
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

export function getBuildingDisplayName(b) {
  if (b.nm && b.nm.trim()) return b.nm.trim();
  if (b.rd && b.rd.trim()) return b.rd.trim();
  return `${b.d} ${b.cat}`;
}

export function formatBuildingMeta(b) {
  const parts = [b.d];
  if (b.rd && b.rd !== b.nm) parts.push(b.rd);
  else if (b.zn) parts.push(b.zn);
  if (b.fl && b.fl > 0) parts.push(`${b.fl}층`);
  if (b.yr) parts.push(`${b.yr}년`);
  if (b.pr != null) parts.push(`월세환산 약 ${Math.round(b.pr)}만`);
  else if (b.ps === '미수집') parts.push('시세 미수집');
  return parts.join(' · ');
}
