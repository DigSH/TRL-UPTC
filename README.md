# Herramienta de diagnóstico TRL — UPTC

Versión web de la *Herramienta de estimación del grado de desarrollo de la tecnología (nivel TRL)*,
adaptada de las metodologías de la NASA, el Departamento de Defensa de EE. UU. y NYSERDA.

**➡️ https://digsh.github.io/TRL-UPTC/**

Es un sitio estático: no hay servidor, no hay base de datos y **ninguna respuesta sale del navegador**
de la persona que responde (se guardan en `localStorage`).

## Qué hace

- **Cuestionario de 73 preguntas** de sí/no repartidas en 7 categorías: General, Mercado, Desarrollo,
  Integración, Experimentación, Seguridad y Producción.
- **Cálculo automático del TRL** (1–9) y del nivel de desarrollo asociado
  (concepto · investigación · prototipo de laboratorio · prototipo industrial · producción).
- **Progreso por nivel TRL y por categoría**, con el umbral de cada nivel marcado sobre la barra.
- **Ruta de maduración hasta TRL 9**: recomendaciones generadas a partir de las preguntas respondidas
  con «No», agrupadas por nivel. Para cada nivel indica cuántas actividades faltan para superar su
  umbral y señala el **cuello de botella** —el nivel más bajo sin consolidar—, que es por donde debe
  empezar el trabajo. Esto importa porque el TRL se asigna al nivel más alto que supera su umbral: una
  tecnología puede figurar como TRL 7 y tener los niveles 4 y 5 sin consolidar.
- **Glosario** integrado: los términos definidos aparecen subrayados dentro de las preguntas.
- **Informe en PDF** (mediante la impresión del navegador) y **exportar/importar respuestas** en JSON
  para retomar el diagnóstico en otro equipo o archivarlo en el expediente de la tecnología.

## Cómo se calcula el TRL

Réplica exacta de la hoja `RESULTADOS` del libro original:

1. Cada pregunta está asociada a un nivel TRL (columna B de cada hoja del Excel).
2. Para cada nivel se calcula `% = respuestas "Sí" / total de preguntas del nivel`.
3. El TRL asignado es el nivel **más alto** cuyo porcentaje **supera** su umbral, evaluando de 9 hacia 1
   (fórmula `RESULTADOS!J21`). La comparación es estricta (`>`, no `>=`).

| Nivel TRL | Umbral | Preguntas |
|---|---|---|
| 1 y 2 | 79 % | 5 y 5 |
| 3 y 4 | 60 % | 9 y 8 |
| 5 | 70 % | 8 |
| 6 | 60 % | 12 |
| 7, 8 y 9 | 70 % | 7, 11 y 8 |

Las preguntas sin responder cuentan como «No», igual que en el Excel. Siguiendo la guía original:
si duda de una respuesta marque **No**; si la pregunta no aplica a su tecnología marque **Sí**.

Como el umbral es un porcentaje y la comparación es estricta, el mínimo de respuestas «Sí» de un nivel
es `floor(umbral × total) + 1`. La ruta de maduración usa ese mínimo para decir cuántas actividades
faltan en cada nivel; `tools/verify.js` lo contrasta contra una búsqueda exhaustiva.

## Estructura

```
index.html            Interfaz completa (una sola página, navegación por pestañas)
assets/styles.css     Estilos, tema claro/oscuro y hoja de impresión A4
assets/app.js         Estado, cálculo del TRL, ruta de maduración, import/export
assets/data.js        Datos generados desde el Excel — no editar a mano
assets/brand/         Originales institucionales tal como se entregaron
assets/img/           Recursos de marca listos para web — generados, no editar a mano
tools/build_data.py   Regenera assets/data.js a partir del libro .xlsm
tools/build_brand.py  Regenera assets/img/ a partir de assets/brand/
tools/verify.js       Comprueba que el cálculo coincide con las fórmulas del Excel
```

## Identidad gráfica

La paleta procede de los colores institucionales (azul petróleo `#0e2a32`, verdeazul `#1d6a6b` /
`#22808a`, dorado `#e4b11d`), y el degradado de la portada, del cabezote institucional.

Los contrastes están comprobados contra WCAG AA: el verdeazul da 6,31:1 sobre blanco. El dorado y el
verdeazul claro no alcanzan 4,5:1, por lo que solo se usan como relleno o sobre fondo oscuro.

La página no muestra logotipos. El informe en PDF sí va encabezado por el membrete de la Vicerrectoría
de Investigación y Extensión, para que funcione como documento oficial. Los másteres institucionales
se conservan en `assets/brand/` aunque no se publiquen.

## Desarrollo

No hay dependencias ni paso de compilación. Para verlo en local:

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

Si cambia el instrumento (nuevas preguntas, otros textos), edite el Excel y regenere los datos:

```bash
pip install openpyxl
python tools/build_data.py "ruta/Herramienta de diagnostico TRL.xlsm"
node tools/verify.js
```

`tools/verify.js` valida las cardinalidades por nivel y categoría (73 preguntas en total) y reproduce
la fórmula `J21` sobre casos límite. Debe pasar antes de publicar.

## Publicación

GitHub Pages sirve la rama `main` desde la raíz del repositorio
(*Settings → Pages → Source: Deploy from a branch → main / (root)*). Cada `push` actualiza el sitio.

## Créditos

Universidad Pedagógica y Tecnológica de Colombia — Dirección de Investigaciones, Oficina de
Transferencia de Resultados de Investigación (OTRI).
