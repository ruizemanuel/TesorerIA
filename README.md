# TesorerIA

**The group's treasury, without a treasurer.**

TesorerIA is an AI treasurer for a group's shared fund in Argentine pesos (wARS) on Celo. Members contribute to a smart contract. The agent converts USDT to wARS, reimburses the expense the group agreed on (up to a weekly cap), reminds members who are behind, and puts everything else to a vote. The contract enforces the limits: the agent can only pay members, never above the cap, and can't change the rules.

Built for the [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon (Celo × Ripio), track Stable Agents: LatAm.

Status: early development.

## The agent

`packages/agent` is the agent's deterministic core: TypeScript and viem, no language model. It is the only part that signs, and every transaction it sends pays its gas in USDT (CIP-64) and carries the ERC-8021 attribution suffix.

- **Convert:** when a fund holds 5 USDT or more, the agent swaps them for wARS in the Uniswap v3 pool, as long as Chainlink's USD / ARS (Base) is less than 26 hours old, the pool holds at least 10 times the wARS the conversion takes, and the pool's price is within 2% of Chainlink's USD / ARS × USDT / USD. Its `minWarsOut` sits 0.5% under Uniswap's quote, not at the contract's 2% floor.
- **Pay back the agreed expense:** when a member enters it and it fits in what's left of the week's cap, never twice for the same expense (the contract doesn't check that). Anything else becomes a payment proposal for the members to vote on.
- **Reminders:** it works out what each member owes at the group's weekly fee, and what each one would get if the fund closed today.

Its own limits, on top of the contract's: it only pays addresses the contract lists as members, never one taken from text a person or a model wrote; at most 100,000 wARS per reimbursement and 150,000 wARS a day per fund, 500 USDT per conversion and 1,000 USDT a day, and 20 transactions a day per fund. A reimbursement over a limit becomes a proposal. Every decision, including what it didn't do and why, comes back as an entry for the fund's timeline.

    pnpm --filter @tesoreria/agent test         # the rules, with fixed data
    pnpm --filter @tesoreria/agent test:fork    # the agent against a fork of Celo mainnet and the deployed FundFactory
    pnpm --filter @tesoreria/agent agent:tick   # one heartbeat on Celo mainnet; a dry run unless --send

Its ERC-8004 registration file is [`packages/agent/registration.json`](packages/agent/registration.json), generated from the code with `pnpm --filter @tesoreria/agent registration:write`.

## On Celo mainnet

| What | Address |
|---|---|
| `FundFactory` | `0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020` |
| Agent wallet (controlled by the team; pays its gas in USDT and tags every transaction with `celo_fbe4d00a2cb4`) | `0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671` |
| Agent's ERC-8004 identity (Identity Registry `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) | agent id `9887`, registered in transaction `0xdc78602c45a837b248b78ac02eccbe90ff601c18ba3ec468c79905ddd3c328ff` |

The agent wallet deployed the factory in transaction `0x0e96c1e48e0e95c6b734a64e0f9c452dfa9d35bcc33dfa10268af5cdeaee60dc` (block `79659548`). The factory has no owner: deploying it grants no privileges.

## Team test wallets

These addresses belong to the TesorerIA team and are used only for testing. They are not users.

| Address | What it is |
|---|---|
| `0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F` | Safe 1.4.1 smart account owned by a team passkey on `localhost`, created with `probes/passkey` to test sponsored, tagged UserOperations on Celo mainnet. |
