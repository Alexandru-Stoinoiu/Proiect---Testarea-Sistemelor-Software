import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("AI Experiment 2", function () {
  async function deploySubscriptionFixture() {
    const [owner, treasuryAdmin, subscriber, other] = await ethers.getSigners();
    const pricePerPeriodWei = ethers.parseEther("0.01");
    const periodSeconds = 30n;

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(treasuryAdmin.address);
    await treasury.waitForDeployment();

    const Subscription = await ethers.getContractFactory("Subscription");
    const subscription = await Subscription.deploy(
      pricePerPeriodWei,
      periodSeconds,
      await treasury.getAddress()
    );
    await subscription.waitForDeployment();

    await treasury.connect(treasuryAdmin).setSubscription(await subscription.getAddress());

    return {
      owner,
      treasuryAdmin,
      subscriber,
      other,
      pricePerPeriodWei,
      periodSeconds,
      treasury,
      subscription,
    };
  }

  async function deployTreasuryFixture() {
    const [deployer, admin, subscriptionSigner, recipient, other] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(admin.address);
    await treasury.waitForDeployment();
    await treasury.connect(admin).setSubscription(subscriptionSigner.address);

    return {
      deployer,
      admin,
      subscriptionSigner,
      recipient,
      other,
      treasury,
    };
  }

  it("treats a plain ETH transfer as a deposit and emits Deposited", async function () {
    const { subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    await expect(
      subscriber.sendTransaction({
        to: await subscription.getAddress(),
        value: ethers.parseEther("0.02"),
      })
    )
      .to.emit(subscription, "Deposited")
      .withArgs(subscriber.address, ethers.parseEther("0.02"));

    expect(await subscription.balanceWei(subscriber.address)).to.equal(ethers.parseEther("0.02"));
  });

  it("updates the auto-renew preference even when the user has no active subscription", async function () {
    const { subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    expect(await subscription.autoRenewEnabled(subscriber.address)).to.equal(false);

    await expect(subscription.connect(subscriber).setAutoRenew(true))
      .to.emit(subscription, "AutoRenewSet")
      .withArgs(subscriber.address, true);

    expect(await subscription.autoRenewEnabled(subscriber.address)).to.equal(true);
    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(0n);
  });

  it("returns false for processRenewal when auto-renew is disabled", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(
      deploySubscriptionFixture
    );

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei * 2n });
    await subscription.connect(subscriber).subscribeFromBalance(1);
    await subscription.connect(subscriber).setAutoRenew(false);
    await time.increase(31);

    const previousUntil = await subscription.subscribedUntil(subscriber.address);
    const previousBalance = await subscription.balanceWei(subscriber.address);

    expect(await subscription.processRenewal.staticCall(subscriber.address)).to.equal(false);
    expect(await subscription.processRenewal(subscriber.address)).to.not.emit(
      subscription,
      "AutoRenewProcessed"
    );

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(previousUntil);
    expect(await subscription.balanceWei(subscriber.address)).to.equal(previousBalance);
  });

  it("returns false for processRenewal when the subscription has not expired yet", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(
      deploySubscriptionFixture
    );

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei * 2n });
    await subscription.connect(subscriber).subscribeFromBalance(1);

    const previousUntil = await subscription.subscribedUntil(subscriber.address);
    const previousBalance = await subscription.balanceWei(subscriber.address);

    expect(await subscription.processRenewal.staticCall(subscriber.address)).to.equal(false);
    expect(await subscription.processRenewal(subscriber.address)).to.not.emit(
      subscription,
      "AutoRenewProcessed"
    );

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(previousUntil);
    expect(await subscription.balanceWei(subscriber.address)).to.equal(previousBalance);
  });

  it("returns false for processRenewal when the user has no subscription record", async function () {
    const { subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(0n);
    expect(await subscription.processRenewal.staticCall(subscriber.address)).to.equal(false);

    await expect(subscription.processRenewal(subscriber.address)).to.not.emit(
      subscription,
      "AutoRenewProcessed"
    );

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(0n);
    expect(await subscription.balanceWei(subscriber.address)).to.equal(0n);
  });

  it("allows the owner to withdraw accidentally retained ETH from the contract", async function () {
    const { owner, subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    await subscriber.sendTransaction({
      to: await subscription.getAddress(),
      value: ethers.parseEther("0.03"),
    });

    const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
    const tx = await subscription.connect(owner).ownerWithdraw(ethers.parseEther("0.01"));
    const receipt = await tx.wait();

    const gasPrice = receipt!.gasPrice ?? tx.gasPrice ?? 0n;
    const gasCost = receipt!.gasUsed * gasPrice;
    const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

    expect(await ethers.provider.getBalance(await subscription.getAddress())).to.equal(
      ethers.parseEther("0.02")
    );
    expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + ethers.parseEther("0.01") - gasCost);
  });

  it("rejects ownerWithdraw with zero amount", async function () {
    const { owner, subscription } = await loadFixture(deploySubscriptionFixture);

    await expect(subscription.connect(owner).ownerWithdraw(0n))
      .to.be.revertedWithCustomError(subscription, "AmountZero");
  });

  it("rejects ownerWithdraw when the contract balance is insufficient", async function () {
    const { owner, subscription } = await loadFixture(deploySubscriptionFixture);

    await expect(subscription.connect(owner).ownerWithdraw(1n))
      .to.be.revertedWithCustomError(subscription, "InsufficientFunds");
  });

  it("rejects deploying Subscription with the zero treasury address", async function () {
    const Subscription = await ethers.getContractFactory("Subscription");

    await expect(Subscription.deploy(ethers.parseEther("0.01"), 30n, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Subscription, "ZeroAddress");
  });

  it("rejects setting the treasury address to zero", async function () {
    const { owner, subscription } = await loadFixture(deploySubscriptionFixture);

    await expect(subscription.connect(owner).setTreasury(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(subscription, "ZeroAddress");
  });

  it("rejects deploying Treasury with the zero admin address", async function () {
    const Treasury = await ethers.getContractFactory("Treasury");

    await expect(Treasury.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      Treasury,
      "ZeroAddress"
    );
  });

  it("rejects setting the subscription address to zero", async function () {
    const { admin, treasury } = await loadFixture(deployTreasuryFixture);

    await expect(treasury.connect(admin).setSubscription(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(treasury, "ZeroAddress");
  });
});
