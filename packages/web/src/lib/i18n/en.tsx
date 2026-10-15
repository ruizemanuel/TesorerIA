import type { Messages } from "./es";

/** Everything the web says, in English (spec, 9.3): the voice and the glossary of the spec, never a word of jargon. */
export const en: Messages = {
  locale: "en",
  meta: {
    description: "The group's treasury, without a treasurer.",
  },
  language: {
    label: "Language",
  },
  errors: {
    logIn: "Log in with your passkey.",
    fundNotFound: "We couldn't find that fund.",
    badRequest: "Some details are missing or aren't valid.",
    failed: "Something went wrong. Try again.",
    amountFormat: "Write it like 10,000 or 10,000.50.",
    notInAFund: "You aren't in any fund.",
    agentJustRan: "The agent just ran.",
    notYourDraft: "That draft isn't yours.",
  },
  checks: {
    personName: "Enter your name, up to 30 letters.",
    personEmail: "That email doesn't look valid.",
    fundName: "Enter a name for the fund, up to 40 letters.",
    agreedExpense: "Enter what the agreed expense is, up to 40 letters.",
    feeZero: "The weekly dues have to be more than zero.",
    capZero: "The weekly cap has to be more than zero.",
    feeTooBig: (max: string) => `The weekly dues can't be more than ${max}.`,
    capTooBig: (max: string) => `The weekly cap can't be more than ${max}.`,
    feeUnreadable: "We couldn't read the weekly dues. Write them like 10,000 or 10,000.50.",
    capUnreadable: "We couldn't read the weekly cap. Write it like 60,000 or 60,000.50.",
  },
  funds: {
    badInvite: "That invitation link isn't valid.",
    alreadyLive: "The fund is already running: ask someone in the group to propose adding you.",
    alreadyCreated: "The fund is already created.",
    onlyCreator: "Only the person who set up the fund can create it.",
    beingCreated: "The fund is being created right now. Try again in a little while.",
    unconfirmed: "The operation isn't confirmed yet. Try again in a little while.",
    full: "The fund already has 10 people, which is the most it can have.",
    mismatch: "A fund was already created from your account, but with other details. Don't create it again: you'd have two.",
    accountCap: (max: number) =>
      `Your account has already used its ${max} tries to create a fund that TesorerIA pays for. Write to us and we'll unblock it.`,
    dayCap: "Many funds were created in TesorerIA today already. Try again tomorrow.",
    tooFewMembers: "You need at least 3 people to create the fund.",
    tooManyMembers: (max: number, n: number) => `A fund can have up to ${max} people, and this one has ${n}.`,
    votesRange: (n: number) => `With ${n} people, the votes needed go from 2 to ${n - 1}.`,
    votesLocked: (votes: number) => `You've already started creating the fund with ${votes} votes needed: pick ${votes} to continue.`,
    createFirst: "Create the fund first.",
    notInOperation: "We couldn't find the fund in that operation.",
  },
  auth: {
    late: "Too much time went by. Try again.",
    badPasskey: "We couldn't create your passkey. Try again.",
    taken: "That passkey already has an account. Log in with it.",
    unknownPasskey: "We couldn't recognize your passkey.",
  },
  expenses: {
    amountUnreadable: "We couldn't read the amount.",
    amountZero: "The amount has to be more than zero.",
    amountTooBig: (max: string) => `The amount can't be more than ${max}.`,
    noteTooLong: (max: number) => `The note can be up to ${max} letters long.`,
  },
};
