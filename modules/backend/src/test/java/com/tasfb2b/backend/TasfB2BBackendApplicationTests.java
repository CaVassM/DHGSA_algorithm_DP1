package com.tasfb2b.backend;

import com.tasfb2b.backend.domain.enums.DataSetReference;
import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.service.PlanningRunExecutor;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest(classes = TasfB2BBackendApplication.class)
@ActiveProfiles("test")
class TasfB2BBackendApplicationTests {
    
    @Autowired
    private PlanningRunExecutor planningRunExecutor;

    @Test
    void contextLoads() {
        System.out.print("Hello World!");
        PlanningRequest request = new PlanningRequest();

        request.setAlgorithm(PlannerAlgorithm.IALNS_SA);
        request.setScenario(OperationalScenario.REAL_TIME);
        request.setPlanningStart(LocalDateTime.now());
        request.setHorizonDays(1);
        request.setEpochHours(24L);
        request.setPopulationSize(50);
        request.setTimeLimitSeconds(60);
        request.setDataSetReference(DataSetReference.DEMO);
        
        planningRunExecutor.executeRun(0L, request, PlannerAlgorithm.IALNS_SA, DataSetReference.DEMO);
    }
}
