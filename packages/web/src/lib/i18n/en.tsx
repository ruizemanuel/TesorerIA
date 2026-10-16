import type { ReactNode } from "react";
import type { Messages } from "./es";

const SOMEONE = "someone";
const NEW_ACCOUNT = "a new account";

/** The two stand-ins for a name, as they read where they start a sentence. */
const STAND_INS = new Map([
  [SOMEONE, "Someone"],
  [NEW_ACCOUNT, "A new account"],
]);

/** Capitalizes a stand-in where it starts a sentence, and leaves a member's name as they wrote it (spec, 9.3). */
const sentenceStart = (who: string) => STAND_INS.get(who) ?? who;

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
    member: (n: number) => `Member ${n}`,
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
    amountTooBig: (max: string) => `It can't be more than ${max}.`,
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
    alreadyMember: "You're already in this fund.",
    liveFull: "The fund already has 10 members, which is the most it can have.",
    manyRequests: "Many people are already asking to join this fund. Try again in a few days.",
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
  summary: {
    heading: (week: number, from: string, to: string) => `Week ${week} summary (${from} to ${to})`,
    balance: (amount: string) => `The fund holds ${amount}.`,
    paid: (paid: number, members: number) => `${paid} of ${members} paid their dues. Still owing:`,
    owes: (who: string, amount: string) => `${sentenceStart(who)}, ${amount}`,
    allPaid: "Everyone paid their dues.",
    happened: "What happened:",
    contributed: (amount: string) => `Together you contributed ${amount}.`,
    /** `what` is timeline.proposal.pay: "paying Ale ARS 8,000 for las pelotas". */
    approvedPayment: (what: string) => `${what.charAt(0).toUpperCase()}${what.slice(1)} was approved.`,
    nothing: "No activity this week.",
    toContribute: (link: string) => `To contribute: ${link}`,
    copy: "Copy",
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
  timeline: {
    someone: SOMEONE,
    newAccount: NEW_ACCOUNT,
    you: "You",
    contributed: (who: string, what: string) => `${sentenceStart(who)} contributed ${what}.`,
    converted: (usdt: string, pesos: string) => `I changed the ${usdt} that came in into pesos: ${pesos}.`,
    convertedDetail: "I changed them into pesos and checked that the price wasn't more than 2 % away from the dollar's reference price, as my rules say.",
    reimbursed: (amount: string, who: string, expense: string) => `I paid ${who} back ${amount} for ${expense}.`,
    reimbursedLeftThisWeek: (left: string) => `This week's cap has ${left} left.`,
    reimbursedLeftThatWeek: (left: string) => `That week's cap had ${left} left.`,
    reimbursedDetail: (expense: string, cap: string) => `It was ${expense}, which I pay back without a vote up to ${cap} per week.`,
    proposal: {
      byAgent: (what: string) => `I proposed ${what}.`,
      byMember: (who: string, what: string) => `${sentenceStart(who)} proposed ${what}.`,
      agentDetail: (votes: number) => `What I can't pay back on my own has to be voted on: ${votes} votes are needed.`,
      pay: (amount: string, who: string, note: string) => `paying ${who} ${amount}${note ? ` for ${note}` : ""}`,
      addMember: "adding a new account to the fund",
      removeMember: (who: string) => `removing ${who} from the fund`,
      replaceMember: (who: string) => `changing ${who}'s account`,
      setWeeklyCap: (expense: string, cap: string) => `changing the weekly cap for ${expense} to ${cap}`,
      setVotesRequired: (votes: number, expense: string) => `requiring ${votes} votes for anything that isn't ${expense}`,
      setAgent: "changing the agent",
      close: "closing the fund and splitting the balance",
      approved: "It was approved.",
      expiredWithVotes: "It expired without being carried out.",
      expiredWithoutVotes: "It expired without the votes it needed.",
      short: (amount: string) => `It has the votes, but the fund needs ${amount} more to pay it.`,
      needsCarryingOut: "It has the votes: it still needs to be carried out.",
      votes: (votes: number, required: number) => `It has ${votes} of ${required} votes.`,
    },
    paid: (amount: string, who: string) => `The fund paid ${who} ${amount}: the proposal was approved.`,
    memberAdded: (who: string) => `${sentenceStart(who)} joined the fund.`,
    weekClosed: (week: number) => `I closed week ${week}. Here's the summary for the group.`,
    memberRemoved: (who: string) => `${sentenceStart(who)} left the fund and took their share.`,
    memberReplaced: (who: string) => `${sentenceStart(who)} switched accounts.`,
    weeklyCapChanged: (expense: string, cap: string) => `The weekly cap for ${expense} is now ${cap}.`,
    votesRequiredChanged: (votes: number, expense: string) => `Now ${votes} votes are needed for anything that isn't ${expense}.`,
    agentChanged: "The fund's agent was changed.",
    fundClosed: "The fund was closed and the balance was split according to what each person contributed.",
    remainderDistributed: "What arrived after the fund closed was split among the members.",
    hold: (usdt: string, why: string) => `I haven't changed ${usdt} into pesos yet: ${why}. I'll try again in a few minutes.`,
    holdWhy: {
      "daily-limit": "I've already changed all I can change in a day for this fund",
      "price-reference": "the dollar's reference price isn't up to date",
      "pool-depth": "the market where I change them doesn't have enough pesos",
      "price-gap": "the market price is more than 2 % away from the reference",
      "price-floor": "the market pays less than my rules allow",
      other: "I couldn't make the trade",
    },
    expense: {
      what: (amount: string, by: string, note: string) => `the ${amount} expense that ${by} added${note ? ` (${note})` : ""}`,
      looking: (what: string) => `I'm looking at ${what}.`,
      waiting: (what: string) => `I've saved ${what}: I'll pay it back when the fund has the pesos.`,
      blocked: (what: string) => `I couldn't process ${what}. I'll try again in a while.`,
      rejected: (what: string) => `I can't pay back ${what}.`,
    },
    onItsWay: {
      vote: "Your vote is on its way.",
      execute: "Your action to carry out the proposal is on its way.",
      propose: "Your proposal is on its way.",
      contribution: (what: string) => `Your contribution of ${what} is on its way.`,
    },
  },
  fund: {
    inFund: "In the fund",
    owe: (amount: ReactNode) => <>You owe {amount}.</>,
    upToDateAhead: (amount: ReactNode) => <>You're up to date, {amount} ahead.</>,
    upToDate: "You're up to date.",
    share: (amount: ReactNode) => <>If the fund closed today, you'd get {amount}.</>,
    contribute: "Contribute",
    addExpense: "Add an expense",
    inYourAccount: (amounts: ReactNode) => <>You have {amounts} in your account.</>,
    and: "and",
    cashOut: "Cash out to pesos",
    publicNotice: "You're looking at a real fund, read-only.",
    loading: "Loading",
  },
  week: {
    title: "This week",
    dues: (amount: string) => `Weekly dues: ${amount}`,
    owes: (amount: string) => `owes ${amount}`,
    paid: "paid",
  },
  rules: {
    title: "The rules",
    text: (cap: ReactNode, expense: string, left: ReactNode, votes: number, members: number) => (
      <>
        The agent pays back up to {cap} per week for {expense}. This week's cap has {left} left. Everything else needs {votes} of {members} votes. No
        one can change this alone, not even the agent.
      </>
    ),
  },
  nav: {
    home: "Home",
    activity: "Activity",
    agent: "Agent",
    account: "Your account",
    sections: "Fund sections",
    askAgent: "Ask the agent",
  },
  movements: {
    title: "Activity",
    latest: "Latest from the agent",
    seeAll: "See all",
    empty: "No activity yet. The first one can be your contribution.",
    onItsWay: "On its way",
    viewReceipt: "View receipt",
    viewSummary: "See the summary",
    voted: "You voted",
  },
  receipt: {
    viewOnExplorer: "View on the Celo explorer",
  },
  fundError: {
    title: "We couldn't read the fund right now.",
    moneyIsFine: "The money is fine: it's the reading that failed.",
    tryLater: "Try again in a while.",
    retrying: "We'll try again in a few seconds.",
    retry: "Try again",
  },
  panels: {
    back: "Back",
    titles: {
      aportar: "Contribute",
      gasto: "Add an expense",
      cuenta: "Your account",
      pesos: "Cash out to pesos",
      agente: "Agent",
      comprobante: "Receipt",
      resumen: "Week summary",
    },
  },
  account: {
    reading: "Looking at your account…",
    readFailed: "We couldn't look at your account. We'll try again in a few seconds.",
    youHave: (amount: ReactNode) => <>You have {amount} in your account.</>,
    loggedInAs: (name: string) => `You're logged in as ${name}.`,
    holds: (pesos: ReactNode) => <>Your account holds {pesos}</>,
    holdsAnd: (pesos: ReactNode, usdt: ReactNode) => (
      <>
        Your account holds {pesos} and {usdt}
      </>
    ),
    reimbursementsLand: "This is where the agent's reimbursements arrive.",
    cashOut: "Cash out to pesos with Ripio",
    nothingYet: "When the agent pays you back for an expense, you'll see it here.",
  },
  contribute: {
    haveUsdt: "I have USDT",
    havePesos: "I have pesos in Ripio",
    sendAtLeast: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Send at least {usdt} to your fund account from Binance or any exchange: with that you cover {pesos} at the current price.
      </>
    ),
    sendAtLeastMore: (usdt: ReactNode, pesos: ReactNode) => (
      <>
        Send at least {usdt} more to your fund account from Binance or any exchange: with what you already have, you cover {pesos} at the current price.
      </>
    ),
    sendUsdt: "Send USDT to your fund account from Binance or any exchange.",
    binanceMinimum: (min: ReactNode) => <>If you withdraw it from Binance, the minimum is {min}.</>,
    binanceMinimumLeftover: (min: ReactNode) => (
      <>If you withdraw it from Binance, the minimum is {min}: whatever is left over stays in your account for next time.</>
    ),
    ripioWithdraw: "In the Ripio app, withdraw wARS over the Celo network to your fund account. Or load them directly:",
    loadWithRipio: "Load pesos with Ripio",
    onItsWay: "Your contribution is on its way. Once it's confirmed, you'll see it in the fund.",
    nothingYet: "Nothing has arrived yet. When it does, it'll show up here; it can take a few minutes.",
    capReachedNotice: (cap: ReactNode) => <>The fund reached its cap of {cap}: no more fits.</>,
    amountLabel: "How much to contribute",
    submit: (amount: string) => `Contribute ${amount}`,
    accountHolds: (held: string) => `Your account holds ${held}.`,
    capReached: (cap: string) => `The fund reached its cap of ${cap}: no more fits.`,
    roomLeft: (room: string, cap: string) => `The fund has room for up to ${room} more, because its cap is ${cap}.`,
    usdtFormat: "Write it like 6 or 6.25.",
    covers: (pesos: string) => `That covers ${pesos} at the current price.`,
    worth: (pesos: string) => `That comes to about ${pesos} at the current price.`,
  },
  expense: {
    which: "Which expense is it?",
    agreed: (expense: string) => `${expense} (the agreed expense)`,
    other: "Other expense (voted on)",
    amountLabel: "How much you paid",
    amountPlaceholder: "45,000",
    noteLabel: "Note (optional)",
    notePlaceholder: "Thursday's pitch",
    submit: "Add the expense",
    looking: "The agent is looking at it…",
    twin: (amount: ReactNode) => <>A few minutes ago you added an expense of {amount}. Is this another expense just like it?</>,
    another: "Yes, it's another one",
    same: "No, it's the same one",
  },
  outcome: {
    reimbursed: "Done: the agent paid you back.",
    proposed: "It couldn't go through without a vote: the agent proposed it and now the group votes on it.",
    waiting: "The fund doesn't have those pesos yet: the agent pays you back when they arrive.",
    rejected: "The agent can't pay this expense back.",
    blocked: "It couldn't be processed right now. The agent will try again in a while.",
    sending: "The agent already sent it. It'll show up in the activity in a while.",
    new: "The agent is busy: it'll process it in a few minutes.",
  },
  cashOut: {
    passed: (amount: ReactNode) => (
      <>You cashed out {amount} to Ripio. In a minute you'll see it in the app: there you sell it 1:1 for pesos and move it to your bank.</>
    ),
    depositInstructions: "In the Ripio app, tap Depositar (Deposit), pick wARS and the Celo network, and copy the address.",
    addressLabel: "Your Ripio address",
    savedAddress: "To your Ripio account",
    change: "Change",
    onItsWay: "Your cash-out to pesos is on its way.",
    nothingToPass: "You have no pesos in your account to cash out.",
    amountLabel: "How much to cash out",
    submit: "Cash out to Ripio",
    submitAmount: (amount: string) => `Cash out ${amount} to Ripio`,
    badAddress: "That address doesn't look valid. Copy it again from Ripio.",
    ownAccount: "That's your fund account. Paste your Ripio one.",
    ours: "That address belongs to TesorerIA, not Ripio.",
    accountHolds: (held: string) => `You have ${held} in your account.`,
  },
  network: {
    warning: "Choose the CELO network. If you choose another, the money is lost.",
    copy: "Copy the address",
    copied: "Copied",
    copiedStatus: "Address copied.",
    copyFailed: "Couldn't copy it. Select the address and copy it.",
  },
  vote: {
    button: "Vote",
  },
  execute: {
    button: "Carry out",
  },
  chat: {
    unavailable: "The agent can't answer right now. Try again later.",
    memberLimit: "We've talked enough for today. We'll pick this up tomorrow.",
    refused: "I can't help you with that.",
    badCard: "I couldn't put the expense together. Tell me the amount and what it was for again.",
    sendFailed: "We couldn't send your message.",
    longMessage: (max: number) => `Your message can be up to ${max} characters.`,
    badRequest: "Some details are missing or aren't valid.",
    notFound: "We couldn't find that fund.",
    remaining: (n: number) => (n === 1 ? "You have 1 message left today." : `You have ${n} messages left today.`),
    greeting: (name: string) => `Hi, ${name}. Ask me anything about the fund.`,
    suggestions: ["Who owes this week?", "How much is left of the weekly cap?", "I want to add an expense"],
    typing: "The agent is typing",
    questionLabel: "Your question",
    placeholder: "Write your question",
    send: "Send",
    count: (used: number, max: number) => `${used} of ${max}`,
    card: {
      otherExpense: "Other expense",
      agreedNext: (left: string) => `If it fits in what's left of the weekly cap (${left}), I'll pay you back right away. If not, it goes to a vote.`,
      otherNext: (votes: number, members: number) => `It goes to a vote: it needs ${votes} of ${members} votes.`,
      kindLabel: "Which expense it is",
      amountLabel: "How much",
      noteLabel: "Note",
      confirm: "Confirm",
      cancel: "Cancel",
      notLoaded: "I didn't add it.",
    },
    brief: {
      agent: "The agent",
      group: "The group",
      account: "an account",
      reason: (detail: string) => ` Reason: ${detail}`,
      youVoted: " You already voted on it.",
      now: (today: string, week: string) => `It's ${today}, Argentina time. The fund is in week ${week}.`,
      fund: (name: string, balance: string) => `Fund: ${name}. Balance: ${balance}.`,
      closed: " The fund is closed.",
      rules: (fee: string, cap: string, expense: string, spent: string, left: string, votes: number, members: number) =>
        `Rules: each person puts in ${fee} per week. The agent pays back up to ${cap} per week for ${expense}, the agreed expense: this week it has paid back ${spent} and ${left} is left. Everything else needs ${votes} of ${members} votes. No one can change this alone, not even the agent.`,
      speaking: (name: string) => `Who's asking: ${name}.`,
      owe: (amount: string) => `You owe ${amount}.`,
      upToDateAhead: (amount: string) => `You're up to date, ${amount} ahead.`,
      upToDate: "You're up to date.",
      situation: (standing: string, share: string) => `Your situation: ${standing} If the fund closed today, you'd get ${share}.`,
      weekList: "This week's list, in the order they joined:",
      noProposals: "Open proposals: none.",
      proposals: "Open proposals:",
      noMovements: "Activity: none yet.",
      movementsCut: (shown: number, total: number) => `Activity, newest first (the newest ${shown} of ${total}; you can't see the older ones):`,
      movements: "Activity, newest first:",
    },
  },
};
