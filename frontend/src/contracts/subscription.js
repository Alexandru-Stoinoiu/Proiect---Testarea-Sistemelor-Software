import { ethers } from "ethers";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS;

export const ABI = [
  "function balanceWei(address) view returns (uint256)",
  "function subscribedUntil(address) view returns (uint256)",
  "function quote(uint256) view returns (uint256)",
  "function deposit() payable",
  "function subscribe(uint256) payable",
  "function subscribeFromWallet(uint256) payable",
  "function subscribeFromBalance(uint256)",
  "function withdraw(uint256 amountWei)",
  "function cancelSubscription()",
  "function processRenewal(address) returns (bool)",
  "function setAutoRenew(bool)",
  "function autoRenewEnabled(address) view returns (bool)",
];

export async function getContract() {
  if (!window.ethereum) throw new Error("No MetaMask");
  if (!CONTRACT_ADDRESS || !ethers.isAddress(CONTRACT_ADDRESS)) {
    throw new Error("Invalid VITE_CONTRACT_ADDRESS");
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
}

export async function assertContractDeployed() {
  if (!window.ethereum) throw new Error("No MetaMask");
  if (!CONTRACT_ADDRESS || !ethers.isAddress(CONTRACT_ADDRESS)) {
    throw new Error("Invalid VITE_CONTRACT_ADDRESS");
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const code = await provider.getCode(CONTRACT_ADDRESS);
  if (code === "0x") {
    throw new Error("No contract deployed at VITE_CONTRACT_ADDRESS on this network");
  }
}
