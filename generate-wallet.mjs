import { Keypair } from "@solana/web3.js";
import fs from "fs";

const kp = Keypair.generate();
fs.writeFileSync("devnet-wallet.json", JSON.stringify(Array.from(kp.secretKey)));
console.log("✅ Public Key:", kp.publicKey.toBase58());
console.log("⚠️  Fund this address at https://faucet.solana.com (select Devnet)");
