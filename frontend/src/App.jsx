import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, assertContractDeployed, getContract } from "./contracts/subscription";

const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS;
const ORACLE_ADDRESS = import.meta.env.VITE_ORACLE_ADDRESS;
const TREASURY_ABI = [
  "function withdraw(address payable to, uint256 amountWei)",
  "function admin() view returns (address)",
  "function adminDeposit() payable",
];
const ORACLE_ABI = [
  "function latestAnswer() view returns (int256)",
  "function decimals() view returns (uint8)",
];
const SUBSCRIPTION_EVENTS_ABI = [
  "event Deposited(address indexed user, uint256 amount)",
  "event Withdrawn(address indexed user, uint256 amount)",
  "event Subscribed(address indexed user, uint256 fromTs, uint256 untilTs, uint256 costWei)",
  "event SubscriptionCancelled(address indexed user, uint256 previousUntil, uint256 cancelledAt)",
  "event AutoRenewProcessed(address indexed user, uint256 costWei, uint256 newUntil)",
];
const TREASURY_EVENTS_ABI = [
  "event RevenueDeposited(address indexed from, uint256 amount)",
  "event Withdrawn(address indexed to, uint256 amount)",
];
const SILVER_PERIODS = 1n; // 30 seconds after bootstrap config
const GOLD_PERIODS = 6n; // 3 minutes (6 x 30 seconds)

function fmtEth(wei) {
  try {
    return ethers.formatEther(wei);
  } catch {
    return "0";
  }
}

function fmtGas(gas) {
  if (gas === null || gas === undefined) return "-";
  return gas.toString();
}

function withGasBuffer(estimated) {
  return (estimated * 120n) / 100n;
}

function fmtTs(unixTs) {
  if (!unixTs) return "-";
  return new Date(unixTs * 1000).toLocaleString();
}

const VIDEO_ITEMS = [
  { title: "Level 1", subtitle: "Let's Play Doctor", minPlan: "silver", image: "/thumbnails/level-1.jpg" },
  { title: "Level 2", subtitle: "We're Not Alone", minPlan: "silver", image: "/thumbnails/level-2.jpg" },
  { title: "Level 3", subtitle: "Hello Timmy", minPlan: "silver", image: "/thumbnails/level-3.jpg" },
  { title: "Level 4", subtitle: "Time to Die Mr. Pie", minPlan: "silver", image: "/thumbnails/level-4.jpg" },
  { title: "Level 5", subtitle: "Please Enjoy Your Stay", minPlan: "silver", image: "/thumbnails/level-5.jpg" },
  { title: "Level 6", subtitle: "The Ultimate Hang", minPlan: "gold", image: "/thumbnails/level-6.jpg" },
  { title: "Level 7", subtitle: "I'm Not Crazy", minPlan: "gold", image: "/thumbnails/level-7.jpg" },
  { title: "Level 8", subtitle: "Call of Pewdie", minPlan: "gold", image: "/thumbnails/level-8.jpg" },
  { title: "Level 9", subtitle: "Naughty Pie", minPlan: "gold", image: "/thumbnails/level-9.jpg" },
  { title: "Level 10", subtitle: "Game Over", minPlan: "gold", image: "/thumbnails/level-10.jpg" },
];

const HOME_COLORS = {
  primary: "#0B132B",
  secondary: "#1C7C7D",
  accent: "#F4A259",
};
const ACCOUNT_COLORS = {
  panel: "#1A1F2E",
  panelSoft: "#232A3D",
  accentA: "#38BDF8",
  accentB: "#F97316",
};

