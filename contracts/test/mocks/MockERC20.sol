// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimales;

    constructor(string memory nombre, string memory simbolo, uint8 decimales_) ERC20(nombre, simbolo) {
        _decimales = decimales_;
    }

    function decimals() public view override returns (uint8) {
        return _decimales;
    }

    function mint(address a, uint256 monto) external {
        _mint(a, monto);
    }
}
