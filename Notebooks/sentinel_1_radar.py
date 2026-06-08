def get_s1_composite(year, aoi):
    return (ee.ImageCollection('COPERNICUS/S1_GRD')
        .filterBounds(aoi)
        .filterDate(f'{year}-01-01', f'{year}-12-31')
        .filter(ee.Filter.eq('instrumentMode', 'IW'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation','VH'))
        .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
        .select(['VV','VH'])
        .median()
        .clip(aoi))
 
s1_2017 = get_s1_composite(2017, aoi)
s1_2023 = get_s1_composite(2023, aoi)
 
export_to_drive(s1_2017, 'S1_SAR_2017_LimaNorte', aoi)
export_to_drive(s1_2023, 'S1_SAR_2023_LimaNorte', aoi)

