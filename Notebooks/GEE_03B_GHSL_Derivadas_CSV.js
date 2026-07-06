// ==================================================================================
// SCRIPT GEE 03B — VARIABLES URBANAS DERIVADAS DE GHSL
// Variables nuevas (complementan al Script 03 original):
//   BUILT_2015_SUM, BUILT_2020_SUM   → suma de superficie construida por celda
//   PROP_URBANA_BUF300               → proporción urbana en vecindario de 300m
//   DIST_CENTRO                      → distancia al centroide del área urbana consolidada
//   DIST_BORDE_URBANO                → distancia al borde del área urbana 2017
// Salida: CSVs en Drive (carpeta GEE_LimaNorte_CSV)
// ==================================================================================
// NOTA: Este script complementa al GEE_03. Puede ejecutarse independientemente.
//   - BUILT_2015/2020_MEAN ya se exportaron en Script 03 original.
//   - Aquí se agregan SUM y las variables derivadas espacialmente.
// ==================================================================================

// ── CONFIGURACIÓN ──────────────────────────────────────────────────────────────
var ASSET_GRILLA  = 'projects/TU_PROYECTO/assets/grilla_distritos'; // ← CAMBIAR
var CARPETA_DRIVE = 'GEE_LimaNorte_CSV';
var CRS_SALIDA    = 'EPSG:32718';
var UMBRAL_URBANO = 200;  // m² de superficie construida para considerar "urbano"

// ── CARGA DE DATOS ─────────────────────────────────────────────────────────────
var grilla = ee.FeatureCollection(ASSET_GRILLA);
var roi    = grilla.geometry().dissolve();

var ghsl2015 = ee.ImageCollection('JRC/GHSL/P2023A/GHS_BUILT_S')
  .filter(ee.Filter.eq('epoch', 2015)).first()
  .select('built_surface').clip(roi);

var ghsl2020 = ee.ImageCollection('JRC/GHSL/P2023A/GHS_BUILT_S')
  .filter(ee.Filter.eq('epoch', 2020)).first()
  .select('built_surface').clip(roi);


// ══════════════════════════════════════════════════════════════════════════════
// PARTE A — BUILT SUM (superficie total construida por celda en m²)
// El SUM es necesario para calcular TASA_CAMBIO_BUILT en Python
// ══════════════════════════════════════════════════════════════════════════════
function exportarGHSL_Sum(ghslImage, epochLabel) {
  var extraccion = ghslImage.reduceRegions({
    collection: grilla,
    reducer: ee.Reducer.mean().combine({
      reducer2: ee.Reducer.sum(),
      sharedInputs: true
    }),
    scale: 10,
    crs: CRS_SALIDA
  });

  extraccion = extraccion.map(function(feat) {
    return feat.set({
      'BUILT_MEAN'  : feat.get('built_surface_mean'),
      'BUILT_SUM'   : feat.get('built_surface_sum'),
      'GHSL_EPOCH'  : parseInt(epochLabel)
    });
  });

  var campos = ['cell_id', 'col_idx', 'row_idx', 'fold_id',
                'ubigeo', 'distrito',
                'BUILT_MEAN', 'BUILT_SUM', 'GHSL_EPOCH'];

  Export.table.toDrive({
    collection: extraccion.select(campos),
    description: 'LN_GHSL_completo_' + epochLabel,
    folder: CARPETA_DRIVE,
    fileNamePrefix: 'LN_GHSL_completo_' + epochLabel,
    fileFormat: 'CSV'
  });
}

exportarGHSL_Sum(ghsl2015, '2015');
exportarGHSL_Sum(ghsl2020, '2020');


// ══════════════════════════════════════════════════════════════════════════════
// PARTE B — PROP_URBANA_BUF300
// Proporción de área construida en un radio de 300m alrededor de cada celda.
// Captura el efecto de vecindad: celdas rodeadas de zonas urbanas tienen mayor
// probabilidad de cambio (presión de consolidación).
// Estrategia: aplicar un kernel focal circular de 300m sobre una imagen binaria
// urbano/no-urbano derivada de GHSL 2020. Esto es más eficiente que crear
// buffers vectoriales para cada una de las 82,519 celdas.
// ══════════════════════════════════════════════════════════════════════════════

// Imagen binaria: 1 = urbano (>= 200 m²), 0 = no urbano
var urbano2020 = ghsl2020.gte(UMBRAL_URBANO).rename('urbano');

// Kernel circular de 300m (en píxeles de 10m: radio = 30 píxeles)
var kernel = ee.Kernel.circle({
  radius: 300,     // en metros
  units: 'meters',
  normalize: true  // normalizar = resultado es proporción (0 a 1)
});

// Media focal = proporción de píxeles urbanos en el vecindario de 300m
var propUrbana = urbano2020.focal_mean({kernel: kernel}).rename('PROP_URBANA_BUF300');

var extProp = propUrbana.reduceRegions({
  collection: grilla,
  reducer: ee.Reducer.mean(),
  scale: 10,
  crs: CRS_SALIDA
});

extProp = extProp.map(function(feat) {
  return feat.set('PROP_URBANA_BUF300', feat.get('PROP_URBANA_BUF300'));
});

Export.table.toDrive({
  collection: extProp.select(['cell_id', 'col_idx', 'row_idx', 'fold_id',
                               'ubigeo', 'distrito', 'PROP_URBANA_BUF300']),
  description: 'LN_PropUrbanaBuf300',
  folder: CARPETA_DRIVE,
  fileNamePrefix: 'LN_PropUrbanaBuf300',
  fileFormat: 'CSV'
});


