import { SIMULACION, KPIS, LOG_EVENTOS, ATENCION_REQUERIDA } from '../data/simulacion'
import BarraProgreso from './BarraProgreso'
import SemaforoBadge from './SemaforoBadge'

const LOG_COLORES = {
  critico: 'text-red-400',
  alerta:  'text-amber-400',
  exito:   'text-green-400',
  info:    'text-slate-300',
}

export default function PanelLateral() {
  const progresoPct = Math.round((SIMULACION.tiempoEjecucionMin / SIMULACION.tiempoTotalMin) * 100)
  const cumplimientoColor = KPIS.cumplimientoPlazos >= 95 ? 'verde' : KPIS.cumplimientoPlazos >= 85 ? 'ambar' : 'rojo'

  return (
    <aside className="w-72 shrink-0 flex flex-col bg-slate-900 border-l border-slate-700 overflow-y-auto">

      {/* Simulación en curso */}
      <section className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-semibold text-green-400 uppercase tracking-wider">Simulación en Curso</span>
        </div>
        <div className="space-y-2 text-sm">
          <Row label="Tiempo simulado" value={`Día ${SIMULACION.diaActual} de ${SIMULACION.diasTotal}`} />
          <Row label="Hora simulada" value={SIMULACION.horaSimulada} />
          <div>
            <div className="flex justify-between text-slate-400 text-xs mb-1">
              <span>Ejecución</span>
              <span>{SIMULACION.tiempoEjecucionMin} de {SIMULACION.tiempoTotalMin} min</span>
            </div>
            <BarraProgreso pct={progresoPct} color="azul" height="h-2" />
          </div>
          <Row label="Término estimado" value={`en ${SIMULACION.terminaEn}`} />
          <Row label="Algoritmo" value={SIMULACION.algoritmo} />
        </div>
      </section>

      {/* KPIs */}
      <section className="p-4 border-b border-slate-700">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Estado Actual</h3>
        <div className="space-y-2.5">
          <KpiRow label="Maletas en tránsito" value={KPIS.maletasTransito.toLocaleString()} color="azul" />
          <KpiRow label="Maletas pendientes"  value={KPIS.maletasPendientes.toLocaleString()} color="ambar" />
          <KpiRow label="Maletas entregadas"  value={KPIS.maletasEntregadas.toLocaleString()} color="verde" />
          <div className="flex justify-between items-center">
            <span className="text-slate-400 text-xs">Cumplimiento de plazos</span>
            <span className={`font-mono font-bold text-sm ${cumplimientoColor === 'verde' ? 'text-green-400' : cumplimientoColor === 'ambar' ? 'text-amber-400' : 'text-red-400'}`}>
              {KPIS.cumplimientoPlazos}%
            </span>
          </div>
        </div>
      </section>

      {/* Log de eventos */}
      <section className="p-4 border-b border-slate-700 flex-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Log de Eventos — Día {SIMULACION.diaActual}
        </h3>
        <ul className="space-y-2.5">
          {LOG_EVENTOS.map((ev, i) => (
            <li key={i} className="text-xs leading-snug">
              <span className="text-slate-500 font-mono mr-1">{ev.hora}</span>
              <span className={LOG_COLORES[ev.tipo]}>{ev.mensaje}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Atención requerida */}
      <section className="p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Atención Requerida</h3>
        <ul className="space-y-2">
          {ATENCION_REQUERIDA.map((item) => (
            <li key={item.codigo} className="flex items-start gap-2">
              <SemaforoBadge
                color={item.nivel === 'critico' ? 'rojo' : 'ambar'}
                label={item.nivel === 'critico' ? 'CRÍTICO' : 'VIGILAR'}
              />
              <div className="text-xs">
                <span className="font-semibold text-white">{item.codigo}</span>
                <span className="text-slate-400 ml-1">— {item.mensaje}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-200 font-medium">{value}</span>
    </div>
  )
}

function KpiRow({ label, value, color }) {
  const textColor = { verde: 'text-green-400', ambar: 'text-amber-400', rojo: 'text-red-400', azul: 'text-blue-400' }[color] ?? 'text-white'
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className={`font-mono font-bold text-sm ${textColor}`}>{value}</span>
    </div>
  )
}
