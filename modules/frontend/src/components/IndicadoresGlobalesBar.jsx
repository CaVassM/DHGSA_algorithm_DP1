import { useState, useEffect, useMemo } from 'react'
import { getAirports, getFlights } from '../services/api'

// Tira de INDICADORES GLOBALES siempre visible sobre el mapa (lo pidió el
// profesor: deben estar de forma recurrente durante toda la simulación). Cubre
// dos vistas globales: la FLOTA (lo que está/va a volar) y los ALMACENES (lo
// que está en tierra). Compacta y horizontal para no robar espacio vertical.
//
// - enVuelo: legs activos del instante (shipmentId, maletas, ...).
// - ocupacionPorIcao: maletas en tierra por aeropuerto (del mapa).
// - run: corrida de planificación (para asignados/pendientes si existe).

export default function IndicadoresGlobalesBar({ enVuelo = [], ocupacionPorIcao = {}, run }) {
  const [capacidades, setCapacidades] = useState({})
  const [capFlotaTotal, setCapFlotaTotal] = useState(0)

  useEffect(() => {
    let vivo = true
    getAirports(0, 500)
      .then(p => {
        if (!vivo) return
        const cap = {}
        ;(p.content ?? []).forEach(a => { cap[a.codigoIcao] = a.capacidadAlmacen ?? 0 })
        setCapacidades(cap)
      })
      .catch(() => {})
    // Capacidad total de la flota = suma de capacidad de TODOS los vuelos (P12).
    getFlights(0, 2000)
      .then(p => { if (vivo) setCapFlotaTotal((p.content ?? []).reduce((s, f) => s + (f.capacidad ?? 0), 0)) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  // Ocupación de la flota (P12): (maletas en vuelo + maletas asignadas a vuelos)
  // ÷ capacidad total de la flota.
  //   - "asignadas a vuelos" = toda la carga planificada del run
  //     (run.totalMaletasDespachadas). Es el numerador principal y da un valor
  //     estable y significativo (evita el 0% engañoso cuando, en un instante,
  //     no hay nada volando pero todo está planificado).
  //   - si no hay run, se usan solo las maletas en vuelo del instante.
  const flota = useMemo(() => {
    const maletasEnVuelo = enVuelo.reduce((s, e) => s + (e.maletas ?? 0), 0)
    const maletasAsignadas = run?.totalMaletasDespachadas ?? 0
    const numerador = maletasAsignadas > 0 ? maletasAsignadas : maletasEnVuelo
    const pct = capFlotaTotal > 0 ? Math.round((numerador / capFlotaTotal) * 100 * 10) / 10 : 0
    return { vuelos: enVuelo.length, maletas: numerador, pct, capTotal: capFlotaTotal }
  }, [enVuelo, capFlotaTotal, run])

  // Almacenes: maletas en tierra y % de ocupación global (sobre capacidad total).
  // P12 pide recalcular "a lo más cada 4 min". Aquí el cálculo es una simple
  // suma (O(n) sobre ~pocos aeropuertos), no costoso, así que se recalcula con
  // cada cambio de ocupación; el límite de 4 min aplica al cálculo PESADO del
  // backend por iteración de planificación, no a este agregado de la vista.
  const almacenes = useMemo(() => {
    const enTierra = Object.values(ocupacionPorIcao).reduce((s, n) => s + (n ?? 0), 0)
    const capTotal = Object.values(capacidades).reduce((s, n) => s + (n ?? 0), 0)
    const pct = capTotal > 0 ? Math.round((enTierra / capTotal) * 100 * 10) / 10 : 0
    return { enTierra, capTotal, pct }
  }, [ocupacionPorIcao, capacidades])

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
      <div className="flex items-stretch gap-px bg-slate-900/92 backdrop-blur border border-slate-700 rounded-lg overflow-hidden shadow-lg">
        <Grupo titulo="Ocupación flota">
          <Metric label="Ocupación" value={`${flota.pct}%`} accent="text-blue-300" />
          <Metric label="Maletas" value={flota.maletas.toLocaleString()} accent="text-blue-300" />
        </Grupo>
        <Grupo titulo="Ocupación aeropuertos">
          <Metric label="Ocupación" value={`${almacenes.pct}%`} accent="text-emerald-300" />
          <Metric label="Maletas" value={almacenes.enTierra.toLocaleString()} accent="text-emerald-300" />
        </Grupo>
        {run && (
          <Grupo titulo="Planificación">
            <Metric label="Asignados" value={(run.totalEnviosAsignados ?? 0).toLocaleString()} accent="text-green-400" />
            <Metric label="Pendientes" value={(run.totalEnviosNoAsignados ?? 0).toLocaleString()} accent="text-amber-400" />
          </Grupo>
        )}
      </div>
    </div>
  )
}

function Grupo({ titulo, children }) {
  return (
    <div className="px-3 py-1.5 bg-slate-900/60">
      <p className="text-[8px] text-slate-500 uppercase tracking-widest mb-0.5">{titulo}</p>
      <div className="flex gap-4">{children}</div>
    </div>
  )
}

function Metric({ label, value, accent }) {
  return (
    <div className="flex flex-col items-start leading-none">
      <span className={`text-sm font-bold font-mono ${accent}`}>{value}</span>
      <span className="text-[9px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  )
}
