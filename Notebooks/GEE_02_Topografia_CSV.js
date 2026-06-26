// ==================================================================================
// SCRIPT GEE 02 — TOPOGRAFÍA  [v2 — alineado con matriz]
// Variables: ELEV_MEAN, SLOPE_MEAN, SLOPE_STD, ROUGHNESS_MEAN, ES_LADERA
// Fuente: SRTM 30m (USGS) | Estático — un solo CSV
// Salida: LN_Topografia.csv en Drive (carpeta GEE_LimaNorte_CSV)
// ==================================================================================
// CAMBIOS RESPECTO A v1:
//   - Eliminado ASPECT_MEAN (no figura en la matriz; queda como comentario opcional)
//   - Agregado SLOPE_STD (desviación estándar de pendiente dentro de la celda)
//   - Agregado ROUGHNESS_MEAN (stdDev de elevación en ventana 3×3 — rugosidad)
//   - Agregado ES_LADERA (indicador binario: pendiente > 15° → 1)
// ==================================================================================

var ASSET_GRILLA  = 'projects/TU_PROYECTO/assets/grilla_distritos'; // ← CAMBIAR
var CARPETA_DRIVE = 'GEE_LimaNorte_CSV';
var CRS_SALIDA    = 'EPSG:32718';

var grilla = ee.FeatureCollection(ASSET_GRILLA);
var roi    = grilla.geometry().dissolve();

// ── CAPAS BASE ─────────────────────────────────────────────────────────────────
var dem   = ee.Image('USGS/SRTMGL1_003').clip(roi);
var elev  = dem.rename('ELEV');
var slope = ee.Terrain.slope(dem).rename('SLOPE');  // grados 0–90°

// ROUGHNESS: desviación estándar de elevación en ventana 3×3 píxeles (≈90×90 m)
// Identifica zonas accidentadas difíciles de urbanizar de forma regular.
// Equivale al método reduceNeighborhood(stdDev, Kernel.square(1)) de la matriz.
var roughness = dem.reduceNeighborhood({
  reducer: ee.Reducer.stdDev(),
  kernel: ee.Kernel.square({radius: 1, units: 'pixels'})
}).rename('ROUGHNESS');

// ES_LADERA: binario — 1 si pendiente > 15°, 0 si no.
// Patrón característico de la expansión informal en cerros de Lima Norte.
var es_ladera = slope.gt(15).rename('ES_LADERA').toInt8();

// ASPECT (opcional — no en matriz, pero útil como covariate auxiliar):
// var aspect = ee.Terrain.aspect(dem).rename('ASPECT');

// ── STACK FINAL ────────────────────────────────────────────────────────────────
var topoStack = elev.addBands(slope).addBands(roughness).addBands(es_ladera);

// ── EXTRACCIÓN CON MEAN + STDDEV ───────────────────────────────────────────────
// ES_LADERA es binario — solo necesita mean (= proporción de px con pendiente >15°)
// SLOPE y ROUGHNESS usan mean + stdDev
// ELEV solo usa mean
var reducer = ee.Reducer.mean().combine({
  reducer2: ee.Reducer.stdDev(), sharedInputs: true
});

var extraccion = topoStack.reduceRegions({
  collection: grilla,
  reducer: reducer,
  scale: 30,        // resolución nativa SRTM
  crs: CRS_SALIDA
});

extraccion = extraccion.map(function(feat) {
  return feat.set({
    'ELEV_MEAN'      : feat.get('ELEV_mean'),
    'SLOPE_MEAN'     : feat.get('SLOPE_mean'),
    'SLOPE_STD'      : feat.get('SLOPE_stdDev'),
    'ROUGHNESS_MEAN' : feat.get('ROUGHNESS_mean'),
    'ES_LADERA'      : feat.get('ES_LADERA_mean')  // proporción de px > 15° en la celda
  });
});

// Nota sobre ES_LADERA:
//   reduceRegions devuelve la media de los píxeles binarios dentro de la celda.
//   Si quieres un valor binario estricto (1 si CUALQUIER px > 15°, 0 si ninguno):
//     cambiar a ee.Reducer.max() para ES_LADERA.
//   Si quieres que la celda sea "ladera" solo si >50% de px son >15°:
//     ES_LADERA_mean > 0.5 en Python al integrar los CSVs.

var campos = ['cell_id','col_idx','row_idx','fold_id','ubigeo','distrito',
              'ELEV_MEAN','SLOPE_MEAN','SLOPE_STD','ROUGHNESS_MEAN','ES_LADERA'];

Export.table.toDrive({
  collection: extraccion.select(campos),
  description: 'LN_Topografia',
  folder: CARPETA_DRIVE,
  fileNamePrefix: 'LN_Topografia',
  fileFormat: 'CSV'
});

// ── VERIFICACIÓN VISUAL ────────────────────────────────────────────────────────
Map.centerObject(roi, 11);
Map.addLayer(elev,   {min:0, max:2500, palette:['006633','E5FFCC','662A00','D8D8D8']}, 'Elevación SRTM');
Map.addLayer(slope,  {min:0, max:45, palette:['green','yellow','red']}, 'Pendiente (°)', false);
Map.addLayer(roughness, {min:0, max:30, palette:['white','orange','red']}, 'Rugosidad', false);
Map.addLayer(es_ladera.selfMask(), {palette:['red']}, 'Ladera (>15°)', false);
Map.addLayer(grilla.style({fillColor:'00000000', color:'gray', width:0.3}), {}, 'Grilla 100m');

// Diagnóstico
print('Script 02 v2 — Topografía [ALINEADO CON MATRIZ]');
print('Variables: ELEV_MEAN, SLOPE_MEAN, SLOPE_STD, ROUGHNESS_MEAN, ES_LADERA');
print('1 exportación CSV (estático, no varía por año)');
print('Estadísticas de pendiente:',
      slope.reduceRegion({reducer: ee.Reducer.percentile([5,50,95]),
                          geometry: roi, scale: 30, maxPixels: 1e9}));
print('Superficie con pendiente >15°:',
      es_ladera.reduceRegion({reducer: ee.Reducer.mean(),
                              geometry: roi, scale: 30, maxPixels: 1e9}),
      '(proporción del área total)');
