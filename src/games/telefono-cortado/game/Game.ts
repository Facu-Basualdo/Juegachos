import { LocalMockAdapter, MultiplayerAdapter } from "./GameAdapter";
import type { IGameAdapter } from "./Types";
import { initRoomMode, isRoomMode, type RoomMode } from "../../../shared/room/roomMode";
import { resolveGameServerUrl } from "../../../shared/server-status";
import { getNickname } from "../../../shared/nickname";

export class Game {
  private room: RoomMode | null = null;
  private app: HTMLElement;
  private adapter: IGameAdapter;
  private currentPhase: string = "text_phase";
  
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  
  private isDrawing = false;
  private currentColor = "#000000";
  private currentThickness = 3;
  private currentTool: "pencil" | "marker" | "eraser" | "circle" | "rect" | "fill" = "pencil";
  private startX = 0;
  private startY = 0;

  private phaseTimer: number | null = null;
  private remainingTime = 0;
  private phaseDuration = 60;
  private currentScore = 0;
  private currentGuessWord = "";
  private savedImageData: ImageData | null = null;
  
  constructor(app: HTMLElement) {
    this.app = app;
    
    const nickname = getNickname();
    const ownerId = nickname || "jugador_local";
    
    this.room = initRoomMode("telefono-cortado", {
      getScore: () => this.currentScore,
      onStart: () => {
        this.renderTextPhase();
      },
    });
    
    if (!this.room) {
      if (isRoomMode()) {
        this.app.innerHTML = `
          <div class="phase-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
            <h2>No disponible</h2>
            <p style="text-align: center; max-width: 400px; margin: 20px 0;">Teléfono Cortado necesita las credenciales de la sala y no están configuradas.</p>
          </div>
        `;
      } else {
        this.app.innerHTML = `
          <div class="phase-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
            <h2>Solo en salas</h2>
            <p style="text-align: center; max-width: 400px; margin: 20px 0;">Teléfono Cortado se juega con amigos en una sala. Creá o uníte a una para jugar.</p>
            <button class="action-button" onclick="window.location.href = '/rooms/'">Ir a las salas</button>
          </div>
        `;
      }
      this.adapter = new LocalMockAdapter(ownerId); // Dummy adapter to satisfy TS
      return;
    }

    const adapter = new MultiplayerAdapter(ownerId);
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get("room") || "";
    
    resolveGameServerUrl().then(serverUrl => {
      if (serverUrl) {
        adapter.connect(serverUrl, roomCode);
      }
    });
    
    this.adapter = adapter;
    this.app.innerHTML = `
      <div class="phase-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
        <h2>Teléfono Cortado</h2>
        <p style="text-align: center; margin: 20px 0;">Esperá a que empiece la partida...</p>
      </div>
    `;

    this.adapter.onPhaseChange((phase) => {
      if (this.currentPhase === "drawing_phase") {
        this.currentPhase = "guess_phase";
      } else {
        this.currentPhase = phase;
      }
      this.render();
    });

    this.startCountdown();
  }

