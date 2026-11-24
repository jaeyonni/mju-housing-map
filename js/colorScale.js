// Viridis 및 역방향 환산월세 색상 스케일 유틸리티

const VIRIDIS_STOPS = [
  [0.0, [68, 1, 84]],     // #440154
  [0.25, [59, 82, 139]],  // #3b528b
  [0.5, [33, 145, 140]],  // #21918c
  [0.75, [94, 201, 98]],  // #5ec962
  [1.0, [253, 231, 37]],  // #fde725
];

// 환산월세: 싼 곳이 진하게 (밝은 연두 -> 짙은 포레스트 그린)
const RENT_INV_STOPS = [
  [0.0, [232, 245, 233]], // #e8f5e9 (비싼 편)
  [0.35, [129, 199, 132]],// #81c784
  [0.7, [46, 125, 50]],   // #2e7d32
  [1.0, [20, 61, 43]],    // #143d2b (가장 저렴)
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
  return 'rgb(68, 1, 84)';
}

export function getScoreColor(score, minScore, maxScore) {
  const span = maxScore - minScore;
  const t = span > 1e-4 ? (score - minScore) / span : 0.65;
  return lerpStops(VIRIDIS_STOPS, t);
}

export function getRentColor(rent, minRent, maxRent) {
  if (rent == null || Number.isNaN(rent)) return '#cbd5e1';
  const span = maxRent - minRent;
  // 저렴할수록 t -> 1.0 (진한 녹색)
  const t = span > 1e-4 ? (maxRent - rent) / span : 0.5;
  return lerpStops(RENT_INV_STOPS, t);
}

export function getFactorBarColor(val) {
  return lerpStops(VIRIDIS_STOPS, (val - 1.0) / 4.0);
}

export function getRoadRentColor(conv) {
  if (conv <= 48) return '#1b5e20';
  if (conv <= 58) return '#2e7d32';
  if (conv <= 68) return '#f59e0b';
  return '#dc2626';
}

export const LEGEND_GRADIENTS = {
  score: 'linear-gradient(to right, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)',
  rent: 'linear-gradient(to right, #e8f5e9 0%, #81c784 35%, #2e7d32 70%, #143d2b 100%)',
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
  return parts.join(' · ');
}
