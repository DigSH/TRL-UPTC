/* Comprueba que la lógica de cálculo de la web coincide con la del Excel.
   Uso:  node tools/verify.js                                              */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
global.window = {};
new Function(fs.readFileSync(path.join(root, 'assets', 'data.js'), 'utf8')).call(global);
const DATA = global.window.TRL_DATA;

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FALLA'}  ${name}` + (ok ? '' : `\n         esperado ${JSON.stringify(expected)}\n         obtenido ${JSON.stringify(actual)}`));
}

const questions = DATA.sections.flatMap((s) => s.items);

// ── Cardinalidades tomadas de RESULTADOS!H27:H43 y H47:H59 ───────────────────
const perTrl = {};
questions.forEach((q) => { perTrl[q.trl] = (perTrl[q.trl] || 0) + 1; });
check('preguntas por nivel TRL (H27:H43)', perTrl, { 1: 5, 2: 5, 3: 9, 4: 8, 5: 8, 6: 12, 7: 7, 8: 11, 9: 8 });
check('preguntas por categoría (H47:H59)', DATA.sections.map((s) => s.items.length), [7, 10, 24, 4, 13, 4, 11]);
check('total de preguntas', questions.length, 73);
check('cada pregunta tiene actividad de plan', questions.filter((q) => !q.action).length, 0);
check('umbrales (Z5:AC5 vía J21)', DATA.thresholds, { 1: 0.79, 2: 0.79, 3: 0.6, 4: 0.6, 5: 0.7, 6: 0.6, 7: 0.7, 8: 0.7, 9: 0.7 });

// ── Réplica de RESULTADOS!J21 ────────────────────────────────────────────────
function trlFor(answers) {
  const yes = {}, total = {};
  for (let l = 1; l <= 9; l += 1) { yes[l] = 0; total[l] = 0; }
  questions.forEach((q) => { total[q.trl] += 1; if (answers[q.id] === 'yes') yes[q.trl] += 1; });
  for (let l = 9; l >= 1; l -= 1) if (yes[l] / total[l] > DATA.thresholds[l]) return l;
  return 0;
}
const answerAll = (value) => Object.fromEntries(questions.map((q) => [q.id, value]));
const answerUpTo = (max) => Object.fromEntries(questions.map((q) => [q.id, q.trl <= max ? 'yes' : 'no']));

check('sin responder → TRL 0', trlFor({}), 0);
check('todo "No" → TRL 0', trlFor(answerAll('no')), 0);
check('todo "Sí" → TRL 9', trlFor(answerAll('yes')), 9);
for (let max = 1; max <= 9; max += 1) {
  check(`"Sí" hasta TRL ${max} → TRL ${max}`, trlFor(answerUpTo(max)), max);
}

// Umbral estricto (>, no >=): 4/5 = 0,80 > 0,79 supera TRL 1; 3/5 = 0,60 no.
const trl1 = questions.filter((q) => q.trl === 1).map((q) => q.id);
const partial = (ids, n) => Object.fromEntries(ids.map((id, i) => [id, i < n ? 'yes' : 'no']));
check('TRL 1 con 4/5 "Sí" (80 % > 79 %) → 1', trlFor(partial(trl1, 4)), 1);
check('TRL 1 con 3/5 "Sí" (60 % ≤ 79 %) → 0', trlFor(partial(trl1, 3)), 0);

// Salto de niveles: el Excel devuelve el nivel más alto que supere su umbral,
// aunque los inferiores no lo hagan.
const soloTrl9 = Object.fromEntries(questions.map((q) => [q.id, q.trl === 9 ? 'yes' : 'no']));
check('solo TRL 9 respondido "Sí" → 9 (regla del Excel)', trlFor(soloTrl9), 9);

// ── Mínimo de actividades para superar cada umbral ───────────────────────────
// Réplica de buildRoadmap(): floor(umbral × total) + 1, con epsilon para que un
// producto exacto representado como 5,999… no exija una actividad de menos.
function needed(threshold, total) {
  return Math.min(total, Math.floor(threshold * total + 1e-9) + 1);
}
function bruteForce(threshold, total) {
  for (let yes = 0; yes <= total; yes += 1) if (yes / total > threshold) return yes;
  return total;
}

let mismatches = [];
for (let total = 1; total <= 40; total += 1) {
  [0.6, 0.7, 0.79].forEach((th) => {
    if (needed(th, total) !== bruteForce(th, total)) mismatches.push(`${th}×${total}`);
  });
}
check('mínimo necesario coincide con la búsqueda exhaustiva', mismatches, []);

const expected = { 1: 4, 2: 4, 3: 6, 4: 5, 5: 6, 6: 8, 7: 5, 8: 8, 9: 6 };
const real = {};
[1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((lvl) => {
  const total = questions.filter((q) => q.trl === lvl).length;
  real[lvl] = needed(DATA.thresholds[lvl], total);
});
check('actividades mínimas por nivel del instrumento', real, expected);

// Con el mínimo exacto de cada nivel se debe alcanzar el TRL 9.
const minimal = {};
[1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((lvl) => {
  questions.filter((q) => q.trl === lvl).forEach((q, i) => { minimal[q.id] = i < real[lvl] ? 'yes' : 'no'; });
});
check('respondiendo solo el mínimo de cada nivel → TRL 9', trlFor(minimal), 9);

// Una actividad menos en el nivel 9 lo deja sin consolidar.
const oneLess = Object.assign({}, minimal);
const trl9 = questions.filter((q) => q.trl === 9);
oneLess[trl9[real[9] - 1].id] = 'no';
check('una actividad menos en TRL 9 → TRL 8', trlFor(oneLess), 8);

console.log(failures ? `\n${failures} comprobación(es) fallida(s)` : '\nTodas las comprobaciones correctas');
process.exit(failures ? 1 : 0);
