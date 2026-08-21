#!/usr/bin/env node
/**
 * QA del briefing previo a la ronda en modo sala (2 navegadores).
 * Host crea la sala (playlist forzada a snake), guest se une, host arranca.
 * Ambos deben ver el briefing (titulo + descripcion + Controles + boton "Listo"
 * + contador de listos). Al marcar "Listo" los dos, el briefing debe cerrarse
 * antes del tope de 10s y arrancar el countdown.
 *
 * Uso: NODE_PATH=<npx pw>/node_modules node scripts/qa-briefing.mjs [--base URL] [--out DIR]
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// playwright vive en la cache de npx (no en node_modules del proyecto). ESM
// ignora NODE_PATH, asi que se resuelve por ruta absoluta con createRequire.
const require = createRequire(import.meta.url);
const pwPath = process.env.PW_PATH || "playwright";
const { chromium } = require(pwPath);

const args = { base: "http://localhost:5177", out: "artifacts/qa-briefing" };
for (let i = 2; i < process.argv.length; i++) {
  const v = process.argv[i];
  if (v === "--base") args.base = process.argv[++i];
  else if (v === "--out") args.out = process.argv[++i];
}

await mkdir(args.out, { recursive: true });
const browser = await chromium.launch();
const mkPage = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page._errors = [];
  page.on("console", (m) => m.type() === "error" && page._errors.push(`[${name}] ${m.text()}`));
  page.on("pageerror", (e) => page._errors.push(`[${name}] ${e}`));
  return page;
};

const host = await mkPage("host");
const guest = await mkPage("guest");
const shot = (page, name) => page.screenshot({ path: path.join(args.out, `${name}.png`) });
const fail = async (msg) => {
  await shot(host, "fail-host");
  await shot(guest, "fail-guest");
  console.error(`FAIL: ${msg}`);
  console.error([...host._errors, ...guest._errors].join("\n"));
  await browser.close();
  process.exit(1);
};

// ---- Host crea la sala (playlist vacia -> primer juego al azar) ----
await host.goto(`${args.base}/rooms/`, { waitUntil: "networkidle" });
await host.locator("input.input").first().fill("hostqa");
await host.locator('button:has-text("Crear sala")').click(); // home -> lobby directo
await host.locator(".lobby__code").waitFor({ timeout: 15000 });
const codeText = await host.locator(".lobby__code").textContent();
const code = codeText?.trim().match(/[A-Z0-9]{6}/)?.[0];
if (!code) await fail(`no pude leer el codigo de sala de "${codeText}"`);
console.log(`sala creada: ${code}`);

// ---- Guest se une ----
await guest.goto(`${args.base}/rooms/`, { waitUntil: "networkidle" });
await guest.locator("input.input").first().fill("guestqa");
await guest.locator("input.input--code").fill(code);
await guest.locator('button:has-text("Unirse")').click();
await guest.locator(".lobby__code").waitFor({ timeout: 15000 });
console.log("guest dentro del lobby");

// ---- Host arranca ----
const startBtn = host.locator('button:has-text("Empezar")');
await startBtn.waitFor({ state: "visible", timeout: 20000 });
await startBtn.click();

await host.waitForURL(/\/games\//, { timeout: 20000 });
await guest.waitForURL(/\/games\//, { timeout: 20000 });
const gameUrl = new URL(host.url()).pathname;
console.log(`ambos en el juego: ${gameUrl}`);

// ---- Briefing: ambos deben ver la tarjeta con controles + boton Listo ----
for (const [page, name] of [[host, "host"], [guest, "guest"]]) {
  try {
    await page.locator('.mg-room__controls-label:has-text("Controles")').waitFor({ timeout: 15000 });
    await page.locator('.mg-room__btn:has-text("Listo")').waitFor({ timeout: 5000 });
  } catch {
    await fail(`${name} no vio el briefing con controles + boton Listo`);
  }
}
const controlsText = await host.locator(".mg-room__controls-text").textContent();
const readyBefore = await host.locator(".mg-room__ready-count").textContent();
const timeText = await host.locator(".mg-room__time").textContent();
console.log(`briefing visible. controles="${controlsText}" listos="${readyBefore}" tope="${timeText}"`);
await shot(host, "01-briefing-host");
await shot(guest, "02-briefing-guest");

if (!controlsText || !controlsText.trim()) await fail("el briefing no muestra texto de controles");
if (!/0\/2/.test(readyBefore ?? "")) await fail(`contador de listos inesperado: "${readyBefore}"`);

// ---- Ambos marcan Listo: debe arrancar antes del tope de 10s ----
const t0 = Date.now();
await host.locator('.mg-room__btn:has-text("Listo")').click();
await host.locator('.mg-room__ready-count:has-text("1/2")').waitFor({ timeout: 8000 });
await shot(host, "03-host-listo");
await guest.locator('.mg-room__btn:has-text("Listo")').click();

// Con los dos listos el briefing se cierra (overlay oculto) y arranca el countdown.
await host.locator(".mg-room__box").waitFor({ state: "hidden", timeout: 8000 });
const elapsed = Date.now() - t0;
console.log(`briefing cerrado tras ${elapsed} ms de marcar Listo (tope era 10s)`);
await host.waitForTimeout(500);
await shot(host, "04-after-briefing-host");
await shot(guest, "05-after-briefing-guest");

if (elapsed > 9000) await fail(`el briefing no se adelanto al estar todos listos (${elapsed} ms)`);

const errors = [...host._errors, ...guest._errors];
const report = { code, game: gameUrl, controlsText, readyBefore, timeText, earlyStartMs: elapsed, errors };
await writeFile(path.join(args.out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(errors.length === 0 ? "TODO OK" : "OK con errores de consola (revisar)");
await browser.close();
