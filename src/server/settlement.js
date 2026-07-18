import { json } from "./http.js";
import { fakeBase58, readRequestBody } from "./utils.js";

export async function handleSettlement(req, res) {
  const body = await readRequestBody(req);
  const marketId = String(body.marketId || "UNKNOWN");
  const userWallet = String(body.userWallet || "");
  const txSignature = fakeBase58("4sbl");
  const escrowPda = fakeBase58("Esc");
  const vaultPda = fakeBase58("Vlt");
  const explorerUrl = `https://explorer.solana.com/tx/${txSignature}?cluster=devnet`;

  if (!userWallet) {
    json(res, 400, {
      error: "missing_user_wallet",
      message: "userWallet is required for settlement simulation."
    });
    return;
  }

  json(res, 200, {
    id: `escrow-${marketId}`,
    userWallet,
    marketId,
    selection: body.selection || "resolved_selection",
    amountUsdc: body.amountUsdc || "100.00",
    status: "settled",
    escrowPda,
    vaultPda,
    settleTx: txSignature,
    txSignature,
    explorerUrl,
    validation: {
      program: process.env.TXLINE_DEVNET_PROGRAM_ID || "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
      instruction: "validateStatV2",
      result: "passed"
    }
  });
}
