package com.tasfb2b.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.ThreadPoolExecutor;

@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "planningExecutor")
    public ThreadPoolTaskExecutor planningExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("planning-");
        executor.initialize();
        return executor;
    }

    /**
     * Ejecutor dedicado a persistir las rutas de cada época (C29).
     *
     * <p>Un solo hilo, a propósito: las épocas deben escribirse en el orden en
     * que se simularon, y varias escrituras en paralelo solo se pelearían por
     * el pool de conexiones. Va separado de {@code planningExecutor} porque ahí
     * corren las simulaciones: si compartieran pool, guardar una época podría
     * quedarse esperando a que una corrida libere un hilo.
     *
     * <p>La cola es amplia porque las escrituras van por detrás de la
     * animación; si se llenara, {@code CallerRunsPolicy} hace que el hilo de la
     * simulación escriba él mismo — más lento, pero sin perder rutas.
     */
    @Bean(name = "routePersistenceExecutor")
    public ThreadPoolTaskExecutor routePersistenceExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("route-persist-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        // Al parar el backend, terminar de escribir lo que quede en la cola.
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
