import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
let bad = 0;

const timerText = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const visible = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    return el.getBoundingClientRect().height > 0;
  }, sel);

// ---------- Número Fugaz: vencer el tiempo = error = game over ----------
await page.goto("http://localhost:5173/games/number-memory/");
await page.waitForTimeout(600);
await page.keyboard.press("Enter"); // countdown + showing
await page.waitForSelector(".nm-timer.is-shown", { timeout: 15000 });
const nmStart = await timerText(".nm-timer__text");
await page.waitForTimeout(1500);
const nmMid = await timerText(".nm-timer__text");
// Sin urgencia todavía, y urgente cerca del final.
const nmUrgentEarly = await page.evaluate(() => !!document.querySelector(".nm-timer.is-urgent"));
await page.waitForTimeout(6200);
const nmUrgentLate = await page.evaluate(() => !!document.querySelector(".nm-timer.is-urgent"));
// Dejamos vencer el tope sin escribir nada. Ojo: al vencer, onWrong muestra el
// número correcto 1.5s (overTimer) ANTES de pasar a gameOver, así que hay que
// esperar más allá de los 10s del tope.
await page.waitForTimeout(4800);
const nmOver = await page.evaluate(() => /SE ESFUMÓ|RÉCORD/i.test(document.body.innerText));
const nmTimerGone = !(await visible(".nm-timer.is-shown"));

console.log("Número Fugaz:");
console.log(`  reloj arranca en ${nmStart}, a 1.5s marca ${nmMid}`);
console.log(`  urgente a los 1.5s: ${nmUrgentEarly} (esperado false) · a los 7.7s: ${nmUrgentLate} (esperado true)`);
console.log(`  al vencer -> game over: ${nmOver} · reloj oculto: ${nmTimerGone}`);
const nmOk = nmStart === "10s" && nmMid === "9s" && !nmUrgentEarly && nmUrgentLate && nmOver && nmTimerGone;
console.log(nmOk ? "  OK\n" : "  FALLO\n");
if (!nmOk) bad++;

// ---------- Cálculo Flash: vencer el tiempo = envía lo tipeado ----------
errs.length = 0;
await page.goto("http://localhost:5173/games/flash-math/");
await page.waitForTimeout(600);
await page.keyboard.press("Enter");
await page.waitForSelector(".fm-timer", { state: "visible", timeout: 20000 });
const fmStart = await timerText(".fm-timer__text");
// Tipeamos una respuesta parcial y dejamos vencer el tiempo: no debe descartarse.
await page.keyboard.press("7");
await page.waitForTimeout(11000);
const fmOverlay = await page.evaluate(() => !document.querySelector(".fm-overlay")?.classList.contains("hidden"));
console.log("Cálculo Flash:");
console.log(`  reloj arranca en ${fmStart}`);
console.log(`  al vencer se envió lo tipeado y cerró la partida: ${fmOverlay}`);
console.log(`  errores JS: ${errs.length}${errs[0] ? " -> " + errs[0] : ""}`);
const fmOk = fmStart === "10s" && fmOverlay && errs.length === 0;
console.log(fmOk ? "  OK\n" : "  FALLO\n");
if (!fmOk) bad++;

await browser.close();
process.exit(bad ? 1 : 0);
