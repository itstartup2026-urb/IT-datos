import os
import time
import json
import requests
from datetime import datetime

# =========================================================
# CONFIGURACIÓN
# =========================================================

# Headers correctos (capturados de Overpass Turbo)
headers = {
    "Accept": "*/*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Origin": "https://overpass-turbo.eu",
    "Referer": "https://overpass-turbo.eu/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
}

# =========================================================
# DISTRITOS DE LIMA NORTE (con bounding boxes)
# =========================================================

# Coordenadas (sur, oeste, norte, este) para cada distrito
lima_norte = {
    "Ancón": {
        "slug": "ancon",
        "bbox": (-11.78, -77.18, -11.70, -77.12)
    },
    "Carabayllo": {
        "slug": "carabayllo",
        "bbox": (-11.88, -77.05, -11.80, -76.98)
    },
    "Comas": {
        "slug": "comas",
        "bbox": (-11.95, -77.08, -11.90, -77.02)
    },
    "Independencia": {
        "slug": "independencia",
        "bbox": (-11.99, -77.07, -11.96, -77.03)
    },
    "Los Olivos": {
        "slug": "los_olivos",
        "bbox": (-11.98, -77.10, -11.93, -77.05)
    },
    "Puente Piedra": {
        "slug": "puente_piedra",
        "bbox": (-11.88, -77.12, -11.82, -77.05)
    },
    "San Martín de Porres": {
        "slug": "smp",
        "bbox": (-12.02, -77.12, -11.97, -77.05)
    },
    "Santa Rosa": {
        "slug": "santa_rosa",
        "bbox": (-11.80, -77.20, -11.75, -77.15)
    }
}

# =========================================================
# TIPOS DE VÍAS A INCLUIR
# =========================================================

highway_types = [
    'motorway',
    'trunk',
    'primary',
    'secondary',
    'tertiary',
    'residential',
    'unclassified',
    'motorway_link',
    'trunk_link',
    'primary_link',
    'secondary_link',
    'tertiary_link',
    'living_street',
    'service'
]

# =========================================================
# CREAR CARPETAS
# =========================================================

# Estructura: output/red_vial/{distrito}/{año}/
base_path = "output_overpass_historical/red_vial"

for distrito in lima_norte.keys():
    distrito_path = os.path.join(base_path, distrito.lower().replace(" ", "_"))
    os.makedirs(distrito_path, exist_ok=True)

print("=" * 80)
print("DESCARGANDO REDES VIALES - LIMA NORTE (2015-2026)")
print("=" * 80)

# =========================================================
# FUNCIÓN PARA CONSULTAR OVERPASS API (CON REINTENTOS)
# =========================================================

def descargar_red_vial(distrito_nombre, bbox, año, slug, max_reintentos=5):
    """
    Descarga redes viales para un distrito y año específico
    Con reintentos automáticos para error 429 (rate limiting)
    """
    
    # Construir consulta Overpass QL
    query = f"""[out:json][date:"{año}-01-01T00:00:00Z"];
way["highway"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});
out geom;
"""
    
    for intento in range(1, max_reintentos + 1):
        try:
            response = requests.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                headers=headers,
                timeout=120
            )
            
            # Éxito (200)
            if response.status_code == 200:
                data = response.json()
                elements = data.get('elements', [])
                
                # Filtrar solo ways con highway
                ways = [e for e in elements if e.get('type') == 'way' and 'highway' in e.get('tags', {})]
                
                if ways:
                    # Convertir a GeoJSON
                    features = []
                    for way in ways:
                        if 'geometry' not in way:
                            continue
                        
                        # Construir geometría LineString
                        coords = []
                        for point in way.get('geometry', []):
                            if 'lon' in point and 'lat' in point:
                                coords.append([point['lon'], point['lat']])
                        
                        if len(coords) < 2:
                            continue
                        
                        tags = way.get('tags', {})
                        
                        feature = {
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coords
                            },
                            "properties": {
                                "id": way['id'],
                                "highway": tags.get('highway', 'unknown'),
                                "name": tags.get('name', ''),
                                "ref": tags.get('ref', ''),
                                "maxspeed": tags.get('maxspeed', ''),
                                "lanes": tags.get('lanes', ''),
                                "surface": tags.get('surface', ''),
                                "oneway": tags.get('oneway', ''),
                                "bridge": tags.get('bridge', ''),
                                "tunnel": tags.get('tunnel', ''),
                                "lit": tags.get('lit', ''),
                                "width": tags.get('width', '')
                            }
                        }
                        features.append(feature)
                    
                    # Crear GeoJSON completo
                    geojson = {
                        "type": "FeatureCollection",
                        "name": f"red_vial_{slug}_{año}",
                        "description": f"Red vial de {distrito_nombre} - {año}",
                        "generator": "Overpass API",
                        "timestamp": datetime.now().isoformat(),
                        "features": features
                    }
                    
                    # Guardar archivo
                    filename = os.path.join(base_path, distrito_nombre.lower().replace(" ", "_"), f"red_vial_{año}.geojson")
                    with open(filename, 'w', encoding='utf-8') as f:
                        json.dump(geojson, f, ensure_ascii=False, indent=2)
                    
                    return len(features)
                else:
                    return 0
            
            # Error 429 (Rate limiting) - Reintentar
            elif (response.status_code == 429) or (response.status_code == 504):
                tiempo_espera = min(2 ** intento, 60)  # 2, 4, 8, 16, 32, 60 segundos
                print(f"⏳ 429 (intento {intento}/{max_reintentos}), esperando {tiempo_espera}s...", end=" ", flush=True)
                time.sleep(tiempo_espera)
                continue
            
            # Otros errores HTTP
            else:
                print(f"Error HTTP {response.status_code}")
                return -1
                
        except Exception as e:
            print(f"Excepción (intento {intento}): {str(e)[:50]}", end=" ", flush=True)
            tiempo_espera = min(2 ** intento, 30)
            time.sleep(tiempo_espera)
            continue
    
    # Si llegamos aquí, todos los reintentos fallaron
    print(f"❌ Falló después de {max_reintentos} reintentos")
    return -1

