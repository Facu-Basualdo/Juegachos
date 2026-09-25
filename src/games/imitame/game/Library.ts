import { getNickname, setNickname } from "../../../shared/nickname";
import { resumeAudio } from "./audio";
import {
  MAX_CLIP_S,
  deleteClip,
  fetchClipIndex,
  loadClip,
  prepareClip,
  uploadClip,
  type ClipMeta,
} from "./clips";
import { playBuffer } from "./synth";

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

/**
 * La biblioteca de la comunidad: lo que muestra la pagina de Imitame fuera de una sala.
 * Se arrastran audios (o se eligen con un toque, que en el celular no hay arrastre) y se
 * suben solos, con el nombre del archivo. La lista de abajo los deja escuchar y borrar
 * los propios. Lo que esta aca entra al sorteo de las salas.
 */
export class Library {
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly dropEl: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly nameInput: HTMLInputElement;
  private clips: ClipMeta[] = [];

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "mt mt--library";
    wrap.innerHTML = `
      <div class="mt__lib">
        <div class="mt__lib-head">
          <div class="mt__kicker">Imitame</div>
          <h1 class="mt__title">Biblioteca de audios</h1>
          <p class="mt__sub">Lo que subas aca sale en las salas para que todos lo imiten.</p>
        </div>
        <label class="mt__lib-name">
          <span>Tu nombre</span>
          <input type="text" maxlength="12" autocomplete="off" spellcheck="false" />
        </label>
        <div class="mt__drop" tabindex="0" role="button">
          <strong>Arrastra audios aca</strong>
          <span>o toca para elegir. mp3, wav, ogg, m4a. Se corta a ${MAX_CLIP_S} segundos.</span>
          <input type="file" accept="audio/*" multiple hidden />
        </div>
        <div class="mt__lib-status" aria-live="polite"></div>
        <div class="mt__lib-list"></div>
        <a class="mt__msg-btn mt__lib-rooms" href="/rooms/">Jugar en una sala</a>
      </div>`;
    root.appendChild(wrap);

    this.listEl = wrap.querySelector(".mt__lib-list")!;
    this.statusEl = wrap.querySelector(".mt__lib-status")!;
    this.dropEl = wrap.querySelector(".mt__drop")!;
    this.fileInput = wrap.querySelector('input[type="file"]')!;
    this.nameInput = wrap.querySelector(".mt__lib-name input")!;
    this.nameInput.value = getNickname() ?? "";
    this.nameInput.addEventListener("change", () => {
      this.nameInput.value = setNickname(this.nameInput.value) ?? "";
      this.renderList();
    });

    this.bindDrop();
    this.listEl.addEventListener("click", (e) => this.onListClick(e));
    void this.refresh();
  }

  // ---------- Subida ----------

  private bindDrop(): void {
    const drop = this.dropEl;
    drop.addEventListener("click", () => this.fileInput.click());
    drop.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") this.fileInput.click();
    });
    this.fileInput.addEventListener("change", () => {
      if (this.fileInput.files) void this.upload([...this.fileInput.files]);
      this.fileInput.value = "";
    });
    // Se escucha en toda la ventana: soltar el archivo un poco afuera del recuadro no
    // tiene que abrirlo en la pestana (lo que hace el navegador por defecto).
    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    });
    window.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) drop.classList.remove("is-over");
    });
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length > 0) void this.upload(files);
    });
  }

  private async upload(files: File[]): Promise<void> {
    const uploader = setNickname(this.nameInput.value);
    if (!uploader) {
      this.setStatus("Pone tu nombre antes de subir.", "error");
      this.nameInput.focus();
      return;
    }
    this.nameInput.value = uploader;
    resumeAudio();
    const audio = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(f.name));
    if (audio.length === 0) {
      this.setStatus("Eso no parece un audio.", "error");
      return;
    }
    let ok = 0;
    const errors: string[] = [];
    for (const [i, file] of audio.entries()) {
      this.setStatus(`Subiendo ${i + 1} de ${audio.length}: ${file.name}`, "busy");
      try {
        const clip = await prepareClip(file);
        const meta = await uploadClip(clip, uploader);
        this.clips.unshift(meta);
        ok += 1;
        this.renderList(meta.id);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error && err.message.includes("decode") ? "no se pudo leer" : (err as Error).message}`);
      }
    }
    if (errors.length === 0) this.setStatus(ok === 1 ? "Listo, subido." : `Listo, ${ok} subidos.`, "ok");
    else this.setStatus(`Subidos ${ok}. Fallaron: ${errors.join(" / ")}`, "error");
  }

  // ---------- Lista ----------

  private async refresh(): Promise<void> {
    this.listEl.innerHTML = `<div class="mt__lib-empty">Cargando...</div>`;
    this.clips = await fetchClipIndex();
    this.renderList();
  }

  private renderList(fresh?: string): void {
    if (this.clips.length === 0) {
      this.listEl.innerHTML = `<div class="mt__lib-empty">Todavia no hay audios. Subi el primero.</div>`;
      return;
    }
    const me = getNickname();
    this.listEl.innerHTML = this.clips
      .map(
        (c) => `
        <div class="mt__clip${c.id === fresh ? " is-fresh" : ""}" data-id="${c.id}">
          <button class="mt__clip-play" type="button" data-act="play" aria-label="Escuchar ${esc(c.name)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="mt__clip-info">
            <span class="mt__clip-name">${esc(c.name)}</span>
            <span class="mt__clip-meta">${esc(c.uploader)} / ${c.duration.toFixed(1)}s</span>
          </div>
          ${c.uploader === me ? `<button class="mt__clip-del" type="button" data-act="del">Borrar</button>` : ""}
        </div>`,
      )
      .join("");
  }

  private async onListClick(e: MouseEvent): Promise<void> {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const row = btn?.closest<HTMLElement>(".mt__clip");
    if (!btn || !row?.dataset.id) return;
    const id = row.dataset.id;
    if (btn.dataset.act === "play") {
      resumeAudio();
      row.classList.add("is-playing");
      const clip = await loadClip(id);
      if (clip) {
        const dur = playBuffer(clip.buffer, 0.8);
        window.setTimeout(() => row.classList.remove("is-playing"), dur * 1000 + 100);
      } else {
        row.classList.remove("is-playing");
        this.setStatus("No se pudo bajar ese audio.", "error");
      }
      return;
    }
    if (btn.dataset.act === "del") {
      btn.disabled = true;
      if (await deleteClip(id)) {
        this.clips = this.clips.filter((c) => c.id !== id);
        this.renderList();
        this.setStatus("Borrado.", "ok");
      } else {
        btn.disabled = false;
        this.setStatus("No se pudo borrar (falta correr supabase/imitame.sql?).", "error");
      }
    }
  }

  private setStatus(text: string, kind: "ok" | "error" | "busy"): void {
    this.statusEl.textContent = text;
    this.statusEl.dataset.kind = kind;
  }
}
