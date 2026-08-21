#!/usr/bin/env node
/**
 * QA end-to-end del modo salas de Rocket SpaceX con dos navegadores:
 * host crea la sala (playlist forzada a rocket-arena), guest se une,
 * ambos eligen equipo en la fase nueva y se verifica que el partido
 * arranque con los equipos elegidos. Requiere Supabase configurado (.env)
 * y el dev server corriendo.
 *
 * Uso: node scripts/qa-room-2p.mjs [--base URL] [--out DIR]
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = { base: "http://localhost:5177", out: "artifacts/qa-room-2p" };
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
  process.exit(1);
};

// ---- Host crea la sala con rocket-arena como primer juego ----
await host.goto(`${args.base}/rooms/`, { waitUntil: "networkidle" });
await host.locator("input.input").first().fill("hostqa");
await host.locator('button:has-text("Crear sala")').click();
await host.locator(".lobby__code").waitFor({ timeout: 15000 });
// La playlist se elige en el lobby (panel "Ajustes" del host).
await host.locator('.playlist__item[data-id="rocket-arena"]').click();
const codeText = await host.locator(".lobby__code").textContent();
const code = codeText?.trim().match(/[A-Z0-9]{6}/)?.[0];
if (!code) await fail(`no pude leer el código de sala de "${codeText}"`);
console.log(`sala creada: ${code}`);

// ---- Guest se une ----
await guest.goto(`${args.base}/rooms/`, { waitUntil: "networkidle" });
await guest.locator("input.input").first().fill("guestqa");
await guest.locator("input.input--code").fill(code);
await guest.locator('button:has-text("Unirse")').click();
await guest.locator(".lobby__code").waitFor({ timeout: 15000 });
console.log("guest dentro del lobby");

// ---- Host arranca la ronda ----
const startBtn = host.locator('button:has-text("Empezar")');
await startBtn.waitFor({ state: "visible", timeout: 20000 });
await startBtn.click();

// Ambos deben navegar al juego.
await host.waitForURL(/rocket-arena/, { timeout: 20000 });
await guest.waitForURL(/rocket-arena/, { timeout: 20000 });
console.log("ambos en el juego");

// ---- Fase de elección de equipos ----
for (const [page, name] of [[host, "host"], [guest, "guest"]]) {
  try {
    await page.locator('.overlay__title:has-text("ELEGÍ EQUIPO")').waitFor({ timeout: 15000 });
  } catch {
    await fail(`${name} no vio la fase de elección de equipo`);
  }
}
await shot(host, "01-teampick-host");

await host.locator(".team-btn.blue").click();
await guest.locator(".team-btn.orange").click();
// Los rosters deberían reflejar ambos picks en los dos clientes.
await host.locator('.team-btn.orange .team-btn__roster div:has-text("guestqa")').waitFor({ timeout: 8000 });
await guest.locator('.team-btn.blue .team-btn__roster div:has-text("hostqa")').waitFor({ timeout: 8000 });
await shot(host, "02-picked-host");
console.log("picks sincronizados entre clientes");

// Con todos elegidos el host cierra la fase: countdown y a jugar.
await host.locator('.match-note:has-text("EQUIPO AZUL")').waitFor({ timeout: 12000 });
await guest.locator('.match-note:has-text("EQUIPO NARANJA")').waitFor({ timeout: 12000 });
await host.waitForTimeout(4500); // countdown 3s + margen
await shot(host, "03-playing-host");
await shot(guest, "04-playing-guest");

// El reloj tiene que estar corriendo (partido activo) en ambos.
const t1 = await host.locator(".score-time").textContent();
await host.waitForTimeout(1500);
const t2 = await host.locator(".score-time").textContent();
if (t1 === t2) await fail(`el reloj del host no avanza (${t1})`);

const errors = [...host._errors, ...guest._errors];
const report = { code, hostTeam: "blue", guestTeam: "orange", clock: [t1, t2], errors };
await writeFile(path.join(args.out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(errors.length === 0 ? "TODO OK" : "OK con errores de consola (revisar)");
await browser.close();
