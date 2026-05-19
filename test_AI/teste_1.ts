import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("AI Experiment 1", function () {
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

  it("accepts plain ETH transfers through receive() and credits the sender balance", async function () {
    const { subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    await subscriber.sendTransaction({
      to: await subscription.getAddress(),
      value: ethers.parseEther("0.02"),
    });

    expect(await subscription.balanceWei(subscriber.address)).to.equal(ethers.parseEther("0.02"));
  });

  it("does not process renewal and does not change state when prepaid funds are insufficient", async function () {
    const { subscriber, pricePerPeriodWei, subscription } = await loadFixture(
      deploySubscriptionFixture
    );

    await subscription.connect(subscriber).deposit({ value: pricePerPeriodWei });
    await subscription.connect(subscriber).subscribeFromBalance(1);

    await time.increase(31);

    const oldUntil = await subscription.subscribedUntil(subscriber.address);
    const oldBalance = await subscription.balanceWei(subscriber.address);

    expect(await subscription.processRenewal.staticCall(subscriber.address)).to.equal(false);

    const tx = await subscription.processRenewal(subscriber.address);
    await tx.wait();

    expect(await subscription.subscribedUntil(subscriber.address)).to.equal(oldUntil);
    expect(await subscription.balanceWei(subscriber.address)).to.equal(oldBalance);
  });

  it("restricts ownerWithdraw to the contract owner", async function () {
    const { other, subscriber, subscription } = await loadFixture(deploySubscriptionFixture);

    await subscriber.sendTransaction({
      to: await subscription.getAddress(),
      value: ethers.parseEther("0.01"),
    });

    await expect(subscription.connect(other).ownerWithdraw(ethers.parseEther("0.01")))
      .to.be.revertedWithCustomError(subscription, "NotOwner");
  });

  it("rejects deploying Subscription with the zero treasury address", async function () {
    const Subscription = await ethers.getContractFactory("Subscription");

    await expect(Subscription.deploy(ethers.parseEther("0.01"), 30n, ethers.ZeroAddress))
      .to.be.revertedWithCustomError(Subscription, "ZeroAddress");
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
