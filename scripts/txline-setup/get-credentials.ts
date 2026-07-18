import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import axios from "axios";
import nacl from "tweetnacl";
import fs from "fs";

// ─── CONFIG ────────────────────────────────────────────────────────────────

const WALLET_PATH = "./devnet-wallet.json"; // ← change if yours is elsewhere
const SERVICE_LEVEL_ID = 1;                 // Free World Cup tier
const DURATION_WEEKS   = 4;
const SELECTED_LEAGUES: number[] = [];      // Empty = standard free bundle

const CONFIG = {
  rpcUrl:      "https://api.devnet.solana.com",
  apiOrigin:   "https://txline-dev.txodds.com",
  programId:   new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
  txlTokenMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
};

const apiBaseUrl = `${CONFIG.apiOrigin}/api`;

// ─── LOAD WALLET ───────────────────────────────────────────────────────────

const rawKey  = JSON.parse(fs.readFileSync(WALLET_PATH, "utf-8"));
const keypair = Keypair.fromSecretKey(Uint8Array.from(rawKey));
console.log("✅ Wallet loaded:", keypair.publicKey.toBase58());

// ─── SETUP ANCHOR ──────────────────────────────────────────────────────────

const connection = new Connection(CONFIG.rpcUrl, "confirmed");
const wallet     = new anchor.Wallet(keypair);
const provider   = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// ─── MAIN ──────────────────────────────────────────────────────────────────

async function main() {

  // STEP A — Get Guest JWT
  console.log("\n📡 Step 1: Fetching Guest JWT...");
  const authRes = await axios.post(`${CONFIG.apiOrigin}/auth/guest/start`);
  const jwt     = authRes.data.token;
  console.log("✅ Guest JWT received:", jwt.slice(0, 40) + "...");

  // STEP B — Derive PDAs
  console.log("\n🔑 Step 2: Deriving on-chain accounts...");

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    CONFIG.programId
  );

  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    CONFIG.txlTokenMint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    CONFIG.programId
  );

  const userTokenAccount = getAssociatedTokenAddressSync(
    CONFIG.txlTokenMint,
    provider.wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  console.log("  tokenTreasuryPda   :", tokenTreasuryPda.toBase58());
  console.log("  pricingMatrixPda   :", pricingMatrixPda.toBase58());
  console.log("  userTokenAccount   :", userTokenAccount.toBase58());

  // STEP C — Load IDL and subscribe on-chain
  // NOTE: Download the devnet IDL from TxLINE docs and save as ./idl/txoracle.json
  console.log("\n⛓️  Step 3: Submitting on-chain subscribe transaction...");

  let txSig: string;

  try {
    const idlJson     = JSON.parse(fs.readFileSync("./idl/txoracle.json", "utf-8"));
    const program     = new anchor.Program(idlJson, provider);

    txSig = await program.methods
      .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
      .accounts({
        user:                  provider.wallet.publicKey,
        pricingMatrix:         pricingMatrixPda,
        tokenMint:             CONFIG.txlTokenMint,
        userTokenAccount,
        tokenTreasuryVault,
        tokenTreasuryPda,
        tokenProgram:          TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram:         SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Subscribe tx confirmed:", txSig);

  } catch (err: any) {
    console.error("❌ Subscribe failed:", err.message);
    console.log("\n💡 If IDL is missing, download it from:");
    console.log("   https://txline-docs.txodds.com");
    process.exit(1);
  }

  // STEP D — Sign activation message
  console.log("\n✍️  Step 4: Signing activation message...");

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  // For empty leagues this produces:  txSig::jwt
  const messageBytes  = new TextEncoder().encode(messageString);
  const sigBytes      = nacl.sign.detached(messageBytes, keypair.secretKey);
  const walletSig     = Buffer.from(sigBytes).toString("base64");

  console.log("  Message signed:", messageString.slice(0, 60) + "...");

  // STEP E — Activate API token
  console.log("\n🚀 Step 5: Activating API token...");

  const activationRes = await axios.post(
    `${apiBaseUrl}/token/activate`,
    {
      txSig,
      walletSignature: walletSig,
      leagues:         SELECTED_LEAGUES,
    },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );

  const apiToken = activationRes.data.token ?? activationRes.data;
  console.log("✅ API Token received:", String(apiToken).slice(0, 40) + "...");

  // STEP F — Print your .env block
  console.log("\n");
  console.log("═".repeat(60));
  console.log("  ✅  COPY THESE INTO YOUR .env FILE");
  console.log("═".repeat(60));
  console.log(`TXLINE_GUEST_JWT=${jwt}`);
  console.log(`TXLINE_API_TOKEN=${apiToken}`);
  console.log(`TXLINE_NETWORK=devnet`);
  console.log("═".repeat(60));

  // Also write to .env.txline automatically
  const envContent = [
    `TXLINE_GUEST_JWT=${jwt}`,
    `TXLINE_API_TOKEN=${apiToken}`,
    `TXLINE_NETWORK=devnet`,
  ].join("\n");

  fs.writeFileSync(".env.txline", envContent);
  console.log("\n📄 Also saved to .env.txline automatically\n");
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message ?? err);
  process.exit(1);
});
