// ==================================================================================
// SCRIPT GEE 04 — LUMINOSIDAD NOCTURNA (VIIRS) + SAR (Sentinel-1)  [v2 — matriz]
// Variables: NTL_MEAN, SAR_MEAN (VV+VH promedio), SAR_STD (VV+VH stdDev)
// Años: 2017–2024
// Salida: CSVs anuales en Drive (carpeta GEE_LimaNorte_CSV)
// ==================================================================================
// CAMBIOS RESPECTO A v1:
//   - La matriz define SAR_MEAN como media de VV y VH juntos (no separados)
//   - La matriz define SAR_STD como stdDev de VV y VH juntos
//   - Se mantienen VV y VH individuales como columnas auxiliares (útiles para modelo)
//   - Eliminado SAR_VV_VH_RATIO (no figura en la matriz)
// ==================================================================================

var ASSET_GRILLA  = 'projects/TU_PROYECTO/assets/grilla_distritos'; // ← CAMBIAR
var CARPETA_DRIVE = 'GEE_LimaNorte_CSV';
var CRS_SALIDA    = 'EPSG:32718';
var ANIOS         = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

var grilla = ee.FeatureCollection(ASSET_GRILLA);
var roi    = grilla.geometry().dissolve();

ANIOS.forEach(function(year) {

  // ── PARTE A: VIIRS Luminosidad nocturna ───────────────────────────────────────
  var viirs = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
    .filterBounds(roi)
    .filterDate(year+'-01-01', year+'-11-30')
    .select('avg_rad')
    .map(function(img) { return img.updateMask(img.gte(0).and(img.lt(1000))); });

  var ntl = viirs.median().rename('NTL').clip(roi);

  // ── PARTE B: SAR Sentinel-1 ───────────────────────────────────────────────────
  // La matriz define SAR_MEAN como "media y desviación estándar de retrodispersión
  // radar" para las bandas VV y VH (sin distinguirlas). Se interpreta como:
  //   SAR_MEAN = media del stack VV+VH (ambas bandas juntas → media de 2 valores por px)
  //   SAR_STD  = desviación estándar del mismo stack
  var sarCol = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(roi)
    .filterDate(year+'-01-01', year+'-12-31')
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
    .select(['VV', 'VH']);

  // Mediana anual por polarización
  var sarMediana = sarCol.median().clip(roi);
  var sarVV = sarMediana.select('VV');
  var sarVH = sarMediana.select('VH');

  // SAR_MEAN: media de VV y VH (única imagen con 2 bandas → media por píxel)
  var sarMean = sarVV.add(sarVH).divide(2).rename('SAR_MEAN');

  // SAR_STD: como VV y VH son bandas distintas de la misma imagen,
  // aproximamos STD como la semivarianza entre VV y VH (equivalente conceptual):
  // STD ≈ |VV - VH| / 2 (desviación entre polarizaciones)
  // Nota: si la matriz requiere STD temporal (entre adquisiciones del año),
  // usar sarCol.reduce(ee.Reducer.stdDev()) en lugar de este enfoque.
  var sarStd = sarVV.subtract(sarVH).abs().divide(2).rename('SAR_STD');

  // Columnas auxiliares VV y VH individuales (útiles para interpretabilidad SHAP)
  var stackSAR = sarMean.addBands(sarStd).addBands(sarVV.rename('SAR_VV')).addBands(sarVH.rename('SAR_VH'));

  // ── STACK FINAL ───────────────────────────────────────────────────────────────
  var stack = ntl.addBands(stackSAR);

  // ── EXTRACCIÓN ────────────────────────────────────────────────────────────────
  var reducer = ee.Reducer.mean().combine({
    reducer2: ee.Reducer.stdDev(), sharedInputs: true
  });

  var ext = stack.reduceRegions({
    collection: grilla, reducer: reducer, scale: 10, crs: CRS_SALIDA
  });

  ext = ext.map(function(feat) {
    return feat.set({
      'NTL_MEAN'  : feat.get('NTL_mean'),
      'SAR_MEAN'  : feat.get('SAR_MEAN_mean'),   // media intracelda de (VV+VH)/2
      'SAR_STD'   : feat.get('SAR_STD_mean'),    // media intracelda de |VV-VH|/2
      'SAR_VV'    : feat.get('SAR_VV_mean'),     // auxiliar
      'SAR_VH'    : feat.get('SAR_VH_mean'),     // auxiliar
      'ANIO'      : year
    });
  });

  var campos = ['cell_id','col_idx','row_idx','fold_id','ubigeo','distrito',
                'NTL_MEAN','SAR_MEAN','SAR_STD','SAR_VV','SAR_VH','ANIO'];

  Export.table.toDrive({
    collection: ext.select(campos),
    description: 'LN_NTL_SAR_' + year,
    folder: CARPETA_DRIVE,
    fileNamePrefix: 'LN_NTL_SAR_' + year,
    fileFormat: 'CSV'
  });
});

// ── VERIFICACIÓN VISUAL ────────────────────────────────────────────────────────
Map.centerObject(roi, 11);

var ntl2023 = ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG')
  .filterBounds(roi).filterDate('2023-01-01','2023-11-30').select('avg_rad')
  .map(function(img){return img.updateMask(img.gte(0).and(img.lt(1000)));})
  .median().clip(roi);

Map.addLayer(ntl2023,
             {min:0, max:30, palette:['black','purple','yellow','white']},
             'Luminosidad nocturna 2023 (VIIRS)');

var sar2023 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(roi).filterDate('2023-01-01','2023-12-31')
  .filter(ee.Filter.eq('instrumentMode','IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VH'))
  .select(['VV','VH']).median().clip(roi);

Map.addLayer(sar2023, {bands:['VV','VH','VV'], min:-20, max:0},
             'SAR 2023 (VV/VH/VV)', false);
Map.addLayer(grilla.style({fillColor:'00000000', color:'gray', width:0.3}), {}, 'Grilla 100m');

print('Script 04 v2 — VIIRS + SAR [ALINEADO CON MATRIZ]');
print('Variables: NTL_MEAN, SAR_MEAN, SAR_STD (+ VV y VH auxiliares)');
print('8 exportaciones CSV (2017–2024)');

ANIOS.forEach(function(year) {
  var n = ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(roi).filterDate(year+'-01-01',year+'-12-31')
    .filter(ee.Filter.eq('instrumentMode','IW')).size();
  print('SAR imágenes disponibles '+year+':', n);
});
