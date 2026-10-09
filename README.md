# TesorerIA

**The group's treasury, without a treasurer.**

TesorerIA is an AI treasurer for a group's shared fund in Argentine pesos (wARS) on Celo. Members contribute to a smart contract. The agent converts USDT to wARS, reimburses the expense the group agreed on (up to a weekly cap), reminds members who are behind, and puts everything else to a vote. The contract enforces the limits: the agent can only pay members, never above the cap, and can't change the rules.

Built for the [Agents on Open Rails](https://www.loops.house/agents-on-open-rails) hackathon (Celo × Ripio), track Stable Agents: LatAm.

Status: early development.

## On Celo mainnet

| What | Address |
|---|---|
| `FundFactory` | `0xdF3B0d9edCA58Aac7c9Db4F2931f3559daf82020` |
| Agent wallet (controlled by the team; pays its gas in USDT and tags every transaction with `celo_fbe4d00a2cb4`) | `0x6BE3c1eB63A4edbc6C23c281F93F81B14eF3a671` |

The agent wallet deployed the factory in transaction `0x0e96c1e48e0e95c6b734a64e0f9c452dfa9d35bcc33dfa10268af5cdeaee60dc` (block `79659548`). The factory has no owner: deploying it grants no privileges.

## Team test wallets

These addresses belong to the TesorerIA team and are used only for testing. They are not users.

| Address | What it is |
|---|---|
| `0x2F8218c7cF6d822091EDe24Db9c46B0324c21A6F` | Safe 1.4.1 smart account owned by a team passkey on `localhost`, created with `probes/passkey` to test sponsored, tagged UserOperations on Celo mainnet. |
