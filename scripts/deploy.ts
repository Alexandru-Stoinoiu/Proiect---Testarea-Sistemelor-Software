import { ethers } from "hardhat";

async function main() {
  const Treasury = await ethers.getContractFactory("Treasury");
  const Subscription = await ethers.getContractFactory("Subscription");
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const signers = await ethers.getSigners();
  const treasuryAdminSigner = signers[1];

  const treasury = await Treasury.deploy(treasuryAdminSigner.address);
  await treasury.waitForDeployment();

  const oracle = await MockOracle.connect(treasuryAdminSigner).deploy(8, 3500n * 10n ** 8n);
  await oracle.waitForDeployment();

  const subs = await Subscription.deploy(
    ethers.parseEther("0.01"),
    30,
    await treasury.getAddress()
  );
  await subs.waitForDeployment();
  const setSubscriptionTx = await treasury
    .connect(treasuryAdminSigner)
    .getFunction("setSubscription")(await subs.getAddress());
  await setSubscriptionTx.wait();

  console.log("Subscription deployed to:", await subs.getAddress());
  console.log("Treasury deployed to:", await treasury.getAddress());
  console.log("Oracle deployed to:", await oracle.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
