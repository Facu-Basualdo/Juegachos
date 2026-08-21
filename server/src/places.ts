/**
 * Topónimos: países, capitales, provincias argentinas y ciudades conocidas.
 *
 * El diccionario base (`an-array-of-spanish-words`) es un corpus de léxico común,
 * no una lista de lugares: aceptaba "chile" (el ají), "lima" (la fruta), "salta"
 * y "quito" (verbos), "parís" (voseo de parir) o "argentina" (adjetivo de plata),
 * pero rechazaba "méxico", "uruguay", "mendoza" o "madrid". Esa inconsistencia es
 * ilegible en la mesa: el jugador no tiene forma de saber por qué SALTA vale y
 * MENDOZA no. Esta lista la resuelve haciéndolos válidos a todos.
 *
 * Reglas de esta lista (las mismas de `extra-words.ts`):
 * - Se normalizan igual que el resto (minúscula, se sacan acentos de vocales y la
 *   diéresis, se conserva la ñ), así que se pueden escribir con o sin tilde.
 * - Los nombres compuestos se **concatenan** al normalizar ("buenos aires" ->
 *   "buenosaires"), así que el jugador los acierta escribiéndolos con o sin
 *   espacio. Cuando la forma corta también es de uso común ("el cairo" / "cairo")
 *   van las dos entradas.
 * - Nada de "ã" ni otras letras fuera de [a-zñ] con acentos no soportados: la
 *   normalización las borra y dejarían una palabra mutilada ("são paulo" ->
 *   "sopaulo"). Por eso van castellanizados: "sao paulo".
 * - Sumar palabras las hace VALIDAS como respuesta; no cambia qué fragmentos
 *   (sílabas) se ofrecen como reto en Bomba Palabra: eso depende de
 *   `MIN_WORDS_PER_FRAGMENT`, y una lista de este tamaño no llega al umbral.
 *
 * Tras editar, hay que **redeployar el server en Railway** para que tome los
 * cambios (el diccionario se arma al arrancar el proceso).
 */

/** Los 193 estados miembro de la ONU, en español. */
const PAISES: string[] = [
  // América
  "argentina", "bolivia", "brasil", "chile", "colombia", "costa rica", "cuba",
  "ecuador", "el salvador", "guatemala", "haiti", "honduras", "mexico",
  "nicaragua", "panama", "paraguay", "peru", "republica dominicana", "uruguay",
  "venezuela", "belice", "canada", "estados unidos", "jamaica", "bahamas",
  "barbados", "dominica", "granada", "guyana", "surinam", "trinidad y tobago",
  "antigua y barbuda", "santa lucia", "san cristobal y nieves",
  "san vicente y las granadinas",
  // Europa
  "albania", "alemania", "andorra", "armenia", "austria", "belgica",
  "bielorrusia", "bosnia y herzegovina", "bulgaria", "chipre", "croacia",
  "dinamarca", "eslovaquia", "eslovenia", "españa", "estonia", "finlandia",
  "francia", "grecia", "hungria", "irlanda", "islandia", "italia", "letonia",
  "liechtenstein", "lituania", "luxemburgo", "macedonia del norte", "malta",
  "moldavia", "monaco", "montenegro", "noruega", "paises bajos", "holanda",
  "polonia", "portugal", "reino unido", "republica checa", "rumania", "rusia",
  "san marino", "serbia", "suecia", "suiza", "ucrania", "vaticano",
  // Asia
  "afganistan", "arabia saudita", "azerbaiyan", "banglades", "barein", "brunei",
  "butan", "camboya", "catar", "china", "corea del norte", "corea del sur",
  "emiratos arabes unidos", "filipinas", "georgia", "india", "indonesia",
  "irak", "iran", "israel", "japon", "jordania", "kazajistan", "kirguistan",
  "kuwait", "laos", "libano", "malasia", "maldivas", "mongolia", "myanmar",
  "nepal", "oman", "pakistan", "palestina", "singapur", "siria", "sri lanka",
  "tailandia", "tayikistan", "timor oriental", "turkmenistan", "turquia",
  "uzbekistan", "vietnam", "yemen",
  // África
  "angola", "argelia", "benin", "botsuana", "burkina faso", "burundi",
  "cabo verde", "camerun", "chad", "comoras", "congo", "costa de marfil",
  "egipto", "eritrea", "esuatini", "etiopia", "gabon", "gambia", "ghana",
  "guinea", "guinea bisau", "guinea ecuatorial", "kenia", "lesoto", "liberia",
  "libia", "madagascar", "malaui", "mali", "marruecos", "mauricio",
  "mauritania", "mozambique", "namibia", "niger", "nigeria",
  "republica centroafricana", "ruanda", "santo tome y principe", "senegal",
  "seychelles", "sierra leona", "somalia", "sudafrica", "sudan",
  "sudan del sur", "tanzania", "togo", "tunez", "uganda", "yibuti", "zambia",
  "zimbabue",
  // Oceanía
  "australia", "fiyi", "islas marshall", "islas salomon", "kiribati",
  "micronesia", "nauru", "nueva zelanda", "palaos", "papua nueva guinea",
  "samoa", "tonga", "tuvalu", "vanuatu",
];

