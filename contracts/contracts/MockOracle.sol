// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockOracle {
    address public immutable admin;
    uint8 public immutable decimals;
    int256 private answer;

    event PriceUpdated(int256 newPrice);

    error NotAdmin();
    error InvalidPrice();

    constructor(uint8 _decimals, int256 _initialPrice) {
        if (_initialPrice <= 0) revert InvalidPrice();
        admin = msg.sender;
        decimals = _decimals;
        answer = _initialPrice;
    }

    function latestAnswer() external view returns (int256) {
        return answer;
    }

    function setPrice(int256 newPrice) external {
        if (msg.sender != admin) revert NotAdmin();
        if (newPrice <= 0) revert InvalidPrice();
        answer = newPrice;
        emit PriceUpdated(newPrice);
    }
}
