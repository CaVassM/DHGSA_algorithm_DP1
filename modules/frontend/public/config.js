// Configuración en TIEMPO DE EJECUCIÓN del visualizador.
//
// Este archivo NO se compila dentro del bundle: se copia tal cual a dist/ y el
// navegador lo carga antes que la aplicación. Por eso se puede editar en el
// servidor (contenedor, bucket de S3, EC2) para apuntar a otro backend SIN
// volver a compilar ni reconstruir la imagen.
//
// Dejar vacío para que la aplicación deduzca el backend automáticamente:
//   - página en :5173 / :3000  → backend en el mismo host, puerto 8080
//   - página en :80 / :443     → mismo origen (hay un proxy que enruta /api y /ws)
//
// Definirlo SOLO si el backend vive en otro dominio o puerto. Ejemplos:
//
//   window.__TASF_BACKEND_URL__ = 'https://api.tasfb2b.com'
//   window.__TASF_BACKEND_URL__ = 'http://54.221.10.5:8080'
//
// En AWS con ALB y HTTPS lo normal es NO tocar nada: se enruta /api/* y /ws al
// backend en el mismo dominio y la deducción automática ya acierta.

window.__TASF_BACKEND_URL__ = ''
