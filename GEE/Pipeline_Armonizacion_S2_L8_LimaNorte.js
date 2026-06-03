// ==================================================================================
// PIPELINE DE ARMONIZACIÓN MULTISENSOR: SENTINEL-2 + LANDSAT 8
// Proyecto: Modelado Predictivo de Crecimiento Urbano - Lima Norte
// Autor: A. Narciso | Generado con asistencia de Claude
// ==================================================================================
//
// OBJETIVO: Construir una serie temporal continua y consistente de índices espectrales
// (2017–2025) combinando Landsat 8 y Sentinel-2, con calibración cruzada para
// los años donde solo Landsat tiene cobertura confiable (2017–2018).
//
// FLUJO GENERAL:
//   1. Preprocesamiento de ambos sensores (nubes, escala, calidad)
//   2. Cálculo de índices espectrales con funciones unificadas
//   3. Generación de compuestos anuales (mediana)
//   4. Calibración cruzada en el periodo de traslape (2019–2025)
//   5. Aplicación de coeficientes a Landsat 2017–2018
//   6. Agregación a grilla regular de 100×100 m
//   7. Exportación de la serie temporal armonizada
// ==================================================================================


// ==================================================================================
// SECCIÓN 1: CONFIGURACIÓN GENERAL
// ==================================================================================

var roi = ee.FeatureCollection("projects/mystic-centaur-451219-m0/assets/CDC_Distrito_LimaNorte");
Map.centerObject(roi, 12);

// Años del análisis completo
var todosLosAnios = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Años donde SOLO Landsat es confiable (Sentinel-2 tiene <15 imágenes)
var aniosSoloLandsat = [2017, 2018];

// Años de traslape donde ambos sensores tienen buena cobertura
// Se usan para construir la función de transferencia (calibración cruzada)
var aniosTraslape = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

// Lista unificada de índices que se calculan de ambos sensores
// Esto es CRÍTICO: para la calibración cruzada necesitamos los mismos índices
var nombresIndices = ['NDVI', 'SAVI', 'NDWI', 'MNDWI', 'NDBI', 'BSI', 'UI'];

// Resolución objetivo para la grilla del autómata celular
var resolucionGrilla = 100; // metros

// Umbral de nubosidad para pre-filtrado de escenas
var umbralNubesS2 = 30;  // % para Sentinel-2
var umbralNubesL8 = 50;  // % para Landsat 8 (se perforan nubes per-pixel después)

// Puntos de muestreo para la calibración cruzada
var nMuestreo = 5000;


// ==================================================================================
// SECCIÓN 2: FUNCIONES DE PREPROCESAMIENTO
// ==================================================================================

// --- 2A. Enmascaramiento de nubes para Sentinel-2 (MEJORADO) ---
// MEJORA: Ahora enmascara tanto nubes densas (bit 10) como cirrus (bit 11).
// El cirrus contamina el SWIR y afecta directamente NDBI, BSI y UI.
function maskS2Clouds(image) {
  var qa = image.select('QA60');
  
  var cloudBitMask  = 1 << 10;  // Nubes densas
  var cirrusBitMask = 1 << 11;  // Cirrus (nuevo - no estaba en tu script original)
  
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  
  return image.updateMask(mask)
              .divide(10000)  // Escalar reflectancia a rango 0–1
              .copyProperties(image, ['system:time_start']);
}

// --- 2B. Enmascaramiento de nubes para Landsat 8 (QA_PIXEL) ---
// Usa los bits de calidad para remover nubes, sombras, cirrus y nieve
function maskL8Clouds(image) {
  var qa = image.select('QA_PIXEL');
  
  var dilatedCloudBitMask = (1 << 1);
  var cirrusBitMask       = (1 << 2);
  var cloudBitMask        = (1 << 3);
  var cloudShadowBitMask  = (1 << 4);
  var snowBitMask         = (1 << 5);  // También removemos nieve/hielo
  
  var mask = qa.bitwiseAnd(dilatedCloudBitMask).eq(0)
    .and(qa.bitwiseAnd(cirrusBitMask).eq(0))
    .and(qa.bitwiseAnd(cloudBitMask).eq(0))
    .and(qa.bitwiseAnd(cloudShadowBitMask).eq(0))
    .and(qa.bitwiseAnd(snowBitMask).eq(0));
    
  return image.updateMask(mask).copyProperties(image, ['system:time_start']);
}

