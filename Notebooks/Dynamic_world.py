// 0. OBTENER DATOS POR LABEL POR MODA================================
// 1. ÁREA
// ================================
var region = ee.FeatureCollection(
  'projects/my-project-amaz-475816/assets/lima_norte'
).geometry();

Map.centerObject(region, 11);

// ================================
// 2. PERÍODO
// ================================
var START = '2023-01-01';
var END   = '2024-01-01';

// ================================
// 3. DYNAMIC WORLD
// ================================
var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(START, END);

// ================================
// 4. CLASIFICACIÓN
// ================================
// opción robusta para ruido climático
var label = dw.select('label')
  .mode()
  .clip(region);

// ================================
// 5. VISUALIZACIÓN
// ================================
var palette = [
  '419bdf', // water
  '397d49', // trees
  '88b053', // grass
  '7a87c6', // flooded vegetation
  'e49635', // crops
  'dfc35a', // shrub
  'c4281b', // built
  'a59b8f', // bare
  'b39fe1'  // snow
];

Map.addLayer(label, {min: 0, max: 8, palette: palette}, 'DW Lima Norte');

// Validación
print('Número de imágenes DW:', dw.size());

// ================================
// 6. EXPORTAR
// ================================
Export.image.toDrive({
  image: label,
  description: 'DW_LimaNorte_2023',
  folder: 'GEE_exports',
  fileNamePrefix: 'DW_LimaNorte_2023',
  region: region,
  scale: 10,
  maxPixels: 1e13
});





// 0. OBTENER DATOS ESPECIFICOS DE LABEL BUILT PROBABILIDAD================================
// 1. ÁREA
// ================================
var region = ee.FeatureCollection(
  'projects/my-project-amaz-475816/assets/lima_norte'
).geometry();
Map.centerObject(region, 11);

// ================================
// 2. PERÍODO
// ================================
var START = '2017-01-01';
var END   = '2018-01-01';

// ================================
// 3. DYNAMIC WORLD - BUILT
// ================================
var built = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(START, END)
  .select('built')
  .median()     //ajustar segun minimo, maximo, mean, median
  .clip(region);

// ================================
// 4. VALIDACIÓN
// ================================
print('Número de imágenes DW:', ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(START, END)
  .size()
);

// ================================
// 5. VISUALIZACIÓN
// ================================
Map.addLayer(built, {
  min: 0,
  max: 1,
  palette: ['ffffff', 'c4281b']
}, 'Built Lima Norte 2017');

// ================================
// 6. EXPORTAR
// ================================
Export.image.toDrive({
  image: built,
  description: 'DW_Built_LNmedian_2017',
  folder: 'GEE_exports',
  fileNamePrefix: 'DW_Built_LNmedian_2017',
  region: region,
  scale: 10,
  maxPixels: 1e13
});