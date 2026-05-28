import NavBar from '../components/NavBar'
import PanelLateral from '../components/PanelLateral'
import MapaMundi from '../components/MapaMundi'

export default function Dashboard() {
  return (
    <div className="h-screen flex flex-col bg-[#0f172a] overflow-hidden">
      <NavBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Mapa */}
        <main className="flex-1 relative overflow-hidden p-4">
          <MapaMundi />
          {/* Leyenda */}
          <div className="absolute bottom-4 left-4 flex gap-3 bg-slate-900/80 backdrop-blur rounded-lg px-4 py-2 border border-slate-700">
            <LeyendaItem color="bg-green-500" label="Óptimo (<60%)" />
            <LeyendaItem color="bg-amber-500" label="Riesgo (60–85%)" />
            <LeyendaItem color="bg-red-500" label="Crítico (>85%)" />
            <LeyendaItem color="bg-blue-500" label="Vuelo en tránsito" />
          </div>
        </main>
        <PanelLateral />
      </div>
    </div>
  )
}

function LeyendaItem({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-slate-300 text-xs">{label}</span>
    </div>
  )
}
