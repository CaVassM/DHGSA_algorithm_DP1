import { useState } from 'react'

// T41: lista de envíos actualmente en vuelo (en tránsito), sobre el mapa.
// Recibe los "legs activos" del momento simulado (origen, destino, maletas,
// progreso). Panel flotante y colapsable para no tapar el mapa.
export default function EnviosEnVuelo({ envios = [] }) {
  const [abierto, setAbierto] = useState(true)

  return (
    <div className="absolute bottom-4 right-4 z-[1000] w-72 max-w-[80vw]">
      <div className="bg-slate-900/92 backdrop-blur border border-slate-700 rounded-xl overflow-hidden shadow-lg shadow-black/50">
        <button
          onClick={() => setAbierto(a => !a)}
          className="w-full flex items-center justify-between px-3 py-2 bg-slate-800/60 hover:bg-slate-800 transition-colors"
        >
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <span className="text-blue-400">✈</span> Envíos en vuelo
            <span className="text-slate-500">({envios.length})</span>
          </span>
          <span className={`text-slate-500 text-sm transition-transform ${abierto ? 'rotate-90' : ''}`}>›</span>
        </button>

        {abierto && (
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-700/50">
            {envios.length === 0 ? (
              <p className="px-3 py-4 text-xs text-slate-500 text-center">
                Ningún envío en tránsito en este momento. Dale play a la simulación.
              </p>
            ) : (
              envios.map((e, i) => (
                <div key={`${e.shipmentId}-${i}`} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-blue-300 truncate">{e.shipmentId}</span>
                    <span className="font-mono text-[11px] text-slate-400 shrink-0">{e.maletas} mal.</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-[11px] text-slate-300">{e.desde} → {e.hasta}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">{Math.round((e.progreso ?? 0) * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-700 overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (e.progreso ?? 0) * 100)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
