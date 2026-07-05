// Tiny dependency-free SVG sparkline.
export function Sparkline({
  values,
  width = 140,
  height = 40,
  up = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  up?: boolean;
}) {
  const pad = 3;
  const n = values.length;
  const color = up ? "#4cb782" : "#eb5757";

  if (n === 0) return <svg width={width} height={height} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const x = (i: number) => pad + i * stepX;

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${x(n - 1).toFixed(1)},${height} L ${x(0).toFixed(1)},${height} Z`;
  const lastX = x(n - 1);
  const lastY = y(values[n - 1]);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={area} fill={color} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
