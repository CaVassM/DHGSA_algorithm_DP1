import { Client } from '@stomp/stompjs'

const WS_URL = 'ws://localhost:8080/ws'

/**
 * Conecta al WebSocket del backend y se suscribe al topic de una simulación
 * en vivo. Devuelve una función para desconectar.
 *
 * @param {string} topic  ej. "/topic/simulacion/123"
 * @param {(evento) => void} onEvento  callback por cada evento recibido
 * @param {() => void} [onConnect]
 * @returns {() => void} disconnect
 */
export function suscribirSimulacion(topic, onEvento, onConnect) {
  const client = new Client({
    brokerURL: WS_URL,
    reconnectDelay: 0,
    onConnect: () => {
      onConnect?.()
      client.subscribe(topic, (msg) => {
        try {
          onEvento(JSON.parse(msg.body))
        } catch {
          // ignorar mensajes que no sean JSON
        }
      })
    },
  })
  client.activate()
  return () => {
    try { client.deactivate() } catch { /* noop */ }
  }
}
