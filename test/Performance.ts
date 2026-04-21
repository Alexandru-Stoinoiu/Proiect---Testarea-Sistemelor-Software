import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Performance", function () {
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

  async function deployTreasuryFixture() {
    const [deployer, admin, subscriptionSigner, recipient] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(admin.address);
    await treasury.waitForDeployment();
    await treasury.connect(admin).setSubscription(subscriptionSigner.address);

    return { deployer, admin, subscriptionSigner, recipient, treasury };
  }

  async function gasUsedOf(txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    return receipt!.gasUsed;
  }

  it("keeps the core subscription flow under reasonable gas ceilings", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(deployFixture);

    const depositGas = await gasUsedOf(
      subscription.connect(subscriber).deposit({ value: ethers.parseEther("0.05") })
    );

    const subscribeFromWalletGas = await gasUsedOf(
      subscription
        .connect(subscriber)
        .subscribeFromWallet(1, { value: pricePerPeriodWei + ethers.parseEther("0.02") })
    );

    const subscribeFromBalanceGas = await gasUsedOf(
      subscription.connect(subscriber).subscribeFromBalance(1)
    );

    await time.increase(31);

    const processRenewalGas = await gasUsedOf(
      subscription.connect(subscriber).processRenewal(subscriber.address)
    );

    const withdrawGas = await gasUsedOf(
      subscription.connect(subscriber).withdraw(ethers.parseEther("0.01"))
    );

    console.table([
      { operation: "deposit", gasUsed: depositGas.toString() },
      { operation: "subscribeFromWallet", gasUsed: subscribeFromWalletGas.toString() },
      { operation: "subscribeFromBalance", gasUsed: subscribeFromBalanceGas.toString() },
      { operation: "processRenewal", gasUsed: processRenewalGas.toString() },
      { operation: "withdraw", gasUsed: withdrawGas.toString() },
    ]);

    expect(depositGas).to.be.lessThan(55_000n);
    expect(subscribeFromWalletGas).to.be.lessThan(105_000n);
    expect(subscribeFromBalanceGas).to.be.lessThan(70_000n);
    expect(processRenewalGas).to.be.lessThan(35_000n);
    expect(withdrawGas).to.be.lessThan(45_000n);
  });

  it("shows subscribing with leftover wallet credit costs more gas than an exact wallet payment", async function () {
    const { subscriber, other, pricePerPeriodWei, subscription } = await loadFixture(deployFixture);

    const exactWalletGas = await gasUsedOf(
      subscription.connect(subscriber).subscribeFromWallet(1, { value: pricePerPeriodWei })
    );

    const leftoverWalletGas = await gasUsedOf(
      subscription
        .connect(other)
        .subscribeFromWallet(1, { value: pricePerPeriodWei + ethers.parseEther("0.02") })
    );

    expect(leftoverWalletGas).to.be.greaterThan(exactWalletGas);
  });

  it("shows renewal is cheaper than a first-time wallet subscription", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(deployFixture);

    const subscribeFromWalletGas = await gasUsedOf(
      subscription.connect(subscriber).subscribeFromWallet(1, { value: pricePerPeriodWei })
    );

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei });
    await time.increase(31);

    const processRenewalGas = await gasUsedOf(
      subscription.connect(subscriber).processRenewal(subscriber.address)
    );

    expect(processRenewalGas).to.be.lessThan(subscribeFromWalletGas);
  });

  it("keeps treasury admin operations under reasonable gas ceilings", async function () {
    const { admin, recipient, treasury } = await loadFixture(deployTreasuryFixture);

    const adminDepositGas = await gasUsedOf(
      treasury.connect(admin).adminDeposit({ value: ethers.parseEther("0.05") })
    );

    const withdrawGas = await gasUsedOf(
      treasury.connect(admin).withdraw(recipient.address, ethers.parseEther("0.02"))
    );

    console.table([
      { operation: "treasury.adminDeposit", gasUsed: adminDepositGas.toString() },
      { operation: "treasury.withdraw", gasUsed: withdrawGas.toString() },
    ]);

    expect(adminDepositGas).to.be.lessThan(28_000n);
    expect(withdrawGas).to.be.lessThan(35_000n);
  });
});
