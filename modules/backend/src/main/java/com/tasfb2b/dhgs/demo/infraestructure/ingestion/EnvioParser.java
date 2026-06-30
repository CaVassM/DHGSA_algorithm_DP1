package com.tasfb2b.dhgs.demo.infraestructure.ingestion;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Parser para los archivos envios_XXXX_.txt que contienen los envíos de maletas.
 *
 * Formato esperado por línea:
 * 00000001-20260102-00-47-SUAA-002-0032535
 *
 * Campos (separados por '-'):
 * [0] = ID del envío (8 dígitos)
 * [1] = Fecha (AAAAMMDD)
 * [2] = Hora de generación (HH)
 * [3] = Minutos de generación (mm)
 * [4] = Código ICAO del aeropuerto destino
 * [5] = Cantidad de maletas (3 dígitos)
 * [6] = ID del cliente/aerolínea (7 dígitos)
 *
 * El aeropuerto ORIGEN se infiere del nombre del archivo:
 * envios_SKBO_.txt → origen = SKBO
 */
@Component
public class EnvioParser {

    private static final Logger log = LoggerFactory.getLogger(EnvioParser.class);

    /**
     * Parsea un archivo de envíos.
     *
     * @param archivo     ruta al archivo envios_XXXX_.txt
     * @param aeropuertos mapa de código ICAO → Aeropuerto
     * @return lista de envíos parseados
     */
    public List<Envio> parsear(Path archivo, Map<String, Aeropuerto> aeropuertos) {
        List<Envio> envios = new ArrayList<>();

        // Inferir aeropuerto origen del nombre del archivo
        String nombreArchivo = archivo.getFileName().toString();
        String origenICAO = extraerOrigenDeNombreArchivo(nombreArchivo);

        if (origenICAO == null) {
            log.error("No se pudo determinar aeropuerto origen del archivo: {}", nombreArchivo);
            return envios;
        }

        Aeropuerto origen = aeropuertos.get(origenICAO);
        if (origen == null) {
            log.warn("Aeropuerto origen '{}' no encontrado en el mapa. Archivo: {}", origenICAO, nombreArchivo);
            // Intentar buscar por código corto
            origen = buscarPorCodigoCorto(origenICAO, aeropuertos);
            if (origen == null) {
                log.error("No se encontró aeropuerto para código '{}'. Saltando archivo.", origenICAO);
                return envios;
            }
        }

        try {
            List<String> lineas = Files.readAllLines(archivo);

            for (String linea : lineas) {
                linea = linea.trim();
                if (linea.isEmpty() || linea.startsWith("#")) continue;

                try {
                    Envio envio = parsearLinea(linea, origen, aeropuertos);
                    if (envio != null) {
                        envios.add(envio);
                    }
                } catch (Exception e) {
                    log.warn("Error parseando línea de envío: '{}' - {}", linea, e.getMessage());
                }
            }

            log.info("Parseados {} envíos desde {} (origen: {})",
                    envios.size(), archivo.getFileName(), origen.getCodigoICAO());

        } catch (IOException e) {
            log.error("Error leyendo archivo de envíos: {}", archivo, e);
        }

        return envios;
    }

    /**
     * Parsea una línea individual de envío.
     * Formato: 00000001-20260102-00-47-SUAA-002-0032535
     */
    private Envio parsearLinea(String linea, Aeropuerto origen, Map<String, Aeropuerto> aeropuertos) {
        String[] partes = linea.split("-");

        if (partes.length < 7) {
            log.warn("Línea de envío con formato inválido (se esperan 7 campos): '{}'", linea);
            return null;
        }

        // El ID del archivo (partes[0]) se reinicia 1..N en CADA archivo de
        // envíos (uno por aeropuerto origen), así que NO es único entre archivos.
        // Se compone con el ICAO de origen para obtener una identidad global
        // única (ej. "VIDP-000000001"); de lo contrario el upsert por id pisa
        // los envíos de un aeropuerto con los del siguiente.
        String idLocal = partes[0].trim();
        String id = origen.getCodigoICAO() + "-" + idLocal;
        String fechaStr = partes[1].trim();        // AAAAMMDD
        String horaStr = partes[2].trim();          // HH
        String minutosStr = partes[3].trim();       // mm
        String destinoICAO = partes[4].trim();      // Código ICAO destino
        String maletasStr = partes[5].trim();       // Cantidad de maletas
        String clienteId = partes[6].trim();        // ID del cliente

        // Buscar aeropuerto destino
        Aeropuerto destino = aeropuertos.get(destinoICAO);
        if (destino == null) {
            // Intentar buscar como código corto
            destino = buscarPorCodigoCorto(destinoICAO, aeropuertos);
            if (destino == null) {
                log.warn("Aeropuerto destino '{}' no encontrado. Envío {} ignorado.", destinoICAO, id);
                return null;
            }
        }

        // Parsear fecha y hora de creación
        int anio = Integer.parseInt(fechaStr.substring(0, 4));
        int mes = Integer.parseInt(fechaStr.substring(4, 6));
        int dia = Integer.parseInt(fechaStr.substring(6, 8));
        int hora = Integer.parseInt(horaStr);
        int minutos = Integer.parseInt(minutosStr);

        LocalDateTime fechaHoraCreacion = LocalDateTime.of(anio, mes, dia, hora, minutos);

        // Parsear cantidad de maletas
        int cantidadMaletas = Integer.parseInt(maletasStr);

        // Construir envío
        Envio envio = new Envio();
        envio.setId(id);
        envio.setAeropuertoOrigen(origen);
        envio.setAeropuertoDestino(destino);
        envio.setFechaHoraCreacion(fechaHoraCreacion);
        envio.setCantidadMaletas(cantidadMaletas);
        envio.setIdCliente(clienteId);

        // Calcular deadline y prioridad
        envio.calcularDeadline();
        envio.actualizarMustGo(fechaHoraCreacion, 8);
        envio.calcularPrioridad(fechaHoraCreacion);

        return envio;
    }

    /**
     * Extrae el código del aeropuerto origen del nombre del archivo.
     * Ejemplo: "envios_SKBO_.txt" → "SKBO"
     *          "envios_EBCI_.txt" → "EBCI"
     */
    private String extraerOrigenDeNombreArchivo(String nombreArchivo) {
        // Patrón: envios_XXXX_.txt o _envios_XXXX_.txt
        if (nombreArchivo == null) return null;

        String sinExtension = nombreArchivo.replace(".txt", "");
        String[] partes = sinExtension.split("_");

        // Buscar el código ICAO (4 letras mayúsculas)
        for (String parte : partes) {
            String p = parte.trim();
            if (p.length() == 4 && p.matches("[A-Z]{4}")) {
                return p;
            }
        }

        // Fallback: segundo campo no vacío
        if (partes.length >= 2) {
            String codigo = partes[1].trim();
            if (!codigo.isEmpty()) {
                return codigo;
            }
        }

        return null;
    }

    /**
     * Busca un aeropuerto por su código corto (ej: "bogo", "quit") en caso de que
     * el código ICAO no coincida directamente.
     * Esta es una búsqueda de fallback.
     */
    private Aeropuerto buscarPorCodigoCorto(String codigo, Map<String, Aeropuerto> aeropuertos) {
        // Por ahora retorna null. Se puede extender si se tiene el mapeo código corto → ICAO
        // TODO: Crear mapeo de códigos cortos si los datos lo requieren
        return null;
    }
}