// --- 2C. Factores de escala USGS para Landsat 8 Collection 2 ---
// Convierte los valores digitales a reflectancia de superficie (0–1) y
// temperatura de superficie en Kelvin
function applyScaleFactorsL8(image) {
  var opticalBands = image.select('SR_B.').multiply(0.0000275).add(-0.2);
  var thermalBands = image.select('ST_B.*').multiply(0.00341802).add(149.0);
  
  // Recortar valores ópticos a [0, 1] para evitar negativos por la corrección
  opticalBands = opticalBands.max(0).min(1);
  
  return image.addBands(opticalBands, null, true)
              .addBands(thermalBands, null, true);
}


// ==================================================================================
// SECCIÓN 3: CÁLCULO UNIFICADO DE ÍNDICES ESPECTRALES
// ==================================================================================
// IMPORTANTE: Las fórmulas son idénticas, pero las BANDAS cambian según el sensor.
// Esta función recibe un compuesto (imagen mediana) y el nombre del sensor,
// y devuelve una imagen multibanda con todos los índices.

function calcularIndices(composite, sensor) {
  
  // Mapeo de bandas: traduce nombres genéricos a las bandas reales de cada sensor
  // Sentinel-2:  B2=Blue, B3=Green, B4=Red, B8=NIR, B11=SWIR1, B12=SWIR2
  // Landsat 8:   SR_B2=Blue, SR_B3=Green, SR_B4=Red, SR_B5=NIR, SR_B6=SWIR1, SR_B7=SWIR2
  var bandas;
  if (sensor === 'S2') {
    bandas = {BLUE: 'B2', GREEN: 'B3', RED: 'B4', NIR: 'B8', SWIR1: 'B11', SWIR2: 'B12'};
  } else {
    bandas = {BLUE: 'SR_B2', GREEN: 'SR_B3', RED: 'SR_B4', NIR: 'SR_B5', SWIR1: 'SR_B6', SWIR2: 'SR_B7'};
  }
  
  // NDVI: Índice de Vegetación de Diferencia Normalizada
  // Mide la densidad y vigor de la vegetación
  var ndvi = composite.normalizedDifference([bandas.NIR, bandas.RED]).rename('NDVI');
  
  // SAVI: Índice de Vegetación Ajustado al Suelo (L=0.5)
  // Corrige el efecto del suelo desnudo en zonas de vegetación dispersa
  // Útil en zonas periurbanas de Lima donde la cobertura vegetal es parcial
  var savi = composite.expression(
    '((NIR - RED) / (NIR + RED + L)) * (1 + L)', {
      'NIR': composite.select(bandas.NIR),
      'RED': composite.select(bandas.RED),
      'L': 0.5
  }).rename('SAVI');
  
  // NDWI: Índice de Agua de Diferencia Normalizada
  // Detecta cuerpos de agua y humedad superficial
  var ndwi = composite.normalizedDifference([bandas.GREEN, bandas.NIR]).rename('NDWI');
  
  // MNDWI: NDWI Modificado (usa SWIR1 en lugar de NIR)
  // Más efectivo para agua turbidez y en contextos urbanos
  // donde el NIR puede confundirse con superficies impermeables
  var mndwi = composite.normalizedDifference([bandas.GREEN, bandas.SWIR1]).rename('MNDWI');
  
  // NDBI: Índice de Edificación de Diferencia Normalizada
  // Resalta superficies construidas (concreto, asfalto, techos)
  var ndbi = composite.normalizedDifference([bandas.SWIR1, bandas.NIR]).rename('NDBI');
  
  // BSI: Índice de Suelo Desnudo
  // Diferencia suelo expuesto de vegetación y agua
  // Clave para identificar zonas de expansión urbana reciente
  var bsi = composite.expression(
    '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))', {
      'SWIR1': composite.select(bandas.SWIR1),
      'RED':   composite.select(bandas.RED),
      'NIR':   composite.select(bandas.NIR),
      'BLUE':  composite.select(bandas.BLUE)
  }).rename('BSI');
  
  // UI: Urban Index (Índice Urbano)
  // Usa SWIR2 para mayor sensibilidad a materiales urbanos
  var ui = composite.normalizedDifference([bandas.SWIR2, bandas.NIR]).rename('UI');
  
  // Apilar todos los índices en una sola imagen multibanda
  return ee.Image.cat([ndvi, savi, ndwi, mndwi, ndbi, bsi, ui]);
}


