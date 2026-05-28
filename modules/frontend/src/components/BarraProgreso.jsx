import { SEMAFORO_COLORES } from '../data/aeropuertos'

export default function BarraProgreso({ pct, color = 'verde', height = 'h-1.5', showLabel = false }) {
  const hex = SEMAFORO_COLORES[color] ?? SEMAFORO_COLORES.verde
  const clamped = Math.min(pct, 100)
  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 bg-slate-700 rounded-full overflow-hidden ${height}`}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, backgroundColor: hex }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono text-slate-300 w-10 text-right">{pct.toFixed(1)}%</span>
      )}
    </div>
  )
}
