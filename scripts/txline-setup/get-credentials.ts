import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import nacl from "tweetnacl";

const SCRIPT_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

const NETWORK = "devnet";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const API_ORIGIN = "https://txline-dev.txodds.com";
const API_BASE_URL = `${API_ORIGIN}/api`;
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXL_TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: number[] = [];
const WALLET_PATH = path.join(REPO_ROOT, "devnet-wallet.json");

function maskSecret(value: string): string {
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined || value === "") throw new Error(message);
  return value;
}

function loadOrCreateWallet(): Keypair {
  if (fs.existsSync(WALLET_PATH)) {
    const secretKey = JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  const keypair = Keypair.generate();
  fs.writeFileSync(WALLET_PATH, JSON.stringify(Array.from(keypair.secretKey), null, 2), {
    mode: 0o600,
  });
  return keypair;
}

async function fundWallet(connection: Connection, publicKey: PublicKey) {
  const balance = await connection.getBalance(publicKey, "confirmed");
  if (balance >= 0.01 * LAMPORTS_PER_SOL) {
    console.log(`Wallet SOL balance: ${(balance / LAMPORTS_PER_SOL).toFixed(3)}`);
    return;
  }

  console.log("Requesting 0.1 devnet SOL for TxLINE subscription fees...");
  try {
    const signature = await connection.requestAirdrop(publicKey, 0.1 * LAMPORTS_PER_SOL);
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
    const nextBalance = await connection.getBalance(publicKey, "confirmed");
    console.log(`Wallet SOL balance: ${(nextBalance / LAMPORTS_PER_SOL).toFixed(3)}`);
  } catch (error) {
    console.log("Devnet faucet airdrop failed.");
    console.log(`Fund this devnet address, then rerun npm run txline:credentials: ${publicKey.toBase58()}`);
    console.log("Faucet: https://faucet.solana.com");
    throw error;
  }
}

async function ensureUserTokenAccount(
  connection: Connection,
  payer: Keypair,
  userTokenAccount: PublicKey
) {
  const existingAccount = await connection.getAccountInfo(userTokenAccount, "confirmed");
  if (existingAccount) {
    console.log(`TxL token account already exists: ${userTokenAccount.toBase58()}`);
    return;
  }

  console.log("Creating required TxL Token-2022 associated token account...");
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      userTokenAccount,
      payer.publicKey,
      TXL_TOKEN_MINT,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  const signature = await connection.sendTransaction(transaction, [payer], {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
  console.log(`TxL token account created: ${signature}`);
}

function readLocalIdl(): anchor.Idl | undefined {
  const candidatePaths = [
    path.join(REPO_ROOT, "idl/txoracle.json"),
    path.join(SCRIPT_DIR, "idl/txoracle.json"),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) continue;
    const contents = fs.readFileSync(candidatePath, "utf8").trim();
    if (!contents) continue;
    const idl = JSON.parse(contents) as anchor.Idl;
    if (Array.isArray(idl.instructions) && idl.instructions.length) {
      console.log(`Loaded TxLINE IDL from ${candidatePath}`);
      return idl;
    }
  }

  return undefined;
}

async function loadTxlineIdl(provider: anchor.AnchorProvider): Promise<anchor.Idl> {
  const localIdl = readLocalIdl();
  if (localIdl) return localIdl;

  console.log("Fetching TxLINE devnet IDL from chain...");
  return requireValue(
    await anchor.Program.fetchIdl(PROGRAM_ID, provider),
    "Could not fetch TxLINE devnet IDL."
  );
}

function upsertEnvFile(filePath: string, values: Record<string, string>) {
  const existingLines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    : [];
  const seen = new Set<string>();
  const updatedLines = existingLines.map((line) => {
    const key = line.includes("=") ? line.slice(0, line.indexOf("=")).trim() : "";
    if (!key || !(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) updatedLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(filePath, `${updatedLines.filter(Boolean).join("\n")}\n`, {
    mode: 0o600,
  });
}

async function main() {
  const keypair = loadOrCreateWallet();
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log(`Network: ${NETWORK}`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Wallet file: ${WALLET_PATH}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Service level: ${SERVICE_LEVEL_ID}`);

  await fundWallet(connection, wallet.publicKey);

  console.log("Fetching guest JWT...");
  const authResponse = await axios.post(`${API_ORIGIN}/auth/guest/start`);
  const jwt = requireValue(authResponse.data.token as string | undefined, "Guest auth did not return a token.");
  console.log(`Guest JWT: ${maskSecret(jwt)}`);

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    PROGRAM_ID
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    TXL_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    PROGRAM_ID
  );
  const userTokenAccount = getAssociatedTokenAddressSync(
    TXL_TOKEN_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  await ensureUserTokenAccount(connection, keypair, userTokenAccount);

  const idl = await loadTxlineIdl(provider);
  const program = new anchor.Program(idl, provider);

  console.log("Submitting TxLINE devnet free-tier subscription...");
  const txSig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TXL_TOKEN_MINT,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Subscribe transaction: ${txSig}`);

  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(messageString),
    keypair.secretKey
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");

  console.log("Activating TxODDS API token...");
  const activationResponse = await axios.post(
    `${API_BASE_URL}/token/activate`,
    {
      txSig,
      walletSignature,
      leagues: SELECTED_LEAGUES,
    },
    { headers: { Authorization: `Bearer ${jwt}` } }
  );
  const apiToken = String(
    requireValue(activationResponse.data.token || activationResponse.data, "Activation did not return an API token.")
  );
  console.log(`API token: ${maskSecret(apiToken)}`);

  const envValues = {
    TXLINE_NETWORK: NETWORK,
    TXLINE_GUEST_JWT: jwt,
    TXLINE_API_TOKEN: apiToken,
    TXLINE_DEVNET_API_BASE: "https://txline-dev.txodds.com/api",
    TXLINE_MAINNET_API_BASE: "https://txline.txodds.com/api",
    SOLANA_RPC_URL: RPC_URL,
  };

  upsertEnvFile(path.join(REPO_ROOT, ".env"), envValues);
  upsertEnvFile(path.join(REPO_ROOT, ".env.txline"), envValues);

  console.log("Credentials written to .env and .env.txline.");
  console.log("Restart Sable and switch to LIVE mode.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Credential setup failed: ${message}`);
  process.exit(1);
});
