# Textury kůry

Fotografické textury z Poly Haven (https://polyhaven.com), licence CC0. Zmenšeno na 768 px; u některých upravena sytost a jas.

| Soubor | Zdroj na Poly Haven | Použito pro | Úprava |
| --- | --- | --- | --- |
| pine_* | pine_bark | borovice, modřín | – |
| oak_* | jolcham_oak_bark_01 | dub | – |
| birch_* | sakura_bark | bříza | odbarveno a zesvětleno (vodorovné čočinky) |
| beech_* | japanese_zelkova_bark | buk | odbarveno, zesvětleno |
| hornbeam_* | japanese_hackberry_bark | habr | odbarveno, zesvětleno |
| maple_* | trident_maple_bark | javor babyka | mírně zesvětleno |

`*_d.jpg` = barva, `*_n.jpg` = normálová mapa (OpenGL).

# Listy

`leaves.webp` je atlas složený skriptem `scripts/assets/leaf_atlas.py` z naskenovaných sad ambientCG (https://ambientcg.com), licence CC0.
Každý list je oříznutý na čepel, roztažený na políčko a barevně znormalizovaný (hra ho barví podle ročního období).

| Tvar ve hře | Druh | Sada ambientCG |
| --- | --- | --- |
| ovate | habr (a dělohy semenáčků) | LeafSet014 |
| beech | buk | LeafSet024 |
| lobed | dub | LeafSet016 |
| delta | bříza | LeafSet004 |
| palmate | javor babyka | LeafSet010 |

# Substrát

`soil_d.jpg` (barva), `soil_n.jpg` (normálová mapa, OpenGL) a `soil_h.jpg` (výšková mapa pro plastické zrno) jsou z Poly Haven, sada `brick_gravel` (drcená cihlová drť), licence CC0, zmenšeno na 768 px. Ve hře představuje zrnitý bonsajový substrát (akadama, láva).

# Mech

`moss_d.jpg` (barva), `moss_n.jpg` (normálová mapa, OpenGL) a `moss_h.jpg` (výšková mapa) jsou z ambientCG, sada `Moss002`, licence CC0, zmenšeno na 512 px.

# Plevel

3D modely z Poly Haven (https://polyhaven.com), licence CC0, rozlišení 1k: `dandelion_01` (pampeliška), `grass_medium_02` (trs trávy), `celandine_01` (orsej) a `nettle_plant` (mladá kopřiva). Skript `scripts/assets/weeds.py` z nich vybere lehké varianty (0,4–5,7 tisíce trojúhelníků; velké varianty s desítkami tisíc vynechá), převede je do centimetrů a uloží do `weedmesh.json` (geometrie v base64, popis v `src/weeds.json`). Barva listů je zmenšená na 512 px a průhlednost je odvozená z jasu, protože sken je na černém pozadí (`weed_<model>.webp`).

# Pozadí, desky stolu a sbírka

Vše z Poly Haven (https://polyhaven.com), licence CC0; připraví skript `scripts/assets/scenery.py`.

| Soubor | Zdroj na Poly Haven | Použito pro |
| --- | --- | --- |
| bg_garden.jpg | chinese_garden (HDRI, tonemapovaný JPG) | pozadí Čínská zahrada |
| bg_nursery.jpg | cloudy_netted_nursery (HDRI) | pozadí Školka pod stínovkou |
| bg_glasshouse.jpg | roof_garden (HDRI) | pozadí Zahrada pod sklem |
| bg_patio.jpg | qwantani_patio (HDRI) | pozadí Kryté patio |
| table_teak_* | teak_veneer | stůl Teak |
| table_mahogany_* | dark_wood | stůl Mahagon |
| table_walnut_* | wood_table_001 | stůl Ořech |
| table_bamboo_* | bamboo_veneer | stůl Bambus |
| table_oldwood_* | wood_table_worn | stůl Staré dřevo |
| table_tatami_* | tatami_mat | stůl Tatami |
| table_granite_* | granite_tile | stůl Žula |
| fence.jpg | hinoki_planks | plot za lavicí ve sbírce |
| bench.jpg | dark_wood | lavice ve sbírce |

Panoramata jsou zmenšená na 2048 × 1024 (equirect), textury stolu na 1024 px (barva) a 512 px (`_n` normálová mapa OpenGL, `_r` drsnost); `_t.jpg` jsou náhledy v nastavení.
