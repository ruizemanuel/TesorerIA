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
};

export type Messages = typeof es;