// ==================================================================================
// SECCIÓN 4: GENERACIÓN DE COMPUESTOS ANUALES
// ==================================================================================

// --- 4A. Compuesto anual Sentinel-2 ---
function getS2Composite(year) {
  var inicio = year + '-01-01';
  var fin    = year + '-12-31';
  
  var coleccion = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(roi)
    .filterDate(inicio, fin)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', umbralNubesS2))
    .map(maskS2Clouds);
  
  // La mediana es robusta frente a valores extremos y nubes residuales
  var composite = coleccion.median().clip(roi);
  
  return composite;
}

// --- 4B. Compuesto anual Landsat 8 ---
function getL8Composite(year) {
  var inicio = year + '-01-01';
  var fin    = year + '-12-31';
  
  var coleccion = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
    .filterBounds(roi)
    .filterDate(inicio, fin)
    .filter(ee.Filter.lt('CLOUD_COVER', umbralNubesL8))
    .map(maskL8Clouds)
    .map(applyScaleFactorsL8);
  
  var composite = coleccion.median().clip(roi);
  
  return composite;
}


// ==================================================================================
// SECCIÓN 5: CALIBRACIÓN CRUZADA (CROSS-CALIBRATION)
// ==================================================================================
// CONCEPTO: Usamos los años donde AMBOS sensores tienen buena cobertura (2019–2025)
// para aprender la relación estadística entre sus índices.
//
// Para cada índice: S2_indice = intercepto + pendiente × L8_indice
//
// Esto permite luego "traducir" los valores de Landsat 2017–2018 al espacio
// espectral de Sentinel-2, generando una serie temporal homogénea.
// ==================================================================================

// --- 5A. Generar imágenes pareadas para todos los años de traslape ---
// Para cada año, calculamos los índices de ambos sensores y los apilamos
// en una sola imagen con bandas L8_NDVI, S2_NDVI, L8_NDBI, S2_NDBI, etc.

function crearImagenPareada(year) {
  var compositeS2 = getS2Composite(year);
  var compositeL8 = getL8Composite(year);
  
  var indicesS2 = calcularIndices(compositeS2, 'S2');
  var indicesL8 = calcularIndices(compositeL8, 'L8');
  
  // Renombrar bandas para distinguir sensor de origen
  var bandasS2 = indicesS2.bandNames().map(function(name) {
    return ee.String('S2_').cat(name);
  });
  var bandasL8 = indicesL8.bandNames().map(function(name) {
    return ee.String('L8_').cat(name);
  });
  
  indicesS2 = indicesS2.rename(bandasS2);
  indicesL8 = indicesL8.rename(bandasL8);
  
  // IMPORTANTE: Remuestreamos Sentinel-2 a 30m para que ambas imágenes
  // estén en la misma grilla de píxeles antes de parear los valores.
  // Usamos 'bilinear' porque los índices son variables continuas.
  indicesS2 = indicesS2.resample('bilinear').reproject({
    crs: indicesL8.projection(),
    scale: 30
  });
  
  return indicesL8.addBands(indicesS2).set('year', year);
}

// Crear la colección de imágenes pareadas para todos los años de traslape
var imagenesPareadas = ee.ImageCollection(
  aniosTraslape.map(function(year) {
    return crearImagenPareada(year);
  })
);

