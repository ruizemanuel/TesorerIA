# Uniswap v3-core, the files TesorerIA compiles

Unmodified copies of the files `src/` and `test/` import from [Uniswap/v3-core](https://github.com/Uniswap/v3-core), at commit `6562c52e8f75f0c10f9deaf44861847585fc8129` of its `0.8` branch, the port to Solidity 0.8. Each file keeps its own license header (GPL-2.0-or-later, or MIT for `FullMath.sol`); `LICENSE` is the repository's.

They are copied here instead of being a git submodule because the repository's default branch, `main`, is the Solidity 0.7 code: a checkout that ignores the pinned commit (an archive of this repo with `forge install Uniswap/v3-core`, say) gets a `TickMath.sol` no 0.8 compiler accepts. The `0.8` branch hasn't changed since 2022.

The path is the one the submodule had, so the compiler's metadata, and with it the bytecode, stays the same as the deployed contracts', which Sourcify verified as an exact match.