/**
 * Capitales. Se omiten las que ya figuran arriba con el mismo nombre que su país
 * (singapur, monaco, guatemala, tunez, kuwait): repetirlas no rompe nada — WORDS
 * es un Set — pero ensucia la lista.
 */
const CAPITALES: string[] = [
  // América
  "buenos aires", "sucre", "la paz", "brasilia", "santiago", "bogota", "quito",
  "san salvador", "puerto principe", "tegucigalpa",
  "ciudad de mexico", "managua", "asuncion", "lima", "santo domingo",
  "montevideo", "caracas", "san jose", "la habana", "habana", "belmopan",
  "otawa", "ottawa", "washington", "kingston", "nasau", "bridgetown",
  "roseau", "georgetown", "paramaribo", "castries", "kingstown",
  // Europa
  "tirana", "berlin", "erevan", "yerevan", "viena", "bruselas", "minsk", "sarajevo",
  "sofia", "nicosia", "zagreb", "copenhague", "bratislava", "liubliana",
  "madrid", "tallin", "helsinki", "paris", "atenas", "budapest", "dublin",
  "reikiavik", "roma", "riga", "vaduz", "vilna", "skopie", "la valeta",
  "chisinau", "podgorica", "oslo", "amsterdam", "la haya", "haya", "varsovia",
  "lisboa", "londres", "praga", "bucarest", "moscu", "belgrado", "estocolmo",
  "berna", "kiev", "tiflis",
  // Asia
  "kabul", "riad", "baku", "daca", "manama", "timbu", "phnom penh", "doha",
  "tokio", "dili", "pekin", "beijing", "pionyang", "seul", "abu dabi", "manila", "nueva delhi",
  "delhi", "yakarta", "bagdad", "teheran", "jerusalen", "aman", "astana",
  "biskek", "vientian", "beirut", "kuala lumpur", "male", "ulan bator",
  "naipyido", "katmandu", "mascate", "islamabad", "damasco", "colombo",
  "bangkok", "dusambe", "asjabad", "ankara", "taskent", "hanoi", "sana",
  // África
  "luanda", "argel", "portonovo", "gaborone", "uagadugu", "buyumbura", "praia",
  "yaunde", "yamena", "moroni", "brazzaville", "abiyan", "el cairo", "cairo",
  "asmara", "adis abeba", "libreville", "banjul", "acra", "conakri", "bisau",
  "malabo", "nairobi", "maseru", "monrovia", "tripoli", "antananarivo",
  "lilongue", "bamako", "rabat", "nuakchot", "maputo", "windhoek", "niamey",
  "abuya", "kigali", "santo tome", "dakar", "victoria", "freetown",
  "mogadiscio", "pretoria", "jartum", "mbabane", "dodoma", "lome",
  "kampala", "lusaka", "harare", "kinsasa",
  // Oceanía
  "canberra", "suva", "majuro", "honiara", "tarawa", "palikir",
  "wellington", "port moresby", "apia", "nukualofa", "funafuti", "port vila",
];