# =========================================================
# PROCESAMIENTO PRINCIPAL
# =========================================================

# Estadísticas
resultados = {
    "distritos": {},
    "total_descargas": 0,
    "total_vias": 0
}

# Años a procesar (2015 a 2026)
años = list(range(2015, 2027))

print(f"\n📅 Años a procesar: {años}")
print(f"📍 Distritos: {len(lima_norte)}")
print(f"📊 Total de consultas: {len(lima_norte) * len(años)}")
print("=" * 80)

for distrito_nombre, distrito_info in lima_norte.items():
    
    slug = distrito_info['slug']
    bbox = distrito_info['bbox']
    
    print(f"\n{'=' * 60}")
    print(f"📍 PROCESANDO: {distrito_nombre}")
    print(f"   BBox: {bbox}")
    print(f"{'=' * 60}")
    
    resultados["distritos"][distrito_nombre] = {
        "slug": slug,
        "años": {}
    }
    
    for año in años:
        print(f"  📅 {año}...", end=" ", flush=True)
        
        # Descargar datos (con reintentos automáticos)
        num_vias = descargar_red_vial(distrito_nombre, bbox, año, slug)
        
        if num_vias >= 0:
            if num_vias > 0:
                print(f"✅ {num_vias} vías")
                resultados["distritos"][distrito_nombre]["años"][año] = num_vias
                resultados["total_vias"] += num_vias
                resultados["total_descargas"] += 1
            else:
                print(f"⚠️ Sin datos")
                resultados["distritos"][distrito_nombre]["años"][año] = 0
        else:
            print(f"❌ Error")
            resultados["distritos"][distrito_nombre]["años"][año] = -1
        
        # Pausa para no saturar el servidor
        time.sleep(2)
    
    # Pausa entre distritos
    print(f"\n  ⏳ Pausa entre distritos...")
    time.sleep(5)

# =========================================================
# REPORTE FINAL
# =========================================================

print("\n" + "=" * 80)
print("📊 REPORTE FINAL")
print("=" * 80)

for distrito_nombre, stats in resultados["distritos"].items():
    print(f"\n📌 {distrito_nombre}:")
    vias_por_año = []
    for año in años:
        vias = stats["años"].get(año, 0)
        if vias >= 0:
            vias_por_año.append(vias)
            print(f"     {año}: {vias:>6,} vías")
        else:
            print(f"     {año}: ERROR")
    
    if vias_por_año:
        print(f"     {'─' * 30}")
        print(f"     Promedio: {sum(vias_por_año)//len(vias_por_año):,} vías")

print("\n" + "=" * 80)
print("📈 RESUMEN GENERAL")
print("=" * 80)
print(f"✅ Descargas exitosas: {resultados['total_descargas']}/{len(lima_norte) * len(años)}")
print(f"🛣️  Total de vías descargadas: {resultados['total_vias']:,}")
print(f"📁 Archivos guardados en: {base_path}")
print("=" * 80)

# =========================================================
# GUARDAR REPORTE JSON
# =========================================================

with open(os.path.join(base_path, "reporte_descarga.json"), 'w', encoding='utf-8') as f:
    json.dump(resultados, f, ensure_ascii=False, indent=2)

print("\n✅ PROCESO COMPLETADO!")
print(f"📄 Reporte guardado en: {base_path}/reporte_descarga.json")