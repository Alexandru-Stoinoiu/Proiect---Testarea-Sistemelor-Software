import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const Treasury = await ethers.getContractFactory("Treasury");
  const Subscription = await ethers.getContractFactory("Subscription");
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const signers = await ethers.getSigners();
  const treasuryAdminSigner = signers[1];
  const treasuryAdmin = treasuryAdminSigner.address;

  const treasury = await Treasury.deploy(treasuryAdmin);
  await treasury.waitForDeployment();

  // 1 ETH = 3500.00 USD (8 decimals)
  const oracle = await MockOracle.connect(treasuryAdminSigner).deploy(8, 3500n * 10n ** 8n);
  await oracle.waitForDeployment();

  const subs = await Subscription.deploy(
    ethers.parseEther("0.01"), // pricePerPeriodWei
    30,                        // periodSeconds (Silver)
    await treasury.getAddress()
  );
  await subs.waitForDeployment();
  const setSubscriptionTx = await treasury
    .connect(treasuryAdminSigner)
    .getFunction("setSubscription")(await subs.getAddress());
  await setSubscriptionTx.wait();

  const addr = await subs.getAddress();
  const treasuryAddr = await treasury.getAddress();
  const oracleAddr = await oracle.getAddress();
  console.log("Subscription deployed to:", addr);
  console.log("Treasury deployed to:", treasuryAddr);
  console.log("Oracle deployed to:", oracleAddr);

  // Write frontend env var
  const envPath = path.join(__dirname, "..", "frontend", ".env");
  const envContent = `VITE_CONTRACT_ADDRESS=${addr}\nVITE_TREASURY_ADDRESS=${treasuryAddr}\nVITE_ORACLE_ADDRESS=${oracleAddr}\n`;
  fs.writeFileSync(envPath, envContent, "utf8");

  console.log("Wrote frontend/.env with VITE_CONTRACT_ADDRESS, VITE_TREASURY_ADDRESS and VITE_ORACLE_ADDRESS");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
