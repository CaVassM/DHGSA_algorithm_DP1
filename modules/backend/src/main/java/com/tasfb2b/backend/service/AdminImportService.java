package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.backend.dto.response.ImportStatusResponse;
import com.tasfb2b.backend.dto.response.ImportSummaryResponse;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
import com.tasfb2b.backend.repository.ShipmentRepository;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.AeropuertoParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.EnvioParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.VueloParser;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class AdminImportService {

    private static final Logger log = LoggerFactory.getLogger(AdminImportService.class);

    /** Tamaño de lote para guardar/limpiar el contexto de persistencia. */
    private static final int BATCH_SIZE = 1000;

    private final AirportRepository airportRepository;
    private final FlightRepository flightRepository;
    private final ShipmentRepository shipmentRepository;
    private final AeropuertoParser aeropuertoParser;
    private final VueloParser vueloParser;
    private final EnvioParser envioParser;
    private final EntityManager entityManager;

    public ImportStatusResponse status() {
        return new ImportStatusResponse(
                airportRepository.count(),
                flightRepository.count(),
                shipmentRepository.count()
        );
    }

    @Transactional
    public ImportSummaryResponse importAirports(MultipartFile file) {
        Path tmp = writeTemp(file, "airports", ".txt");
        try {
            var aeropuertos = aeropuertoParser.parsear(tmp);
            int inserted = 0;
            int updated = 0;
            for (Aeropuerto src : aeropuertos) {
                var existing = airportRepository.findByCodigoIcao(src.getCodigoICAO());
                if (existing.isPresent()) {
                    DomainMapper.updateAirportEntity(existing.get(), src);
                    airportRepository.save(existing.get());
                    updated++;
                } else {
                    airportRepository.save(DomainMapper.airportToEntity(src));
                    inserted++;
                }
            }
            return new ImportSummaryResponse("airports", aeropuertos.size(), inserted, updated, 0);
        } finally {
            deleteSilently(tmp);
        }
    }

    @Transactional
    public ImportSummaryResponse importFlights(MultipartFile file) {
        Path tmp = writeTemp(file, "flights", ".txt");
        try {
            Map<String, AirportEntity> entitiesByIcao = loadAirportEntitiesByIcao();
            Map<String, Aeropuerto> domainByIcao = new HashMap<>();
            entitiesByIcao.forEach((icao, ent) -> domainByIcao.put(icao, DomainMapper.airportToDomain(ent)));

            var vuelos = vueloParser.parsear(tmp, domainByIcao);
            Set<String> existentes = new HashSet<>(flightRepository.findAllBusinessIds());
            int inserted = 0;
            int updated = 0;
            int skipped = 0;
            for (Vuelo src : vuelos) {
                AirportEntity origen = entitiesByIcao.get(src.getAeropuertoOrigen().getCodigoICAO());
                AirportEntity destino = entitiesByIcao.get(src.getAeropuertoDestino().getCodigoICAO());
                if (origen == null || destino == null) {
                    skipped++;
                    continue;
                }
                if (existentes.contains(src.getId())) {
                    FlightEntity e = flightRepository.findByBusinessId(src.getId()).orElse(null);
                    if (e != null) {
                        DomainMapper.updateFlightEntity(e, src, origen, destino);
                        flightRepository.save(e);
                        updated++;
                    }
                } else {
                    flightRepository.save(DomainMapper.flightToEntity(src, origen, destino));
                    existentes.add(src.getId());
                    inserted++;
                }
            }
            return new ImportSummaryResponse("flights", vuelos.size(), inserted, updated, skipped);
        } finally {
            deleteSilently(tmp);
        }
    }

    @Transactional
    public ImportSummaryResponse importShipments(MultipartFile[] files) {
        // IDs de aeropuerto por ICAO: sobreviven al clear() del contexto, a
        // diferencia de las entidades, que quedarían detached tras cada lote.
        Map<String, Long> airportIdByIcao = loadAirportIdsByIcao();
        Map<String, Aeropuerto> domainByIcao = loadAirportDomainByIcao();

        // Conjunto de businessId ya existentes: una sola consulta en vez de un
        // SELECT por fila. Decide insert vs update en memoria.
        Set<String> existentes = new HashSet<>(shipmentRepository.findAllBusinessIds());

        int parsed = 0;
        int inserted = 0;
        int updated = 0;
        int skipped = 0;
        int enLote = 0;

        for (MultipartFile file : files) {
            String originalName = Objects.requireNonNullElse(file.getOriginalFilename(), "envios_XXXX_.txt");
            Path tmp = writeTempWithName(file, originalName);
            try {
                var envios = envioParser.parsear(tmp, domainByIcao);
                parsed += envios.size();
                for (Envio src : envios) {
                    if (src.getAeropuertoOrigen() == null || src.getAeropuertoDestino() == null) {
                        skipped++;
                        continue;
                    }
                    Long origenId = airportIdByIcao.get(src.getAeropuertoOrigen().getCodigoICAO());
                    Long destinoId = airportIdByIcao.get(src.getAeropuertoDestino().getCodigoICAO());
                    if (origenId == null || destinoId == null) {
                        skipped++;
                        continue;
                    }
                    // Referencias ligeras (proxies) por ID: válidas tras cada clear().
                    AirportEntity origen = entityManager.getReference(AirportEntity.class, origenId);
                    AirportEntity destino = entityManager.getReference(AirportEntity.class, destinoId);

                    if (existentes.contains(src.getId())) {
                        // Caso minoritario en carga masiva: solo aquí cargamos la entidad.
                        ShipmentEntity e = shipmentRepository.findByBusinessId(src.getId()).orElse(null);
                        if (e != null) {
                            e.setAeropuertoOrigen(origen);
                            e.setAeropuertoDestino(destino);
                            e.setFechaHoraCreacion(src.getFechaHoraCreacion());
                            e.setCantidadMaletas(src.getCantidadMaletas());
                            e.setIdCliente(src.getIdCliente());
                            e.setDeadline(src.getDeadline() != null ? src.getDeadline() : src.calcularDeadline());
                            e.setEsMustGo(src.isEsMustGo());
                            e.setPrioridad(src.getPrioridad());
                            shipmentRepository.save(e);
                            updated++;
                        }
                    } else {
                        shipmentRepository.save(DomainMapper.shipmentToEntity(src, origen, destino));
                        existentes.add(src.getId()); // evita duplicar si el id se repite en los archivos
                        inserted++;
                    }

                    if (++enLote >= BATCH_SIZE) {
                        flushAndClear();
                        enLote = 0;
                    }
                }
            } finally {
                deleteSilently(tmp);
            }
        }
        flushAndClear();
        return new ImportSummaryResponse("shipments", parsed, inserted, updated, skipped);
    }

    private Map<String, AirportEntity> loadAirportEntitiesByIcao() {
        Map<String, AirportEntity> map = new HashMap<>();
        for (AirportEntity e : airportRepository.findAll()) {
            map.put(e.getCodigoIcao(), e);
        }
        if (map.isEmpty()) {
            throw new IllegalStateException(
                    "No hay aeropuertos en la BD. Importa primero el archivo de aeropuertos.");
        }
        return map;
    }

    /** IDs de aeropuerto por ICAO; estables aunque se limpie el contexto JPA. */
    private Map<String, Long> loadAirportIdsByIcao() {
        Map<String, Long> map = new HashMap<>();
        for (AirportEntity e : airportRepository.findAll()) {
            map.put(e.getCodigoIcao(), e.getId());
        }
        if (map.isEmpty()) {
            throw new IllegalStateException(
                    "No hay aeropuertos en la BD. Importa primero el archivo de aeropuertos.");
        }
        return map;
    }

    /** Versión de dominio de los aeropuertos, para el parser. */
    private Map<String, Aeropuerto> loadAirportDomainByIcao() {
        Map<String, Aeropuerto> map = new HashMap<>();
        for (AirportEntity e : airportRepository.findAll()) {
            map.put(e.getCodigoIcao(), DomainMapper.airportToDomain(e));
        }
        return map;
    }

    /** Vuelca el lote pendiente a la BD y libera el contexto de persistencia. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    private Path writeTemp(MultipartFile file, String prefix, String suffix) {
        try {
            Path tmp = Files.createTempFile(prefix + "-", suffix);
            file.transferTo(tmp.toFile());
            return tmp;
        } catch (IOException e) {
            throw new IllegalStateException("No se pudo escribir archivo temporal de import", e);
        }
    }

    private Path writeTempWithName(MultipartFile file, String filename) {
        try {
            Path dir = Files.createTempDirectory("shipments-import-");
            Path tmp = dir.resolve(filename);
            file.transferTo(tmp.toFile());
            return tmp;
        } catch (IOException e) {
            throw new IllegalStateException("No se pudo escribir archivo temporal de import", e);
        }
    }

    private void deleteSilently(Path path) {
        try {
            Files.deleteIfExists(path);
            Path parent = path.getParent();
            if (parent != null && parent.getFileName().toString().startsWith("shipments-import-")) {
                Files.deleteIfExists(parent);
            }
        } catch (IOException e) {
            log.warn("No se pudo borrar archivo temporal {}: {}", path, e.getMessage());
        }
    }
}