  private startCountdown() {
    this.app.innerHTML = `<div class="countdown">Presiona ENTER para empezar</div>`;
    
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        window.removeEventListener("keydown", handler);
        this.runCountdown();
      }
    };
    window.addEventListener("keydown", handler);
  }

  private runCountdown() {
    let count = 3;
    this.app.innerHTML = `<div class="countdown">${count}</div>`;
    
    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        this.app.innerHTML = `<div class="countdown">${count}</div>`;
      } else if (count === 0) {
        this.app.innerHTML = `<div class="countdown">YA</div>`;
      } else {
        clearInterval(interval);
        this.currentPhase = "text_phase";
        this.render();
      }
    }, 1000);
  }

  private render() {
    this.app.innerHTML = "";
    this.startPhaseTimer();
    
    if (this.currentPhase === "text_phase") {
      this.renderTextPhase();
    } else if (this.currentPhase === "drawing_phase") {
      this.renderDrawingPhase();
    } else if (this.currentPhase === "guess_phase") {
      this.renderGuessPhase();
    }
  }

  private getTimerHTML() {
    return `
      <div class="timer-container">
        <div class="timer-bar" id="phase-timer-bar"></div>
        <div class="timer-text" id="phase-timer-text">${this.remainingTime}s</div>
      </div>
    `;
  }

  private startPhaseTimer() {
    if (this.phaseTimer) clearInterval(this.phaseTimer);
    
    if (this.currentPhase === "drawing_phase") this.phaseDuration = 120;
    else if (this.currentPhase === "guess_phase") this.phaseDuration = 30;
    else this.phaseDuration = 60;
    
    this.remainingTime = this.phaseDuration;
    
    this.phaseTimer = window.setInterval(() => {
      this.remainingTime--;
      
      const textEl = document.getElementById("phase-timer-text");
      const barEl = document.getElementById("phase-timer-bar");
      
      if (textEl) textEl.textContent = `${this.remainingTime}s`;
      if (barEl) {
        const pct = (this.remainingTime / this.phaseDuration) * 100;
        barEl.style.width = `${pct}%`;
        if (pct < 25) barEl.style.backgroundColor = "#ff3333";
      }
      
      if (this.remainingTime <= 0) {
        clearInterval(this.phaseTimer!);
        this.autoSubmit();
      }
    }, 1000);
  }

  private autoSubmit() {
    if (this.currentPhase === "text_phase") {
      const input = document.querySelector(".text-input") as HTMLInputElement;
      const text = input && input.value.trim() !== "" ? input.value : "Sin texto";
      this.adapter.submitStep({ type: "text", author: "LocalPlayer", content: text });
    } else if (this.currentPhase === "drawing_phase") {
      if (this.canvas) {
        this.adapter.submitStep({ type: "drawing", author: "LocalPlayer", content: this.canvas.toDataURL("image/png") });
      }
    } else if (this.currentPhase === "guess_phase") {
      this.finishGame(`Tiempo agotado. ¡El dibujo era "${this.currentGuessWord}"!`);
    }
  }

  private renderTextPhase() {
    const container = document.createElement("div");
    container.className = "phase-container";
    
    container.innerHTML += this.getTimerHTML();
    
    const title = document.createElement("h2");
    title.textContent = "Propón un tema para dibujar:";
    
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ejemplo: Un perro en bicicleta";
    input.className = "text-input";
    
    const btn = document.createElement("button");
    btn.textContent = "Enviar";
    btn.className = "action-button";
    btn.onclick = () => {
      if (input.value.trim() === "") return;
      if (this.phaseTimer) clearInterval(this.phaseTimer);
      this.adapter.submitStep({
        type: "text",
        author: "LocalPlayer",
        content: input.value
      });
    };
    
    container.appendChild(title);
    container.appendChild(input);
    container.appendChild(btn);
    this.app.appendChild(container);
    input.focus();
  }

  private renderDrawingPhase() {
    const container = document.createElement("div");
    container.className = "phase-container drawing-mode";
    
    const topBar = document.createElement("div");
    topBar.className = "top-bar";
    
    const title = document.createElement("h2");
    title.textContent = "Dibuja esto: ...";
    
    this.adapter.getChain("jugador_local").then(chain => {
      if (chain.steps.length > 0) {
        const lastStep = chain.steps[chain.steps.length - 1];
        if (lastStep.type === "text") {
          title.textContent = `Dibuja: "${lastStep.content}"`;
        }
      }
    });

    topBar.appendChild(title);
    topBar.innerHTML += this.getTimerHTML();

    const workspace = document.createElement("div");
    workspace.className = "workspace";

    const toolbox = document.createElement("div");
    toolbox.className = "toolbox";
    
    // Tools using SVGs instead of text (no emojis allowed)
    const pencilSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
    const markerSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><path d="m18 5-3-3H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2Z"></path><path d="M4 11h16"></path><path d="M12 11v11"></path></svg>`;
    const fillSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"></path><path d="m5 2 5 5"></path><path d="M2 13h15"></path><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"></path></svg>`;
    const circleSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><circle cx="12" cy="12" r="10"></circle></svg>`;
    const rectSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><rect width="18" height="18" x="3" y="3" rx="2"></rect></svg>`;
    const eraserSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"></path><path d="M22 21H7"></path><path d="m5 11 9 9"></path></svg>`;
    
    const tools = [
      { id: "pencil", icon: pencilSvg, title: "Lápiz" },
      { id: "marker", icon: markerSvg, title: "Marcador" },
      { id: "fill", icon: fillSvg, title: "Rellenar (Balde)" },
      { id: "circle", icon: circleSvg, title: "Círculo" },
      { id: "rect", icon: rectSvg, title: "Rectángulo" },
      { id: "eraser", icon: eraserSvg, title: "Goma" }
    ];
    
    tools.forEach(t => {
      const btn = document.createElement("button");
      btn.className = `tool-btn ${this.currentTool === t.id ? "active" : ""}`;
      btn.innerHTML = t.icon;
      btn.title = t.title;
      btn.onclick = () => {
        this.currentTool = t.id as any;
        document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      };
      toolbox.appendChild(btn);
    });

    const divider = document.createElement("div");
    divider.className = "toolbox-divider";
    toolbox.appendChild(divider);

    // Thickness using circles instead of text
    [2, 5, 10, 20].forEach(size => {
      const btn = document.createElement("button");
      btn.className = `tool-btn thickness-btn ${this.currentThickness === size ? "active" : ""}`;
      btn.title = `Grosor de linea`;
      
      const circle = document.createElement("div");
      circle.className = "thickness-circle";
      circle.style.width = `${size}px`;
      circle.style.height = `${size}px`;
      
      btn.appendChild(circle);
      
      btn.onclick = () => {
        this.currentThickness = size;
        document.querySelectorAll(".thickness-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      };
      toolbox.appendChild(btn);
    });

    const clearBtn = document.createElement("button");
    clearBtn.className = "tool-btn clear-btn";
    clearBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tool-icon"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
    clearBtn.title = "Borrar todo";
    clearBtn.onclick = () => {
      if (this.ctx && this.canvas) {
        this.ctx.fillStyle = "white";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    toolbox.appendChild(clearBtn);

    const canvasContainer = document.createElement("div");
    canvasContainer.className = "canvas-container";
    
    this.canvas = document.createElement("canvas");
    this.canvas.width = 800;
    this.canvas.height = 500;
    this.canvas.className = "drawing-canvas";
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (this.ctx) {
      this.ctx.fillStyle = "white";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.lineCap = "round";
      this.ctx.lineJoin = "round";
    }

    this.canvas.addEventListener("touchstart", (e) => this.startDrawing(e.touches[0] as any), {passive: false});
    this.canvas.addEventListener("touchmove", (e) => { e.preventDefault(); this.draw(e.touches[0] as any); }, {passive: false});
    this.canvas.addEventListener("touchend", () => this.stopDrawing());

    this.canvas.addEventListener("mousedown", (e) => this.startDrawing(e));
    this.canvas.addEventListener("mousemove", (e) => this.draw(e));
    window.addEventListener("mouseup", () => this.stopDrawing());
    this.canvas.addEventListener("mouseleave", () => this.stopDrawing());

    canvasContainer.appendChild(this.canvas);
    
    workspace.appendChild(toolbox);
    workspace.appendChild(canvasContainer);

    const palette = document.createElement("div");
    palette.className = "palette";
    const colors = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF8800", "#FF00FF", "#884400"];
    colors.forEach(color => {
      const cBtn = document.createElement("button");
      cBtn.className = `color-btn ${this.currentColor === color ? "active" : ""}`;
      cBtn.style.backgroundColor = color;
      cBtn.onclick = () => {
        this.currentColor = color;
        if (this.currentTool === "eraser") {
          this.currentTool = "pencil";
          document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
          toolbox.children[0].classList.add("active"); // select pencil
        }
        
        document.querySelectorAll(".color-btn").forEach(b => b.classList.remove("active"));
        cBtn.classList.add("active");
      };
      palette.appendChild(cBtn);
    });

    const submitBtn = document.createElement("button");
    submitBtn.textContent = "Terminar y Enviar";
    submitBtn.className = "action-button submit-drawing";
    submitBtn.onclick = () => {
      if (this.phaseTimer) clearInterval(this.phaseTimer);
      this.autoSubmit();
    };

    container.appendChild(topBar);
    container.appendChild(workspace);
    container.appendChild(palette);
    container.appendChild(submitBtn);
    this.app.appendChild(container);
  }

  private renderGuessPhase() {
    const container = document.createElement("div");
    container.className = "phase-container";
    
    const topBar = document.createElement("div");
    topBar.className = "top-bar";
    
    const title = document.createElement("h2");
    title.textContent = "¿Qué dibujaron aquí?";
    
    topBar.appendChild(title);
    topBar.innerHTML += this.getTimerHTML();

    const imgContainer = document.createElement("div");
    imgContainer.className = "canvas-container guess-image";
    const img = document.createElement("img");
    img.style.width = "100%";
    img.style.display = "block";

    const hintContainer = document.createElement("div");
    hintContainer.className = "hangman-hint";

    this.adapter.getChain("jugador_local").then(chain => {
      for (const step of chain.steps) {
        if (step.type === "text" && !this.currentGuessWord) {
          this.currentGuessWord = step.content;
        }
        if (step.type === "drawing") {
          img.src = step.content;
        }
      }
      
      // Construir pista estilo ahorcado interactiva
      const revealedIndices = new Set<number>();
      
      const updateHint = () => {
        let hintText = "";
        for (let i = 0; i < this.currentGuessWord.length; i++) {
          if (this.currentGuessWord[i] === " ") {
            hintText += "&nbsp;&nbsp;";
          } else if (revealedIndices.has(i)) {
            hintText += this.currentGuessWord[i].toUpperCase() + " ";
          } else {
            hintText += "_ ";
          }
        }
        hintContainer.innerHTML = hintText;
      };
      
      updateHint();
      
      // Revelar una letra al azar cada 10 segundos
      const revealInterval = setInterval(() => {
        if (this.currentPhase !== "guess_phase") {
          clearInterval(revealInterval);
          return;
        }
        
        const hiddenIndices: number[] = [];
        for (let i = 0; i < this.currentGuessWord.length; i++) {
          if (this.currentGuessWord[i] !== " " && !revealedIndices.has(i)) {
            hiddenIndices.push(i);
          }
        }
        
        // Dejar al menos 2 letras sin revelar
        if (hiddenIndices.length > 2) {
          const randomIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
          revealedIndices.add(randomIndex);
          updateHint();
        }
      }, 10000);
    });

    imgContainer.appendChild(img);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Adivina la palabra...";
    input.className = "text-input guess-input";
    
    const btn = document.createElement("button");
    btn.textContent = "Adivinar";
    btn.className = "action-button";
    
    btn.onclick = () => {
      if (input.value.trim().toLowerCase() === this.currentGuessWord.trim().toLowerCase()) {
        if (this.phaseTimer) clearInterval(this.phaseTimer);
        
        // Puntos basados en tiempo restante, minimo 1, maximo 5
        let pct = this.remainingTime / this.phaseDuration;
        let points = Math.ceil(pct * 5);
        if (points < 1) points = 1;
        if (points > 5) points = 5;
        
        this.currentScore = points;
        this.finishGame(`¡Correcto! Era "${this.currentGuessWord}". Puntos obtenidos: ${this.currentScore}`);
      } else {
        input.value = "";
        input.placeholder = "¡Incorrecto! Intenta de nuevo...";
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });

    container.appendChild(topBar);
    container.appendChild(hintContainer);
    container.appendChild(imgContainer);
    container.appendChild(input);
    container.appendChild(btn);
    this.app.appendChild(container);
    input.focus();
  }

  private finishGame(msg: string) {
    this.app.innerHTML = `
      <div class="phase-container">
        <h2>${msg}</h2>
        <div id="chain-results" style="display:flex; flex-wrap:wrap; gap:20px; justify-content:center; margin-top:20px; overflow-y:auto; max-height: 60vh;">
           <div>Cargando la galería de dibujos...</div>
        </div>
        <div style="font-size: 1.2rem; color: #ffcc00; margin: 20px 0;">La tabla de puntos multijugador calculará el total oficial.</div>
        <button class="action-button" onclick="location.reload()">Jugar otra vez (Local)</button>
      </div>
    `;

    const resultsContainer = document.getElementById("chain-results");
    
    // Suponiendo que recuperamos la cadena completa
    this.adapter.getChain("jugador_local").then(chain => {
      if (!resultsContainer) return;
      resultsContainer.innerHTML = "";
      
      let currentText = "Tema desconocido";
      
      if (chain.steps.length === 0) {
        resultsContainer.innerHTML = "<div>No hay dibujos para mostrar.</div>";
        return;
      }

      for (const step of chain.steps) {
        if (step.type === "text") {
          currentText = step.content;
        } else if (step.type === "drawing") {
          const card = document.createElement("div");
          card.style.background = "#fff";
          card.style.padding = "10px";
          card.style.borderRadius = "8px";
          card.style.color = "#000";
          card.style.display = "flex";
          card.style.flexDirection = "column";
          card.style.alignItems = "center";
          card.style.boxShadow = "0 4px 6px rgba(0,0,0,0.3)";
          
          const textEl = document.createElement("div");
          textEl.style.fontWeight = "bold";
          textEl.style.marginBottom = "10px";
          textEl.textContent = currentText;
          
          const img = document.createElement("img");
          img.src = step.content;
          img.style.width = "200px";
          img.style.height = "200px";
          img.style.border = "1px solid #ccc";
          img.style.backgroundColor = "#fff";
          
          const authorEl = document.createElement("div");
          authorEl.style.fontSize = "0.9rem";
          authorEl.style.marginTop = "5px";
          authorEl.style.color = "#666";
          authorEl.textContent = "Por: " + step.author;
          
          card.appendChild(textEl);
          card.appendChild(img);
          card.appendChild(authorEl);
          
          resultsContainer.appendChild(card);
        }
      }
    });
  }

  private startDrawing(e: MouseEvent | { clientX: number, clientY: number }) {
    if (!this.ctx || !this.canvas) return;
    this.isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this.startX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    this.startY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    
    if (this.currentTool === "fill") {
      this.isDrawing = false;
      this.floodFill(Math.floor(this.startX), Math.floor(this.startY), this.currentColor);
      return;
    }
    
    if (this.currentTool === "circle" || this.currentTool === "rect") {
      this.savedImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx.beginPath();
      this.ctx.moveTo(this.startX, this.startY);
    }
  }

  private draw(e: MouseEvent | { clientX: number, clientY: number }) {
    if (!this.isDrawing || !this.ctx || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    
    this.ctx.lineWidth = this.currentThickness;
    this.ctx.strokeStyle = this.currentTool === "eraser" ? "white" : this.currentColor;
    this.ctx.globalAlpha = this.currentTool === "marker" ? 0.3 : 1.0;
    
    if (this.currentTool === "circle" || this.currentTool === "rect") {
      if (this.savedImageData) this.ctx.putImageData(this.savedImageData, 0, 0);
      this.ctx.beginPath();
      
      const width = x - this.startX;
      const height = y - this.startY;
      if (this.currentTool === "rect") {
        this.ctx.strokeRect(this.startX, this.startY, width, height);
      } else {
        const radius = Math.sqrt(width * width + height * height);
        this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    } else {
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    }
  }

  private stopDrawing() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    if (this.ctx) {
      this.ctx.globalAlpha = 1.0;
      this.ctx.beginPath();
    }
  }

  private floodFill(startX: number, startY: number, fillColor: string) {
    if (!this.ctx || !this.canvas) return;
    
    const rFill = parseInt(fillColor.substring(1, 3), 16);
    const gFill = parseInt(fillColor.substring(3, 5), 16);
    const bFill = parseInt(fillColor.substring(5, 7), 16);
    const aFill = 255;
    
    const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imgData.data;
    
    const startPos = (startY * this.canvas.width + startX) * 4;
    const startR = data[startPos];
    const startG = data[startPos + 1];
    const startB = data[startPos + 2];
    const startA = data[startPos + 3];
    
    if (rFill === startR && gFill === startG && bFill === startB && aFill === startA) return;
    
    const width = this.canvas.width;
    const height = this.canvas.height;
    
    const toleranceSq = 10000; // Tolerancia de ~100 unidades de color
    const matchStartColor = (pos: number) => {
      const rDiff = data[pos] - startR;
      const gDiff = data[pos + 1] - startG;
      const bDiff = data[pos + 2] - startB;
      const aDiff = data[pos + 3] - startA;
      
      return (rDiff * rDiff + gDiff * gDiff + bDiff * bDiff + aDiff * aDiff) <= toleranceSq;
    };
    
    const colorPixel = (pos: number) => {
      data[pos] = rFill;
      data[pos + 1] = gFill;
      data[pos + 2] = bFill;
      data[pos + 3] = aFill;
    };
    
    const stack = [[startX, startY]];
    
    while (stack.length) {
      const [x, y] = stack.pop()!;
      let currentPos = (y * width + x) * 4;
      
      let currentY = y;
      while (currentY >= 0 && matchStartColor(currentPos)) {
        currentY--;
        currentPos -= width * 4;
      }
      
      currentPos += width * 4;
      currentY++;
      
      let reachLeft = false;
      let reachRight = false;
      
      while (currentY < height && matchStartColor(currentPos)) {
        colorPixel(currentPos);
        
        if (x > 0) {
          if (matchStartColor(currentPos - 4)) {
            if (!reachLeft) {
              stack.push([x - 1, currentY]);
              reachLeft = true;
            }
          } else if (reachLeft) {
            reachLeft = false;
          }
        }
        
        if (x < width - 1) {
          if (matchStartColor(currentPos + 4)) {
            if (!reachRight) {
              stack.push([x + 1, currentY]);
              reachRight = true;
            }
          } else if (reachRight) {
            reachRight = false;
          }
        }
        
        currentY++;
        currentPos += width * 4;
      }
    }
    
    this.ctx.putImageData(imgData, 0, 0);
  }
}
