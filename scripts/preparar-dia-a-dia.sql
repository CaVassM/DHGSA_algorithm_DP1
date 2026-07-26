-- Preparación del escenario "Operaciones día a día".
--
-- El enunciado pide dos cambios antes de empezar la prueba y su vuelta atrás al
-- terminar, ambos "usando un esquema manual en lote (script)". Este archivo
-- cubre los dos sentidos; se ejecuta el bloque que toque.
--
-- Uso (con los contenedores levantados):
--
--   docker exec -i tasf-b2b-postgres psql -U tasf -d tasf_b2b \
--     -f - < scripts/preparar-dia-a-dia.sql
--
-- o, si se prefiere pegar el bloque a mano:
--
--   docker exec -it tasf-b2b-postgres psql -U tasf -d tasf_b2b
--
-- IMPORTANTE: tras tocar la BD hay que reiniciar la operación día a día
-- (POST /api/v1/daily/reset, o el botón "Reiniciar operación" de la pantalla).
-- El servicio mantiene el grafo en memoria y no se entera solo de los cambios.


-- ---------------------------------------------------------------------------
-- 1. PREPARACIÓN — antes de la prueba
-- ---------------------------------------------------------------------------

-- 1.a  La tabla de envíos debe estar limpia: aquí no aplica la data histórica ni
--      la proyectada, que son de los escenarios de simulación. Se borran también
--      las rutas y corridas que las referencian, o la FK impediría el borrado.
DELETE FROM ruta_legs;
DELETE FROM rutas;
DELETE FROM planning_runs;
DELETE FROM envios;

-- 1.b  Capacidad de almacén a 999 en los cuatro aeropuertos de la prueba.
--      Lima, Buenos Aires, Copenhague y Delhi son los mostradores desde los que
--      registran los estudiantes; con su capacidad real se saturarían durante la
--      sesión y los rechazos taparían lo que se quiere observar.
UPDATE aeropuertos SET capacidad_almacen = 999
 WHERE codigo_icao IN ('SPIM', 'SABE', 'EKCH', 'VIDP');

-- Comprobación
SELECT codigo_icao, ciudad, gmt, capacidad_almacen
  FROM aeropuertos
 WHERE codigo_icao IN ('SPIM', 'SABE', 'EKCH', 'VIDP')
 ORDER BY codigo_icao;

SELECT COUNT(*) AS envios_restantes FROM envios;


-- ---------------------------------------------------------------------------
-- 2. VUELTA ATRÁS — al terminar la prueba
-- ---------------------------------------------------------------------------
-- Descomentar y ejecutar solo esta parte cuando la prueba esté conforme.
--
-- Capacidades originales, según el enunciado.
--
-- UPDATE aeropuertos SET capacidad_almacen = 440 WHERE codigo_icao = 'SPIM';
-- UPDATE aeropuertos SET capacidad_almacen = 460 WHERE codigo_icao = 'SABE';
-- UPDATE aeropuertos SET capacidad_almacen = 480 WHERE codigo_icao = 'EKCH';
-- UPDATE aeropuertos SET capacidad_almacen = 480 WHERE codigo_icao = 'VIDP';
--
-- Los planes de vuelo añadidos para la prueba se identifican por su business_id;
-- ajustar el patrón al que se haya usado al cargarlos.
--
-- DELETE FROM vuelos WHERE business_id LIKE 'DIA-%';
--
-- SELECT codigo_icao, capacidad_almacen FROM aeropuertos
--  WHERE codigo_icao IN ('SPIM','SABE','EKCH','VIDP') ORDER BY codigo_icao;
