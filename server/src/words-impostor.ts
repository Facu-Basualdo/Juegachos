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
 *
 * Las dos categorias de futbolistas son la excepcion a "sustantivos comunes": son
 * nombres propios, escritos como se los nombra en la mesa ("Messi", "Dibu Martinez").
 * La lista de jugadores se armo tomando como referencia la base de futbolistas de
 * github.com/nsh1z/impostor (solo los nombres, que son datos publicos; no se copio ni
 * su codigo ni sus pistas) y se dejo afuera a los que no conoce cualquiera. Como a una
 * persona se la adivina por apodo o apellido, esas palabras tienen `ALIASES`, y la
 * adivinanza del impostor se valida con `isCorrectGuess`.
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
  {
    label: "Futbolista argentino",
    words: [
      "Maradona",
      "Messi",
      "Kempes",
      "Passarella",
      "Fillol",
      "Gatti",
      "Bochini",
      "Labruna",
      "Di Stefano",
      "Batistuta",
      "Caniggia",
      "Redondo",
      "Zanetti",
      "Simeone",
      "Ruggeri",
      "Burruchaga",
      "Goycochea",
      "Riquelme",
      "Palermo",
      "Gallardo",
      "Tevez",
      "Veron",
      "Ortega",
      "Aimar",
      "Saviola",
      "Mascherano",
      "Barros Schelotto",
      "Abbondanzieri",
      "Milito",
      "Higuain",
      "Aguero",
      "Lavezzi",
      "Benedetto",
      "Dibu Martinez",
      "Julian Alvarez",
      "Di Maria",
      "De Paul",
      "Enzo Fernandez",
      "Mac Allister",
      "Cuti Romero",
      "Otamendi",
      "Montiel",
      "Lautaro",
      "Paredes",
      "Tagliafico",
      "Dybala",
      "Mastantuono",
      "Scaloni",
      "Bilardo",
      "Menotti",
    ],
  },
  {
    label: "Futbolista del mundo",
    words: [
      "Pele",
      "Ronaldinho",
      "Romario",
      "Kaka",
      "Rivaldo",
      "Roberto Carlos",
      "Ronaldo Nazario",
      "Neymar",
      "Vinicius",
      "Cristiano Ronaldo",
      "Figo",
      "Zidane",
      "Mbappe",
      "Henry",
      "Platini",
      "Griezmann",
      "Benzema",
      "Cruyff",
      "Van Basten",
      "Robben",
      "Van Dijk",
      "Beckenbauer",
      "Klose",
      "Kroos",
      "Neuer",
      "Maldini",
      "Totti",
      "Pirlo",
      "Buffon",
      "Baggio",
      "Del Piero",
      "Iniesta",
      "Xavi",
      "Casillas",
      "Sergio Ramos",
      "Lamine Yamal",
      "Beckham",
      "Rooney",
      "Gerrard",
      "Harry Kane",
      "Bellingham",
      "Haaland",
      "Lewandowski",
      "Ibrahimovic",
      "Modric",
      "De Bruyne",
      "Salah",
      "Puskas",
      "Francescoli",
      "Suarez",
      "Forlan",
      "Cavani",
      "Chilavert",
      "Falcao",
      "James Rodriguez",
    ],
  },
];

/**
 * Otras formas validas de adivinar una palabra (apodos, nombre de pila, nombre
 * completo). Las claves son las palabras tal cual estan en las categorias.
 */
const ALIASES: Record<string, string[]> = {
  Maradona: ["diego", "el diego", "pelusa", "diego maradona"],
  Messi: ["leo", "lionel", "la pulga", "leo messi", "lionel messi"],
  Batistuta: ["batigol", "bati"],
  Caniggia: ["cani", "el pajaro"],
  Zanetti: ["pupi"],
  Simeone: ["cholo", "el cholo"],
  Riquelme: ["roman"],
  Palermo: ["el titan"],
  Gallardo: ["muneco", "el muneco"],
  Tevez: ["carlitos", "apache", "el apache"],
  Veron: ["brujita", "la brujita"],
  Ortega: ["burrito", "el burrito"],
  Aimar: ["payasito"],
  Saviola: ["conejito"],
  Mascherano: ["jefecito", "el jefecito"],
  "Barros Schelotto": ["mellizo", "guillermo"],
  Higuain: ["pipita"],
  Aguero: ["kun", "el kun"],
  Lavezzi: ["pocho", "el pocho"],
  "Dibu Martinez": ["dibu", "emiliano martinez"],
  "Julian Alvarez": ["julian", "la arana"],
  "Di Maria": ["fideo", "angelito"],
  "Enzo Fernandez": ["enzo"],
  "Mac Allister": ["alexis"],
  "Cuti Romero": ["cuti", "cristian romero"],
  Lautaro: ["lautaro martinez", "el toro"],
  Otamendi: ["ota"],
  Pele: ["o rei"],
  "Ronaldo Nazario": ["ronaldo", "el fenomeno", "r9"],
  "Cristiano Ronaldo": ["cristiano", "cr7"],
  Vinicius: ["vini"],
  Ibrahimovic: ["zlatan", "ibra"],
  Mbappe: ["kylian"],
  "Lamine Yamal": ["lamine", "yamal"],
  Suarez: ["luis suarez"],
  "James Rodriguez": ["james"],
  Chilavert: ["chila"],
};

/** Misma normalizacion que el sim: minuscula, sin acentos, solo letras y espacios. */
function norm(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .replace(/[^a-zñ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * La adivinanza del impostor acusado. Vale igual exacto, un alias, o un nombre mas
 * completo que contenga todas las palabras de la secreta ("lionel messi" por "Messi",
 * "angel di maria" por "Di Maria"). Con nombres de dos palabras vale tambien solo el
 * apellido ("ronaldo" por "Cristiano Ronaldo"): en la mesa se dice asi.
 */
export function isCorrectGuess(guess: string, word: string): boolean {
  const g = norm(guess);
  const w = norm(word);
  if (!g) return false;
  if (g === w) return true;
  if ((ALIASES[word] ?? []).some((a) => norm(a) === g)) return true;
  const gt = g.split(" ");
  const wt = w.split(" ");
  if (wt.every((t) => gt.includes(t))) return true;
  return wt.length > 1 && gt.length === 1 && gt[0] === wt[wt.length - 1];
}

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
