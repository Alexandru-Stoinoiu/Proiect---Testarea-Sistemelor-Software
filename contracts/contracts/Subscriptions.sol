// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITreasury {
    function depositRevenue() external payable;
}

contract Subscription {
    // --- config ---
    address public owner;
    address public treasury;
    uint256 public pricePerPeriodWei;     // e.g. monthly price in wei
    uint256 public periodSeconds;         // e.g. 30 days
    bool public paused;

    // --- state ---
    mapping(address => uint256) public balanceWei;      // user prepaid funds
    mapping(address => uint256) public subscribedUntil; // unix timestamp
    mapping(address => bool) public autoRenewEnabled;

    // --- events ---
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Subscribed(address indexed user, uint256 fromTs, uint256 untilTs, uint256 costWei);
    event SubscriptionCancelled(address indexed user, uint256 previousUntil, uint256 cancelledAt);
    event AutoRenewSet(address indexed user, bool enabled);
    event AutoRenewProcessed(address indexed user, uint256 costWei, uint256 newUntil);
    event PriceUpdated(uint256 newPriceWei);
    event PeriodUpdated(uint256 newPeriodSeconds);
    event TreasuryUpdated(address indexed newTreasury);
    event RevenueSentToTreasury(address indexed user, uint256 amount);
    event Paused(bool paused);

    error NotOwner();
    error PausedErr();
    error AmountZero();
    error ZeroAddress();
    error TransferFailed();
    error InsufficientFunds(uint256 neededWei, uint256 haveWei);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notPaused() {
        if (paused) revert PausedErr();
        _;
    }

    constructor(uint256 _pricePerPeriodWei, uint256 _periodSeconds, address _treasury) {
        if (_treasury == address(0)) revert ZeroAddress();
        owner = msg.sender;
        treasury = _treasury;
        pricePerPeriodWei = _pricePerPeriodWei;
        periodSeconds = _periodSeconds;
    }

    // --- user actions ---

    function deposit() external payable notPaused {
        if (msg.value == 0) revert AmountZero();
        balanceWei[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// Subscribe for N periods.
    /// Uses user's internal balance first, then msg.value.
    /// If msg.value exceeds what’s needed, leftover is credited to balance (no refund surprises).
    function subscribe(uint256 periods) external payable notPaused {
        if (periods == 0) revert AmountZero();

        uint256 cost = pricePerPeriodWei * periods;

        // total available = prepaid balance + new payment
        uint256 have = balanceWei[msg.sender] + msg.value;
        if (have < cost) revert InsufficientFunds(cost, have);

        // consume balance first
        uint256 fromBalance = balanceWei[msg.sender] >= cost ? cost : balanceWei[msg.sender];
        balanceWei[msg.sender] -= fromBalance;

        // remaining must be covered by msg.value; leftover becomes new balance
        uint256 remaining = cost - fromBalance;
        uint256 leftover = msg.value - remaining;
        if (leftover > 0) {
            balanceWei[msg.sender] += leftover;
        }

        // extend subscription from max(now, currentUntil)
        uint256 start = block.timestamp;
        uint256 base = subscribedUntil[msg.sender] > start ? subscribedUntil[msg.sender] : start;
        uint256 newUntil = base + (periodSeconds * periods);
        subscribedUntil[msg.sender] = newUntil;
        autoRenewEnabled[msg.sender] = true;

        _sendRevenueToTreasury(msg.sender, cost);
        emit Subscribed(msg.sender, base, newUntil, cost);
    }

    /// Subscribe using ONLY msg.value (wallet payment), without consuming prepaid balance.
    function subscribeFromWallet(uint256 periods) external payable notPaused {
        if (periods == 0) revert AmountZero();

        uint256 cost = pricePerPeriodWei * periods;
        if (msg.value < cost) revert InsufficientFunds(cost, msg.value);

        uint256 leftover = msg.value - cost;
        if (leftover > 0) {
            balanceWei[msg.sender] += leftover;
        }

        uint256 start = block.timestamp;
        uint256 base = subscribedUntil[msg.sender] > start ? subscribedUntil[msg.sender] : start;
        uint256 newUntil = base + (periodSeconds * periods);
        subscribedUntil[msg.sender] = newUntil;
        autoRenewEnabled[msg.sender] = true;

        _sendRevenueToTreasury(msg.sender, cost);
        emit Subscribed(msg.sender, base, newUntil, cost);
    }

    /// Subscribe using ONLY internal balance, no payment. (nice UX)
    function subscribeFromBalance(uint256 periods) external notPaused {
        if (periods == 0) revert AmountZero();

        uint256 cost = pricePerPeriodWei * periods;
        uint256 bal = balanceWei[msg.sender];
        if (bal < cost) revert InsufficientFunds(cost, bal);

        balanceWei[msg.sender] = bal - cost;

        uint256 start = block.timestamp;
        uint256 base = subscribedUntil[msg.sender] > start ? subscribedUntil[msg.sender] : start;
        uint256 newUntil = base + (periodSeconds * periods);
        subscribedUntil[msg.sender] = newUntil;
        autoRenewEnabled[msg.sender] = true;

        _sendRevenueToTreasury(msg.sender, cost);
        emit Subscribed(msg.sender, base, newUntil, cost);
    }

    function withdraw(uint256 amountWei) external notPaused {
        if (amountWei == 0) revert AmountZero();
        uint256 bal = balanceWei[msg.sender];
        if (bal < amountWei) revert InsufficientFunds(amountWei, bal);

        balanceWei[msg.sender] = bal - amountWei;

        (bool ok, ) = msg.sender.call{value: amountWei}("");
        require(ok, "transfer failed");

        emit Withdrawn(msg.sender, amountWei);
    }

    function cancelSubscription() external {
        uint256 previousUntil = subscribedUntil[msg.sender];
        subscribedUntil[msg.sender] = 0;
        autoRenewEnabled[msg.sender] = false;
        emit SubscriptionCancelled(msg.sender, previousUntil, block.timestamp);
    }

    /// Any caller can process one due renewal period for a user.
    /// This is "automatic" when called by a bot/keeper on interval.
    function processRenewal(address user) external notPaused returns (bool renewed) {
        if (!autoRenewEnabled[user]) return false;
        uint256 until = subscribedUntil[user];
        if (until == 0 || until > block.timestamp) return false;

        uint256 cost = pricePerPeriodWei;
        uint256 bal = balanceWei[user];
        if (bal < cost) return false;

        balanceWei[user] = bal - cost;

        uint256 newUntil = block.timestamp + periodSeconds;
        subscribedUntil[user] = newUntil;

        _sendRevenueToTreasury(user, cost);
        emit AutoRenewProcessed(user, cost, newUntil);
        return true;
    }

    function setAutoRenew(bool enabled) external {
        autoRenewEnabled[msg.sender] = enabled;
        emit AutoRenewSet(msg.sender, enabled);
    }

    // --- view helpers ---

    function isActive(address user) external view returns (bool) {
        return subscribedUntil[user] >= block.timestamp;
    }

    function quote(uint256 periods) external view returns (uint256) {
        return pricePerPeriodWei * periods;
    }

    function periodsCost(uint256 priceWei, uint256 periods) public pure returns (uint256) {
        return priceWei * periods;
    }
    // Calculeaza costul total: pret/perioada * numarul de perioade.

    // --- admin ---

    function setPrice(uint256 newPriceWei) external onlyOwner {
        pricePerPeriodWei = newPriceWei;
        emit PriceUpdated(newPriceWei);
    }

    function setPeriod(uint256 newPeriodSeconds) external onlyOwner {
        periodSeconds = newPeriodSeconds;
        emit PeriodUpdated(newPeriodSeconds);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// Emergency escape hatch for accidental ETH left in this contract.
    function ownerWithdraw(uint256 amountWei) external onlyOwner {
        if (amountWei == 0) revert AmountZero();
        if (address(this).balance < amountWei) revert InsufficientFunds(amountWei, address(this).balance);
        (bool ok, ) = owner.call{value: amountWei}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        // treat plain ETH sends as deposit
        balanceWei[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function _sendRevenueToTreasury(address user, uint256 amountWei) internal {
        ITreasury(treasury).depositRevenue{value: amountWei}();
        emit RevenueSentToTreasury(user, amountWei);
    }
}
