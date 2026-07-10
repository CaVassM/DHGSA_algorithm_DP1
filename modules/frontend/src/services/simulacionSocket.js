import { Client } from '@stomp/stompjs'

const WS_URL = 'ws://localhost:8080/ws'

// ─────────────────────────────────────────────────────────────────────────────
// Cliente STOMP ÚNICO y compartido.
//
// Antes cada llamada a suscribirSimulacion() creaba su propio Client y lo
// activaba/desactivaba. Con React 18 StrictMode (que en dev monta y desmonta
// cada componente dos veces) y con dos suscripciones simultáneas (/topic/run y
// /topic/simulacion) eso provocaba que un deactivate() cerrara el socket justo
// cuando otro montaje lo estaba abriendo → error 1006 "closed before
// connection established" que a veces NO se recuperaba. El resultado era
// intermitente: unas veces conectaba y otras no.
//
// Solución: un solo Client para toda la app. Se conecta una vez y se mantiene
// vivo. Las suscripciones se cuelgan de él y se cuentan por referencia; el
// socket solo se cierra cuando ya nadie lo usa (con un pequeño margen para que
// el re-montaje de StrictMode reutilice la conexión en vez de recrearla).
// ─────────────────────────────────────────────────────────────────────────────

let client = null
let connected = false
let refCount = 0
let closeTimer = null

// Suscripciones pendientes de aplicar en cuanto el socket conecte, y las ya
// activas (para poder cancelarlas). Clave: un id único por llamada.
const pending = new Map()   // id -> { topic, onEvento }
const active = new Map()    // id -> StompSubscription
let nextId = 1

function ensureClient() {
  if (client) return client

  client = new Client({
    brokerURL: WS_URL,
    reconnectDelay: 3000,
    heartbeatIncoming: 10000,
    heartbeatOutgoing: 10000,
    onConnect: () => {
      connected = true
      console.log('[WS] ✅ conectado')
      // Aplicar todas las suscripciones pendientes.
      for (const [id, sub] of pending) {
        aplicarSuscripcion(id, sub.topic, sub.onEvento)
      }
      pending.clear()
    },
    onWebSocketClose: (e) => {
      connected = false
      active.clear() // el broker las descarta al cerrarse; se re-aplican al reconectar
      console.warn('[WS] 🔌 cerrado code=', e?.code, '- reintentando…')
    },
    onWebSocketError: (e) => console.error('[WS] ❌ error de conexión:', e?.message ?? e),
    onStompError: (f) => console.error('[WS] ❌ STOMP error:', f.headers?.message, f.body),
  })
  client.activate()
  return client
}

function aplicarSuscripcion(id, topic, onEvento) {
  const sub = client.subscribe(topic, (msg) => {
    try {
      onEvento(JSON.parse(msg.body))
    } catch {
      // ignorar mensajes que no sean JSON
    }
  })
  active.set(id, sub)
  console.log('[WS] suscrito a', topic)
}

/**
 * Suscribe al topic de una simulación en vivo usando el cliente compartido.
 * Devuelve una función para cancelar SOLO esta suscripción.
 *
 * @param {string} topic  ej. "/topic/simulacion/123"
 * @param {(evento) => void} onEvento  callback por cada evento recibido
 * @param {() => void} [onConnect]  (compat) se llama al conectar si se pasa
 * @returns {() => void} disconnect
 */
export function suscribirSimulacion(topic, onEvento, onConnect) {
  const id = nextId++
  refCount++
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }

  ensureClient()

  if (connected) {
    aplicarSuscripcion(id, topic, onEvento)
    onConnect?.()
  } else {
    pending.set(id, { topic, onEvento })
    // onConnect (si lo pasan) se dispara vía el onConnect global del client;
    // lo invocamos aquí de forma diferida para mantener compatibilidad.
    if (onConnect) {
      const prev = client.onConnect
      client.onConnect = (frame) => { prev?.(frame); onConnect() }
    }
  }

  return () => {
    // Cancelar esta suscripción concreta.
    const sub = active.get(id)
    if (sub) { try { sub.unsubscribe() } catch { /* noop */ } active.delete(id) }
    pending.delete(id)

    refCount = Math.max(0, refCount - 1)
    // Si ya nadie usa el socket, cerrarlo — pero con margen para que el
    // re-montaje inmediato de StrictMode vuelva a subir refCount y lo reutilice.
    if (refCount === 0 && closeTimer == null) {
      closeTimer = setTimeout(() => {
        closeTimer = null
        if (refCount === 0 && client) {
          try { client.deactivate() } catch { /* noop */ }
          client = null
          connected = false
        }
      }, 1000)
    }
  }
}
