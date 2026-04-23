package com.TasfB2B.DHGS.demo.infraestructure.ingestion;

import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.valueobject.Coordenada;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

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
            // Detectar encoding: si empieza con BOM UTF-16 BE (0xFEFF), usar UTF-16
            Charset charset = detectarEncoding(archivo);
            List<String> lineas = Files.readAllLines(archivo, charset);

            for (String linea : lineas) {
                linea = linea.trim().replaceAll("[\\uFEFF\\u200B\\u00A0]", "").replaceAll("\\t", " ");
                if (linea.isEmpty() || linea.startsWith("#") || linea.startsWith("*")) continue;

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

    // Regex que captura: ID, ICAO, Ciudad (puede tener espacios), País (puede tener espacios/punto),
    // código corto, GMT (+/-N), capacidad, y luego Latitud/Longitude
    private static final Pattern LINEA_PATTERN = Pattern.compile(
            "^(\\d+)\\s+([A-Z]{4})\\s+(.+?)\\s{2,}(\\S+(?:\\s+\\S+)?)\\s{2,}(\\w+)\\s+([+-]?\\d+)\\s+(\\d+)\\s+(Latitud|Latitude).*"
    );

    /**
     * Parsea una línea individual del archivo de aeropuertos.
     * Soporta ambos formatos (test y real).
     */
    private Aeropuerto parsearLinea(String linea) {
        // Detectar label de coordenadas
        int idxLatitud = linea.indexOf("Latitude:");
        String latLabel = "Latitude:";
        String lonLabel = "Longitude:";
        if (idxLatitud < 0) {
            idxLatitud = linea.indexOf("Latitud:");
            latLabel = "Latitud:";
            lonLabel = "Longitud:";
        }
        if (idxLatitud < 0) {
            return null; // Línea sin coordenadas, se ignora silenciosamente
        }

        String parteCampos = linea.substring(0, idxLatitud).trim();
        String parteCoordenadas = linea.substring(idxLatitud).trim();

        // Intentar parseo con regex primero (maneja ciudades/países multi-palabra)
        String[] campos = parseFieldsRobust(parteCampos);
        if (campos == null || campos.length < 7) {
            // Fallback: split simple
            campos = parteCampos.split("\\s+");
        }
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
        Coordenada coordenada = parsearCoordenadas(parteCoordenadas, latLabel, lonLabel);
        aeropuerto.setLatitud(coordenada.latitud());
        aeropuerto.setLongitud(coordenada.longitud());

        return aeropuerto;
    }

    /**
     * Extrae y parsea las coordenadas DMS de la cadena de coordenadas.
     * Formato: "Latitud: 04° 42' 05" N Longitud: 74° 08' 49" W"
     * o:       "Latitude: 04° 42' 05" N Longitude: 74° 08' 49" W"
     */
    private Coordenada parsearCoordenadas(String texto, String latLabel, String lonLabel) {
        try {
            // Separar latitud y longitud
            int idxLongitud = texto.indexOf(lonLabel);
            if (idxLongitud < 0) {
                return new Coordenada(0.0, 0.0);
            }

            String latitudTexto = texto.substring(latLabel.length(), idxLongitud).trim();
            String longitudTexto = texto.substring(idxLongitud + lonLabel.length()).trim();

            double latitud = Coordenada.parseDMS(latitudTexto);
            double longitud = Coordenada.parseDMS(longitudTexto);

            return new Coordenada(latitud, longitud);
        } catch (Exception e) {
            log.warn("Error parseando coordenadas: '{}' - {}", texto, e.getMessage());
            return new Coordenada(0.0, 0.0);
        }
    }

    /**
     * Detecta el encoding del archivo leyendo los primeros bytes (BOM).
     */
    private Charset detectarEncoding(Path archivo) {
        try {
            byte[] bytes = Files.readAllBytes(archivo);
            if (bytes.length >= 2) {
                if ((bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
                    return StandardCharsets.UTF_16;
                }
                if ((bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
                    return StandardCharsets.UTF_16;
                }
            }
        } catch (IOException e) {
            log.warn("Error detectando encoding: {}", e.getMessage());
        }
        return StandardCharsets.UTF_8;
    }

    /**
     * Parsea los campos antes de las coordenadas de forma robusta.
     * Busca: ID(num), ICAO(4 mayúsculas), luego busca desde el final:
     * capacidad(num), GMT(+/-num), código corto(alfa), y lo que queda es ciudad + país.
     */
    private String[] parseFieldsRobust(String parteCampos) {
        // Tokenizar por espacios
        String[] tokens = parteCampos.split("\\s+");
        if (tokens.length < 7) return null;

        // tokens[0] = ID, tokens[1] = ICAO (4 letras mayúsculas)
        if (!tokens[1].matches("[A-Z]{4}")) return null;

        String id = tokens[0];
        String icao = tokens[1];

        // Desde el final: último token = capacidad, penúltimo = GMT, antepenúltimo = código corto
        String capacidad = tokens[tokens.length - 1];
        String gmt = tokens[tokens.length - 2];
        String codigoCorto = tokens[tokens.length - 3];

        // Verificar que capacidad y gmt son numéricos
        try {
            Integer.parseInt(capacidad);
            Integer.parseInt(gmt);
        } catch (NumberFormatException e) {
            return null;
        }

        // Lo que queda entre tokens[2] y tokens[length-4] es ciudad + país
        // Necesitamos separarlos. El país es la última "palabra" antes del código corto.
        // Pero el país puede ser multi-palabra (ej: "Arabia Saudita", "Emiratos A.U")
        // Estrategia: unir todo y usar la ciudad como primer grupo, país como segundo
        // Usamos heurística: buscar la ciudad y país como los campos restantes
        int cityStart = 2;
        int cityEnd = tokens.length - 3; // exclusive

        if (cityEnd - cityStart < 2) {
            // Solo hay un token para ciudad+país: split simple fallback
            return tokens;
        }

        // Heurística: el país son los últimos tokens del grupo intermedio
        // Buscar separación por doble espacio en la cadena original
        // Re-construir la parte intermedia
        int icaoEnd = parteCampos.indexOf(icao) + icao.length();
        int codeStart = parteCampos.lastIndexOf(codigoCorto);
        String middlePart = parteCampos.substring(icaoEnd, codeStart).trim();

        // Buscar separación: típicamente hay 2+ espacios entre ciudad y país
        String[] middleSplit = middlePart.split("\\s{2,}");
        String ciudad, pais;
        if (middleSplit.length >= 2) {
            ciudad = middleSplit[0].trim();
            pais = middleSplit[1].trim();
        } else {
            // No hay doble espacio → usar tokens individuales
            // El primer token intermedio es ciudad, el resto es país
            int numMiddleTokens = cityEnd - cityStart;
            if (numMiddleTokens == 2) {
                // Exactamente 2 tokens: ciudad y país simples
                ciudad = tokens[cityStart];
                pais = tokens[cityStart + 1];
            } else {
                // Múltiples tokens sin doble espacio: primer token = ciudad, resto = país
                ciudad = tokens[cityStart];
                StringBuilder paisBuilder = new StringBuilder();
                for (int i = cityStart + 1; i < cityEnd; i++) {
                    if (paisBuilder.length() > 0) paisBuilder.append(" ");
                    paisBuilder.append(tokens[i]);
                }
                pais = paisBuilder.toString();
            }
        }

        return new String[]{id, icao, ciudad, pais, codigoCorto, gmt, capacidad};
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
            case 'U' -> "Europa Norte"; // CIS (Bielorrusia, Azerbaiyán, etc.)
            case 'Z', 'V', 'W', 'R' -> "Asia";
            case 'O' -> "Asia"; // Medio Oriente / Asia Occidental
            case 'F', 'D', 'G', 'H' -> "Africa";
            case 'Y' -> "Oceania";
            default -> "Desconocido";
        };
    }
}

