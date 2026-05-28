import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AEROPUERTOS, getOcupacionPct, getSemaforoPorOcupacion } from '../data/aeropuertos'
import { VUELOS_RANKING, getOcupacionVueloPct, getSemaforoVuelo } from '../data/vuelos'
import { KPIS, DATOS_GRAFICO_DIAS, CONTINENTES } from '../data/simulacion'
import NavBar from '../components/NavBar'
import SemaforoBadge from '../components/SemaforoBadge'
import BarraProgreso from '../components/BarraProgreso'

const RANKING_AEROPUERTOS = Object.values(AEROPUERTOS)
  .map((ap) => ({ ...ap, pct: getOcupacionPct(ap), color: getSemaforoPorOcupacion(getOcupacionPct(ap)) }))
  .sort((a, b) => b.pct - a.pct)

const SEMAFORO_LABEL = {
  verde: { label: '<60% ÓPTIMO',   color: 'verde' },
  ambar: { label: '60-85% RIESGO', color: 'ambar' },
  rojo:  { label: '>85% CRÍTICO',  color: 'rojo'  },
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-white mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

export default function IndicadoresGlobales() {
  const cumplimientoColor = KPIS.cumplimientoPlazos >= 95 ? 'verde' : KPIS.cumplimientoPlazos >= 85 ? 'ambar' : 'rojo'
  const vuelosActivos = VUELOS_RANKING.filter(v => v.estado === 'EN AIRE').length
  const vuelosAltos = VUELOS_RANKING.filter(v => getOcupacionVueloPct(v) >= 90).length
  const vuelosBajos = VUELOS_RANKING.filter(v => getOcupacionVueloPct(v) < 50).length
  const promGlobal = Math.round(
    VUELOS_RANKING.reduce((acc, v) => acc + getOcupacionVueloPct(v), 0) / VUELOS_RANKING.length * 10
  ) / 10

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <NavBar />
      <div className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">

        {/* Fila superior: Cumplimiento + Gráfico */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Cumplimiento global */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-5 flex flex-col justify-between">
            <div>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Cumplimiento Global</h2>
              <div className={`text-5xl font-bold mb-2 ${cumplimientoColor === 'verde' ? 'text-green-400' : cumplimientoColor === 'ambar' ? 'text-amber-400' : 'text-red-400'}`}>
                {KPIS.cumplimientoPlazos}%
              </div>
              <p className="text-slate-400 text-sm mb-4">de maletas entregadas en plazo</p>
            </div>
            <div>
              <BarraProgreso pct={KPIS.cumplimientoPlazos} color={cumplimientoColor} height="h-3" showLabel />
              <div className="mt-3 grid grid-cols-3 text-center text-xs">
                <div>
                  <div className="text-green-400 font-mono font-bold">{KPIS.maletasEntregadas.toLocaleString()}</div>
                  <div className="text-slate-500">Entregadas</div>
                </div>
                <div>
                  <div className="text-amber-400 font-mono font-bold">{KPIS.maletasPendientes.toLocaleString()}</div>
                  <div className="text-slate-500">Pendientes</div>
                </div>
                <div>
                  <div className="text-blue-400 font-mono font-bold">{KPIS.maletasTransito.toLocaleString()}</div>
                  <div className="text-slate-500">En tránsito</div>
                </div>
              </div>
            </div>
          </div>

          {/* Gráfico días */}
          <div className="lg:col-span-2 bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Maletas Procesadas por Día vs Capacidad
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={DATOS_GRAFICO_DIAS} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="dia" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
                  formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                />
                <Bar dataKey="procesadas" name="Procesadas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="capacidad" name="Capacidad disponible" fill="#475569" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-slate-500 text-xs mt-2 text-right">Utilización promedio: 78.3%</p>
          </div>
        </div>

        {/* Utilización de vuelos */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="font-semibold text-white">Utilización de Capacidad de Vuelos</h2>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-700">

            {/* Resumen vuelos */}
            <div className="p-5">
              <div className="space-y-3">
                <MetricaVuelo label="Promedio global" value={`${promGlobal}%`} color="text-blue-400" />
                <MetricaVuelo label="Vuelos activos" value={vuelosActivos} color="text-white" />
                <MetricaVuelo label="Vuelos >90%" value={vuelosAltos} color="text-red-400" />
                <MetricaVuelo label="Vuelos <50%" value={vuelosBajos} color="text-blue-400" />
              </div>
            </div>

            {/* Tabla ranking vuelos */}
            <div className="lg:col-span-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-700/40 text-slate-400 text-xs uppercase">
                    <th className="text-left px-4 py-3">Vuelo</th>
                    <th className="text-left px-4 py-3">Ruta</th>
                    <th className="text-left px-4 py-3">Ocupación</th>
                    <th className="px-4 py-3 w-32"></th>
                    <th className="text-left px-4 py-3">Estado</th>
                    <th className="text-left px-4 py-3">Nivel</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {VUELOS_RANKING.map((v) => {
                    const pct = getOcupacionVueloPct(v)
                    const sem = getSemaforoVuelo(pct)
                    return (
                      <tr key={v.codigo} className="hover:bg-slate-700/20 transition-colors">
                        <td className="px-4 py-3 font-mono font-semibold text-blue-400">{v.codigo}</td>
                        <td className="px-4 py-3 text-slate-300">{v.desde} → {v.hasta}</td>
                        <td className="px-4 py-3 font-mono text-slate-300">{v.actual}/{v.capacidad}</td>
                        <td className="px-4 py-3">
                          <BarraProgreso pct={pct} color={sem.color} height="h-1.5" showLabel />
                        </td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{v.tiempo}</td>
                        <td className="px-4 py-3">
                          <SemaforoBadge color={sem.color} label={sem.label} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Resumen por continente */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {CONTINENTES.map((c) => {
            const cumColor = c.cumplimiento >= 95 ? 'verde' : c.cumplimiento >= 85 ? 'ambar' : 'rojo'
            const cumText = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400' }[cumColor]
            return (
              <div key={c.nombre} className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                  <span className="text-lg">{c.nombre === 'América' ? '🌎' : c.nombre === 'Europa' ? '🌍' : '🌏'}</span>
                  {c.nombre}
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Maletas procesadas</span>
                    <span className="font-mono font-semibold text-white">{c.maletasProcesadas.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Cumplimiento</span>
                    <span className={`font-mono font-semibold ${cumText}`}>{c.cumplimiento}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-xs">Almacenes críticos: </span>
                    <span className="text-red-400 text-xs font-mono">{c.almacenesCriticos.join(', ')}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Ranking aeropuertos */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="font-semibold text-white">Ranking de Ocupación por Aeropuerto</h2>
            <p className="text-xs text-slate-400 mt-0.5">Ordenado por mayor ocupación de almacén</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-700/40 text-slate-400 text-xs uppercase">
                  <th className="text-left px-4 py-3">#</th>
                  <th className="text-left px-4 py-3">Código</th>
                  <th className="text-left px-4 py-3">Continente</th>
                  <th className="text-left px-4 py-3">Almacén</th>
                  <th className="text-left px-4 py-3 w-40">Ocupación</th>
                  <th className="text-left px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {RANKING_AEROPUERTOS.map((ap, i) => {
                  const sem = SEMAFORO_LABEL[ap.color]
                  return (
                    <tr key={ap.codigo} className="hover:bg-slate-700/20 transition-colors">
                      <td className="px-4 py-3 text-slate-500 font-mono">{i + 1}</td>
                      <td className="px-4 py-3 font-mono font-bold text-white">{ap.codigo}</td>
                      <td className="px-4 py-3 text-slate-400">{ap.continente}</td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {ap.almacen.actual.toLocaleString()}/{ap.almacen.capacidad.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <BarraProgreso pct={ap.pct} color={ap.color} height="h-2" showLabel />
                      </td>
                      <td className="px-4 py-3">
                        <SemaforoBadge color={sem.color} label={sem.label} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}

function MetricaVuelo({ label, value, color }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`font-mono font-bold text-lg ${color}`}>{value}</span>
    </div>
  )
}
