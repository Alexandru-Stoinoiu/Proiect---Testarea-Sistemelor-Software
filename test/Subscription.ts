import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Subscription", function () {
  async function deployFixture() {
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

  it("stores deployment configuration", async function () {
    const { owner, pricePerPeriodWei, periodSeconds, treasury, subscription } = await loadFixture(
      deployFixture
    );

    expect(await subscription.owner()).to.equal(owner.address);
    expect(await subscription.pricePerPeriodWei()).to.equal(pricePerPeriodWei);
    expect(await subscription.periodSeconds()).to.equal(periodSeconds);
    expect(await subscription.treasury()).to.equal(await treasury.getAddress());
  });

  it("accepts deposits and rejects zero-value deposits", async function () {
    const { subscriber, subscription } = await loadFixture(deployFixture);

    await expect(subscription.connect(subscriber).deposit({ value: 0n }))
      .to.be.revertedWithCustomError(subscription, "AmountZero");

    await expect(subscription.connect(subscriber).deposit({ value: ethers.parseEther("0.05") }))
      .to.emit(subscription, "Deposited")
      .withArgs(subscriber.address, ethers.parseEther("0.05"));

    expect(await subscription.balanceWei(subscriber.address)).to.equal(ethers.parseEther("0.05"));
  });

  it("subscribes by combining prepaid balance with wallet value and forwards revenue to the treasury", async function () {
    const { subscriber, pricePerPeriodWei, treasury, subscription } = await loadFixture(deployFixture);

    await subscription.connect(subscriber).deposit({ value: ethers.parseEther("0.03") });

    const treasuryBalanceBefore = await ethers.provider.getBalance(await treasury.getAddress());

    const tx = await (
      subscription.connect(subscriber).subscribe(2, { value: ethers.parseEther("0.01") })
    );
    await expect(tx).to.emit(subscription, "Subscribed");
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);

    expect(await subscription.balanceWei(subscriber.address)).to.equal(ethers.parseEther("0.02"));
    expect(await subscription.autoRenewEnabled(subscriber.address)).to.equal(true);
    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(BigInt(block!.timestamp) + 60n);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(
      treasuryBalanceBefore + pricePerPeriodWei * 2n
    );
  });

  it("keeps wallet leftovers as prepaid balance when subscribing directly from the wallet", async function () {
    const { subscriber, pricePerPeriodWei, treasury, subscription } = await loadFixture(deployFixture);

    const treasuryBalanceBefore = await ethers.provider.getBalance(await treasury.getAddress());

    const tx = await subscription
      .connect(subscriber)
      .subscribeFromWallet(1, { value: pricePerPeriodWei + ethers.parseEther("0.02") });
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);

    expect(await subscription.balanceWei(subscriber.address)).to.equal(ethers.parseEther("0.02"));
    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(BigInt(block!.timestamp) + 30n);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(
      treasuryBalanceBefore + pricePerPeriodWei
    );
  });

  it("extends an active subscription when subscribing from prepaid balance", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(deployFixture);

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei * 7n });
    await subscription.connect(subscriber).subscribeFromBalance(1);

    const firstUntil = await subscription.subscribedUntil(subscriber.address);

    await time.increase(10);
    await subscription.connect(subscriber).subscribeFromBalance(6);

    expect(await subscription.balanceWei(subscriber.address)).to.equal(0n);
    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(firstUntil + 180n);
  });

  it("processes auto-renewal only after expiry when prepaid funds are available", async function () {
    const { subscriber, pricePerPeriodWei, treasury, subscription } = await loadFixture(deployFixture);

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei * 3n });
    await subscription.connect(subscriber).subscribeFromBalance(1);

    expect(await subscription.processRenewal.staticCall(subscriber.address)).to.equal(false);

    await time.increase(31);

    const treasuryBalanceBefore = await ethers.provider.getBalance(await treasury.getAddress());
    const renewed = await subscription.processRenewal.staticCall(subscriber.address);
    expect(renewed).to.equal(true);

    await expect(subscription.processRenewal(subscriber.address))
      .to.emit(subscription, "AutoRenewProcessed");

    expect(await subscription.balanceWei(subscriber.address)).to.equal(pricePerPeriodWei);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(
      treasuryBalanceBefore + pricePerPeriodWei
    );
  });

  it("cancels subscriptions and blocks state-changing actions while paused", async function () {
    const { owner, subscriber, pricePerPeriodWei, subscription } = await loadFixture(deployFixture);

    await subscription.connect(subscriber).subscribeFromWallet(1, { value: pricePerPeriodWei });
    await subscription.connect(subscriber).cancelSubscription();

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(0n);
    expect(await subscription.autoRenewEnabled(subscriber.address)).to.equal(false);

    await subscription.connect(owner).setPaused(true);

    await expect(subscription.connect(subscriber).deposit({ value: pricePerPeriodWei }))
      .to.be.revertedWithCustomError(subscription, "PausedErr");
    await expect(subscription.connect(subscriber).withdraw(pricePerPeriodWei))
      .to.be.revertedWithCustomError(subscription, "PausedErr");
    await expect(subscription.processRenewal(subscriber.address))
      .to.be.revertedWithCustomError(subscription, "PausedErr");
  });

  it("restricts admin functions to the owner", async function () {
    const { other, subscription } = await loadFixture(deployFixture);

    await expect(subscription.connect(other).setPrice(123n))
      .to.be.revertedWithCustomError(subscription, "NotOwner");
    await expect(subscription.connect(other).setPeriod(45))
      .to.be.revertedWithCustomError(subscription, "NotOwner");
    await expect(subscription.connect(other).setTreasury(other.address))
      .to.be.revertedWithCustomError(subscription, "NotOwner");
    await expect(subscription.connect(other).setPaused(true))
      .to.be.revertedWithCustomError(subscription, "NotOwner");
  });
});
