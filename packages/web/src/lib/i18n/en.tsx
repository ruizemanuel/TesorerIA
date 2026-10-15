import type { ReactNode } from "react";
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
  common: {
    you: " (you)",
    confirm: "Confirm with your fingerprint, face or PIN",
    sending: "Sending…",
  },
  errors: {
    logIn: "Log in with your passkey.",
    fundNotFound: "We couldn't find that fund.",
    badRequest: "Some details are missing or aren't valid.",
    failed: "Something went wrong. Try again.",
    onItsWay: "Your operation is on its way. You'll see it here in a few minutes: don't send it again.",
    cancelled: "You cancelled the confirmation. Try again.",
    generic: "It couldn't be completed. Try again in a while.",
    noPasskey: "You couldn't log in. If your passkey doesn't show up, try from the phone where you created your account.",
    wrongPasskey: "Your passkey doesn't match your account. Log in again.",
    notCompleted: "The operation couldn't be completed. No money moved.",
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
  home: {
    title: "The group's treasury, without a treasurer.",
    lead: "A fund in pesos for your group, run by an agent with limits that no one can change alone.",
    create: "Create a fund",
    seeReal: "See a real fund",
    logIn: "Log in",
    haveFund: "I already have a fund: log in",
    live: (name: ReactNode) => <>{name}, live.</>,
    howItWorks: "How it works",
    steps: [
      "You set up the fund and add your friends with a link.",
      "Each one puts in their weekly dues, in pesos or in USDT.",
      "The agent pays back what was agreed, keeps track of who is behind, and everything else is voted on.",
    ],
    judges: (celo: ReactNode, contract: ReactNode, agent: ReactNode, code: ReactNode) => (
      <>
        Runs on {celo}, with {contract}, {agent} and {code}.
      </>
    ),
    judgesLinks: {
      celo: "Celo mainnet",
      contract: "the verified contract",
      agent: "the agent registered in ERC-8004 (#9887)",
      code: "the open-source code",
    },
  },
  notFound: {
    title: "We couldn't find that page",
    body: "The link may be wrong, or you may not be part of this fund.",
    home: "Go to the home page",
  },
  login: {
    title: "Log in to your fund",
    lead: "Use the passkey you created when you joined. Your phone will ask for it.",
    firstTime: (create: ReactNode) => <>First time here? Open the invitation link you were sent, or {create}.</>,
    createLink: "create a fund",
    button: "Log in with my passkey",
    logOut: "Log out",
  },
  create: {
    title: "Set up the group's fund",
    lead: "Next we'll give you a link to send on WhatsApp. When at least 3 people have joined, you create the fund. The votes needed are chosen at that point.",
    fundName: "Fund name",
    weeklyFee: "Each person's weekly dues",
    agreedExpense: "Agreed expense",
    agreedExpenseHint: "The agent pays it back without a vote, up to each week's cap.",
    weeklyCap: "Weekly cap for that expense",
    defaults: {
      fundNamePlaceholder: "Thursday football",
      weeklyFee: "10,000",
      agreedExpense: "the pitch",
      weeklyCap: "60,000",
    },
    creating: "Creating…",
    submit: "Create fund",
    submitWithPasskey: "Create my passkey and the fund",
  },
  deploy: {
    joined: "Who has joined",
    shareTitle: "Share this link with the group",
    waitingForMembers: "When at least 3 people have joined, you'll be able to create the fund.",
    waitingForCreator: (creator: string) => `When everyone is in, ${creator} creates the fund and it gets going.`,
    votesNeeded: "Votes needed for anything that isn't the agreed expense",
    votesOption: (n: number, members: number) => `${n} of ${members}`,
    creating: "Creating fund…",
    submit: "Create fund",
  },
  share: {
    whatsApp: (fundName: string, url: string) => `Join the fund "${fundName}" on TesorerIA: ${url}`,
    send: "Send on WhatsApp",
    copy: "Copy the link",
    copied: "Copied",
  },
  person: {
    name: "Your name",
  },
  invitation: {
    title: (creator: string, fund: ReactNode) => (
      <>
        {creator} invited you to {fund}
      </>
    ),
    rules: (fee: ReactNode, cap: ReactNode, expense: string) => (
      <>
        Each person puts in {fee} per week. The agent pays back up to {cap} per week for {expense}. Everything else is voted on. No one can change this
        alone, not even the agent.
      </>
    ),
    passkeyNote: "Your account is protected by a passkey: your fingerprint, your face or your phone's PIN. There's no password or phrase to keep.",
    join: "Join",
    alreadyJoined: (names: string) => `Already joined: ${names}.`,
    full: "This fund is already full.",
    beingCreated: "This fund is already being created.",
    running: "This fund is already running.",
    goToFund: "Go to the fund",
  },
};