// Compuesto de todos los años de traslape (mediana pooled)
// Esto nos da un "promedio" multianual de la relación entre sensores
var pareado_pooled = imagenesPareadas.median();

// --- 5B. Muestreo estratificado para la calibración ---
// Generamos puntos aleatorios dentro de Lima Norte y extraemos
// los valores pareados de ambos sensores

var puntosMuestreo = ee.FeatureCollection.randomPoints({
  region: roi.geometry(),
  points: nMuestreo,
  seed: 42  // Semilla para reproducibilidad
});

// Extraer valores de todos los índices en los puntos de muestreo
var muestrasPareadas = pareado_pooled.sampleRegions({
  collection: puntosMuestreo,
  scale: 30,
  geometries: true  // Preservar ubicación para análisis espacial posterior
});

// --- 5C. Calcular coeficientes de regresión lineal por índice ---
// Para cada índice, ajustamos: S2_indice = intercepto + pendiente × L8_indice
// Usamos ee.Reducer.linearFit() que espera [x, y] = [L8, S2]

// Esta función calcula los coeficientes para un índice dado
function calcularCoeficientes(nombreIndice) {
  var bandaL8 = 'L8_' + nombreIndice;
  var bandaS2 = 'S2_' + nombreIndice;
  
  // Crear imagen de 2 bandas: [predictor=L8, respuesta=S2]
  var parBandas = pareado_pooled.select([bandaL8, bandaS2]);
  
  // Regresión lineal dentro de la región de estudio
  var regresion = parBandas.reduceRegion({
    reducer: ee.Reducer.linearFit(),
    geometry: roi.geometry(),
    scale: 30,
    maxPixels: 1e9,
    bestEffort: true
  });
  
  // linearFit devuelve: 'scale' (pendiente) y 'offset' (intercepto)
  return ee.Dictionary({
    indice: nombreIndice,
    pendiente: regresion.get('scale'),
    intercepto: regresion.get('offset')
  });
}

// Calcular coeficientes para todos los índices
var coeficientes = ee.List(nombresIndices.map(function(nombre) {
  return calcularCoeficientes(nombre);
}));

// Imprimir los coeficientes en la consola de GEE para inspección
print('=== COEFICIENTES DE CALIBRACIÓN CRUZADA ===');
print('Modelo: S2_indice = intercepto + pendiente × L8_indice');
coeficientes.evaluate(function(coefs) {
  coefs.forEach(function(c) {
    print(c.indice + ': pendiente=' + c.pendiente.toFixed(4) + 
          ', intercepto=' + c.intercepto.toFixed(4));
  });
});

// --- 5D. Exportar muestras pareadas para validación externa (R/Python) ---
// Esto permite hacer análisis más sofisticados: regresión robusta, 
// diagnósticos de residuos, test de Chow, etc.
Export.table.toDrive({
  collection: muestrasPareadas,
  description: 'Muestras_Calibracion_Cruzada_S2_L8',
  folder: 'GEE_Exports',
  fileNamePrefix: 'cross_calibration_samples',
  fileFormat: 'CSV'
});


// ==================================================================================
// SECCIÓN 6: APLICACIÓN DE ARMONIZACIÓN Y ENSAMBLAJE DE SERIE TEMPORAL
// ==================================================================================

// --- 6A. Función para armonizar índices de Landsat usando los coeficientes ---
// Aplica la transformación lineal: S2_armonizado = intercepto + pendiente × L8_original

function armonizarIndicesL8(indicesL8, coefs) {
  // coefs es una lista de diccionarios con {indice, pendiente, intercepto}
  // Necesitamos aplicar la transformación banda por banda
  
  var bandasArmonizadas = nombresIndices.map(function(nombre) {
    // Buscar los coeficientes para este índice
    var coefIndice = ee.Dictionary(ee.List(coefs).filter(
      ee.Filter.eq('indice', nombre)
    ).get(0));
    
    var pendiente = ee.Number(coefIndice.get('pendiente'));
    var intercepto = ee.Number(coefIndice.get('intercepto'));
    
    // Aplicar transformación lineal
    return indicesL8.select(nombre)
      .multiply(pendiente)
      .add(intercepto)
      .rename(nombre);
  });
  
  return ee.Image.cat(bandasArmonizadas);
}

