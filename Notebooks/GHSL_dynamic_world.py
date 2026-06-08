ghsl_2015 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2015').select('built_surface').clip(aoi)
ghsl_2020 = ee.Image('JRC/GHSL/P2023A/GHS_BUILT_S/2020').select('built_surface').clip(aoi)
ghsl_pop  = (ee.ImageCollection('JRC/GHSL/P2023A/GHS_POP')
             .filter(ee.Filter.eq('year', 2020)).first().clip(aoi))
 
dw_2023 = (ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
             .filterBounds(aoi)
             .filterDate('2023-01-01','2023-12-31')
             .select('label').mode().clip(aoi))
 
viirs = (ee.ImageCollection('NOAA/VIIRS/DNB/MONTHLY_V1/VCMCFG')
          .filterBounds(aoi).filterDate('2022-01-01','2022-12-31')
          .select('avg_rad').mean().clip(aoi).rename('NTL'))
 
export_to_drive(ghsl_2015, 'GHSL_built_2015_LimaNorte', aoi, scale=100)
export_to_drive(ghsl_2020, 'GHSL_built_2020_LimaNorte', aoi, scale=100)
export_to_drive(ghsl_pop,  'GHSL_pop_2020_LimaNorte',   aoi, scale=100)
export_to_drive(dw_2023,   'DynamicWorld_2023_LimaNorte', aoi, scale=10)
export_to_drive(viirs,     'VIIRS_NTL_2022_LimaNorte',   aoi, scale=100)

