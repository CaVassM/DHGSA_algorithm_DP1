import crypto from 'crypto';
import https from 'https';

/**
 * Módulo heredado de intercambio de claves.
 * Pendiente de migración a criptografía post-cuántica.
 */
export function generateSessionKeys() {
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return keyPair;
}

export function createLegacyAgent() {
  return new https.Agent({ rejectUnauthorized: false });
}