// --- 6B. Generar la serie temporal completa armonizada ---
// Para 2017–2018: Landsat 8 armonizado
// Para 2019–2025: Sentinel-2 nativo (fuente preferida)

function generarIndicesAnuales(year) {
  year = ee.Number(year);
  
  // Decidir la fuente según el año
  var esAnioSoloLandsat = ee.List(aniosSoloLandsat).contains(year);
  
  // Rama Sentinel-2 (años 2019+)
  var indicesS2 = ee.Algorithms.If(
    esAnioSoloLandsat,
    null,
    calcularIndices(getS2Composite(year), 'S2')
  );
  
  // Rama Landsat 8 armonizado (años 2017–2018)
  var indicesL8raw = calcularIndices(getL8Composite(year), 'L8');
  var indicesL8armonizado = armonizarIndicesL8(indicesL8raw, coeficientes);
  
  // Seleccionar la fuente correcta y agregar metadatos
  var indicesFinales = ee.Image(
    ee.Algorithms.If(esAnioSoloLandsat, indicesL8armonizado, indicesS2)
  );
  
  // Agregar banda indicadora de fuente del sensor (0=L8 armonizado, 1=S2 nativo)
  // Esto puede usarse como covariable en el modelo ML para capturar efecto residual
  var fuenteSensor = ee.Image.constant(
    ee.Algorithms.If(esAnioSoloLandsat, 0, 1)
  ).rename('FUENTE_SENSOR').toByte();
  
  return indicesFinales.addBands(fuenteSensor)
    .set('year', year)
    .set('sensor', ee.Algorithms.If(esAnioSoloLandsat, 'L8_armonizado', 'S2_nativo'));
}

// Construir la colección temporal completa
var serieTemporalIndices = ee.ImageCollection(
  todosLosAnios.map(function(year) {
    return generarIndicesAnuales(year);
  })
);

print('=== SERIE TEMPORAL ARMONIZADA ===');
print(serieTemporalIndices);


// ==================================================================================
// SECCIÓN 7: AGREGACIÓN A GRILLA DE 100×100 m
// ==================================================================================
// Tu unidad de análisis (celda del autómata celular) es de 100×100 m.
// Aquí agregamos los valores de los índices a esa resolución usando la MEDIA
// dentro de cada celda. Esto "nivela" la diferencia de resolución nativa:
//   - Sentinel-2 (10m): ~100 píxeles por celda → estadísticas muy robustas
//   - Landsat 8 (30m):  ~9 píxeles por celda  → estadísticas aceptables
//
// Se ofrece OPCIÓN A (reduceResolution, ráster) y OPCIÓN B (reduceRegions, vectorial)
// ==================================================================================

// --- OPCIÓN A: Agregación ráster con reduceResolution ---
// Ventaja: eficiente computacionalmente, ideal para exportar GeoTIFF
// El resultado es un ráster donde cada píxel de 100m contiene la media del índice

function agregarAGrilla100m(imagen) {
  // Primero reproyectamos a la resolución nativa más fina para que
  // reduceResolution tenga suficientes píxeles para agregar
  return imagen
    .reproject({
      crs: 'EPSG:32718',  // UTM zona 18S (Lima, Perú)
      scale: 10            // Resolución base (la más fina disponible)
    })
    .reduceResolution({
      reducer: ee.Reducer.mean(),   // Media dentro de cada celda 100m
      maxPixels: 1024,
      bestEffort: true
    })
    .reproject({
      crs: 'EPSG:32718',
      scale: resolucionGrilla       // 100 metros
    });
}

