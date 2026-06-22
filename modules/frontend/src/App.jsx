import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ConfiguracionSimulacion from './pages/ConfiguracionSimulacion'
import Dashboard from './pages/Dashboard'
import DetalleAeropuerto from './pages/DetalleAeropuerto'
import IndicadoresGlobales from './pages/IndicadoresGlobales'
import OperacionDiaria from './pages/OperacionDiaria'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/config" replace />} />
        <Route path="/config" element={<ConfiguracionSimulacion />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/aeropuerto/:codigo" element={<DetalleAeropuerto />} />
        <Route path="/indicadores" element={<IndicadoresGlobales />} />
        <Route path="/dia-a-dia" element={<OperacionDiaria />} />
      </Routes>
    </BrowserRouter>
  )
}
