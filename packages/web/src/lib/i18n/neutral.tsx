import type { ReactNode } from "react";
import type { Dictionary } from "./es";

const SOMEONE = "alguien";

/** Capitalizes the stand-in where it starts a sentence, and leaves a member's name as they wrote it (spec, 9.3). */
const sentenceStart = (who: string) => (who === SOMEONE ? "Alguien" : who);

/**
 * Everything the web says in the neutral Spanish of Latin America, the one a fund of Mexico speaks (Country.spanish),
 * written sentence by sentence from the Rioplatense one: tú instead of vos, "dinero" instead of "plata", and none of
 * Argentina's words. What changes by country (the bank account, the token, the clock) comes in as a value, from
 * COUNTRIES. Ripio's buttons keep the names the ramp and its app show ("Vender con Ripio", "Depositar").
 */
export const neutral: Dictionary = {
  locale: "es",
  meta: {
    description: "El dinero del grupo, sin tesorero.",
    publicDescription: (fund: string) => `${fund}, en vivo: lo que hay en el fondo, quién pagó la cuota y lo que hizo el agente.`,
    invitationTitle: (fund: string) => `Te invitaron a ${fund}`,
    invitationDescription: "Únete al fondo del grupo en TesorerIA.",
  },
  language: {
    label: "Idioma",
  },
  common: {
    you: " (tú)",
    confirm: "Confirma con tu huella, tu cara o el PIN",
    sending: "Enviando…",
    member: (n: number) => `Miembro ${n}`,
  },
  errors: {
    logIn: "Entra con tu passkey.",
    fundNotFound: "No encontramos ese fondo.",
    badRequest: "Faltan datos o no son válidos.",
    failed: "Algo falló. Inténtalo de nuevo.",
    onItsWay: "Tu operación está en camino. En unos minutos la vas a ver reflejada: no la envíes de nuevo.",
    cancelled: "Cancelaste la confirmación. Inténtalo de nuevo.",
    generic: "No se pudo completar. Inténtalo de nuevo en un rato.",
    noPasskey: "No se pudo entrar. Si no te aparece tu passkey, intenta desde el teléfono donde creaste tu cuenta.",
    wrongPasskey: "Tu passkey no coincide con tu cuenta. Entra de nuevo.",
    notCompleted: "La operación no se pudo completar. No se movió dinero.",
    accountSponsorCap: "Tu cuenta llegó al tope de operaciones que paga TesorerIA este mes. No se movió dinero. Escríbenos y lo desbloqueamos.",
    sponsorCap: "TesorerIA llegó al tope de operaciones que paga este mes. No se movió dinero. Escríbenos y lo desbloqueamos.",
    amountFormat: (whole: string, cents: string) => `Escríbelo como ${whole} o ${cents}.`,
    amountTooBig: (max: string) => `No puede pasar de ${max}.`,
    notInAFund: "No estás en ningún fondo.",
    agentJustRan: "El agente acaba de correr.",
    notYourDraft: "Ese borrador no es tuyo.",
  },
  checks: {
    personName: "Escribe tu nombre, de hasta 30 letras.",
    personEmail: "Ese correo no parece válido.",
    fundName: "Escribe un nombre para el fondo, de hasta 40 letras.",
    agreedExpense: "Escribe cuál es el gasto acordado, de hasta 40 letras.",
    feeZero: "La cuota tiene que ser mayor que cero.",
    capZero: "El tope tiene que ser mayor que cero.",
    feeTooBig: (max: string) => `La cuota no puede pasar de ${max}.`,
    capTooBig: (max: string) => `El tope no puede pasar de ${max}.`,
    capAboveFundCap: (cap: string) => `El tope semanal no puede superar el tope del fondo, de ${cap}.`,
    feeUnreadable: (whole: string, cents: string) => `No entendimos la cuota. Escríbela como ${whole} o ${cents}.`,
    capUnreadable: (whole: string, cents: string) => `No entendimos el tope. Escríbelo como ${whole} o ${cents}.`,
  },
  funds: {
    badInvite: "Ese enlace de invitación no es válido.",
    alreadyMember: "Ya eres parte de este fondo.",
    liveFull: "El fondo ya tiene 10 miembros, que es el máximo.",
    manyRequests: "Ya hay muchas solicitudes para unirse a este fondo. Inténtalo en unos días.",
    alreadyCreated: "El fondo ya está creado.",
    onlyCreator: "Solo quien armó el fondo puede crearlo.",
    beingCreated: "El fondo se está creando en este momento. Inténtalo en un rato.",
    unconfirmed: "La operación todavía no se ha confirmado. Inténtalo en un rato.",
    full: "El fondo ya tiene 10 personas, que es el máximo.",
    mismatch: "Ya se creó un fondo desde tu cuenta, pero con otros datos. No lo crees de nuevo: tendrías dos.",
    accountCap: (max: number) => `Tu cuenta ya usó los ${max} intentos de crear un fondo que paga TesorerIA. Escríbenos y lo desbloqueamos.`,
    dayCap: "Hoy ya se crearon muchos fondos en TesorerIA. Inténtalo de nuevo mañana.",
    tooFewMembers: "Hacen falta al menos 3 personas para crear el fondo.",
    tooManyMembers: (max: number, n: number) => `Un fondo puede tener hasta ${max} personas, y este tiene ${n}.`,
    votesRange: (n: number) => `Con ${n} personas, los votos necesarios van de 2 a ${n - 1}.`,
    votesLocked: (votes: number) => `Ya empezaste a crear el fondo con ${votes} votos necesarios: elige ${votes} para continuar.`,
    createFirst: "Primero hay que crear el fondo.",
    notInOperation: "No encontramos el fondo en esa operación.",
  },
  auth: {
    late: "Pasó demasiado tiempo. Inténtalo de nuevo.",
    badPasskey: "No pudimos crear tu passkey. Inténtalo de nuevo.",
    taken: "Esa passkey ya tiene una cuenta. Entra con ella.",
    unknownPasskey: "No pudimos reconocer tu passkey.",
  },
  expenses: {
    amountUnreadable: "No entendimos el monto.",
    amountZero: "El monto tiene que ser mayor que cero.",
    amountTooBig: (max: string) => `El monto no puede pasar de ${max}.`,
    noteTooLong: (max: number) => `La nota puede tener hasta ${max} letras.`,
  },
  home: {
    title: "El dinero del grupo, sin tesorero.",
    lead: "Un fondo en pesos para tu grupo, que administra un agente con límites que nadie puede cambiar solo.",
    create: "Crear un fondo",
    seeReal: "Ver un fondo real",
    logIn: "Entrar",
    haveFund: "Ya tengo un fondo: entrar",
    live: (name: ReactNode) => <>{name}, en vivo.</>,
    howItWorks: "Cómo funciona",
    steps: (hasDollar: boolean) => [
      "Armas el fondo e invitas a tus amigos con un enlace.",
      hasDollar
        ? "Cada uno aporta su cuota semanal, en pesos desde Ripio o en USDT desde cualquier exchange."
        : "Cada uno aporta su cuota semanal, en pesos desde Ripio.",
      "El agente devuelve lo acordado, lleva la cuenta de quién debe, y lo demás se vota.",
    ],
    rules: {
      title: "Qué hace el agente por su cuenta y qué se vota",
      alone: (expense: string, cap: ReactNode) => (
        <>
          Por su cuenta, el agente convierte a pesos los USDT que entran y devuelve {expense} hasta {cap} por semana, siempre a un miembro.
        </>
      ),
      vote: (fund: string, votes: number, members: number) =>
        `Todo lo demás se vota: otro pago, agregar o sacar a alguien, cambiar el tope o el agente, cerrar el fondo. En ${fund} hacen falta ${votes} de ${members} votos.`,
      money: (contract: ReactNode) => <>El dinero está en {contract}, no en una cuenta nuestra, y nadie puede cambiar estas reglas solo.</>,
      contractLink: "el contrato del propio fondo",
      leaving:
        "Si te vas, el grupo vota tu salida y te llevas tu parte de lo que hay en el fondo, en proporción a lo que aportaste. Si se cierra, se reparte todo de la misma forma entre los que quedan.",
    },
    judges: (celo: ReactNode, contracts: ReactNode, agent: ReactNode, code: ReactNode) => (
      <>
        Corre en {celo}, con {contracts}, {agent} y {code}.
      </>
    ),
    judgesLinks: {
      celo: "Celo mainnet",
      contracts: (v1: ReactNode, v2: ReactNode) => (
        <>
          las FundFactory verificadas ({v1} y {v2})
        </>
      ),
      agent: "el agente registrado en ERC-8004 (#9887)",
      code: "el código abierto",
    },
  },
  notFound: {
    title: "No encontramos esa página",
    body: "Puede que el enlace esté mal o que no seas parte de este fondo.",
    home: "Ir al inicio",
  },
  login: {
    title: "Entra a tu fondo",
    lead: "Usa la passkey que creaste cuando te uniste. Tu teléfono te la va a pedir.",
    firstTime: (create: ReactNode) => <>¿Es tu primera vez? Entra con el enlace de invitación que te enviaron, o {create}.</>,
    createLink: "crea un fondo",
    button: "Entrar con mi passkey",
    logOut: "Salir",
    loggingOut: "Saliendo…",
  },
  keyChange: {
    title: "Actualiza tu passkey",
    lead: "TesorerIA se mudó a tesoreria.finance. Crea una passkey para el dominio nuevo: tu cuenta, tu dinero y tus fondos no cambian.",
    twice: "Tu teléfono te va a pedir la cara o la huella dos veces: una para crear la passkey nueva y otra para confirmar el cambio con la de siempre.",
    button: "Actualizar mi passkey",
    resume: "Termina de actualizar tu passkey",
    later: "Ahora no",
    working: "Actualizando tu passkey…",
    step: {
      create: "Creando tu passkey nueva…",
      prove: "Confirma con la passkey nueva que habías creado antes…",
      sign: "Confirma el cambio con tu passkey de siempre…",
      confirm: "Esperando que se confirme el cambio…",
    },
    waiting: "El cambio está en camino. Vuelve en un rato.",
    done: "Listo, tu passkey está actualizada.",
  },
  create: {
    title: "Arma el fondo del grupo",
    lead: "Después te damos un enlace para compartir por WhatsApp. Cuando se unan al menos 3, lo creas. Los votos necesarios se eligen en ese momento.",
    fundName: "Nombre del fondo",
    weeklyFee: "Cuota de cada uno por semana",
    agreedExpense: "Gasto acordado",
    agreedExpenseHint: "El agente lo devuelve sin votación, hasta el tope de cada semana.",
    weeklyCap: "Tope por semana para ese gasto",
    defaults: {
      fundNamePlaceholder: "Fútbol de los jueves",
      agreedExpense: "la cancha",
    },
    creating: "Creando…",
    submit: "Crear fondo",
    submitWithPasskey: "Crear mi passkey y el fondo",
  },
  deploy: {
    joined: "Se unieron",
    shareTitle: "Comparte este enlace en el grupo",
    waitingForMembers: "Cuando se unan al menos 3 personas, podrás crear el fondo.",
    waitingForCreator: (creator: string) => `Cuando estén todos, ${creator} crea el fondo y empieza a funcionar.`,
    votesNeeded: "Votos necesarios para lo que no es el gasto acordado",
    votesOption: (n: number, members: number) => `${n} de ${members}`,
    feeNote: (percent: string) => `De cada aporte, el ${percent} va a TesorerIA para cubrir lo que cuestan las operaciones del fondo. Queda fijo cuando se crea.`,
    creating: "Creando fondo…",
    submit: "Crear fondo",
  },
  share: {
    whatsApp: (fundName: string, url: string) => `Únete al fondo "${fundName}" en TesorerIA: ${url}`,
    send: "Enviar por WhatsApp",
    copy: "Copiar el enlace",
    copied: "Copiado",
  },
  summary: {
    heading: (week: number, from: string, to: string) => `Resumen de la semana ${week} (del ${from} al ${to})`,
    balance: (amount: string) => `En el fondo hay ${amount}.`,
    paid: (paid: number, members: number) => `Pagaron la cuota ${paid} de ${members}. Deben, en total:`,
    owes: (who: string, amount: string) => `${sentenceStart(who)}, ${amount}`,
    allPaid: "Todos pagaron la cuota.",
    happened: "Lo que pasó:",
    contributed: (amount: string) => `Aportaron ${amount} entre todos.`,
    approvedPayment: (what: string) => `Se aprobó ${what}.`,
    nothing: "No hubo movimientos.",
    toContribute: (link: string) => `Para aportar: ${link}`,
    copy: "Copiar",
  },
  person: {
    name: "Tu nombre",
  },
  invitation: {
    title: (creator: string, fund: ReactNode) => (
      <>
        {creator} te invitó a {fund}
      </>
    ),
    rules: (fee: ReactNode, cap: ReactNode, expense: string) => (
      <>
        Cada uno pone {fee} por semana. El agente devuelve hasta {cap} por semana por {expense}. Todo lo demás se vota. Nadie puede cambiar esto solo, ni
        el agente.
      </>
    ),
    feeNote: (percent: string) => `De cada aporte, el ${percent} va a TesorerIA para cubrir lo que cuestan las operaciones del fondo. Queda fijo cuando se crea.`,
    passkeyNote: "Tu cuenta se protege con una passkey: tu huella, tu cara o el PIN del teléfono. No hay contraseña ni frase que guardar.",
    join: "Unirme",
    alreadyJoined: (names: string) => `Ya se unieron: ${names}.`,
    full: "Este fondo ya está completo.",
    beingCreated: "Este fondo ya se está creando.",
    running: "Este fondo ya está en marcha.",
    goToFund: "Ir al fondo",
    request: "Pedir unirme",
    requestAgain: "Pedir de nuevo",
    requested: "Pediste unirte. Alguien del grupo tiene que proponerte, y después se vota. Cuando se apruebe, vas a ver el fondo aquí.",
    proposed: (who: string, votes: number, required: number) => `${sentenceStart(who)} propuso agregarte. Lleva ${votes} de ${required} votos.`,
    expired: "Tu solicitud venció. Pídele a alguien del grupo que te proponga.",
  },
  timeline: {
    someone: SOMEONE,
    newAccount: "una cuenta nueva",
    you: "Tú",
    contributed: (who: string, what: string) => `${sentenceStart(who)} aportó ${what}.`,
    converted: (usdt: string, pesos: string) => `Pasé a pesos los ${usdt} que entraron: ${pesos}.`,
    convertedLess: (usdt: string, pesos: string, diff: string, who: string | null) =>
      `Pasé a pesos los ${usdt} que entraron: ${pesos}, ${diff} menos de lo que valían al aportarlos. ${who === null ? "Esa diferencia la ponen quienes los aportaron." : `Esa diferencia la pone ${who}.`}`,
    convertedMore: (usdt: string, pesos: string, diff: string, who: string | null) =>
      `Pasé a pesos los ${usdt} que entraron: ${pesos}, ${diff} más de lo que valían al aportarlos. ${who === null ? "Esa diferencia queda a favor de quienes los aportaron." : `Esa diferencia queda a favor de ${who}.`}`,
    convertedFor: (usdt: string, pesos: string, who: string) => `Pasé a pesos los ${usdt} de ${who}: ${pesos}.`,
    convertedDetail: "Los cambié a pesos y revisé que el precio no se alejara más de 2 % del precio de referencia del dólar, como dicen mis reglas.",
    feePaid: (pesos: string, percent: string) =>
      `Envié ${pesos} de la comisión del ${percent} a TesorerIA, para cubrir lo que cuestan las operaciones del fondo.`,
    feePaidDetail: (percent: string) => `De cada aporte, el ${percent} cubre lo que cuestan las operaciones del fondo. Lo junto y lo envío una vez por semana.`,
    reimbursed: (amount: string, who: string, expense: string) => `Le devolví ${amount} a ${who} por ${expense}.`,
    reimbursedLeftThisWeek: (left: string) => `Quedan ${left} del tope de esta semana.`,
    reimbursedLeftThatWeek: (left: string) => `Quedaban ${left} del tope de esa semana.`,
    reimbursedDetail: (expense: string, cap: string) => `Era ${expense}, que devuelvo sin votación hasta ${cap} por semana.`,
    proposal: {
      byAgent: (what: string) => `Propuse ${what}.`,
      byMember: (who: string, what: string) => `${sentenceStart(who)} propuso ${what}.`,
      agentDetail: (votes: number) => `Lo que no puedo devolver por mi cuenta lo tienen que votar: hacen falta ${votes} votos.`,
      pay: (amount: string, who: string, note: string) => `pagarle ${amount} a ${who}${note ? ` por ${note}` : ""}`,
      giveBack: (amount: string, who: string, note: string) => `devolverle ${amount} de su aporte a ${who}${note ? ` (${note})` : ""}`,
      addMember: (who: string) => `agregar a ${who} al fondo`,
      removeMember: (who: string) => `sacar a ${who} del fondo`,
      replaceMember: (who: string) => `cambiar la cuenta de ${who}`,
      setWeeklyCap: (expense: string, cap: string) => `cambiar el tope semanal de ${expense} a ${cap}`,
      setVotesRequired: (votes: number, expense: string) => `pedir ${votes} votos para lo que no es ${expense}`,
      setAgent: "cambiar el agente",
      close: "cerrar el fondo y repartir el saldo",
      approved: "Se aprobó.",
      expiredWithVotes: "Venció sin ejecutarse.",
      expiredWithoutVotes: "Venció sin los votos necesarios.",
      short: (amount: string) => `Tiene los votos, pero al fondo le faltan ${amount} para pagarlo.`,
      needsCarryingOut: "Tiene los votos: falta ejecutarla.",
      votes: (votes: number, required: number) => `Lleva ${votes} de ${required} votos.`,
    },
    paid: (amount: string, who: string) => `El fondo le pagó ${amount} a ${who}: la propuesta se aprobó.`,
    givenBack: (amount: string, who: string) => `El fondo le devolvió ${amount} de su aporte a ${who}: la propuesta se aprobó.`,
    memberAdded: (who: string) => `Se unió ${who} al fondo.`,
    joinRequest: (who: string) => `${sentenceStart(who)} pidió unirse al fondo.`,
    joinRequestExpired: (who: string) => `Venció la solicitud de ${who}.`,
    joinRequestSameName: (who: string) =>
      `Atención: hay otra persona que se llama ${who}. Antes de proponer, confirma en el grupo que es quien esperan.`,
    weekClosed: (week: number) => `Cerré la semana ${week}. Te dejo el resumen para el grupo.`,
    memberRemoved: (who: string) => `${sentenceStart(who)} dejó el fondo y se llevó su parte.`,
    memberReplaced: (who: string) => `${sentenceStart(who)} cambió de cuenta.`,
    weeklyCapChanged: (expense: string, cap: string) => `El tope semanal de ${expense} ahora es ${cap}.`,
    votesRequiredChanged: (votes: number, expense: string) => `Ahora hacen falta ${votes} votos para lo que no es ${expense}.`,
    agentChanged: "Cambió el agente del fondo.",
    fundClosed: "Se cerró el fondo y se repartió el saldo según lo que aportó cada uno.",
    remainderDistributed: "Se repartió lo que llegó después del cierre.",
    hold: (usdt: string, why: string) => `Todavía no pasé a pesos ${usdt}: ${why}. Lo vuelvo a intentar en unos minutos.`,
    holdWhy: {
      "daily-limit": "ya cambié todo lo que puedo cambiar por día en este fondo",
      "price-reference": "el precio de referencia del dólar no está al día",
      "pool-depth": "en el mercado donde los cambio no hay suficientes pesos",
      "price-gap": "el precio del mercado se alejó más de 2 % del de referencia",
      "price-floor": "el mercado paga menos de lo que permiten mis reglas",
      other: "no pude hacer la operación",
    },
    expense: {
      what: (amount: string, by: string, note: string) => `el gasto de ${amount} que cargó ${by}${note ? ` (${note})` : ""}`,
      looking: (what: string) => `Estoy revisando ${what}.`,
      waiting: (what: string) => `Guardé ${what}: lo devuelvo cuando el fondo tenga los pesos.`,
      blocked: (what: string) => `No pude procesar ${what}. Lo vuelvo a intentar en un rato.`,
      rejected: (what: string) => `No puedo devolver ${what}.`,
      quota: (what: string) => `Guardé ${what}: lo propongo cuando empiece la semana que viene.`,
    },
    onItsWay: {
      vote: "Tu voto está en camino.",
      execute: "Tu ejecución de la propuesta está en camino.",
      propose: "Tu propuesta está en camino.",
      contribution: (what: string) => `Tu aporte de ${what} está en camino.`,
    },
  },
  fund: {
    inFund: "En el fondo",
    owe: (amount: ReactNode) => <>Debes {amount}.</>,
    upToDateAhead: (amount: ReactNode) => <>Estás al día, con {amount} adelantados.</>,
    upToDate: "Estás al día.",
    share: (amount: ReactNode) => <>Si se cerrara hoy, te tocarían {amount}.</>,
    contribute: "Aportar",
    addExpense: "Cargar gasto",
    inYourAccount: (amounts: ReactNode) => <>En tu cuenta tienes {amounts}.</>,
    and: "y",
    cashOut: "Pasar a pesos",
    publicNotice: "Estás viendo un fondo real, en solo lectura.",
    loading: "Cargando",
  },
  week: {
    title: "Esta semana",
    dues: (amount: string) => `Cuota semanal de ${amount}`,
    owes: (amount: string) => `debe en total ${amount}`,
    paid: "pagó",
  },
  rules: {
    title: "Las reglas",
    text: (cap: ReactNode, expense: string, left: ReactNode, votes: number, members: number) => (
      <>
        El agente devuelve hasta {cap} por semana por {expense}. Esta semana quedan {left}. Todo lo demás necesita {votes} de {members} votos. Nadie puede
        cambiar esto solo, ni el agente.
      </>
    ),
    fee: (percent: string) =>
      `El ${percent} de cada aporte va a TesorerIA para cubrir lo que cuestan las operaciones del fondo. Sale una vez por semana, sin votación, y nadie puede cambiarlo.`,
  },
  nav: {
    home: "Inicio",
    activity: "Movimientos",
    agent: "Agente",
    account: "Tu cuenta",
    sections: "Secciones del fondo",
    askAgent: "Pregúntale al agente",
  },
  movements: {
    title: "Movimientos",
    latest: "Lo último del agente",
    seeAll: "Ver todos",
    empty: "Todavía no hay movimientos. El primero puede ser tu aporte.",
    onItsWay: "En camino",
    viewReceipt: "Ver comprobante",
    viewSummary: "Ver el resumen",
    voted: "Votaste",
    yourTurn: "Te toca",
  },
  receipt: {
    viewOnExplorer: "Ver en el explorador de Celo",
  },
  fundError: {
    title: "No pudimos leer el fondo en este momento.",
    moneyIsFine: "El dinero está bien: es la lectura la que falló.",
    tryLater: "Inténtalo de nuevo en un rato.",
    retrying: "Lo volvemos a intentar en unos segundos.",
    retry: "Intentar de nuevo",
  },
  panels: {
    back: "Volver",
    titles: {
      aportar: "Aportar",
      gasto: "Cargar un gasto",
      cuenta: "Tu cuenta",
      pesos: "Pasar a pesos",
      agente: "Agente",
      comprobante: "Comprobante",
      resumen: "Resumen de la semana",
    },
  },
  account: {
    reading: "Revisando tu cuenta…",
    readFailed: "No pudimos revisar tu cuenta. Lo intentamos de nuevo en unos segundos.",
    youHave: (amount: ReactNode) => <>Tienes {amount} en tu cuenta.</>,
    loggedInAs: (name: string) => `Entraste como ${name}.`,
    holds: (pesos: ReactNode) => <>En tu cuenta tienes {pesos}</>,
    holdsAnd: (pesos: ReactNode, usdt: ReactNode) => (
      <>
        En tu cuenta tienes {pesos} y {usdt}
      </>
    ),
    reimbursementsLand: "Aquí llegan los reembolsos del agente.",
    cashOut: "Pasar a pesos con Ripio",
    nothingYet: "Cuando el agente te devuelva un gasto, lo vas a ver aquí.",
    yourFunds: "Tus fondos",
    fundTags: { here: "estás aquí", draft: "borrador", requested: "pediste unirte" },
    createAnother: "Crear otro fondo",
    invite: "Invitar a alguien",
    inviteHow: (fund: string) => `Quien abra el enlace pide unirse a ${fund}, y el grupo lo vota.`,
  },
  contribute: {
    haveUsdt: "Tengo USDT",
    havePesos: "Tengo pesos en Ripio",
    sendAtLeast: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Envía al menos {usdt} a tu cuenta del fondo desde Binance o cualquier exchange: con eso cubres {pesos} al precio actual, incluido lo que se
        pierde al pasarlos a pesos.
      </>
    ),
    sendAtLeastMore: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Envía al menos {usdt} más a tu cuenta del fondo desde Binance o cualquier exchange: con lo que ya tienes, cubres {pesos} al precio actual,
        incluido lo que se pierde al pasarlos a pesos.
      </>
    ),
    sendUsdt: "Envía USDT a tu cuenta del fondo desde Binance o cualquier exchange.",
    binanceMinimum: (min: ReactNode) => <>Si lo retiras de Binance, el mínimo es {min}.</>,
    binanceMinimumLeftover: (min: ReactNode) => <>Si lo retiras de Binance, el mínimo es {min}: lo que sobre se queda en tu cuenta para la próxima.</>,
    ripioWithdraw: (token: string) => `En la app de Ripio, retira ${token} por la red Celo a tu cuenta del fondo. O cárgalos directamente:`,
    rampOnly: (token: string) => `Compra ${token} con Ripio y llegan directo a tu cuenta del fondo.`,
    loadWithRipio: "Cargar pesos con Ripio",
    onItsWay: "Tu aporte está en camino. Cuando se confirme, lo vas a ver en el fondo.",
    nothingYet: "Todavía no ha llegado nada. Cuando llegue, aparece aquí; puede tardar unos minutos.",
    capReachedNotice: (cap: ReactNode) => <>El fondo llegó a su tope de {cap}: ya no cabe más.</>,
    amountLabel: "Cuánto aportas",
    youHold: (amount: ReactNode) => <>Tienes {amount}</>,
    submit: (amount: string) => `Aportar ${amount}`,
    accountHolds: (held: string) => `En tu cuenta tienes ${held}.`,
    capReached: (cap: string) => `El fondo llegó a su tope de ${cap}: ya no cabe más.`,
    roomLeft: (room: string, cap: string) => `Al fondo le caben hasta ${room} más, porque tiene un tope de ${cap}.`,
    // USDT only exists in a fund with a dollar; written as Mexico writes it, the one neutral country so far.
    usdtFormat: "Escríbelo como 6 o 6.25.",
    covers: (pesos: string) => `Cubre los ${pesos}, al precio actual.`,
    worth: (pesos: string) => `Son unos ${pesos} al precio actual.`,
    feeNote: (percent: string) => `Incluye el ${percent} que cubre lo que cuestan las operaciones del fondo: lo demás cuenta como tu aporte.`,
  },
  expense: {
    which: "¿Qué gasto es?",
    agreed: (expense: string) => `${expense} (el gasto acordado)`,
    other: "Otro gasto (se vota)",
    amountLabel: "Cuánto pagaste",
    noteLabel: "Nota (opcional)",
    notePlaceholder: "La cancha del jueves",
    submit: "Cargar el gasto",
    looking: "El agente lo está revisando…",
    twin: (amount: ReactNode) => <>Hace unos minutos cargaste un gasto de {amount}. ¿Es otro gasto igual?</>,
    another: "Sí, es otro",
    same: "No, es el mismo",
    giveBack: "Devolverme un aporte (se vota)",
    giveBackAmountLabel: "Cuánto te devolvemos",
    giveBackNoteLabel: "¿Por qué?",
    giveBackNotePlaceholder: "Deposité en otro fondo",
    giveBackSubmit: "Pedir la devolución",
    giveBackProposed: "El agente propuso devolvértelo y ahora lo vota el grupo.",
    giveBackMax: (amount: string) => `Puedes pedir hasta ${amount}, lo que cuenta como aportado.`,
    proposalsLeft: (left: number) =>
      left === 1 ? "Te queda 1 solicitud que se vota esta semana." : `Te quedan ${left} solicitudes que se votan esta semana.`,
    noProposalsLeft: "Ya usaste las solicitudes que se votan de esta semana: si lo cargas, el agente lo propone cuando empiece la próxima.",
  },
  outcome: {
    reimbursed: "Listo: el agente te devolvió el dinero.",
    proposed: "No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.",
    waiting: "El fondo todavía no tiene esos pesos: el agente te lo devuelve cuando entren.",
    rejected: "El agente no puede devolver este gasto.",
    blocked: "No se pudo procesar ahora. El agente lo vuelve a intentar en un rato.",
    sending: "El agente ya lo envió. En un rato aparece en los movimientos.",
    quota: "Ya se usaron las solicitudes que se votan de esta semana: el agente lo propone cuando empiece la próxima.",
    new: "El agente está ocupado: lo procesa en unos minutos.",
  },
  cashOut: {
    passed: (amount: ReactNode, ripioApp: boolean) => (
      <>
        Pasaste {amount} a Ripio. Si la dirección es de Vender con Ripio, los pesos llegan solos a tu banco y Ripio te avisa por correo.
        {ripioApp && " Si es de la app, véndelos ahí 1:1."}
      </>
    ),
    sellIntro: (bankAccount: string) =>
      `Con Vender con Ripio ingresas tu ${bankAccount} y Ripio te da una dirección en la red Celo. Pégala aquí y envía: los pesos llegan a tu banco.`,
    sellIntroSaved: "Con Vender con Ripio los pesos llegan directo a tu banco: Ripio te da una dirección en la red Celo. Toca Cambiar y pégala aquí.",
    sellWithRipio: "Vender con Ripio",
    depositInstructions: (token: string) => `O desde la app de Ripio: toca Depositar, elige ${token} y la red Celo, y copia la dirección. Ahí los vendes 1:1.`,
    addressLabel: "Tu dirección de Ripio",
    savedAddress: "A tu cuenta de Ripio",
    change: "Cambiar",
    onItsWay: "Tu pase a pesos está en camino.",
    nothingToPass: "No tienes pesos en tu cuenta para pasar.",
    amountLabel: "Cuánto pasas",
    submit: "Pasar a Ripio",
    submitAmount: (amount: string) => `Pasar ${amount} a Ripio`,
    badAddress: "Esa dirección no parece válida. Cópiala de nuevo desde Ripio.",
    ownAccount: "Esa es tu cuenta del fondo. Pega la de Ripio.",
    ours: "Esa dirección es de TesorerIA, no de Ripio.",
    accountHolds: (held: string) => `Tienes ${held} en tu cuenta.`,
  },
  network: {
    warning: "Elige la red CELO. Si eliges otra, el dinero se pierde.",
    copy: "Copiar la dirección",
    copied: "Copiada",
    copiedStatus: "Dirección copiada.",
    copyFailed: "No se pudo copiar. Selecciona la dirección y cópiala.",
  },
  vote: {
    button: "Votar",
  },
  execute: {
    button: "Ejecutar",
  },
  proposeMember: {
    button: "Proponer agregarlo",
  },
  chat: {
    unavailable: "El agente no puede responder ahora. Inténtalo más tarde.",
    memberLimit: "Por hoy ya hablamos bastante. Mañana seguimos.",
    refused: "No puedo ayudarte con eso.",
    badCard: "No pude armar el gasto. Cuéntame de nuevo el monto y qué fue.",
    sendFailed: "No pudimos enviar tu mensaje.",
    longMessage: (max: number) => `Tu mensaje puede tener hasta ${max} letras.`,
    badRequest: "Faltan datos o no son válidos.",
    notFound: "No encontramos ese fondo.",
    remaining: (n: number) => (n === 1 ? "Te queda 1 mensaje por hoy." : `Te quedan ${n} mensajes por hoy.`),
    greeting: (name: string) => `Hola, ${name}. Pregúntame lo que quieras del fondo.`,
    suggestions: ["¿Quién debe esta semana?", "¿Cuánto queda del tope de la semana?", "Quiero cargar un gasto"],
    typing: "El agente está escribiendo",
    questionLabel: "Tu pregunta",
    placeholder: "Escribe tu pregunta",
    send: "Enviar",
    count: (used: number, max: number) => `${used} de ${max}`,
    card: {
      otherExpense: "Otro gasto",
      agreedNext: (left: string) => `Si entra en lo que queda del tope de la semana (${left}), te lo devuelvo enseguida. Si no, se vota.`,
      otherNext: (votes: number, members: number) => `Se vota: necesita ${votes} de ${members} votos.`,
      kindLabel: "Qué gasto es",
      amountLabel: "Cuánto",
      noteLabel: "Nota",
      confirm: "Confirmar",
      cancel: "Cancelar",
      notLoaded: "No lo cargué.",
    },
    brief: {
      agent: "El agente",
      group: "El grupo",
      account: "una cuenta",
      reason: (detail: string) => ` Motivo: ${detail}`,
      youVoted: " Ya la votaste.",
      now: (today: string, week: string, timeName: string) => `Ahora es ${today}, ${timeName}. El fondo va en su semana ${week}.`,
      fund: (name: string, balance: string) => `Fondo: ${name}. Saldo: ${balance}.`,
      closed: " El fondo está cerrado.",
      rules: (fee: string, cap: string, expense: string, spent: string, left: string, votes: number, members: number) =>
        `Reglas: cada uno pone ${fee} por semana. El agente devuelve hasta ${cap} por semana por ${expense}, el gasto acordado: esta semana devolvió ${spent} y quedan ${left}. Todo lo demás necesita ${votes} de ${members} votos. Nadie puede cambiar esto solo, ni el agente.`,
      fee: (percent: string) =>
        `Comisión: el ${percent} de cada aporte va a la cuenta de TesorerIA, una vez por semana, para cubrir lo que cuestan las operaciones del fondo. El monto que pide Aportar ya la incluye: lo demás cuenta como aporte.`,
      speaking: (name: string) => `Te habla: ${name}.`,
      owe: (amount: string) => `Debes ${amount}.`,
      upToDateAhead: (amount: string) => `Estás al día, con ${amount} adelantados.`,
      upToDate: "Estás al día.",
      situation: (standing: string, share: string) => `Tu situación: ${standing} Si el fondo se cerrara hoy, te tocarían ${share}.`,
      weekList: "La lista de la semana, en el orden en que entraron:",
      noProposals: "Propuestas abiertas: ninguna.",
      proposals: "Propuestas abiertas:",
      noMovements: "Movimientos: todavía no hay.",
      movementsCut: (shown: number, total: number) => `Movimientos, del más nuevo al más viejo (los ${shown} más nuevos de ${total}; los anteriores no los ves):`,
      movements: "Movimientos, del más nuevo al más viejo:",
    },
  },
};