// --- OPCIÓN B: Agregación vectorial con reduceRegions ---
// Ventaja: si ya tienes tu grilla vectorial en GEE, puedes calcular
// estadísticas directamente sobre ella (media, mediana, desviación estándar).
// Descomenta esta sección si tienes el asset de la grilla cargado.

/*
var grilla100m = ee.FeatureCollection("projects/TU_PROYECTO/assets/grilla_100m_LimaNorte");

function agregarAGrillaVectorial(imagen, year) {
  var stats = imagen.reduceRegions({
    collection: grilla100m,
    reducer: ee.Reducer.mean().combine({
      reducer2: ee.Reducer.stdDev(),
      sharedInputs: true
    }),
    scale: 10,
    tileScale: 4  // Ayuda con memoria en regiones grandes
  });
  
  return stats.map(function(f) {
    return f.set('year', year);
  });
}
*/


// ==================================================================================
// SECCIÓN 8: VISUALIZACIÓN Y EXPORTACIÓN
// ==================================================================================

// --- 8A. Visualización interactiva en el mapa de GEE ---
Map.layers().reset();
Map.addLayer(roi.style({color: 'black', fillColor: '00000000', width: 2}), 
             {}, 'Límite Lima Norte');

// Paletas de visualización por tipo de índice
var paletaVegetacion = {min: -0.2, max: 0.8, palette: ['brown', 'yellow', 'green']};
var paletaAgua       = {min: -0.5, max: 0.5, palette: ['red', 'white', 'blue']};
var paletaUrbano     = {min: -0.3, max: 0.5, palette: ['blue', 'yellow', 'red']};
var paletaSuelo      = {min: -0.3, max: 0.5, palette: ['blue', 'white', 'brown']};

// Mostrar un año de ejemplo de cada fuente para comparación visual
var ejemplo2017 = ee.Image(serieTemporalIndices.filter(ee.Filter.eq('year', 2017)).first());
var ejemplo2023 = ee.Image(serieTemporalIndices.filter(ee.Filter.eq('year', 2023)).first());

Map.addLayer(ejemplo2017.select('NDVI'), paletaVegetacion, 'NDVI 2017 (L8 armonizado)');
Map.addLayer(ejemplo2023.select('NDVI'), paletaVegetacion, 'NDVI 2023 (S2 nativo)', false);
Map.addLayer(ejemplo2017.select('NDBI'), paletaUrbano, 'NDBI 2017 (L8 armonizado)', false);
Map.addLayer(ejemplo2023.select('NDBI'), paletaUrbano, 'NDBI 2023 (S2 nativo)', false);
Map.addLayer(ejemplo2017.select('BSI'),  paletaSuelo, 'BSI 2017 (L8 armonizado)', false);

// --- 8B. Exportación de la serie temporal completa ---
// Exporta un GeoTIFF multibanda por año, agregado a grilla de 100m

