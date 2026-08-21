/**
 * Palabras que pueden salir de SOLUCION. Es un subconjunto curado a mano del
 * diccionario de intentos (`words.ts`): esas ~11k incluyen conjugaciones y
 * rarezas ("abaje", "abalo", "abito") que como respuesta darian rondas
 * injugables. Cada palabra de aca es comun y adivinable, y esta garantizado que
 * tambien es un intento valido.
 *
 * Para sumar palabras: agregarlas aca y asegurarse de que existan en
 * `words.ts` (si no, serian imposibles de tipear).
 */

const RAW = `
  abajo abeja abono abril abrir acaso acero acido actor aguas agudo aguja
  ahora ajies aldea algas algun altar altos ambos amigo ancho ancla andar
  anden anexo angel animo antes anual apodo apuro arado araña arbol arena
  argot armar armas aroma arpon arroz asado asilo aspas astro atajo atlas
  atomo audio aulas autor autos avena avion aviso ayuda azote bahia baile
  bajos balde balsa banal banco banda bando barba barco barra barro basta
  batir bazar beber beige besos bicho bifes bingo birra bocas bodas bolas
  bolsa bolso bomba bondi bonos borde botes boton boxeo brasa bravo brazo
  breve brisa broma brote bruja bruma budin bueno buhos bulla bulon buque
  burla burro busto buzon cable cabos cabra cacao cafes caida cajas cajon
  caldo calle calma calor calvo camas campo canal canoa canto capas capaz
  caras carga carne caros carro carta casas casco casos caspa catre cauce
  cavar cazar caños cebra cedro cejas celda celos cenar cepas cerca cerdo
  cerro cesta cesto chala chapa chico chino chivo cholo choza ciego cielo
  cifra cinco cinta circo cisne citar claro clase clave clavo clima cobra
  cobre cocer cocos codos cofre cojin colas color comer comun conde copas
  copia coral coros corte corto cosas coser costa crack crear creer crema
  criar cruce crudo cruel cruza cubos cuero cueva culpa culto cuota curar
  curry curso curva cutis dados damas danza datil datos deber debil decir
  dedal dedos dejar delta demas denso deseo deuda dicho dieta digno diosa
  dique disco divan doble dolor domar donar dosis drama ducha dudar dudas
  duelo dueño dulce dunas duque duros ebrio edema elite enano encia enero
  enojo entre envio epoca error espia esqui estar etapa exito extra facil
  falda falso farol faros fauna favor fecha feliz feria ficha fideo fiera
  fijar filas filme final finca finos firma firme flaco flete flojo flora
  flota fluir focas focos folio fondo forma forro fosil fotos frase freno
  fresa fruta fruto fuego fuera fuero fugaz fumar furia galgo gallo gamba
  ganar ganso garra garza gasas gasto gatos gemas genio gente gesto girar
  globo golfo golpe gomas gordo gorra gozar grada grado grama grana grano
  grasa grato grave greda green grifo gripe grito grupo guiar guiso guita
  gusto habil hacer hacha hadas hasta hebra heces hecho helar herir heroe
  hielo hiena higos hijas hijos hilos himno hojas hondo hongo honor honra
  horas horno hotel hoyos hueso huevo humor humos huron hurto ideal ideas
  idolo igual indio islas jabon jamon jefes joven joyas juego jugar jugos
  julio junio junta junto jurar justo labio labor lagos lamer lanza lapiz
  largo larva lasca latas latir lavar lavas lazos leche lecho legal lejos
  lemas lento leona letra leves leyes libra libre libro licor lider ligar
  lilas limon lince lindo linea lisos listo litro llama llano llave lleno
  lobos local locos locro logro lomos loros losas lotes luces lucha luego
  lugar lujos lunas lunes lupas lutos macho madre magia magma magno malla
  malos manco manga mango manos manta mapas marca marco marea mares marte
  marzo masas matar mayor mecha media medio mejor melon menor menos mente
  mesas meses metal metas meter metro miedo mirar mitad mitos mixto modas
  modos mojar molde moler monje monos monte moral moras morir morro morsa
  mosca motor mover movil mucho mudar mudos muela mujer mulas mulos multa
  mundo muros museo musgo muslo mutuo nabos nacer nadar nadie nafta naipe
  nariz natal naval naves necio negar negro nieta nieto nieve nivel noble
  noche nomas norma norte notas novia novio nubes nudos nuera nuevo nunca
  oasis obeso ocaso ocios ocres ocupa odiar odios oeste oidos ojera oleos
  oliva ollas olmos ondas opaco opera opina orden oreja orina oruga osado
  ostra otoño otros ovalo oveja ovino oxido pacto padre pagar pagos pajas
  palas palco palma palos palta panal panes panza papas papel parar pared
  pares parir parra parte pasar pasas pases pasta pasto patio patos pauta
  pavos pecho pedal pedir pegar peine pelea pelos penal penas peras perla
  perro pesar pesca pesos pezon piano picar picos pieza pilar pilas pinar
  pinos pinta pinto pinza piojo pipas pique pisar pisos pista pitar pizza
  placa plaga plano plata plato playa plaza plazo pleno plomo pluma pobre
  podar poder podio poema polen pollo polos polvo pomos poner porte posar
  poste potes potro pozos prado presa preso prima primo prisa prosa pulga
  pulso pumas punta punto purga puros queja quema queso quien quiso quita
  rabia radio rajar ramas rampa ranas rango raros rasgo ratas raton ratos
  rayas rayos razon recto redes regar regla reina reino rejas relax reloj
  remos renta reses resto retos reyes rezar ricos riego rioja risas ritmo
  rival rizos riñon robar roble robos rocas rocio rodar rogar rojos rollo
  rompe ronda ropas rosas rotos rubia rubio rubro rueda rugir ruido rumbo
  rural rutas saber sabia sabio sable sabor sacar sacos sagaz salas salir
  salsa salto salud salvo sanar sanos santo sapos sauce savia secar secos
  sedas segun sello selva senda sepia serio sesos setas señal señor sidra
  siglo signo silbo silla sitio sobre socio sodas sofas sogas solar soles
  solos sonar sonda sopas sorbo sordo soñar suave subir sucio sudor suela
  suelo sueño sumar surco susto tabla tacos tacto tajos talar talco tallo
  talon tanga tango tanto tapas tapiz tapon tarde tarea tarro tarta taxis
  tazas tazon techo tejas tejer telas temas temer tempo tenaz tener tenis
  tenor tenue termo tesis texto tibio tigre timon tinta tinto tipos tirar
  tiras tiros titan tizon tocar todos toldo tomar tomos tonel tonos tonto
  topos torax toros torre torso torta total traer traje trama trapo trato
  trazo trepa tribu trigo trino tripa trono tropa trote trozo tubos tucan
  tumba tunel turbo turno ultra unico union untar urgir usado usual vacas
  vacio vagon vales valle valor vapor varas varon vasos vasto velas velos
  venas venda venir venta venus verbo verde verja verso viaje vicio vidas
  video viejo vigas vigor villa vinos viola virus visar visor vista vital
  vivir vivos vocal volar votar votos vuelo yacer yates yegua yerba yerno
  yogur yunta zafra zanja zarpa zonas zorra zorro zumba zurdo ñandu
`;

/** Soluciones sorteables (995 palabras). */
export const SOLUTIONS: readonly string[] = RAW.trim().split(/\s+/);
