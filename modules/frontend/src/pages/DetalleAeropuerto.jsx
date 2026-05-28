import { useParams, useNavigate } from 'react-router-dom'
import { AEROPUERTOS, getOcupacionPct, getSemaforoPorOcupacion } from '../data/aeropuertos'
import { MALETAS_POR_AEROPUERTO, VUELOS_DETALLE_POR_AEROPUERTO } from '../data/maletas'
import NavBar from '../components/NavBar'
import SemaforoBadge from '../components/SemaforoBadge'
import BarraProgreso from '../components/BarraProgreso'

const ESTADO_CONFIG = {
  'EN PLAZO':       { color: 'verde', label: 'EN PLAZO' },
  'EN RIESGO':      { color: 'ambar', label: 'EN RIESGO' },
  'FUERA DE PLAZO': { color: 'rojo',  label: 'FUERA DE PLAZO' },
}

export default function DetalleAeropuerto() {
  const { codigo } = useParams()
  const navigate = useNavigate()
  const ap = AEROPUERTOS[codigo?.toUpperCase()]
  const maletas = MALETAS_POR_AEROPUERTO[codigo?.toUpperCase()] ?? []
  const vuelos = VUELOS_DETALLE_POR_AEROPUERTO[codigo?.toUpperCase()] ?? { salientes: [], entrantes: [] }

  if (!ap) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">✈</div>
          <h2 className="text-2xl font-bold text-white mb-2">Aeropuerto no encontrado</h2>
          <p className="text-slate-400 mb-4">El código "{codigo}" no existe en el sistema.</p>
          <button onClick={() => navigate('/dashboard')} className="text-blue-400 hover:text-blue-300">
            ← Volver al Dashboard
          </button>
        </div>
      </div>
    )
  }

  const pct = getOcupacionPct(ap)
  const color = getSemaforoPorOcupacion(pct)
  const barColor = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400' }[color]

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <NavBar />
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-slate-400 hover:text-white transition-colors text-sm flex items-center gap-1"
          >
            ← Volver al Mapa
          </button>
          <div className="h-4 w-px bg-slate-600" />
          <div>
            <h1 className="text-2xl font-bold text-white">
              {ap.nombre} ({ap.codigo})
            </h1>
            <span className="inline-block mt-1 text-xs font-semibold text-slate-400 bg-slate-700 px-2 py-0.5 rounded uppercase tracking-wider">
              {ap.ciudad}, {ap.continente}
            </span>
          </div>
        </div>

        {/* Barra de capacidad */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-slate-400 font-medium">Capacidad del Almacén</span>
            <span className={`font-mono font-bold text-lg ${barColor}`}>
              {ap.almacen.actual.toLocaleString()}/{ap.almacen.capacidad.toLocaleString()} maletas — {pct}% OCUPADO
            </span>
          </div>
          <BarraProgreso pct={pct} color={color} height="h-3" />
        </div>

        {/* Dos columnas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Maletas en almacén */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700 flex justify-between items-center">
              <h2 className="font-semibold text-white">Maletas en Almacén</h2>
              <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded">{maletas.length} maletas</span>
            </div>
            <div className="divide-y divide-slate-700/50 max-h-[480px] overflow-y-auto">
              {maletas.length === 0 ? (
                <p className="p-5 text-slate-400 text-sm text-center">Sin maletas registradas</p>
              ) : (
                maletas.map((m) => {
                  const cfg = ESTADO_CONFIG[m.estado] ?? { color: 'azul', label: m.estado }
                  const horasTexto = m.horasRestantes >= 0
                    ? `Restan ${m.horasRestantes}h`
                    : `Restan ${m.horasRestantes}h`
                  return (
                    <div key={m.codigo} className="flex items-center justify-between px-5 py-3 hover:bg-slate-700/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-300">{m.codigo}</span>
                        <span className="text-xs text-slate-500">→</span>
                        <span className="text-xs font-semibold text-slate-200">{m.destino}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <SemaforoBadge color={cfg.color} label={cfg.label} />
                        <span className={`font-mono text-xs ${m.horasRestantes < 0 ? 'text-red-400' : m.horasRestantes <= 6 ? 'text-amber-400' : 'text-slate-400'}`}>
                          {horasTexto}
                        </span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Vuelos */}
          <div className="flex flex-col gap-4">

            {/* Salientes */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700">
                <h2 className="font-semibold text-white">Vuelos Salientes Próximos</h2>
              </div>
              <div className="divide-y divide-slate-700/50">
                {vuelos.salientes.length === 0 ? (
                  <p className="p-5 text-slate-400 text-sm text-center">Sin vuelos salientes próximos</p>
                ) : (
                  vuelos.salientes.map((v) => {
                    const capPct = Math.round((v.asignadas / (v.asignadas + v.capacidadLibre)) * 100)
                    return (
                      <div key={v.codigo} className="px-5 py-4">
                        <div className="flex justify-between items-center mb-2">
                          <div>
                            <span className="font-mono font-semibold text-blue-400 text-sm">{v.codigo}</span>
                            <span className="text-slate-400 text-xs ml-2">→ {v.hacia}</span>
                          </div>
                          <span className="text-xs text-slate-400">Sale en <span className="text-white font-mono">{v.saleEn}</span></span>
                        </div>
                        <div className="grid grid-cols-2 text-xs gap-x-4 text-slate-400 mb-2">
                          <span>Capacidad libre: <span className="text-green-400 font-mono">{v.capacidadLibre}</span></span>
                          <span>Asignadas: <span className="text-amber-400 font-mono">{v.asignadas}</span></span>
                        </div>
                        <BarraProgreso
                          pct={capPct}
                          color={capPct > 85 ? 'rojo' : capPct >= 60 ? 'ambar' : 'verde'}
                          height="h-1.5"
                          showLabel
                        />
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Entrantes */}
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700">
                <h2 className="font-semibold text-white">Vuelos Entrantes Próximos</h2>
              </div>
              <div className="divide-y divide-slate-700/50">
                {vuelos.entrantes.length === 0 ? (
                  <p className="p-5 text-slate-400 text-sm text-center">Sin vuelos entrantes próximos</p>
                ) : (
                  vuelos.entrantes.map((v) => (
                    <div key={v.codigo} className="flex justify-between items-center px-5 py-4">
                      <div>
                        <span className="font-mono font-semibold text-blue-400 text-sm">{v.codigo}</span>
                        <span className="text-slate-400 text-xs ml-2">desde {v.desde}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">
                          Llega en <span className="text-white font-mono">{v.llegaEn}</span>
                        </div>
                        <div className="text-xs text-slate-400">
                          <span className="text-amber-400 font-mono">{v.maletasEnCamino}</span> maletas en camino
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
