// G06: dirección del backend, resuelta en tiempo de ejecución.
//
// Antes estaba escrita a mano como "localhost:8080" en api.js y en
// simulacionSocket.js. Eso obliga a que el navegador y el backend estén en la
// MISMA máquina: si un segundo dispositivo abre la app por la red, "localhost"
// apunta a ese dispositivo (donde no hay backend) y no conecta nada.
//
// La resolución tiene que servir para tres escenarios distintos:
//
//   a) Desarrollo / laboratorio: front en :5173 (Vite) o :3000 (contenedor),
//      backend en :8080 de la MISMA máquina. Se deduce del host de la página.
//   b) Despliegue detrás de un proxy (nginx / ALB de AWS): la página se sirve
//      por 80/443 y el proxy enruta /api y /ws al backend. Aquí NO hay que
//      inventar puerto: se usa el mismo origen.
//   c) Backend en otro dominio (p. ej. api.midominio.com): hay que decirlo
//      explícitamente.
//
// Orden de prioridad:
//   1. window.__TASF_BACKEND_URL__  → configuración en TIEMPO DE EJECUCIÓN,
//      definida en /config.js. Es la que sirve para AWS: permite cambiar el
//      backend editando un archivo del contenedor o del bucket, SIN volver a
//      compilar la aplicación. Las variables VITE_ se congelan al compilar,
//      así que por sí solas obligan a una imagen distinta por ambiente.
//   2. import.meta.env.VITE_BACKEND_URL → override en tiempo de compilación.
//   3. Deducción automática según el puerto desde el que se sirvió la página.

/** Puertos en los que se sirve el visualizador en desarrollo/contenedor. */
const PUERTOS_FRONTEND_DIRECTO = new Set(['5173', '3000', '4173'])

/** Puerto del backend cuando corre expuesto directamente (sin proxy). */
const PUERTO_BACKEND_DIRECTO =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_PORT) || '8080'

function limpiar(url) {
  return String(url).replace(/\/+$/, '')
}

function resolverBase() {
  // 1. Configuración en tiempo de ejecución (AWS / contenedores).
  if (typeof window !== 'undefined' && window.__TASF_BACKEND_URL__) {
    return limpiar(window.__TASF_BACKEND_URL__)
  }

  // 2. Override en tiempo de compilación.
  const build = typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL
  if (build) return limpiar(build)

  // Sin window (build/SSR): valor de desarrollo de siempre.
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return `http://localhost:${PUERTO_BACKEND_DIRECTO}`
  }

  const { protocol, hostname, port } = window.location
  const esquema = protocol === 'https:' ? 'https:' : 'http:'

  // 3a. Servido desde un puerto de desarrollo/contenedor → el backend está en
  //     su propio puerto, en la misma máquina. Caso laboratorio y EC2 con
  //     docker-compose (front :3000, backend :8080).
  if (PUERTOS_FRONTEND_DIRECTO.has(port)) {
    return `${esquema}//${hostname}:${PUERTO_BACKEND_DIRECTO}`
  }

  // 3b. Servido por 80/443 → hay un proxy delante (nginx, ALB de AWS,
  //     CloudFront). El backend se alcanza por el MISMO origen; inventar
  //     ":8080" aquí rompería el despliegue, porque ese puerto no está
  //     publicado. Cadena vacía = mismo origen (rutas relativas).
  return ''
}

/**
 * Base HTTP del backend. Cadena vacía cuando se comparte origen con la página
 * (despliegue detrás de proxy), en cuyo caso las rutas quedan relativas.
 */
export const BACKEND_URL = resolverBase()

/** Base de la API REST. Relativa ("/api/v1") si se comparte origen. */
export const API_URL = `${BACKEND_URL}/api/v1`

/**
 * Endpoint WebSocket. Siempre absoluto — el estándar WebSocket no admite URLs
 * relativas — y con el esquema correcto: wss:// si la página va por https,
 * porque el navegador bloquea ws:// dentro de una página segura.
 */
export const WS_URL = (() => {
  if (BACKEND_URL) return `${BACKEND_URL.replace(/^http/, 'ws')}/ws`

  if (typeof window === 'undefined' || !window.location?.host) {
    return `ws://localhost:${PUERTO_BACKEND_DIRECTO}/ws`
  }
  const esquema = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${esquema}//${window.location.host}/ws`
})()
