dem = ee.Image('USGS/SRTMGL1_003').clip(aoi).rename('ELEV')
slope    = ee.Terrain.slope(dem).rename('SLOPE')
aspect   = ee.Terrain.aspect(dem).rename('ASPECT')
rugosidad = dem.reduceNeighborhood(
    reducer=ee.Reducer.stdDev(), kernel=ee.Kernel.square(1)
).rename('ROUGHNESS')
 
topo_stack = dem.addBands([slope, aspect, rugosidad])
export_to_drive(topo_stack, 'Topografia_SRTM_LimaNorte', aoi, scale=30)

