package com.tasfb2b.backend.dto.response;

import com.tasfb2b.dhgs.demo.application.dto.EpocaResumenDTO;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationResponse;
import com.tasfb2b.dhgs.demo.application.dto.RutaDTO;
import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class PlanningResponse {

    private PlannerAlgorithm algorithm;
    private OperationalScenario scenario;
    private String dataSetReference;
    private String status;
    private String message;
    private int totalEpocas;
    private int epocasProcesadas;
    private double costoTotal;
    private int totalEnviosAsignados;
    private int totalEnviosNoAsignados;
    private int totalMaletasDespachadas;
    private boolean simulacionCompleta;
    private long tiempoEjecucionMs;
    private List<EpocaResumenDTO> resumenPorEpoca = new ArrayList<>();
    private List<RutaDTO> rutas = new ArrayList<>();

    public static PlanningResponse fromOptimizationResult(PlannerAlgorithm algorithm,
                                                          OperationalScenario scenario,
                                                          String dataSetReference,
                                                          String status,
                                                          String message,
                                                          OptimizationResponse optimizationResponse) {
        PlanningResponse response = new PlanningResponse();
        response.algorithm = algorithm;
        response.scenario = scenario;
        response.dataSetReference = dataSetReference;
        response.status = status;
        response.message = message;
        response.totalEpocas = optimizationResponse.getTotalEpocas();
        response.epocasProcesadas = optimizationResponse.getEpocasProcesadas();
        response.costoTotal = optimizationResponse.getCostoTotal();
        response.totalEnviosAsignados = optimizationResponse.getTotalEnviosAsignados();
        response.totalEnviosNoAsignados = optimizationResponse.getTotalEnviosNoAsignados();
        response.totalMaletasDespachadas = optimizationResponse.getTotalMaletasDespachadas();
        response.simulacionCompleta = optimizationResponse.isSimulacionCompleta();
        response.tiempoEjecucionMs = optimizationResponse.getTiempoEjecucionMs();
        response.resumenPorEpoca = optimizationResponse.getResumenPorEpoca() != null
                ? new ArrayList<>(optimizationResponse.getResumenPorEpoca())
                : new ArrayList<>();
        response.rutas = optimizationResponse.getMejoresRutas() != null
                ? new ArrayList<>(optimizationResponse.getMejoresRutas())
                : new ArrayList<>();
        return response;
    }
}

