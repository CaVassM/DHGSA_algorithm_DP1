package com.TasfB2B.DHGS.demo.domain.valueobject;

/**
 * Value object inmutable que representa coordenadas geográficas.
 * Incluye parser de formato DMS (grados, minutos, segundos) a decimal.
 */
public record Coordenada(double latitud, double longitud) {

    /**
     * Convierte una cadena en formato DMS a grados decimales.
     * Ejemplo de entrada: "04° 42' 05\" N" o "74° 08' 49\" W"
     */
    public static double parseDMS(String dms) {
        if (dms == null || dms.isBlank()) {
            return 0.0;
        }

        String limpio = dms.trim();

        // Determinar dirección (N/S/E/W)
        char direccion = limpio.charAt(limpio.length() - 1);
        limpio = limpio.substring(0, limpio.length() - 1).trim();

        // Extraer grados, minutos, segundos usando regex
        String[] partes = limpio.split("[°'\"\\s]+");

        double grados = 0, minutos = 0, segundos = 0;
        if (partes.length >= 1) {
            grados = Double.parseDouble(partes[0].trim());
        }
        if (partes.length >= 2) {
            minutos = Double.parseDouble(partes[1].trim());
        }
        if (partes.length >= 3) {
            segundos = Double.parseDouble(partes[2].trim());
        }

        double decimal = grados + (minutos / 60.0) + (segundos / 3600.0);

        // Sur y Oeste son negativos
        if (direccion == 'S' || direccion == 'W' || direccion == 's' || direccion == 'w') {
            decimal = -decimal;
        }

        return decimal;
    }

    /**
     * Crea una Coordenada a partir de dos cadenas DMS (latitud y longitud).
     */
    public static Coordenada fromDMS(String latitudDMS, String longitudDMS) {
        return new Coordenada(parseDMS(latitudDMS), parseDMS(longitudDMS));
    }
}

