import type { ReactNode } from "react";
import type { Locale } from "./locales";

const SOMEONE = "alguien";

/** Capitalizes the stand-in where it starts a sentence, and leaves a member's name as they wrote it (spec, 9.3). */
const sentenceStart = (who: string) => (who === SOMEONE ? "Alguien" : who);

/**
 * Everything the web says, in Rioplatense Spanish (spec, 9.3): the texts it always had, moved here word for word
 * (except that "alguien" now starts a sentence capitalized).
 * `en` has this same shape (Messages), so a sentence missing in English doesn't compile. A fixed sentence is a
 * string; one with values is a function that takes them already formatted; a value that stands out on screen comes
 * in as a ReactNode, and the sentence is a fragment around it.
 */
export const es = {
  /** The dictionary's own language: what a function that has `m` passes to the formats (formatPesos(x, m.locale)). */
  locale: "es" as Locale,
  meta: {
    description: "La plata del grupo, sin tesorero.",
  },
  language: {
    label: "Idioma",
  },
  /** What more than one screen says. */
  common: {
    you: " (vos)",
    confirm: "Confirmá con tu huella, tu cara o el PIN",
    sending: "Enviando…",
    /** The name of a member the fund has no name for (a public view without the group's OK shows them all this way). */
    member: (n: number) => `Miembro ${n}`,
  },
  /**
   * What the API answers when a request fails (spec, 9.3): the browser shows each as the route wrote it. It also holds the
   * browser's own errors, which `ErrorKey` names (`onItsWay`, `cancelled`, `generic`, `noPasskey`, `wrongPasskey`, `notCompleted`).
   */
  errors: {
    logIn: "Entrá con tu passkey.",
    fundNotFound: "No encontramos ese fondo.",
    badRequest: "Faltan datos o no son válidos.",
    failed: "Algo falló. Probá de nuevo.",
    onItsWay: "Tu operación está en camino. En unos minutos la vas a ver reflejada: no la mandes de nuevo.",
    cancelled: "Cancelaste la confirmación. Probá de nuevo.",
    generic: "No se pudo completar. Probá de nuevo en un rato.",
    noPasskey: "No se pudo entrar. Si no te aparece tu passkey, probá desde el teléfono donde creaste tu cuenta.",
    wrongPasskey: "Tu passkey no coincide con tu cuenta. Entrá de nuevo.",
    notCompleted: "La operación no se pudo completar. No se movió plata.",
    amountFormat: "Escribilo como 10.000 o 10.000,50.",
    /** What the browser says of an amount typed above the most the app takes; `max` is that most. */
    amountTooBig: (max: string) => `No puede pasar de ${max}.`,
    notInAFund: "No estás en ningún fondo.",
    agentJustRan: "El agente acaba de correr.",
    notYourDraft: "Ese borrador no es tuyo.",
  },
  /** What the forms check, in the browser and on the server (checks.ts). */
  checks: {
    personName: "Poné tu nombre, de hasta 30 letras.",
    personEmail: "Ese mail no parece válido.",
    fundName: "Poné un nombre para el fondo, de hasta 40 letras.",
    agreedExpense: "Poné cuál es el gasto acordado, de hasta 40 letras.",
    feeZero: "La cuota tiene que ser más que cero.",
    capZero: "El tope tiene que ser más que cero.",
    feeTooBig: (max: string) => `La cuota no puede pasar de ${max}.`,
    capTooBig: (max: string) => `El tope no puede pasar de ${max}.`,
    feeUnreadable: "No entendimos la cuota. Escribila como 10.000 o 10.000,50.",
    capUnreadable: "No entendimos el tope. Escribilo como 60.000 o 60.000,50.",
  },
  /** Drafts, invitations and creating a fund (funds.ts). */
  funds: {
    badInvite: "Ese link de invitación no es válido.",
    alreadyLive: "El fondo ya está en marcha: pedile a alguien del grupo que proponga sumarte.",
    alreadyCreated: "El fondo ya está creado.",
    onlyCreator: "Solo quien armó el fondo puede crearlo.",
    beingCreated: "El fondo se está creando en este momento. Probá en un rato.",
    unconfirmed: "La operación todavía no se confirmó. Probá en un rato.",
    full: "El fondo ya tiene 10 personas, que es el máximo.",
    mismatch: "Ya se creó un fondo desde tu cuenta, pero con otros datos. No lo crees de nuevo: tendrías dos.",
    accountCap: (max: number) =>
      `Tu cuenta ya usó los ${max} intentos de crear un fondo que paga TesorerIA. Escribinos y lo destrabamos.`,
    dayCap: "Hoy ya se crearon muchos fondos en TesorerIA. Probá de nuevo mañana.",
    tooFewMembers: "Hacen falta al menos 3 personas para crear el fondo.",
    tooManyMembers: (max: number, n: number) => `Un fondo puede tener hasta ${max} personas, y este tiene ${n}.`,
    votesRange: (n: number) => `Con ${n} personas, los votos necesarios van de 2 a ${n - 1}.`,
    votesLocked: (votes: number) => `Ya empezaste a crear el fondo con ${votes} votos necesarios: elegí ${votes} para seguir.`,
    createFirst: "Primero hay que crear el fondo.",
    notInOperation: "No encontramos el fondo en esa operación.",
  },
  /** Signing up and logging in with a passkey (auth.ts). */
  auth: {
    late: "Pasó demasiado tiempo. Probá de nuevo.",
    badPasskey: "No pudimos crear tu passkey. Probá de nuevo.",
    taken: "Esa passkey ya tiene una cuenta. Entrá con ella.",
    unknownPasskey: "No pudimos reconocer tu passkey.",
  },
  /** Loading an expense (expenses.ts). */
  expenses: {
    amountUnreadable: "No entendimos el monto.",
    amountZero: "El monto tiene que ser más que cero.",
    amountTooBig: (max: string) => `El monto no puede pasar de ${max}.`,
    noteTooLong: (max: number) => `La nota puede tener hasta ${max} letras.`,
  },
  /** The portada (spec, 9.2). */
  home: {
    title: "La plata del grupo, sin tesorero.",
    lead: "Un fondo en pesos para tu grupo, que administra un agente con límites que nadie puede cambiar solo.",
    create: "Crear un fondo",
    seeReal: "Ver un fondo real",
    logIn: "Entrar",
    haveFund: "Ya tengo un fondo: entrar",
    /** Above the real group's week: `name` stands out. */
    live: (name: ReactNode) => <>{name}, en vivo.</>,
    howItWorks: "Cómo funciona",
    steps: [
      "Armás el fondo y sumás a tus amigos con un link.",
      "Cada uno aporta su cuota, en pesos o en USDT.",
      "El agente devuelve lo acordado, lleva la cuenta de quién debe, y lo demás se vota.",
    ],
    /** For the judges: each argument is a link, the text of which is in `judgesLinks`. */
    judges: (celo: ReactNode, contract: ReactNode, agent: ReactNode, code: ReactNode) => (
      <>
        Corre en {celo}, con {contract}, {agent} y {code}.
      </>
    ),
    judgesLinks: {
      celo: "Celo mainnet",
      contract: "el contrato verificado",
      agent: "el agente registrado en ERC-8004 (#9887)",
      code: "el código abierto",
    },
  },
  /** Every `notFound()` of the app. */
  notFound: {
    title: "No encontramos esa página",
    body: "Puede que el link esté mal o que no seas parte de este fondo.",
    home: "Ir al inicio",
  },
  /** Logging in and out. */
  login: {
    title: "Entrá a tu fondo",
    lead: "Usá la passkey que creaste cuando te sumaste. Tu teléfono te la va a pedir.",
    /** `create` is the link to create a fund, with `createLink` as its text. */
    firstTime: (create: ReactNode) => <>¿Es tu primera vez? Entrá con el link de invitación que te pasaron, o {create}.</>,
    createLink: "creá un fondo",
    button: "Entrar con mi passkey",
    logOut: "Salir",
  },
  /** Creating a fund (spec, 9, screen 7). */
  create: {
    title: "Armá el fondo del grupo",
    lead: "Después te damos un link para pasar por WhatsApp. Cuando se sumen al menos 3, lo creás. Los votos necesarios se eligen en ese momento.",
    fundName: "Nombre del fondo",
    weeklyFee: "Cuota de cada uno por semana",
    agreedExpense: "Gasto acordado",
    agreedExpenseHint: "El agente lo devuelve sin votación, hasta el tope de cada semana.",
    weeklyCap: "Tope por semana para ese gasto",
    /** What the form starts with. The amounts are written the way this language writes them: `readDraft` reads them back. */
    defaults: {
      fundNamePlaceholder: "Fútbol de los jueves",
      weeklyFee: "10.000",
      agreedExpense: "la cancha",
      weeklyCap: "60.000",
    },
    creating: "Creando…",
    submit: "Crear fondo",
    submitWithPasskey: "Crear mi passkey y el fondo",
  },
  /** The draft: who joined, the link, and creating the fund (spec, 9). */
  deploy: {
    joined: "Se sumaron",
    shareTitle: "Compartí este link en el grupo",
    waitingForMembers: "Cuando se sumen al menos 3 personas, vas a poder crear el fondo.",
    waitingForCreator: (creator: string) => `Cuando estén todos, ${creator} crea el fondo y empieza a andar.`,
    votesNeeded: "Votos necesarios para lo que no es el gasto acordado",
    votesOption: (n: number, members: number) => `${n} de ${members}`,
    creating: "Creando fondo…",
    submit: "Crear fondo",
  },
  /** The invitation link, to copy or send. */
  share: {
    /** What goes in the WhatsApp message: in the language of whoever shares. */
    whatsApp: (fundName: string, url: string) => `Sumate al fondo "${fundName}" en TesorerIA: ${url}`,
    send: "Mandar por WhatsApp",
    copy: "Copiar el link",
    copied: "Copiado",
  },
  /**
   * The week's summary that goes to the group (spec, 9.4): its words, joined by weekSummaryText. The bullets, the
   * blank lines and the first line ("TesorerIA · {fund}") are the code's. `week` counts from 1, as people do.
   */
  summary: {
    heading: (week: number, from: string, to: string) => `Resumen de la semana ${week} (del ${from} al ${to})`,
    balance: (amount: string) => `En el fondo hay ${amount}.`,
    paid: (paid: number, members: number) => `Pagaron la cuota ${paid} de ${members}. Deben:`,
    owes: (who: string, amount: string) => `${sentenceStart(who)}, ${amount}`,
    allPaid: "Todos pagaron la cuota.",
    happened: "Lo que pasó:",
    contributed: (amount: string) => `Aportaron ${amount} entre todos.`,
    /** `what` is timeline.proposal.pay: "pagarle $ 8.000 a Ale por las pelotas". */
    approvedPayment: (what: string) => `Se aprobó ${what}.`,
    nothing: "No hubo movimientos.",
    toContribute: (link: string) => `Para aportar: ${link}`,
  },
  /** The fields of someone without an account yet. */
  person: {
    name: "Tu nombre",
  },
  /** The invitation (spec, 9, screen 1). */
  invitation: {
    /** `fund` stands out (the fund's name, in italics). */
    title: (creator: string, fund: ReactNode) => (
      <>
        {creator} te invitó a {fund}
      </>
    ),
    /** The fund's rules: `fee` and `cap` stand out as amounts; `expense` is what the creator wrote. */
    rules: (fee: ReactNode, cap: ReactNode, expense: string) => (
      <>
        Cada uno pone {fee} por semana. El agente devuelve hasta {cap} por semana por {expense}. Todo lo demás se vota. Nadie puede cambiar esto solo, ni
        el agente.
      </>
    ),
    passkeyNote: "Tu cuenta se protege con una passkey: tu huella, tu cara o el PIN del teléfono. No hay contraseña ni frase para guardar.",
    join: "Sumarme",
    alreadyJoined: (names: string) => `Ya se sumaron: ${names}.`,
    full: "Este fondo ya está completo.",
    beingCreated: "Este fondo ya se está creando.",
    running: "Este fondo ya está andando.",
    goToFund: "Ir al fondo",
  },
  /**
   * The movements of a fund, written on the server (timeline.ts; spec, 9.2): the agent speaks in first person, a
   * member's actions in third, and what the group decided is the fund's. What the members wrote (the agreed expense,
   * notes, names) comes in as it is and is never translated. A sentence that goes after another one comes without the
   * space between them: the server joins them.
   */
  timeline: {
    /** For an account the fund has no name for. */
    someone: SOMEONE,
    newAccount: "una cuenta nueva",
    /** Who the viewer's own operations on their way are. */
    you: "Vos",
    contributed: (who: string, what: string) => `${sentenceStart(who)} aportó ${what}.`,
    converted: (usdt: string, pesos: string) => `Pasé a pesos los ${usdt} que entraron: ${pesos}.`,
    // Plain words, no jargon (spec, 9): the exchange and the price feed stay out of what people read.
    convertedDetail: "Los cambié a pesos y revisé que el precio no se alejara más de 2 % del precio de referencia del dólar, como dicen mis reglas.",
    reimbursed: (amount: string, who: string, expense: string) => `Le devolví ${amount} a ${who} por ${expense}.`,
    reimbursedLeftThisWeek: (left: string) => `Quedan ${left} del tope de esta semana.`,
    reimbursedLeftThatWeek: (left: string) => `Quedaban ${left} del tope de esa semana.`,
    reimbursedDetail: (expense: string, cap: string) => `Era ${expense}, que devuelvo sin votación hasta ${cap} por semana.`,
    /** A proposal: how it's told, what it is (`what` comes from the ones below), and where it stands. */
    proposal: {
      byAgent: (what: string) => `Propuse ${what}.`,
      byMember: (who: string, what: string) => `${sentenceStart(who)} propuso ${what}.`,
      agentDetail: (votes: number) => `Lo que no puedo devolver por mi cuenta lo tienen que votar: hacen falta ${votes} votos.`,
      pay: (amount: string, who: string, note: string) => `pagarle ${amount} a ${who}${note ? ` por ${note}` : ""}`,
      addMember: "sumar a una cuenta nueva al fondo",
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
    memberAdded: (who: string) => `Se sumó ${who} al fondo.`,
    memberRemoved: (who: string) => `${sentenceStart(who)} dejó el fondo y se llevó su parte.`,
    memberReplaced: (who: string) => `${sentenceStart(who)} cambió de cuenta.`,
    weeklyCapChanged: (expense: string, cap: string) => `El tope semanal de ${expense} ahora es ${cap}.`,
    votesRequiredChanged: (votes: number, expense: string) => `Ahora hacen falta ${votes} votos para lo que no es ${expense}.`,
    agentChanged: "Cambió el agente del fondo.",
    fundClosed: "Se cerró el fondo y se repartió el saldo según lo que aportó cada uno.",
    remainderDistributed: "Se repartió lo que llegó después del cierre.",
    /** The USDT the fund holds and the agent hasn't converted: `why` is one of `holdWhy`. */
    hold: (usdt: string, why: string) => `Todavía no pasé a pesos ${usdt}: ${why}. Lo vuelvo a intentar en unos minutos.`,
    /** Why, as the agent says it (spec, 9.2: no jargon): by the agent's skip codes, and `other` for anything else. */
    holdWhy: {
      "daily-limit": "ya cambié todo lo que puedo cambiar por día en este fondo",
      "price-reference": "el precio de referencia del dólar no está al día",
      "pool-depth": "en el mercado donde los cambio no hay suficientes pesos",
      "price-gap": "el precio del mercado se alejó más de 2 % del de referencia",
      "price-floor": "el mercado paga menos de lo que permiten mis reglas",
      other: "no pude hacer la operación",
    },
    /** An expense the agent still holds: `what` is `expense.what`. */
    expense: {
      what: (amount: string, by: string, note: string) => `el gasto de ${amount} que cargó ${by}${note ? ` (${note})` : ""}`,
      looking: (what: string) => `Estoy mirando ${what}.`,
      waiting: (what: string) => `Guardé ${what}: lo devuelvo cuando el fondo tenga los pesos.`,
      blocked: (what: string) => `No pude procesar ${what}. Lo vuelvo a intentar en un rato.`,
      rejected: (what: string) => `No puedo devolver ${what}.`,
    },
    /** The viewer's own operations on their way. */
    onItsWay: {
      vote: "Tu voto está en camino.",
      execute: "Tu ejecución de la propuesta está en camino.",
      contribution: (what: string) => `Tu aporte de ${what} está en camino.`,
    },
  },
  /** The top of a fund's inicio: the balance, where you stand, and what's in your own account (spec, 9.2, Inicio 1–2). */
  fund: {
    /** The label above the balance, so the balance doesn't read as "$ X en el fondo. Estás al día…". */
    inFund: "En el fondo",
    /** Where you stand: `amount` stands out. */
    owe: (amount: ReactNode) => <>Debés {amount}.</>,
    upToDateAhead: (amount: ReactNode) => <>Estás al día, con {amount} adelantados.</>,
    upToDate: "Estás al día.",
    share: (amount: ReactNode) => <>Si se cerrara hoy, te tocan {amount}.</>,
    contribute: "Aportar",
    addExpense: "Cargar gasto",
    /** What reached the member's own account and isn't in the fund: `amounts` is the pesos and the USDT, joined with `and`. */
    inYourAccount: (amounts: ReactNode) => <>En tu cuenta tenés {amounts}.</>,
    and: "y",
    /** The link next to what's in your account, which opens the panel of the same name. */
    cashOut: "Pasar a pesos",
    /** On the public view, over the whole screen. */
    publicNotice: "Estás viendo un fondo real, en solo lectura.",
    /** The name of the fund's loading screen for screen readers. */
    loading: "Cargando",
  },
  /** The week's list (spec, 9.1): who paid and who owes. */
  week: {
    title: "Esta semana",
    dues: (amount: string) => `Cuota de ${amount}`,
    owes: (amount: string) => `debe ${amount}`,
    /** The name of the check by someone who paid, for screen readers. */
    paid: "pagó",
  },
  /** The rules in plain words: `cap` and `left` stand out as amounts; `expense` is what the creator wrote. */
  rules: {
    title: "Las reglas",
    text: (cap: ReactNode, expense: string, left: ReactNode, votes: number, members: number) => (
      <>
        El agente devuelve hasta {cap} por semana por {expense}. Esta semana quedan {left}. Todo lo demás necesita {votes} de {members} votos. Nadie puede
        cambiar esto solo, ni el agente.
      </>
    ),
  },
  /** The bars that take you around a fund (spec, 9.2). */
  nav: {
    home: "Inicio",
    activity: "Movimientos",
    agent: "Agente",
    /** Your avatar opens it. */
    account: "Tu cuenta",
    /** The name of the bottom bar for screen readers. */
    sections: "Secciones del fondo",
    /** The floating button from 1024 px. */
    askAgent: "Preguntale al agente",
  },
  /** The movements (spec, 9.2); the sentences themselves come written by the server (`timeline`). */
  movements: {
    title: "Movimientos",
    latest: "Lo último del agente",
    seeAll: "Ver todos",
    empty: "Todavía no hay movimientos. El primero puede ser tu aporte.",
    onItsWay: "En camino",
    viewReceipt: "Ver comprobante",
    voted: "Votaste",
  },
  /** The comprobante: the only link to the chain. */
  receipt: {
    viewOnExplorer: "Ver en el explorador de Celo",
  },
  /** When the chain or its history couldn't be read just now (spec, 9.2). */
  fundError: {
    title: "No pudimos leer el fondo en este momento.",
    moneyIsFine: "La plata está bien: es la lectura la que falló.",
    tryLater: "Probá de nuevo en un rato.",
    retrying: "Lo volvemos a intentar en unos segundos.",
    retry: "Probar de nuevo",
  },
  /** The panels' frame: the title of each, by what the URL names (`?p=`), and the arrow that closes them. */
  panels: {
    /** The arrow's name for screen readers. */
    back: "Volver",
    titles: {
      aportar: "Aportar",
      gasto: "Cargar un gasto",
      cuenta: "Tu cuenta",
      pesos: "Pasar a pesos",
      agente: "Agente",
      comprobante: "Comprobante",
    },
  },
  /** Your own account, which holds what hasn't reached the fund yet. */
  account: {
    reading: "Mirando tu cuenta…",
    readFailed: "No pudimos mirar tu cuenta. Probamos de nuevo en unos segundos.",
    /** What the account holds, in the Aportar and Pasar a pesos panels: `amount` stands out. */
    youHave: (amount: ReactNode) => <>Tenés {amount} en tu cuenta.</>,
    /** The top of Tu cuenta. */
    loggedInAs: (name: string) => `Entraste como ${name}.`,
    /** What it holds, big and without a full stop: the pesos, or the pesos and the USDT (both stand out). */
    holds: (pesos: ReactNode) => <>En tu cuenta tenés {pesos}</>,
    holdsAnd: (pesos: ReactNode, usdt: ReactNode) => (
      <>
        En tu cuenta tenés {pesos} y {usdt}
      </>
    ),
    reimbursementsLand: "Acá llegan los reintegros del agente.",
    cashOut: "Pasar a pesos con Ripio",
    nothingYet: "Cuando el agente te devuelva un gasto, lo vas a ver acá.",
  },
  /** Aportar (spec, 9, pantalla 3): where to send USDT or wARS from, and the button once the money has arrived. */
  contribute: {
    /** The two tabs: what the member has. */
    haveUsdt: "Tengo USDT",
    havePesos: "Tengo pesos en Ripio",
    /** The USDT tab, when this week needs more than the account holds: `usdt` and `pesos` stand out as amounts. */
    sendAtLeast: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Mandá al menos {usdt} a tu cuenta del fondo desde Binance o cualquier exchange: con eso cubrís {pesos} al precio de ahora.
      </>
    ),
    /** The same, when the account already holds some USDT. */
    sendAtLeastMore: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Mandá al menos {usdt} más a tu cuenta del fondo desde Binance o cualquier exchange: con lo que ya tenés, cubrís {pesos} al precio de ahora.
      </>
    ),
    /** When there is nothing to send for the week, or no rate to say how much. */
    sendUsdt: "Mandá USDT a tu cuenta del fondo desde Binance o cualquier exchange.",
    /** Binance's minimum goes after either: `min` stands out. The second is for when the week needs less than that. */
    binanceMinimum: (min: ReactNode) => <>Si lo retirás de Binance, el mínimo es {min}.</>,
    binanceMinimumLeftover: (min: ReactNode) => <>Si lo retirás de Binance, el mínimo es {min}: lo que sobre queda en tu cuenta para la próxima.</>,
    /** The wARS tab: Ripio's app is where they come from. */
    ripioWithdraw: "En la app de Ripio, retirá wARS por la red Celo a tu cuenta del fondo. O cargalos directo:",
    loadWithRipio: "Cargar pesos con Ripio",
    /** The member's contribution went out and has no receipt yet. */
    onItsWay: "Tu aporte está en camino. Cuando se confirme, lo ves en el fondo.",
    nothingYet: "Todavía no llegó nada. Cuando llegue, aparece acá; puede tardar unos minutos.",
    /** The fund is at its cap, in the panel: `cap` stands out. */
    capReachedNotice: (cap: ReactNode) => <>El fondo llegó a su tope de {cap}: no entra más.</>,
    amountLabel: "Cuánto aportás",
    /** The button: `amount` is the one that will go in. */
    submit: (amount: string) => `Aportar ${amount}`,
    /** What is wrong with what was typed, as plain text under the field. */
    accountHolds: (held: string) => `En tu cuenta tenés ${held}.`,
    capReached: (cap: string) => `El fondo llegó a su tope de ${cap}: no entra más.`,
    roomLeft: (room: string, cap: string) => `Al fondo le entran hasta ${room} más, porque tiene un tope de ${cap}.`,
    usdtFormat: "Escribilo como 6 o 6,25.",
    /** Under the USDT field: that it covers this week's contribution, or what it comes to. */
    covers: (pesos: string) => `Cubre los ${pesos}, al precio de ahora.`,
    worth: (pesos: string) => `Son unos ${pesos} al precio de ahora.`,
  },
  /** Cargar un gasto (spec, 9, pantalla 6). */
  expense: {
    which: "¿Qué gasto es?",
    /** The first option: `expense` is what the creator wrote. */
    agreed: (expense: string) => `${expense} (el gasto acordado)`,
    other: "Otro gasto (se vota)",
    amountLabel: "Cuánto pagaste",
    /** An example in the empty field: written the way this language writes amounts. */
    amountPlaceholder: "45.000",
    noteLabel: "Nota (opcional)",
    notePlaceholder: "La cancha del jueves",
    submit: "Cargar el gasto",
    looking: "El agente lo está mirando…",
    /** The same kind and amount as one loaded a few minutes ago: `amount` stands out. */
    twin: (amount: ReactNode) => <>Hace unos minutos cargaste un gasto de {amount}. ¿Es otro gasto igual?</>,
    another: "Sí, es otro",
    same: "No, es el mismo",
  },
  /** What happened to an expense a member loaded, by its status: the panel and the agent's card say the same. */
  outcome: {
    reimbursed: "Listo: el agente te devolvió la plata.",
    proposed: "No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.",
    waiting: "El fondo todavía no tiene esos pesos: el agente te lo devuelve cuando entren.",
    rejected: "El agente no puede devolver este gasto.",
    blocked: "No se pudo procesar ahora. El agente lo vuelve a intentar en un rato.",
    sending: "El agente ya lo mandó. En un rato aparece en los movimientos.",
    /** Anything else: the expense is saved and the agent hasn't looked yet. */
    new: "El agente está ocupado: lo procesa en unos minutos.",
  },
  /** Pasar a pesos (spec, 9, pantalla 8, and 9.2): the member's wARS, to their Ripio address. */
  cashOut: {
    /** After a pass that went well: `amount` stands out. */
    passed: (amount: ReactNode) => <>Pasaste {amount} a Ripio. En un minuto lo ves en la app: ahí lo vendés 1:1 a pesos y lo pasás a tu banco.</>,
    depositInstructions: "En la app de Ripio tocá Depositar, elegí wARS y la red Celo, y copiá la dirección.",
    addressLabel: "Tu dirección de Ripio",
    /** Over the address this browser remembers. */
    savedAddress: "A tu cuenta de Ripio",
    change: "Cambiar",
    onItsWay: "Tu pase a pesos está en camino.",
    nothingToPass: "No tenés pesos en tu cuenta para pasar.",
    amountLabel: "Cuánto pasás",
    submit: "Pasar a Ripio",
    /** The button once there is an amount: `amount` is the one that will go. */
    submitAmount: (amount: string) => `Pasar ${amount} a Ripio`,
    /** What is wrong with the address pasted as the Ripio one. */
    badAddress: "Esa dirección no parece válida. Copiala de nuevo desde Ripio.",
    ownAccount: "Esa es tu cuenta del fondo. Pegá la de Ripio.",
    ours: "Esa dirección es de TesorerIA, no de Ripio.",
    /** What is wrong with the amount typed: more than the account holds. */
    accountHolds: (held: string) => `Tenés ${held} en tu cuenta.`,
  },
  /** An address on Celo, wherever money is sent to one (spec, 9.2). */
  network: {
    warning: "Elegí la red CELO. Si elegís otra, la plata se pierde.",
    copy: "Copiar la dirección",
    copied: "Copiada",
    /** For screen readers, and when the copy didn't work. */
    copiedStatus: "Dirección copiada.",
    copyFailed: "No se pudo copiar. Seleccioná la dirección y copiala.",
  },
  /** Votar, on an open proposal; "Votaste" afterwards is `movements.voted`. */
  vote: {
    button: "Votar",
  },
  /** Ejecutar, on a proposal that has its votes. */
  execute: {
    button: "Ejecutar",
  },
  /** The chat with the agent (spec, 9.2 and 9.3): what its route answers, its panel, its card, and the brief's fixed text. */
  chat: {
    /** What the chat says when something stops it (spec, 8.2 and 9.2), in the interface's voice. */
    unavailable: "El agente no puede responder ahora. Probá más tarde.",
    memberLimit: "Por hoy ya hablamos bastante. Mañana seguimos.",
    refused: "No puedo ayudarte con eso.",
    badCard: "No pude armar el gasto. Contame de nuevo el monto y qué fue.",
    sendFailed: "No pudimos mandar tu mensaje.",
    /** `max` is the most letters a message may have. */
    longMessage: (max: number) => `Tu mensaje puede tener hasta ${max} letras.`,
    badRequest: "Faltan datos o no son válidos.",
    notFound: "No encontramos ese fondo.",
    /** The messages left today, said from 5 down. */
    remaining: (n: number) => (n === 1 ? "Te queda 1 mensaje por hoy." : `Te quedan ${n} mensajes por hoy.`),
    greeting: (name: string) => `Hola, ${name}. Preguntame lo que quieras del fondo.`,
    /** Tapping one sends it as the member's own words, so they come in the page's language. */
    suggestions: ["¿Quién debe esta semana?", "¿Cuánto queda del tope de la semana?", "Quiero cargar un gasto"],
    /** Before the three dots that move. */
    typing: "El agente está escribiendo",
    questionLabel: "Tu pregunta",
    placeholder: "Escribí tu pregunta",
    send: "Mandar",
    /** Under the field from 400 letters: how many there are, of the most a message may have. */
    count: (used: number, max: number) => `${used} de ${max}`,
    /** The card the agent shows to load an expense. */
    card: {
      otherExpense: "Otro gasto",
      /** `left` is what remains of the week's cap. */
      agreedNext: (left: string) => `Si entra en lo que queda del tope de la semana (${left}), te lo devuelvo enseguida. Si no, se vota.`,
      otherNext: (votes: number, members: number) => `Se vota: necesita ${votes} de ${members} votos.`,
      /** For screen readers, over each line of the card. */
      kindLabel: "Qué gasto es",
      amountLabel: "Cuánto",
      noteLabel: "Nota",
      confirm: "Confirmar",
      cancel: "Cancelar",
      /** After the member tells the agent not to load it. */
      notLoaded: "No lo cargué.",
    },
    /**
     * What the model reads of the fund (spec, 8.2): the fixed text around the screen's own amounts and sentences. Each
     * function takes its values already formatted; the leading spaces of `reason`, `youVoted` and `closed` are part of them.
     */
    brief: {
      agent: "El agente",
      group: "El grupo",
      /** What a full address a member wrote becomes: the model never reads one. */
      account: "una cuenta",
      reason: (detail: string) => ` Motivo: ${detail}`,
      youVoted: " Ya la votaste.",
      /** `today` is the date and time, in words; `week` counts from 1. */
      now: (today: string, week: string) => `Ahora es ${today}, hora de Argentina. El fondo va por su semana ${week}.`,
      fund: (name: string, balance: string) => `Fondo: ${name}. Saldo: ${balance}.`,
      closed: " El fondo está cerrado.",
      rules: (fee: string, cap: string, expense: string, spent: string, left: string, votes: number, members: number) =>
        `Reglas: cada uno pone ${fee} por semana. El agente devuelve hasta ${cap} por semana por ${expense}, el gasto acordado: esta semana devolvió ${spent} y quedan ${left}. Todo lo demás necesita ${votes} de ${members} votos. Nadie puede cambiar esto solo, ni el agente.`,
      speaking: (name: string) => `Te habla: ${name}.`,
      owe: (amount: string) => `Debés ${amount}.`,
      upToDateAhead: (amount: string) => `Estás al día, con ${amount} adelantados.`,
      upToDate: "Estás al día.",
      /** `standing` is one of the three sentences above; `share` is what they'd get if the fund closed today. */
      situation: (standing: string, share: string) => `Tu situación: ${standing} Si el fondo se cerrara hoy, te tocarían ${share}.`,
      weekList: "La lista de la semana, en el orden en que entraron:",
      noProposals: "Propuestas abiertas: ninguna.",
      proposals: "Propuestas abiertas:",
      noMovements: "Movimientos: todavía no hay.",
      /** When there are more than the brief carries: `shown` of `total`. */
      movementsCut: (shown: number, total: number) => `Movimientos, del más nuevo al más viejo (los ${shown} más nuevos de ${total}; los anteriores no los ves):`,
      movements: "Movimientos, del más nuevo al más viejo:",
    },
  },
};

export type Messages = typeof es;
