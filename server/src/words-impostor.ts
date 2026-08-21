/**
 * Banco de palabras secretas de Impostor (namespace `/impostor`).
 *
 * A diferencia de Bomba/Cadena, el server NO usa el diccionario para esto: Impostor
 * necesita palabras concretas y adivinables agrupadas por categoria (la categoria se
 * le muestra a todos, incluido el impostor). Vive solo en el server (no pesa en el
 * bundle del front) y se edita a mano; requiere redeploy.
 *
 * Reglas del corpus: sustantivos comunes, concretos y conocidos en el Rio de la Plata,
 * faciles de describir con UNA palabra-pista. Nada muy tecnico ni ambiguo. La categoria
 * es una pista deliberada para el impostor, asi que las palabras dentro de una categoria
 * tienen que ser distinguibles entre si (que no alcance con decir la categoria).
 */

export interface WordCategory {
  /** Etiqueta visible a todos (incluye al impostor). */
  label: string;
  /** Palabras secretas posibles de esta categoria. */
  words: string[];
}

export const WORD_CATEGORIES: WordCategory[] = [
  {
    label: "Comida",
    words: [
      "milanesa",
      "asado",
      "empanada",
      "pizza",
      "hamburguesa",
      "helado",
      "chocolate",
      "sushi",
      "ensalada",
      "tarta",
      "locro",
      "choripan",
      "fideos",
      "tostada",
      "sandwich",
      "flan",
    ],
  },
  {
    label: "Animal",
    words: [
      "elefante",
      "jirafa",
      "pinguino",
      "tiburon",
      "cocodrilo",
      "canguro",
      "murcielago",
      "caballo",
      "tortuga",
      "aguila",
      "pulpo",
      "leon",
      "mono",
      "vaca",
      "conejo",
      "araña",
    ],
  },
  {
    label: "Lugar",
    words: [
      "playa",
      "hospital",
      "aeropuerto",
      "escuela",
      "cancha",
      "cine",
      "supermercado",
      "montaña",
      "desierto",
      "iglesia",
      "carcel",
      "biblioteca",
      "cementerio",
      "gimnasio",
      "estadio",
      "castillo",
    ],
  },
  {
    label: "Deporte",
    words: [
      "futbol",
      "tenis",
      "basquet",
      "boxeo",
      "natacion",
      "golf",
      "rugby",
      "ciclismo",
      "voley",
      "hockey",
      "esgrima",
      "surf",
      "karate",
      "atletismo",
      "handball",
    ],
  },
  {
    label: "Profesion",
    words: [
      "medico",
      "bombero",
      "policia",
      "cocinero",
      "maestro",
      "abogado",
      "piloto",
      "astronauta",
      "carpintero",
      "electricista",
      "peluquero",
      "veterinario",
      "cartero",
      "payaso",
      "arquitecto",
    ],
  },
  {
    label: "Objeto",
    words: [
      "paraguas",
      "martillo",
      "linterna",
      "almohada",
      "espejo",
      "reloj",
      "escoba",
      "telefono",
      "candado",
      "tijera",
      "mochila",
      "sombrilla",
      "brujula",
      "cepillo",
      "termo",
    ],
  },
  {
    label: "Transporte",
    words: [
      "bicicleta",
      "avion",
      "barco",
      "helicoptero",
      "tren",
      "colectivo",
      "moto",
      "camion",
      "submarino",
      "globo",
      "patineta",
      "ambulancia",
      "tractor",
      "cohete",
    ],
  },
  {
    label: "Instrumento",
    words: [
      "guitarra",
      "piano",
      "bateria",
      "trompeta",
      "violin",
      "flauta",
      "saxofon",
      "acordeon",
      "arpa",
      "tambor",
      "bandoneon",
      "maracas",
    ],
  },
  {
    label: "Ropa",
    words: [
      "campera",
      "bufanda",
      "zapatilla",
      "sombrero",
      "guante",
      "corbata",
      "pijama",
      "bikini",
      "poncho",
      "media",
      "cinturon",
      "gorra",
      "vestido",
    ],
  },
  {
    label: "Naturaleza",
    words: [
      "volcan",
      "cascada",
      "arcoiris",
      "tormenta",
      "glaciar",
      "bosque",
      "rio",
      "isla",
      "cueva",
      "relampago",
      "nieve",
      "terremoto",
      "estrella",
    ],
  },
];

/** Sortea una categoria y una palabra de ella. */
export function pickWord(exclude: Set<string> = new Set()): { category: string; word: string } {
  const cat = WORD_CATEGORIES[Math.floor(Math.random() * WORD_CATEGORIES.length)];
  const pool = cat.words.filter((w) => !exclude.has(w));
  const from = pool.length > 0 ? pool : cat.words;
  const word = from[Math.floor(Math.random() * from.length)];
  return { category: cat.label, word };
}

/** Total de palabras (para el health check). */
export function impostorWordCount(): number {
  return WORD_CATEGORIES.reduce((n, c) => n + c.words.length, 0);
}
