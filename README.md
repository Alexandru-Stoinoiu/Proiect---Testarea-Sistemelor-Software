# Sample Hardhat 3 Beta Project (`mocha` and `ethers`)

This project showcases a Hardhat 3 Beta project using `mocha` for tests and the `ethers` library for Ethereum interactions.

To learn more about the Hardhat 3 Beta, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3 Beta](https://hardhat.org/hardhat3-beta-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using `mocha` and ethers.js
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `mocha` tests:

```shell
npx hardhat test solidity
npx hardhat test mocha
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```


# Blockchain Subscriptions – Local Setup

Folosim **Hardhat** pentru a rula un blockchain de Etherum local, si Solidity pentru smart contract

---

## Requirements

Instaleaza:

### 1. Node.js (LTS)
-Versiune cel putin 18! (De preferat 20+)
-https://nodejs.org

Verifica:
```bash
node -v
npm -v
git --version
```

Trebuie:
MetaMask (Extensie de browser- pref Chrome)
- https://metamask.io
- Interactiunea cu blockchainul lcoal

## Setup:

```bash
git clone <https://github.com/Alexandru-Stoinoiu/Proiect---Testarea-Sistemelor-Software.git>
cd Proiect---Testarea-Sistemelor-Software
npm install
npm test
```

Comanda `npm test` ruleaza toate testele Hardhat din folderul `test/`.

## Rulare Locala
Terminal 1
```bash
npm run chain
```
Terminal 2
```bash
npm run bootstrap
npm run ui
```
Terminal 3 
```
$env:USER_ADDRESS="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
$env:SUBSCRIPTION_ADDRESS="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
npm run keeper
```

### Pe MetaMask
Faci cont (bla bla)
- Adauga network custom:
  -RPC URL: http://127.0.0.1:8545
  -Chain ID: 31337
- Importeaza o cheie din terminalul 1 pentru un cont nou

### Note
- Foloseste numai *ETH local Hardhat*
- Nu exista fonduri sau blockchainuri reale!
- FUNCTIE "PURE" in Subscriptions.sol -line 199
- GAS in App.jsx -~line 250.  
  - gasUsed = cat s-a folosit
  - gasPrice = pretul/unitate de gas
  - cost ETH = gasUsed * gasPrice
  - DECI arata cat de "greu" este fiecare apel pe EVM(Ethereum Virtual Machine)
- ORACLE in contract. deploy.ts(line 6) si bootstrap.ts(line 8 & 16) app.jsx(line 12)

## Prezentare Testare

Pentru cerinta **T8 - Testarea unei retele Blockchain**, proiectul include teste automate realizate cu **Hardhat, Mocha, Chai si TypeScript**. Aceste teste ruleaza pe o retea blockchain locala simulata si verifica atat comportamentul individual al contractelor, cat si interactiunea dintre ele.

In proiect sunt acoperite urmatoarele categorii:
- **Teste unitare** pentru functiile esentiale din contractele `Subscription`, `Treasury` si `MockOracle`
- **Teste de integrare** pentru fluxurile complete dintre contracte, de exemplu depunere, abonare, trimiterea fondurilor catre treasury si reinnoirea automata
- **Teste de securitate** pentru controlul accesului, validarea inputului si blocarea operatiilor nepermise
- **Teste de performanta** prin masurarea consumului de gas pentru operatiile principale din sistem

Prin **testele unitare** se verifica daca fiecare functie isi respecta responsabilitatea: de exemplu depunerea fondurilor, calculul perioadei de abonare, actualizarea starii de auto-renew, modificarea pretului sau actualizarea valorii din oracle. Ideea principala este ca fiecare componenta sa fie verificata separat, pe cazuri valide si invalide.

Prin **testele de integrare** se verifica felul in care contractele colaboreaza intre ele. In proiect, `Subscription` nu functioneaza izolat, ci interactioneaza cu `Treasury`, iar unele informatii sunt influentate de `MockOracle`. De aceea, este important sa demonstram nu doar ca metodele merg individual, ci si ca fluxul complet functioneaza corect atunci cand contractele comunica intre ele.

**Testele de securitate** sunt importante in orice aplicatie blockchain deoarece contractele gestioneaza bani si reguli de acces care, odata deployate, trebuie sa fie foarte clare. In proiect am verificat in special restrictiile pe roluri, prevenirea apelurilor neautorizate, validarea valorilor invalide si blocarea operatiilor atunci cand contractul este pus pe `paused`. Aceste teste raspund la intrebari de tipul: "cine are voie sa cheme functia?", "ce se intampla daca utilizatorul trimite o valoare gresita?" sau "sistemul poate fi folosit intr-o stare in care ar trebui sa fie blocat?".

**Testele de performanta** urmaresc costul executiei pe EVM pentru operatii precum `deposit`, `subscribeFromWallet`, `subscribeFromBalance`, `processRenewal`, `withdraw`, `adminDeposit` si `treasury.withdraw`. In blockchain, performanta nu inseamna doar timp de executie, ci mai ales cost de executie exprimat prin `gas`. De aceea, aceste teste sunt utile pentru a arata ca functiile importante nu sunt doar corecte, ci si rezonabile din punct de vedere al costului.

Pe langa simpla masurare a consumului de gas, testele compara si scenarii diferite. De exemplu, se poate observa ca o reinnoire automata a abonamentului este mai ieftina decat o prima abonare platita direct din wallet, iar o abonare care lasa rest in sold poate consuma mai mult gas decat o plata exacta. Aceste comparatii sunt utile la prezentare deoarece arata ca nu am masurat valori "de forma", ci am analizat comportamentul sistemului in situatii relevante.

Toata suita se ruleaza din directorul proiectului cu:

```bash
npm test
```

La momentul actual, rularea automata a testelor returneaza cu succes toate suitele definite, inclusiv testele de performanta. Rezultatul obtinut confirma ca logica principala a contractelor functioneaza corect, ca interactiunea dintre componente este valida, ca exista controale de securitate de baza si ca operatiile importante raman in limite rezonabile de cost pe reteaua blockchain locala.

Pe scurt, partea de testare din proiect nu demonstreaza doar ca "aplicatia merge", ci ca poate fi verificata sistematic din mai multe perspective: corectitudine functionala, colaborare intre contracte, securitate si eficienta executiei. Acesta este motivul pentru care testarea este esentiala intr-un proiect blockchain, unde orice eroare logica sau de acces poate avea efect direct asupra fondurilor si asupra comportamentului intregului sistem.
