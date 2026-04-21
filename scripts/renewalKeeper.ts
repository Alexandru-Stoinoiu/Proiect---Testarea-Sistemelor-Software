import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const POLL_MS = 5000;

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function resolveSubscriptionAddress(): string {
  const fromArg = getArgValue("--contract");
  if (fromArg) return fromArg;

  const fromEnv = process.env.SUBSCRIPTION_ADDRESS || process.env.VITE_CONTRACT_ADDRESS;
  if (fromEnv) return fromEnv;

  const envPath = path.join(__dirname, "..", "frontend", ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const line = content
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith("VITE_CONTRACT_ADDRESS="));
    if (line) {
      const value = line.split("=")[1]?.trim();
      if (value) return value;
    }
  }

  throw new Error(
    "Missing subscription address. Use --contract <address> or set SUBSCRIPTION_ADDRESS."
  );
}

function resolveUserAddress(): string {
  const fromArg = getArgValue("--user");
  const fromEnv = process.env.USER_ADDRESS;
  const value = fromArg || fromEnv;
  if (!value) {
    throw new Error("Missing user address. Use --user <address> or set USER_ADDRESS.");
  }
  return value;
}

async function main() {
  const contractAddress = resolveSubscriptionAddress();
  const userAddress = resolveUserAddress();

  if (!ethers.isAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }
  if (!ethers.isAddress(userAddress)) {
    throw new Error(`Invalid user address: ${userAddress}`);
  }

  const keeper = (await ethers.getSigners())[0];
  const subscription = await ethers.getContractAt("Subscription", contractAddress, keeper);

  console.log(`Renewal keeper started.`);
  console.log(`Contract: ${contractAddress}`);
  console.log(`User: ${userAddress}`);
  console.log(`Keeper: ${keeper.address}`);
  console.log(`Polling every ${POLL_MS / 1000}s...`);

  while (true) {
    try {
      const [until, bal, autoRenew] = await Promise.all([
        subscription.subscribedUntil(userAddress),
        subscription.balanceWei(userAddress),
        subscription.autoRenewEnabled(userAddress),
      ]);

      if (!autoRenew) {
        console.log(`[skip] auto-renew disabled | until=${until} | balance=${bal}`);
      } else if (until > BigInt(Math.floor(Date.now() / 1000))) {
        console.log(`[skip] still active | until=${until} | balance=${bal}`);
      } else {
        const tx = await subscription.processRenewal(userAddress);
        const receipt = await tx.wait();
        console.log(`[renewed] tx=${tx.hash} block=${receipt?.blockNumber ?? "-"}`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.log(`[error] ${message}`);
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
