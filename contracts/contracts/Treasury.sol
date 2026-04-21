// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Treasury {
    address public immutable admin;
    address public subscription;

    event SubscriptionSet(address indexed subscription);
    event RevenueDeposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotAdmin();
    error NotSubscription();
    error ZeroAddress();
    error AmountZero();
    error TransferFailed();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlySubscription() {
        if (msg.sender != subscription) revert NotSubscription();
        _;
    }

    constructor(address _admin) {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
    }

    function setSubscription(address _subscription) external onlyAdmin {
        if (_subscription == address(0)) revert ZeroAddress();
        subscription = _subscription;
        emit SubscriptionSet(_subscription);
    }

    function depositRevenue() external payable onlySubscription {
        if (msg.value == 0) revert AmountZero();
        emit RevenueDeposited(msg.sender, msg.value);
    }

    function adminDeposit() external payable onlyAdmin {
        if (msg.value == 0) revert AmountZero();
        emit RevenueDeposited(msg.sender, msg.value);
    }

    function adminBalance() external view onlyAdmin returns (uint256) {
        return address(this).balance;
    }

    function withdraw(address payable to, uint256 amountWei) external onlyAdmin {
        if (to == address(0)) revert ZeroAddress();
        if (amountWei == 0) revert AmountZero();
        (bool ok, ) = to.call{value: amountWei}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amountWei);
    }
}