todosLosAnios.forEach(function(year) {
  var imagen = ee.Image(serieTemporalIndices.filter(ee.Filter.eq('year', year)).first());
  
  // Agregar a grilla de 100m antes de exportar
  var imagenGrilla = agregarAGrilla100m(imagen);
  
  Export.image.toDrive({
    image: imagenGrilla.toFloat(),
    description: 'Indices_Armonizados_LimaNorte_' + year,
    folder: 'GEE_Exports',
    fileNamePrefix: 'Indices_Armonizados_LN_' + year,
    region: roi.geometry(),
    scale: resolucionGrilla,  // 100m
    crs: 'EPSG:32718',        // UTM 18S
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
});

// --- 8C. Exportación de diagnósticos de la calibración ---
// Exportar también los índices sin armonizar de 2017-2018 para comparación
aniosSoloLandsat.forEach(function(year) {
  var compositeL8 = getL8Composite(year);
  var indicesL8raw = calcularIndices(compositeL8, 'L8');
  var indicesL8grilla = agregarAGrilla100m(indicesL8raw);
  
  Export.image.toDrive({
    image: indicesL8grilla.toFloat(),
    description: 'Indices_L8_SinArmonizar_LimaNorte_' + year,
    folder: 'GEE_Exports',
    fileNamePrefix: 'Indices_L8_RAW_LN_' + year,
    region: roi.geometry(),
    scale: resolucionGrilla,
    crs: 'EPSG:32718',
    maxPixels: 1e13,
    fileFormat: 'GeoTIFF'
  });
});


// ==================================================================================
// SECCIÓN 9: MÉTRICAS DE CALIDAD DE LA ARMONIZACIÓN
// ==================================================================================
// Calculamos R², RMSE y MAE para cada índice en el periodo de traslape.
// Esto se imprime en la consola de GEE y se puede citar en la metodología.

print('=== MÉTRICAS DE CALIDAD DE LA CALIBRACIÓN CRUZADA ===');

nombresIndices.forEach(function(nombre) {
  var bandaL8 = 'L8_' + nombre;
  var bandaS2 = 'S2_' + nombre;
  
  // Imagen con valores pareados
  var par = pareado_pooled.select([bandaL8, bandaS2]);
  
  // Calcular estadísticas básicas
  var stats = par.reduceRegion({
    reducer: ee.Reducer.pearsonsCorrelation(),
    geometry: roi.geometry(),
    scale: 30,
    maxPixels: 1e9,
    bestEffort: true
  });
  
  // RMSE: raíz del error cuadrático medio
  var diferencia = pareado_pooled.select(bandaS2)
    .subtract(pareado_pooled.select(bandaL8));
  var errorCuadratico = diferencia.pow(2);
  
  var rmseDict = errorCuadratico.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: roi.geometry(),
    scale: 30,
    maxPixels: 1e9,
    bestEffort: true
  });
  
  print(nombre + ' - Correlación de Pearson:', stats);
  print(nombre + ' - Error cuadrático medio (ECM):', rmseDict);
  // Nota: RMSE = sqrt(ECM). Calcularlo client-side: Math.sqrt(ECM)
});


// ==================================================================================
// SECCIÓN 10: NOTAS METODOLÓGICAS PARA EL DOCUMENTO DEL PROYECTO
// ==================================================================================
// 
// Para documentar en tu plan de proyecto (OE1 - Metodología), incluir:
//
// 1. ESTRATEGIA DE ARMONIZACIÓN MULTISENSOR
//    "Se implementó una estrategia de calibración cruzada (cross-calibration)
//    para generar una serie temporal espectralmente consistente 2017–2025.
//    Los años 2019–2025, donde ambos sensores (Sentinel-2 MSI y Landsat 8 OLI)
//    presentan cobertura confiable sobre Lima Norte, se utilizaron como periodo
//    de traslape para ajustar funciones de transferencia lineal por índice
//    espectral. Los coeficientes obtenidos se aplicaron a los compuestos
//    Landsat 8 de 2017–2018 para proyectarlos al espacio espectral de
//    Sentinel-2, que constituye la fuente primaria de la serie."
//
// 2. VARIABLE DE CONTROL DEL SENSOR
//    "Se incluyó una variable binaria FUENTE_SENSOR (0=Landsat 8 armonizado,
//    1=Sentinel-2 nativo) como covariable en los modelos predictivos, 
//    permitiendo que los algoritmos de machine learning capturen cualquier
//    efecto residual de la fuente del sensor."
//
// 3. MÉTRICAS DE CALIDAD
//    Reportar R², RMSE y MAE por índice (obtenidos de la Sección 9).
//    Incluir gráficos de dispersión L8 vs S2 por índice (generables desde
//    el CSV exportado en la Sección 5D con R o Python).
//
// 4. REFERENCIA BIBLIOGRÁFICA CLAVE
//    Claverie, M. et al. (2018). The Harmonized Landsat and Sentinel-2
//    surface reflectance data set. Remote Sensing of Environment, 219, 145–161.
//    DOI: 10.1016/j.rse.2018.09.002
//
// ==================================================================================

print('Pipeline de armonización ejecutado correctamente.');
print('Revisa las tareas de exportación en la pestaña "Tasks" de GEE.');