// ══════════════════════════════════════════════════════════════════════════════
// PARTE C — DIST_CENTRO
// Distancia de cada celda al centroide del área urbana consolidada del distrito.
// Mayor distancia al centro → mayor probabilidad de ser frente de expansión.
// Estrategia: vectorizar el GHSL umbralizado, calcular centroide por distrito,
// luego medir distancia euclidiana de cada celda al centroide más cercano.
// ══════════════════════════════════════════════════════════════════════════════

// Vectorizar el área urbana consolidada (GHSL 2020 >= 200 m²)
var urbanoVector = urbano2020.selfMask().reduceToVectors({
  geometry: roi,
  scale: 100,          // vectorizar a resolución de grilla para velocidad
  geometryType: 'polygon',
  eightConnected: true,
  maxPixels: 1e10,
  bestEffort: true
});

// Filtrar polígonos pequeños (ruido) — quedarse con clusters > 10 ha
var urbanoConsolidado = urbanoVector.filter(ee.Filter.gt('count', 100));

// Centroide del área urbana consolidada más grande (principal)
var centroideUrbano = urbanoConsolidado.geometry().centroid(10);

// Imagen de distancia al centroide urbano (en metros)
var distCentro = ee.Image.constant(0).paint(
  ee.FeatureCollection([ee.Feature(centroideUrbano)]), 1
).fastDistanceTransform(2048).sqrt()
  .multiply(100)  // a metros (resolución de la grilla de distancia)
  .divide(1000)   // a kilómetros
  .rename('DIST_CENTRO');

// Alternativa más robusta: distancia desde cada celda al centroide usando
// coordenadas, sin depender de fastDistanceTransform
var extCentro = grilla.map(function(feat) {
  var centCell = feat.geometry().centroid(1);
  var dist = centCell.distance(centroideUrbano).divide(1000); // km
  return feat.set('DIST_CENTRO', dist);
});

Export.table.toDrive({
  collection: extCentro.select(['cell_id', 'col_idx', 'row_idx', 'fold_id',
                                 'ubigeo', 'distrito', 'DIST_CENTRO']),
  description: 'LN_DistCentro',
  folder: CARPETA_DRIVE,
  fileNamePrefix: 'LN_DistCentro',
  fileFormat: 'CSV'
});


// ══════════════════════════════════════════════════════════════════════════════
// PARTE D — DIST_BORDE_URBANO
// Distancia de cada celda al borde del área urbana en t₀ (GHSL 2015).
// Las celdas inmediatamente adyacentes al borde urbano tienen la mayor
// probabilidad histórica de urbanizarse (efecto de contigüidad).
// Estrategia: detectar el borde con Canny edge detector sobre GHSL binario,
// luego medir distancia euclidiana con fastDistanceTransform.
// ══════════════════════════════════════════════════════════════════════════════

// Borde de la mancha urbana en 2015 (detectado con Canny)
var urbano2015 = ghsl2015.gte(UMBRAL_URBANO);
var bordeUrbano = ee.Algorithms.CannyEdgeDetector({
  image: urbano2015.toFloat(),
  threshold: 0.5,
  sigma: 1
}).rename('borde');

// Distancia al borde más cercano (en metros → km)
var distBorde = bordeUrbano.selfMask()
  .fastDistanceTransform(2048).sqrt()
  .multiply(10)     // resolución de GHSL (10m)
  .divide(1000)     // a kilómetros
  .rename('DIST_BORDE_URBANO');

var extBorde = distBorde.reduceRegions({
  collection: grilla,
  reducer: ee.Reducer.mean(),
  scale: 10,
  crs: CRS_SALIDA
});

extBorde = extBorde.map(function(feat) {
  return feat.set('DIST_BORDE_URBANO', feat.get('DIST_BORDE_URBANO'));
});

Export.table.toDrive({
  collection: extBorde.select(['cell_id', 'col_idx', 'row_idx', 'fold_id',
                                'ubigeo', 'distrito', 'DIST_BORDE_URBANO']),
  description: 'LN_DistBordeUrbano',
  folder: CARPETA_DRIVE,
  fileNamePrefix: 'LN_DistBordeUrbano',
  fileFormat: 'CSV'
});


// ── VERIFICACIÓN VISUAL ────────────────────────────────────────────────────────
Map.centerObject(roi, 11);
Map.addLayer(urbano2020.selfMask(),
             {palette: ['red']}, 'Urbano GHSL 2020 (≥200 m²)');
Map.addLayer(propUrbana,
             {min: 0, max: 1, palette: ['white', 'orange', 'darkred']},
             'Prop. urbana buffer 300m', false);
Map.addLayer(bordeUrbano.selfMask(),
             {palette: ['cyan']}, 'Borde urbano 2015', false);
Map.addLayer(ee.FeatureCollection([ee.Feature(centroideUrbano)])
               .style({color: 'yellow', pointSize: 8}),
             {}, 'Centroide urbano');
Map.addLayer(grilla.style({fillColor: '00000000', color: 'gray', width: 0.3}),
             {}, 'Grilla 100m');

print('Script 03B — Variables urbanas derivadas GHSL listo.');
print('Exportaciones: 5 CSVs');
print('  1. LN_GHSL_completo_2015.csv (MEAN + SUM)');
print('  2. LN_GHSL_completo_2020.csv (MEAN + SUM)');
print('  3. LN_PropUrbanaBuf300.csv');
print('  4. LN_DistCentro.csv');
print('  5. LN_DistBordeUrbano.csv');