/** Provincias argentinas (más CABA) y las ciudades del país que se nombran solas. */
const ARGENTINA: string[] = [
  "catamarca", "chaco", "chubut", "cordoba", "corrientes", "entre rios",
  "formosa", "jujuy", "la pampa", "la rioja", "mendoza", "misiones", "neuquen",
  "rio negro", "salta", "san juan", "san luis", "santa cruz", "santa fe",
  "santiago del estero", "tierra del fuego", "tucuman",
  "rosario", "mar del plata", "la plata", "bahia blanca", "tandil",
  "bariloche", "ushuaia", "san rafael", "rafaela", "parana", "posadas",
  "resistencia", "junin", "pergamino", "olavarria", "necochea", "pinamar",
  "moron", "quilmes", "lanus", "avellaneda", "tigre", "escobar", "pilar",
  "lujan", "campana", "zarate", "azul", "chivilcoy", "concordia",
  "gualeguaychu", "goya", "obera", "eldorado", "clorinda", "oran", "tartagal",
  "cafayate", "humahuaca", "tilcara", "purmamarca", "chilecito", "malargue",
  "tunuyan", "esquel", "trelew", "puerto madryn", "rawson", "comodoro",
  "caleta olivia", "calafate", "rio gallegos", "rio grande", "viedma",
];

/** Ciudades grandes o muy conocidas del resto del mundo. */
const CIUDADES: string[] = [
  // Mundo hispano
  "barcelona", "sevilla", "valencia", "bilbao", "zaragoza", "malaga",
  "salamanca", "toledo", "cadiz", "murcia", "valladolid", "santander",
  "oviedo", "vigo", "pamplona", "alicante", "guadalajara", "monterrey",
  "puebla", "tijuana", "cancun", "acapulco", "medellin", "cali", "cartagena",
  "barranquilla", "guayaquil", "cuenca", "arequipa", "cusco", "trujillo",
  "valparaiso", "concepcion", "antofagasta", "iquique", "viña del mar",
  "punta del este", "maldonado", "salto", "rivera", "santa cruz de la sierra",
  "cochabamba", "oruro", "potosi", "ciudad del este", "encarnacion",
  "maracaibo", "barquisimeto", "san cristobal", "oporto", "coimbra",
  // Resto del mundo
  "nueva york", "los angeles", "chicago", "miami", "boston", "san francisco",
  "houston", "dallas", "seattle", "filadelfia", "detroit", "las vegas",
  "nueva orleans", "toronto", "montreal", "vancouver", "sao paulo",
  "rio de janeiro", "fortaleza", "recife", "curitiba", "porto alegre",
  "belo horizonte", "manaos", "milan", "napoles", "florencia", "venecia",
  "turin", "genova", "palermo", "bolonia", "verona", "pisa", "munich",
  "hamburgo", "frankfurt", "colonia", "dresde", "stuttgart", "marsella",
  "lyon", "niza", "burdeos", "toulouse", "estrasburgo", "liverpool",
  "manchester", "birmingham", "glasgow", "edimburgo", "rotterdam", "amberes",
  "gante", "brujas", "zurich", "ginebra", "basilea", "salzburgo", "cracovia",
  "gdansk", "san petersburgo", "kazan", "novosibirsk", "estambul", "esmirna",
  "alejandria", "casablanca", "marrakech", "fez", "tanger", "ciudad del cabo",
  "johannesburgo", "durban", "lagos", "shanghai", "canton", "hong kong",
  "shenzhen", "osaka", "kioto", "yokohama", "nagoya", "sapporo", "busan",
  "bombay", "mumbai", "calcuta", "bangalore", "karachi", "lahore", "dubai",
  "sidney", "melbourne", "brisbane", "perth", "adelaida", "auckland",
];

/** Todo junto, como lo consume `dictionary.ts`. */
export const PLACES: string[] = [...PAISES, ...CAPITALES, ...ARGENTINA, ...CIUDADES];
