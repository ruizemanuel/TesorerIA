import type { ReactNode } from "react";
import type { Locale } from "./locales";

/**
 * Everything the web says, in Rioplatense Spanish (spec, 9.3): the texts it always had, moved here word for word.
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
  /** What the API answers when a request fails (spec, 9.3): the browser shows each as the route wrote it. */
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
    someone: "alguien",
    newAccount: "una cuenta nueva",
    /** Who the viewer's own operations on their way are. */
    you: "Vos",
    contributed: (who: string, what: string) => `${who} aportó ${what}.`,
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
      byMember: (who: string, what: string) => `${who} propuso ${what}.`,
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
    memberRemoved: (who: string) => `${who} dejó el fondo y se llevó su parte.`,
    memberReplaced: (who: string) => `${who} cambió de cuenta.`,
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
};

export type Messages = typeof es;
