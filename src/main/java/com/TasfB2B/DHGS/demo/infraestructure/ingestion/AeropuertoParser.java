package com.TasfB2B.DHGS.demo.infraestructure.ingestion;

import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.valueobject.Coordenada;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Parser para el archivo estudiantes.txt que contiene los aeropuertos.
 *
 * Formato esperado por línea:
 * 01 SKBO Bogotá Colombia bogo -5 430 Latitud: 04° 42' 05" N Longitud: 74° 08' 49" W
 *
 * Campos posicionales (separados por espacio):
 * [0] = ID numérico
 * [1] = Código ICAO (4 letras)
 * [2] = Ciudad
 * [3] = País
 * [4] = Código corto interno
 * [5] = GMT (zona horaria)
 * [6] = Capacidad del almacén
 * Resto = Coordenadas en formato DMS
 */
@Component
public class AeropuertoParser {

    private static final Logger log = LoggerFactory.getLogger(AeropuertoParser.class);

    /**
     * Parsea el archivo de aeropuertos y retorna la lista de objetos Aeropuerto.
     *
     * @param archivo ruta al archivo estudiantes.txt
     * @return lista de aeropuertos parseados
     */
    public List<Aeropuerto> parsear(Path archivo) {
        List<Aeropuerto> aeropuertos = new ArrayList<>();

        try {
            List<String> lineas = Files.readAllLines(archivo);

            for (String linea : lineas) {
                linea = linea.trim();
                if (linea.isEmpty() || linea.startsWith("#")) continue;

                try {
                    Aeropuerto aeropuerto = parsearLinea(linea);
                    if (aeropuerto != null) {
                        aeropuertos.add(aeropuerto);
                    }
                } catch (Exception e) {
                    log.warn("Error parseando línea de aeropuerto: '{}' - {}", linea, e.getMessage());
                }
            }

            log.info("Parseados {} aeropuertos desde {}", aeropuertos.size(), archivo.getFileName());

        } catch (IOException e) {
            log.error("Error leyendo archivo de aeropuertos: {}", archivo, e);
        }

        return aeropuertos;
    }

    /**
     * Parsea una línea individual del archivo de aeropuertos.
     */
    private Aeropuerto parsearLinea(String linea) {
        // Separar la parte de coordenadas (después de "Latitud:")
        int idxLatitud = linea.indexOf("Latitud:");
        if (idxLatitud < 0) {
            log.warn("Línea sin coordenadas: '{}'", linea);
            return null;
        }

        String parteCampos = linea.substring(0, idxLatitud).trim();
        String parteCoordenadas = linea.substring(idxLatitud).trim();

        // Parsear campos principales
        String[] campos = parteCampos.split("\\s+");
        if (campos.length < 7) {
            log.warn("Línea con campos insuficientes: '{}'", linea);
            return null;
        }

        Aeropuerto aeropuerto = new Aeropuerto();
        aeropuerto.setId(Integer.parseInt(campos[0]));
        aeropuerto.setCodigoICAO(campos[1]);
        aeropuerto.setCiudad(campos[2]);
        aeropuerto.setPais(campos[3]);
        // campos[4] = código corto interno (no se almacena en el modelo)
        aeropuerto.setGmt(Integer.parseInt(campos[5]));
        aeropuerto.setCapacidadAlmacen(Integer.parseInt(campos[6]));

        // Inferir continente por prefijo ICAO
        aeropuerto.setContinente(inferirContinente(campos[1]));

        // Parsear coordenadas DMS
        Coordenada coordenada = parsearCoordenadas(parteCoordenadas);
        aeropuerto.setLatitud(coordenada.latitud());
        aeropuerto.setLongitud(coordenada.longitud());

        return aeropuerto;
    }

    /**
     * Extrae y parsea las coordenadas DMS de la cadena de coordenadas.
     * Formato: "Latitud: 04° 42' 05" N Longitud: 74° 08' 49" W"
     */
    private Coordenada parsearCoordenadas(String texto) {
        try {
            // Separar latitud y longitud
            int idxLongitud = texto.indexOf("Longitud:");
            if (idxLongitud < 0) {
                return new Coordenada(0.0, 0.0);
            }

            String latitudTexto = texto.substring("Latitud:".length(), idxLongitud).trim();
            String longitudTexto = texto.substring(idxLongitud + "Longitud:".length()).trim();

            double latitud = Coordenada.parseDMS(latitudTexto);
            double longitud = Coordenada.parseDMS(longitudTexto);

            return new Coordenada(latitud, longitud);
        } catch (Exception e) {
            log.warn("Error parseando coordenadas: '{}' - {}", texto, e.getMessage());
            return new Coordenada(0.0, 0.0);
        }
    }

    /**
     * Infiere el continente según el prefijo del código ICAO.
     * - S* = América del Sur
     * - K* = América del Norte (USA)
     * - C* = Canadá
     * - E* = Norte de Europa
     * - L* = Sur de Europa
     * - Otros...
     */
    private String inferirContinente(String codigoICAO) {
        if (codigoICAO == null || codigoICAO.isEmpty()) return "Desconocido";

        char prefijo = codigoICAO.charAt(0);
        return switch (prefijo) {
            case 'S' -> "America del Sur";
            case 'K' -> "America del Norte";
            case 'C' -> "Canada";
            case 'M' -> "America Central";
            case 'T' -> "Caribe";
            case 'E' -> "Europa Norte";
            case 'L' -> "Europa Sur";
            case 'U' -> "Rusia";
            case 'Z', 'V', 'W', 'R' -> "Asia";
            case 'F', 'D', 'G', 'H' -> "Africa";
            case 'Y' -> "Oceania";
            default -> "Desconocido";
        };
    }
}

