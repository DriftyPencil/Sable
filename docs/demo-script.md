# Sable 4-Minute Demo Script

## 0:00 - Open Terminal

Action: Open `http://localhost:3000`.

Expected output: Sable loads in DEMO mode with status cells, match tape, odds monitor, scanner, chart, and settlement console.

Narrator: "Sable is a professional betting intelligence terminal powered by TxLINE-shaped real-time sports data."

## 0:25 - Start Replay

Action: Keep `BRA vs ARG`, speed `5x`, click `Replay`.

Expected output: Match tape starts receiving status and odds ticks.

Narrator: "Demo mode replays a full fixture so judging works even when live matches are quiet."

## 0:45 - Navigate By Command

Action: Press `Cmd+K`, type `MATCH BRA-ARG`, press Enter.

Expected output: Match detail pane is focused with score, fixture ID, volume, alert count, and latest sequence.

Narrator: "The operator can drive the terminal by command, not by hunting through menus."

## 1:15 - Odds Repricing

Action: Let the Argentina goal and following odds tick play.

Expected output: Tape shows `GOAL`, odds table reprices Argentina, chart updates for selected market.

Narrator: "A TxLINE match event causes immediate implied probability movement across active markets."

## 1:45 - Steam Scanner

Action: Type `STEAM --live`.

Expected output: Scanner focuses and displays high-basis-point market movement alerts.

Narrator: "Sable detects steam moves and ties the move back to the triggering match event."

## 2:20 - Odds Monitor

Action: Type `ODDS BRA-ARG`; click `BRA_ML`.

Expected output: Odds table focuses the Brazil winner market; chart displays its probability path.

Narrator: "Operators get a compact view of consensus price, implied probability, volume, and line movement."

## 2:50 - Resolution Receipt

Action: After finalization, type `PROOF BRA_ML`.

Expected output: Receipt drawer opens with payload hash, stat keys, daily scores PDA, event root, and Merkle proof nodes.

Narrator: "The market resolution is backed by a visible TxLINE proof receipt, not a hidden oracle assumption."

## 3:25 - Settlement Simulation

Action: Type `SETTLE BRA_ML`.

Expected output: Settlement console shows `settled`, `validateStatV2`, devnet program, and explorer transaction reference.

Narrator: "A devnet escrow can use TxLINE validation before releasing SOL or USDC to the winning side."

## 3:50 - Closing Shot

Action: Leave receipt drawer open and show the status bar.

Expected output: Market is resolved, receipt is verified, settlement has a transaction reference.

Narrator: "Sable turns real-time World Cup data into explainable, verifiable market intelligence."