export default function App() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [balance, setBalance] = useState("0");
  const [treasuryBalance, setTreasuryBalance] = useState("0");
  const [ethUsdPrice, setEthUsdPrice] = useState("-");
  const [subscribedUntil, setSubscribedUntil] = useState(0);
  const [depositAmount, setDepositAmount] = useState("0.05");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [treasuryWithdrawAmount, setTreasuryWithdrawAmount] = useState("0.01");
  const [silverPrice, setSilverPrice] = useState("0");
  const [goldPrice, setGoldPrice] = useState("0");
  const [viewerPlan, setViewerPlan] = useState("silver");
  const [log, setLog] = useState("");
  const [now, setNow] = useState(0);
  const [lastTxHash, setLastTxHash] = useState("");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showSubscribePopup, setShowSubscribePopup] = useState(false);
  const [selectedTier, setSelectedTier] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [showExpiryPopup, setShowExpiryPopup] = useState(false);
  const [expiryPopupShown, setExpiryPopupShown] = useState(false);
  const [gasDeposit, setGasDeposit] = useState(null);
  const [gasSubscribeWallet, setGasSubscribeWallet] = useState(null);
  const [gasSubscribeBalance, setGasSubscribeBalance] = useState(null);
  const [gasWithdraw, setGasWithdraw] = useState(null);
  const [gasCancel, setGasCancel] = useState(null);
  const [gasEmptyTreasury, setGasEmptyTreasury] = useState(null);
  const [gasWithdrawTreasury, setGasWithdrawTreasury] = useState(null);
  const [page, setPage] = useState("home");
  const [currentRole, setCurrentRole] = useState("Viewer");
  const [eventsFeed, setEventsFeed] = useState([]);
  const seenEventIdsRef = useRef(new Set());

  const resolveRoleForAccount = useCallback(async (walletAddress) => {
    if (!walletAddress) return "Viewer";
    if (!window.ethereum) return "Viewer";
    if (!TREASURY_ADDRESS || !ethers.isAddress(TREASURY_ADDRESS)) return "Viewer";

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, provider);
      const adminAddress = await treasury.admin();
      return adminAddress.toLowerCase() === walletAddress.toLowerCase() ? "Admin" : "Viewer";
    } catch {
      return "Viewer";
    }
  }, []);

  async function connect() {
    if (!window.ethereum) {
      setLog("Install MetaMask first.");
      return;
    }
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    setAccount(accs[0] || null);
    const cid = await window.ethereum.request({ method: "eth_chainId" });
    setChainId(parseInt(cid, 16));
  }

  async function autoConnect() {
    if (!window.ethereum) return;
    const accs = await window.ethereum.request({ method: "eth_accounts" });
    if (accs.length > 0) {
      setAccount(accs[0]);
    }
    const cid = await window.ethereum.request({ method: "eth_chainId" });
    setChainId(parseInt(cid, 16));
  }

  async function connectAs(expectedRole) {
    if (!window.ethereum) {
      setLog("Install MetaMask first.");
      return;
    }
    try {
      // Ask MetaMask to show account selection/permissions again.
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Some wallets may not support this; fall back to requestAccounts.
    }
    const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
    const selected = accs[0] || null;
    setAccount(selected);
    if (!selected) return;

    const detectedRole = await resolveRoleForAccount(selected);
    setCurrentRole(detectedRole);

    if (detectedRole !== expectedRole) {
      setLog(`Connected wallet is ${detectedRole}. In MetaMask switch to a ${expectedRole.toLowerCase()} wallet, then press ${expectedRole} again.`);
      return;
    }

    setLog(`Connected as ${detectedRole}.`);
    setPage("home");
  }

  const pushEvent = useCallback((eventItem) => {
    setEventsFeed((prev) => [eventItem, ...prev].slice(0, 120));
  }, []);

  const refresh = useCallback(async () => {
    if (!account || !CONTRACT_ADDRESS) return;
    try {
      await assertContractDeployed();
      const c = await getContract();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const treasuryBalanceWei = TREASURY_ADDRESS && ethers.isAddress(TREASURY_ADDRESS)
        ? await provider.getBalance(TREASURY_ADDRESS)
        : 0n;
      let ethUsdText = "-";
      if (ORACLE_ADDRESS && ethers.isAddress(ORACLE_ADDRESS)) {
        try {
          const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);
          const [rawPrice, decimals] = await Promise.all([
            oracle.latestAnswer(),
            oracle.decimals(),
          ]);
          const scaled = Number(rawPrice) / (10 ** Number(decimals));
          if (Number.isFinite(scaled) && scaled > 0) {
            ethUsdText = scaled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
        } catch {
          ethUsdText = "-";
        }
      }
      const [balWei, until, renewEnabled, onePeriodCost, silverQuote, goldQuote] = await Promise.all([
        c.balanceWei(account),
        c.subscribedUntil(account),
        c.autoRenewEnabled(account),
        c.quote(1),
        c.quote(SILVER_PERIODS),
        c.quote(GOLD_PERIODS),
      ]);

      setBalance(fmtEth(balWei));
      setTreasuryBalance(fmtEth(treasuryBalanceWei));
      setEthUsdPrice(ethUsdText);
      setSubscribedUntil(Number(until));

      setSilverPrice(fmtEth(silverQuote));
      setGoldPrice(fmtEth(goldQuote));

      const isExpired = Number(until) <= Math.floor(Date.now() / 1000);
      const hasNoFundsForRenewal = balWei < onePeriodCost;
      const shouldShowExpiryPopup = Boolean(renewEnabled) && isExpired && hasNoFundsForRenewal;

      if (shouldShowExpiryPopup && !expiryPopupShown) {
        setShowExpiryPopup(true);
        setExpiryPopupShown(true);
      } else if (!shouldShowExpiryPopup) {
        setExpiryPopupShown(false);
      }
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Refresh failed");
    }
  }, [account, expiryPopupShown]);

  async function doDeposit() {
    try {
      setLog("Depositing...");
      const value = ethers.parseEther(depositAmount);
      let tx;
      let estimated;

      if (isAdmin) {
        if (!window.ethereum) throw new Error("No MetaMask");
        if (!TREASURY_ADDRESS || !ethers.isAddress(TREASURY_ADDRESS)) {
          throw new Error("Invalid VITE_TREASURY_ADDRESS");
        }
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
        const admin = await treasury.admin();
        const signerAddress = await signer.getAddress();
        if (admin.toLowerCase() !== signerAddress.toLowerCase()) {
          throw new Error("Current wallet is not treasury admin.");
        }
        estimated = await treasury.adminDeposit.estimateGas({ value });
        tx = await treasury.adminDeposit({ value, gasLimit: withGasBuffer(estimated) });
      } else {
        const c = await getContract();
        const renewEnabled = await c.autoRenewEnabled(account);
        if (renewEnabled) {
          setLog("Disabling auto-renew before deposit...");
          const disableTx = await c.setAutoRenew(false);
          await disableTx.wait();
        }
        estimated = await c.deposit.estimateGas({ value });
        tx = await c.deposit({ value, gasLimit: withGasBuffer(estimated) });
      }

      setGasDeposit(estimated);
      setLastTxHash(tx.hash);
      await tx.wait();
      setLog("Deposit complete.");
      await refresh();
    } catch (e) {
      const msg = e?.shortMessage || e?.message || "Deposit failed";
      if (isAdmin && (msg.includes("no data present") || msg.includes("execution reverted"))) {
        setLog("Admin treasury deposit is unavailable on this deployment. Run `npm run bootstrap` and reconnect MetaMask.");
      } else {
        setLog(msg);
      }
    }
  }

  async function doSubscribeSilver() {
    try {
      setLog("Subscribing to Silver from wallet...");
      const c = await getContract();
      const quoteWei = await c.quote(SILVER_PERIODS);
      const estimated = await c.subscribe.estimateGas(SILVER_PERIODS, { value: quoteWei });
      setGasSubscribeWallet(estimated);
      const tx = await c.subscribe(SILVER_PERIODS, {
        value: quoteWei,
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setViewerPlan("silver");
      setLog("Silver subscription activated.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Subscribe failed");
    }
  }

  async function doSubscribeGold() {
    try {
      setLog("Subscribing to Gold from wallet...");
      const c = await getContract();
      const quoteWei = await c.quote(GOLD_PERIODS);
      const estimated = await c.subscribe.estimateGas(GOLD_PERIODS, { value: quoteWei });
      setGasSubscribeBalance(estimated);
      const tx = await c.subscribe(GOLD_PERIODS, {
        value: quoteWei,
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setViewerPlan("gold");
      setLog("Gold subscription activated.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Gold subscribe failed");
    }
  }

  async function doSubscribeFromBalanceSilver() {
    try {
      setLog("Subscribing to Silver from balance...");
      const c = await getContract();
      const estimated = await c.subscribeFromBalance.estimateGas(SILVER_PERIODS);
      setGasSubscribeWallet(estimated);
      const tx = await c.subscribeFromBalance(SILVER_PERIODS, {
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setViewerPlan("silver");
      setLog("Silver subscription activated from balance.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Silver subscribe from balance failed");
    }
  }

  async function doSubscribeFromBalanceGold() {
    try {
      setLog("Subscribing to Gold from balance...");
      const c = await getContract();
      const estimated = await c.subscribeFromBalance.estimateGas(GOLD_PERIODS);
      setGasSubscribeBalance(estimated);
      const tx = await c.subscribeFromBalance(GOLD_PERIODS, {
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setViewerPlan("gold");
      setLog("Gold subscription activated from balance.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Gold subscribe from balance failed");
    }
  }

  async function doSubscribeWalletByTier() {
    if (selectedTier === "gold") {
      await doSubscribeGold();
    } else if (selectedTier === "silver") {
      await doSubscribeSilver();
    }
    setShowSubscribePopup(false);
    setSelectedTier("");
  }

  async function doSubscribeBalanceByTier() {
    if (selectedTier === "gold") {
      await doSubscribeFromBalanceGold();
    } else if (selectedTier === "silver") {
      await doSubscribeFromBalanceSilver();
    }
    setShowSubscribePopup(false);
    setSelectedTier("");
  }

  async function doWithdraw() {
    try {
      setLog("Withdrawing from prepaid balance...");
      const c = await getContract();
      const renewEnabled = await c.autoRenewEnabled(account);
      if (renewEnabled) {
        setLog("Disabling auto-renew first...");
        const disableTx = await c.setAutoRenew(false);
        await disableTx.wait();
      }
      const amountWei = ethers.parseEther(withdrawAmount);
      const estimated = await c.withdraw.estimateGas(amountWei);
      setGasWithdraw(estimated);
      const tx = await c.withdraw(amountWei, {
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setLog("Withdraw complete.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Withdraw failed");
    }
  }

  async function doCancelSubscription() {
    if (isCancelling) return;
    try {
      setShowCancelConfirm(false);
      setIsCancelling(true);
      setLog("Cancelling subscription...");
      const c = await getContract();
      const estimated = await c.cancelSubscription.estimateGas();
      setGasCancel(estimated);
      const tx = await c.cancelSubscription({ gasLimit: withGasBuffer(estimated) });
      setLastTxHash(tx.hash);
      await tx.wait();
      setLog("Subscription cancelled.");
      await refresh();
    } catch (e) {
      const msg = e?.shortMessage || e?.message || "Cancel failed";
      if (msg.includes("execution reverted") || msg.includes("missing")) {
        setLog("Cancel failed: deployed contract may be outdated. Run `npm run bootstrap` and reconnect MetaMask.");
      } else {
        setLog(msg);
      }
    } finally {
      setIsCancelling(false);
    }
  }

  async function doEmptyTreasury() {
    try {
      if (!window.ethereum) throw new Error("No MetaMask");
      if (!TREASURY_ADDRESS || !ethers.isAddress(TREASURY_ADDRESS)) {
        throw new Error("Invalid VITE_TREASURY_ADDRESS");
      }

      setLog("Emptying treasury...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const to = await signer.getAddress();
      const treasuryBalanceWei = await provider.getBalance(TREASURY_ADDRESS);
      if (treasuryBalanceWei === 0n) {
        setLog("Treasury is already empty.");
        return;
      }

      const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
      const admin = await treasury.admin();
      if (admin.toLowerCase() !== to.toLowerCase()) {
        setLog("Current wallet is not treasury admin.");
        return;
      }

      const estimated = await treasury.withdraw.estimateGas(to, treasuryBalanceWei);
      setGasEmptyTreasury(estimated);
      const tx = await treasury.withdraw(to, treasuryBalanceWei, {
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setLog("Treasury emptied to your wallet.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Empty treasury failed");
    }
  }

  async function doWithdrawTreasury() {
    try {
      if (!window.ethereum) throw new Error("No MetaMask");
      if (!TREASURY_ADDRESS || !ethers.isAddress(TREASURY_ADDRESS)) {
        throw new Error("Invalid VITE_TREASURY_ADDRESS");
      }

      setLog("Withdrawing treasury amount...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const to = await signer.getAddress();
      const amountWei = ethers.parseEther(treasuryWithdrawAmount);
      if (amountWei <= 0n) {
        throw new Error("Amount must be greater than 0");
      }

      const treasuryBalanceWei = await provider.getBalance(TREASURY_ADDRESS);
      if (treasuryBalanceWei < amountWei) {
        setLog("Not enough balance in treasury for that amount.");
        return;
      }

      const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
      const admin = await treasury.admin();
      if (admin.toLowerCase() !== to.toLowerCase()) {
        setLog("Current wallet is not treasury admin.");
        return;
      }

      const estimated = await treasury.withdraw.estimateGas(to, amountWei);
      setGasWithdrawTreasury(estimated);
      const tx = await treasury.withdraw(to, amountWei, {
        gasLimit: withGasBuffer(estimated),
      });
      setLastTxHash(tx.hash);
      await tx.wait();
      setLog("Treasury withdrawal complete.");
      await refresh();
    } catch (e) {
      setLog(e?.shortMessage || e?.message || "Withdraw treasury failed");
    }
  }

  const refreshGasEstimates = useCallback(async () => {
    if (!account || !CONTRACT_ADDRESS) return;
    try {
      let gDep = null;
      if (currentRole === "Admin" && TREASURY_ADDRESS && ethers.isAddress(TREASURY_ADDRESS) && window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
        try {
          gDep = await treasury.adminDeposit.estimateGas({ value: ethers.parseEther(depositAmount) });
        } catch {
          gDep = null;
        }
      } else {
        const c = await getContract();
        gDep = await c.deposit.estimateGas({ value: ethers.parseEther(depositAmount) });
      }
      setGasDeposit(gDep);

      const c = await getContract();
      const silverQuoteWei = await c.quote(SILVER_PERIODS);
      const withdrawAmountWei = ethers.parseEther(withdrawAmount);
      const [gSubW, gSubB, gWdr, gCan] = await Promise.all([
        c.subscribe.estimateGas(SILVER_PERIODS, { value: silverQuoteWei }),
        c.subscribeFromBalance.estimateGas(GOLD_PERIODS),
        c.withdraw.estimateGas(withdrawAmountWei),
        c.cancelSubscription.estimateGas(),
      ]);

      setGasSubscribeWallet(gSubW);
      setGasSubscribeBalance(gSubB);
      setGasWithdraw(gWdr);
      setGasCancel(gCan);

      if (currentRole === "Admin" && TREASURY_ADDRESS && ethers.isAddress(TREASURY_ADDRESS) && window.ethereum) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const to = await signer.getAddress();
        const treasuryBalanceWei = await provider.getBalance(TREASURY_ADDRESS);
        const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_ABI, signer);
        if (treasuryBalanceWei > 0n) {
          const gEmp = await treasury.withdraw.estimateGas(to, treasuryBalanceWei);
          setGasEmptyTreasury(gEmp);

          try {
            const amountWei = ethers.parseEther(treasuryWithdrawAmount);
            if (amountWei > 0n && amountWei <= treasuryBalanceWei) {
              const gWdrTreasury = await treasury.withdraw.estimateGas(to, amountWei);
              setGasWithdrawTreasury(gWdrTreasury);
            } else {
              setGasWithdrawTreasury(null);
            }
          } catch {
            setGasWithdrawTreasury(null);
          }
        } else {
          setGasEmptyTreasury(null);
          setGasWithdrawTreasury(null);
        }
      } else {
        setGasEmptyTreasury(null);
        setGasWithdrawTreasury(null);
      }
    } catch {
      // Skip when current state makes an action non-estimable.
    }
  }, [account, depositAmount, withdrawAmount, currentRole, treasuryWithdrawAmount]);

  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = (accs) => setAccount(accs?.[0] || null);
    const onChainChanged = (cid) => setChainId(parseInt(cid, 16));
    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  useEffect(() => {
    void autoConnect();
  }, []);

  useEffect(() => {
    if (!account) return;
    const savedPlan = window.localStorage.getItem(`nebflix-plan-${account.toLowerCase()}`);
    if (savedPlan === "silver" || savedPlan === "gold") {
      setViewerPlan(savedPlan);
    } else {
      setViewerPlan("silver");
    }
  }, [account]);

  useEffect(() => {
    if (!account) return;
    window.localStorage.setItem(`nebflix-plan-${account.toLowerCase()}`, viewerPlan);
  }, [account, viewerPlan]);

  useEffect(() => {
    if (currentRole !== "Admin" || !window.ethereum) return;
    if (!CONTRACT_ADDRESS || !ethers.isAddress(CONTRACT_ADDRESS)) return;
    if (!TREASURY_ADDRESS || !ethers.isAddress(TREASURY_ADDRESS)) return;

    let alive = true;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const sub = new ethers.Contract(CONTRACT_ADDRESS, SUBSCRIPTION_EVENTS_ABI, provider);
    const treasury = new ethers.Contract(TREASURY_ADDRESS, TREASURY_EVENTS_ABI, provider);
    let treasuryAdminAddress = "";

    const resolveActorLabel = (addr) => {
      if (!addr) return "UNKNOWN";
      if (account && addr.toLowerCase() === account.toLowerCase() && currentRole === "Admin") return "ADMIN";
      if (treasuryAdminAddress && addr.toLowerCase() === treasuryAdminAddress.toLowerCase()) return "ADMIN";
      return "VIEWER";
    };

    const recordEvent = async (type, details, ev) => {
      const txHash = ev?.log?.transactionHash ?? ev?.transactionHash ?? "";
      const logIndex = ev?.log?.index ?? ev?.index ?? -1;
      const dedupeId = `${type}-${txHash}-${logIndex}`;
      if (seenEventIdsRef.current.has(dedupeId)) return;
      seenEventIdsRef.current.add(dedupeId);
      if (seenEventIdsRef.current.size > 2000) {
        seenEventIdsRef.current.clear();
      }

      let ts = Math.floor(Date.now() / 1000);
      const blockNumber = ev?.log?.blockNumber ?? ev?.blockNumber;
      if (blockNumber) {
        try {
          const block = await provider.getBlock(blockNumber);
          if (block?.timestamp) ts = Number(block.timestamp);
        } catch {
          // keep local timestamp fallback
        }
      }
      if (!alive) return;
      pushEvent({
        id: `${dedupeId}-${Date.now()}`,
        type,
        details,
        timestamp: ts,
        txHash,
      });
    };

    const onDeposited = (user, amount, ev) => void recordEvent("Deposit", `${resolveActorLabel(user)} deposited +${fmtEth(amount)} ETH | ${user}`, ev);
    const onWithdrawn = (user, amount, ev) => void recordEvent("Withdraw", `${resolveActorLabel(user)} withdrew -${fmtEth(amount)} ETH | ${user}`, ev);
    const onSubscribed = (user, _fromTs, untilTs, costWei, ev) => void recordEvent("Subscribe", `${resolveActorLabel(user)} subscribed | cost ${fmtEth(costWei)} ETH | until ${fmtTs(Number(untilTs))} | ${user}`, ev);
    const onCancelled = (user, _previousUntil, cancelledAt, ev) => void recordEvent("Subscription Cancelled", `${resolveActorLabel(user)} cancelled at ${fmtTs(Number(cancelledAt))} | ${user}`, ev);
    const onRenewed = (user, costWei, newUntil, ev) => void recordEvent("BOT MESSAGE-AutoRenewProcessed", `BOT renewed ${resolveActorLabel(user)} | cost ${fmtEth(costWei)} ETH | until ${fmtTs(Number(newUntil))} | ${user}`, ev);
    const onRevenue = (from, amount, ev) => void recordEvent("Treasury Revenue", `${resolveActorLabel(from)} payment moved to treasury +${fmtEth(amount)} ETH | ${from}`, ev);
    const onTreasuryWithdrawn = (to, amount, ev) => void recordEvent("Treasury Withdraw", `ADMIN withdrew treasury -${fmtEth(amount)} ETH to ${to}`, ev);

    const loadRecentEvents = async () => {
      try {
        try {
          treasuryAdminAddress = await treasury.admin();
        } catch {
          treasuryAdminAddress = "";
        }
        const latestBlock = await provider.getBlockNumber();
        const fromBlock = latestBlock > 3000 ? latestBlock - 3000 : 0;

        const [
          subDeposits,
          subWithdrawals,
          subSubscribed,
          subCancelled,
          subRenewed,
          treRevenue,
          treWithdrawn,
        ] = await Promise.all([
          sub.queryFilter(sub.filters.Deposited(), fromBlock, latestBlock),
          sub.queryFilter(sub.filters.Withdrawn(), fromBlock, latestBlock),
          sub.queryFilter(sub.filters.Subscribed(), fromBlock, latestBlock),
          sub.queryFilter(sub.filters.SubscriptionCancelled(), fromBlock, latestBlock),
          sub.queryFilter(sub.filters.AutoRenewProcessed(), fromBlock, latestBlock),
          treasury.queryFilter(treasury.filters.RevenueDeposited(), fromBlock, latestBlock),
          treasury.queryFilter(treasury.filters.Withdrawn(), fromBlock, latestBlock),
        ]);

        for (const ev of subDeposits) {
          const user = ev.args?.[0];
          await recordEvent("Deposit", `${resolveActorLabel(user)} deposited +${fmtEth(ev.args?.[1] ?? 0n)} ETH | ${user}`, ev);
        }
        for (const ev of subWithdrawals) {
          const user = ev.args?.[0];
          await recordEvent("Withdraw", `${resolveActorLabel(user)} withdrew -${fmtEth(ev.args?.[1] ?? 0n)} ETH | ${user}`, ev);
        }
        for (const ev of subSubscribed) {
          const user = ev.args?.[0];
          await recordEvent("Subscribe", `${resolveActorLabel(user)} subscribed | cost ${fmtEth(ev.args?.[3] ?? 0n)} ETH | until ${fmtTs(Number(ev.args?.[2] ?? 0n))} | ${user}`, ev);
        }
        for (const ev of subCancelled) {
          const user = ev.args?.[0];
          await recordEvent("Subscription Cancelled", `${resolveActorLabel(user)} cancelled at ${fmtTs(Number(ev.args?.[2] ?? 0n))} | ${user}`, ev);
        }
        for (const ev of subRenewed) {
          const user = ev.args?.[0];
          await recordEvent("BOT MESSAGE-AutoRenewProcessed", `BOT renewed ${resolveActorLabel(user)} | cost ${fmtEth(ev.args?.[1] ?? 0n)} ETH | until ${fmtTs(Number(ev.args?.[2] ?? 0n))} | ${user}`, ev);
        }
        for (const ev of treRevenue) {
          const from = ev.args?.[0];
          await recordEvent("Treasury Revenue", `${resolveActorLabel(from)} payment moved to treasury +${fmtEth(ev.args?.[1] ?? 0n)} ETH | ${from}`, ev);
        }
        for (const ev of treWithdrawn) {
          await recordEvent("Treasury Withdraw", `ADMIN withdrew treasury -${fmtEth(ev.args?.[1] ?? 0n)} ETH to ${ev.args?.[0]}`, ev);
        }
      } catch {
        // Ignore history fetch issues; live listener still works.
      }
    };

    void loadRecentEvents();

    sub.on("Deposited", onDeposited);
    sub.on("Withdrawn", onWithdrawn);
    sub.on("Subscribed", onSubscribed);
    sub.on("SubscriptionCancelled", onCancelled);
    sub.on("AutoRenewProcessed", onRenewed);
    treasury.on("RevenueDeposited", onRevenue);
    treasury.on("Withdrawn", onTreasuryWithdrawn);

    return () => {
      alive = false;
      sub.off("Deposited", onDeposited);
      sub.off("Withdrawn", onWithdrawn);
      sub.off("Subscribed", onSubscribed);
      sub.off("SubscriptionCancelled", onCancelled);
      sub.off("AutoRenewProcessed", onRenewed);
      treasury.off("RevenueDeposited", onRevenue);
      treasury.off("Withdrawn", onTreasuryWithdrawn);
    };
  }, [currentRole, account, pushEvent]);

  useEffect(() => {
    if (currentRole !== "Admin" && page === "events") {
      setPage("home");
    }
  }, [currentRole, page]);

  useEffect(() => {
    if (!account) {
      setCurrentRole("Viewer");
      return;
    }
    void (async () => {
      const role = await resolveRoleForAccount(account);
      setCurrentRole(role);
    })();
  }, [account, chainId, resolveRoleForAccount]);

  useEffect(() => {
    void refresh();
  }, [refresh, chainId]);

  useEffect(() => {
    if (!account) return;
    const timer = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [account, refresh]);

  useEffect(() => {
    void refreshGasEstimates();
    const timer = setInterval(() => {
      void refreshGasEstimates();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshGasEstimates]);

  useEffect(() => {
    const updateNow = () => setNow(Math.floor(Date.now() / 1000));
    updateNow();
    const timer = setInterval(updateNow, 1000);
    return () => clearInterval(timer);
  }, []);

  const active = subscribedUntil > now;
  const isAdmin = currentRole === "Admin";
  const subscribedUntilText = subscribedUntil ? new Date(subscribedUntil * 1000).toLocaleString() : "-";
  const effectiveViewerPlan = active ? viewerPlan : "none";
  const effectivePlan = isAdmin ? "gold" : effectiveViewerPlan;
  const homeIsSubscribed = isAdmin ? true : active;
  const silverVideoCount = VIDEO_ITEMS.filter((v) => v.minPlan === "silver").length;
  const totalVideoCount = VIDEO_ITEMS.length;
  const unlockedVideoCount = effectivePlan === "gold" ? totalVideoCount : effectivePlan === "silver" ? silverVideoCount : 0;
  const homeStatusText = isAdmin
    ? "Subscribed permanently (Admin)"
    : active
      ? `${viewerPlan === "gold" ? "Gold" : "Silver"} Subscription until: ${subscribedUntilText}`
      : "Subscribe now";

  return (
    <>
      <div style={{ minHeight: "100vh", background: "#eef2f5", overflowX: "hidden" }}>
        <header
          style={{
            background: `linear-gradient(90deg, ${HOME_COLORS.primary}, #13213f)`,
            color: "#fff",
            borderBottom: `3px solid ${HOME_COLORS.accent}`,
          }}
        >
          <div
            style={{
              width: "100%",
              padding: "12px 24px 12px 18px",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1.2 }}>Nebflix</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button onClick={() => setPage("home")} style={{ border: `1px solid ${ACCOUNT_COLORS.accentA}` }}>Home</button>
              <button onClick={() => setPage("account")} style={{ border: `1px solid ${ACCOUNT_COLORS.accentA}` }}>Account</button>
              <button onClick={() => setPage("changeAccount")} style={{ border: `1px solid ${ACCOUNT_COLORS.accentA}` }}>Change account</button>
              {isAdmin ? (
                <button onClick={() => setPage("events")} style={{ border: `1px solid ${ACCOUNT_COLORS.accentA}` }}>Events</button>
              ) : null}
              {!isAdmin && !homeIsSubscribed ? (
                <button
                  onClick={() => {
                    setSelectedTier("");
                    setShowSubscribePopup(true);
                  }}
                  style={{ background: HOME_COLORS.accent, color: HOME_COLORS.primary, border: `1px solid ${HOME_COLORS.accent}`, fontWeight: 700 }}
                >
                  Subscribe now
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div style={{ width: "100%", margin: "0 auto", padding: "12px 24px 26px 18px", boxSizing: "border-box" }}>

      {page === "home" ? (
        <div style={{ fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif", width: "100%", margin: "8px auto 0", padding: 0 }}>
          <div
            style={{
              position: "relative",
              background: `linear-gradient(140deg, ${HOME_COLORS.primary}, ${HOME_COLORS.secondary})`,
              borderRadius: 24,
              padding: 24,
              color: "#fff",
              boxShadow: "0 18px 36px rgba(11, 19, 43, 0.28)",
              overflow: "hidden",
            }}
          >
            <div style={{ position: "absolute", width: 180, height: 180, borderRadius: "50%", background: "rgba(244, 162, 89, 0.14)", top: -40, right: -20 }} />
            <div style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: "rgba(244, 162, 89, 0.12)", bottom: 20, left: -28 }} />

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "stretch", position: "relative" }}>
              <div style={{ background: "rgba(255, 255, 255, 0.08)", borderRadius: 16, padding: 18 }}>
                <h1 style={{ margin: 0, letterSpacing: 1.5, fontSize: 42 }}>Scare PewDiePie</h1>
                <div style={{ marginTop: 10, opacity: 0.9 }}>Comedy Horror Reality</div>
                {!homeIsSubscribed ? (
                  <button
                    onClick={() => {
                      setPage("account");
                      setSelectedTier("");
                      setShowSubscribePopup(true);
                    }}
                    style={{
                      marginTop: 12,
                      display: "inline-block",
                      padding: "8px 14px",
                      borderRadius: 999,
                      border: `1px solid ${HOME_COLORS.accent}`,
                      background: "rgba(11, 19, 43, 0.4)",
                      color: "#fff",
                      fontWeight: 700,
                    }}
                  >
                    Subscribe now
                  </button>
                ) : null}
              </div>

              <div
                style={{
                  borderRadius: 16,
                  border: `2px solid ${HOME_COLORS.accent}`,
                  background: "rgba(255, 255, 255, 0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  fontWeight: 700,
                  fontSize: 18,
                  padding: 14,
                }}
              >
                {homeStatusText}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14, position: "relative" }}>
              <div style={{ borderRadius: 12, background: "rgba(255, 255, 255, 0.1)", padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>ROLE</div>
                <div style={{ fontWeight: 700 }}>{currentRole}</div>
              </div>
              <div style={{ borderRadius: 12, background: "rgba(255, 255, 255, 0.1)", padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>PLAN</div>
                <div style={{ fontWeight: 700 }}>{effectivePlan === "none" ? "-" : effectivePlan.toUpperCase()}</div>
              </div>
              <div style={{ borderRadius: 12, background: "rgba(255, 255, 255, 0.1)", padding: 10, textAlign: "center" }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>VIDEOS</div>
                    <div style={{ fontWeight: 700 }}>{`${unlockedVideoCount} / ${totalVideoCount}`}</div>
              </div>
            </div>

            <div style={{ marginTop: 18, textAlign: "center", fontWeight: 700, letterSpacing: 1 }}>LIBRARY</div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 12, position: "relative" }}>
              {VIDEO_ITEMS.map((item) => {
                const isLocked = !homeIsSubscribed || (item.minPlan === "gold" && effectivePlan !== "gold");
                return (
                  <div
                    key={item.title}
                    style={{
                      borderRadius: 14,
                      overflow: "hidden",
                      background: "rgba(255, 255, 255, 0.96)",
                      border: `1px solid ${HOME_COLORS.primary}`,
                    }}
                  >
                    <div
                      style={{
                        height: 132,
                        backgroundImage: `url(${item.image})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          fontSize: 12,
                          fontWeight: 700,
                          color: HOME_COLORS.primary,
                          background: "#fff",
                          padding: "4px 8px",
                          borderRadius: 999,
                        }}
                      >
                        {item.minPlan.toUpperCase()}
                      </div>
                      {isLocked ? (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(11, 19, 43, 0.68)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: 700,
                            letterSpacing: 0.5,
                          }}
                        >
                          {item.minPlan === "gold" ? "GOLD LOCKED" : "LOCKED"}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ padding: 12, color: HOME_COLORS.primary }}>
                      <div style={{ fontWeight: 700 }}>{item.title}</div>
                      <div style={{ fontSize: 13, opacity: 0.82 }}>{item.subtitle}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : page === "account" ? (
        <div style={{ fontFamily: "system-ui", width: "100%", margin: "20px 0", padding: 16 }}>
          <div
            style={{
              background: `linear-gradient(160deg, ${ACCOUNT_COLORS.panel}, ${ACCOUNT_COLORS.panelSoft})`,
              color: "#fff",
              borderRadius: 18,
              padding: 20,
              border: `1px solid ${ACCOUNT_COLORS.accentA}`,
              boxShadow: "0 14px 28px rgba(0,0,0,0.25)",
            }}
          >
          <h1>Account</h1>
          <div style={{ marginBottom: 12 }}><b>Logged in as:</b> {currentRole}</div>

          {!window.ethereum && (
            <div style={{ padding: 12, border: "1px solid #ccc" }}>Install MetaMask first.</div>
          )}
          {!CONTRACT_ADDRESS && (
            <div style={{ padding: 12, border: "1px solid #ccc", marginTop: 8 }}>
              Missing <code>VITE_CONTRACT_ADDRESS</code>. Run <code>npm run bootstrap</code>.
            </div>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            <button onClick={connect} disabled={!window.ethereum}>
              Connect MetaMask
            </button>
            <div>
              <b>Account:</b> {account || "-"}
            </div>
            {isAdmin ? (
              <div>
                <b>Chain:</b> {chainId || "-"}
              </div>
            ) : null}
          </div>

          <hr style={{ margin: "20px 0" }} />

          <h2>Status</h2>
          <div style={{ padding: 12, border: `1px solid ${ACCOUNT_COLORS.accentA}`, borderRadius: 10, background: "rgba(56,189,248,0.07)" }}>
            {isAdmin ? (
              <>
                <div>
                  <b>Contract:</b> {CONTRACT_ADDRESS || "-"}
                </div>
                <div>
                  <b>Treasury:</b> {TREASURY_ADDRESS || "-"}
                </div>
                <div>
                  <b>Treasury balance:</b> {treasuryBalance} ETH
                </div>
              </>
            ) : null}
            <div>
              <b>ETH price (USD):</b> {ethUsdPrice === "-" ? "-" : `$${ethUsdPrice}`}
            </div>
            {!isAdmin ? (
              <>
                <div>
                  <b>Prepaid balance:</b> {balance} ETH
                </div>
                <div>
                  <b>Subscription:</b> {active ? "Active" : "Inactive"}
                </div>
                <div>
                  <b>Tier:</b> {active ? (viewerPlan === "gold" ? "Gold" : "Silver") : "-"}
                </div>
                <div>
                  <b>Subscribed until:</b> {subscribedUntilText}
                </div>
              </>
            ) : (
              <div>
                <b>Subscription:</b> Admin
              </div>
            )}
          </div>

          <h2 style={{ marginTop: 20 }}>Actions</h2>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>Silver Subscription: {silverPrice} ETH / 30 seconds</div>
            <div>Gold Subscription: {goldPrice} ETH / 3 minutes</div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <input
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              style={{ width: 120 }}
            />
            <button onClick={doDeposit} disabled={!account}>
              Deposit
            </button>
            {isAdmin ? (
              <>
                <input
                  value={treasuryWithdrawAmount}
                  onChange={(e) => setTreasuryWithdrawAmount(e.target.value)}
                  style={{ width: 120 }}
                />
                <button onClick={doWithdrawTreasury} disabled={!account}>
                  Withdraw Treasury
                </button>
                <button
                  onClick={doEmptyTreasury}
                  disabled={!account}
                  style={{ background: "#b00020", color: "#fff", border: "1px solid #7a0016" }}
                >
                  Empty Treasury
                </button>
              </>
            ) : null}
            {!isAdmin ? (
              <>
                <input
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  style={{ width: 120 }}
                />
                <button onClick={doWithdraw} disabled={!account}>
                  Withdraw
                </button>
                <button
                  onClick={() => {
                    setSelectedTier("");
                    setShowSubscribePopup(true);
                  }}
                  disabled={!account || active}
                >
                  Subscribe
                </button>
                <button onClick={() => setShowCancelConfirm(true)} disabled={!account || isCancelling || !active}>
                  {isCancelling ? "Cancelling..." : "Cancel subscription"}
                </button>
              </>
            ) : null}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
            {isAdmin
              ? `Gas estimates -> Deposit: ${fmtGas(gasDeposit)} | Withdraw Treasury: ${fmtGas(gasWithdrawTreasury)} | Empty Treasury: ${fmtGas(gasEmptyTreasury)}`
              : `Gas estimates -> Deposit: ${fmtGas(gasDeposit)} | Withdraw: ${fmtGas(gasWithdraw)} | Subscribe(wallet): ${fmtGas(gasSubscribeWallet)} | Subscribe(balance): ${fmtGas(gasSubscribeBalance)} | Cancel: ${fmtGas(gasCancel)}`}
          </div>

          <div style={{ marginTop: 12, padding: 10, background: "rgba(249,115,22,0.12)", borderRadius: 10, border: `1px solid ${ACCOUNT_COLORS.accentB}` }}>
            <b>Log:</b> {log || "-"}
            {lastTxHash ? (
              <div style={{ marginTop: 6 }}>
                <b>Last tx:</b> <code>{lastTxHash}</code>
              </div>
            ) : null}
          </div>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => void refresh()} disabled={!account}>
              Refresh now
            </button>
          </div>

          {showCancelConfirm ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 12, padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Are you sure you want to cancel your Nebflix subscription?</div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={doCancelSubscription}>YES</button>
                  <button onClick={() => setShowCancelConfirm(false)}>NO</button>
                </div>
              </div>
            </div>
          ) : null}

          {showExpiryPopup ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              }}
            >
              <div style={{ width: "100%", maxWidth: 420, background: "#fff", borderRadius: 12, padding: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  Your subscription expired! No funds left in your account!
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <button onClick={() => setShowExpiryPopup(false)}>Got it!</button>
                </div>
              </div>
            </div>
          ) : null}
          </div>
        </div>
      ) : page === "events" ? (
        <div style={{ fontFamily: "system-ui", width: "100%", margin: "20px 0", padding: 16 }}>
          <div style={{ borderRadius: 18, padding: 20, background: "linear-gradient(160deg, #1f2937, #0f172a)", color: "#fff", border: "1px solid #38bdf8" }}>
          <h1>Events</h1>
          <div style={{ marginBottom: 12 }}><b>Logged in as:</b> {currentRole}</div>
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => {
                setEventsFeed([]);
                seenEventIdsRef.current.clear();
              }}
            >
              Clear Events
            </button>
          </div>
          <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.8 }}>
            Live contract events ({eventsFeed.length} shown, latest first)
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, overflow: "hidden" }}>
            {eventsFeed.length === 0 ? (
              <div style={{ padding: 14 }}>No events yet. Trigger some actions to populate this list.</div>
            ) : (
              eventsFeed.map((item) => (
                <div key={item.id} style={{ padding: 12, borderTop: "1px solid #eee" }}>
                  <div><b>{item.type}</b> - {fmtTs(item.timestamp)}</div>
                  <div style={{ opacity: 0.85 }}>{item.details}</div>
                  {item.txHash ? (
                    <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-all" }}>
                      tx: {item.txHash}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          </div>
        </div>
      ) : (
        <div style={{ fontFamily: "system-ui", width: "100%", margin: "20px 0", padding: 16 }}>
          <div style={{ borderRadius: 18, padding: 20, background: "linear-gradient(160deg, #1f2937, #0f172a)", color: "#fff", border: "1px solid #38bdf8" }}>
          <h1>Change account</h1>
          <div style={{ marginBottom: 12 }}><b>Logged in as:</b> {currentRole}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <button
              onClick={() => {
                void connectAs("Viewer");
              }}
            >
              Viewer
            </button>
            <button
              onClick={() => {
                void connectAs("Admin");
              }}
            >
              Admin
            </button>
          </div>
          </div>
        </div>
      )}
        </div>
      </div>

      {showSubscribePopup ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1200,
          }}
        >
          <div style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 20 }}>Choose subscription tier</div>
              <button
                onClick={() => {
                  setShowSubscribePopup(false);
                  setSelectedTier("");
                }}
                style={{ width: 34, height: 34, fontSize: 20, lineHeight: 1, padding: 0 }}
              >
                X
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
              <button
                onClick={() => setSelectedTier("silver")}
                style={{ padding: "12px 16px", fontSize: 18, fontWeight: 700 }}
              >
                Silver
              </button>
              <button
                onClick={() => setSelectedTier("gold")}
                style={{ padding: "12px 16px", fontSize: 18, fontWeight: 700 }}
              >
                Gold
              </button>
            </div>
            {selectedTier ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ marginBottom: 8, fontSize: 16 }}>
                  Selected tier: <b>{selectedTier === "gold" ? "Gold" : "Silver"}</b>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => void doSubscribeWalletByTier()}>Wallet</button>
                  <button onClick={() => void doSubscribeBalanceByTier()}>Balance</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
