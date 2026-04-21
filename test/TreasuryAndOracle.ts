import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Treasury and MockOracle", function () {
  async function deployFixture() {
    const [deployer, admin, subscriptionSigner, recipient, other] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = await Treasury.deploy(admin.address);
    await treasury.waitForDeployment();
    await treasury.connect(admin).setSubscription(subscriptionSigner.address);

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.connect(admin).deploy(8, 3500n * 10n ** 8n);
    await oracle.waitForDeployment();

    return {
      deployer,
      admin,
      subscriptionSigner,
      recipient,
      other,
      treasury,
      oracle,
    };
  }

  it("only allows the configured subscription contract to deposit revenue", async function () {
    const { other, subscriptionSigner, treasury } = await loadFixture(deployFixture);

    await expect(treasury.connect(other).depositRevenue({ value: 1n }))
      .to.be.revertedWithCustomError(treasury, "NotSubscription");

    await expect(treasury.connect(subscriptionSigner).depositRevenue({ value: ethers.parseEther("0.02") }))
      .to.emit(treasury, "RevenueDeposited")
      .withArgs(subscriptionSigner.address, ethers.parseEther("0.02"));
  });

  it("lets the admin fund and withdraw from the treasury", async function () {
    const { admin, recipient, treasury } = await loadFixture(deployFixture);

    await treasury.connect(admin).adminDeposit({ value: ethers.parseEther("0.05") });

    const before = await ethers.provider.getBalance(recipient.address);
    await treasury.connect(admin).withdraw(recipient.address, ethers.parseEther("0.02"));

    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(ethers.parseEther("0.03"));
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(before + ethers.parseEther("0.02"));
  });

  it("restricts treasury admin functions to the admin account", async function () {
    const { other, recipient, treasury } = await loadFixture(deployFixture);

    await expect(treasury.connect(other).setSubscription(other.address))
      .to.be.revertedWithCustomError(treasury, "NotAdmin");
    await expect(treasury.connect(other).adminDeposit({ value: 1n }))
      .to.be.revertedWithCustomError(treasury, "NotAdmin");
    await expect(treasury.connect(other).adminBalance())
      .to.be.revertedWithCustomError(treasury, "NotAdmin");
    await expect(treasury.connect(other).withdraw(recipient.address, 1n))
      .to.be.revertedWithCustomError(treasury, "NotAdmin");
  });

  it("allows only the oracle admin to update the price and rejects invalid values", async function () {
    const { admin, other, oracle } = await loadFixture(deployFixture);

    expect(await oracle.latestAnswer()).to.equal(3500n * 10n ** 8n);

    await expect(oracle.connect(other).setPrice(3600n * 10n ** 8n))
      .to.be.revertedWithCustomError(oracle, "NotAdmin");
    await expect(oracle.connect(admin).setPrice(0))
      .to.be.revertedWithCustomError(oracle, "InvalidPrice");

    await expect(oracle.connect(admin).setPrice(3600n * 10n ** 8n))
      .to.emit(oracle, "PriceUpdated")
      .withArgs(3600n * 10n ** 8n);

    expect(await oracle.latestAnswer()).to.equal(3600n * 10n ** 8n);
  });
});
