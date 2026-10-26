# Reglo ICC — how this module is built

Ismatec 4-channel peristaltic pump, flow-rate mode, mL/min. **Read it for**: a protocol that is not
NAMUR, several channels on one card, values the app computes, and safety rules generated per channel.
Manual facts with pages: [`docs/manuals/reglo-icc/notes.md`](../../../docs/manuals/reglo-icc/notes.md).

| File | What it shows |
| --- | --- |
| [`module.ts`](module.ts) | `protocol: ISMATEC` (acknowledged writes, `*`/`#`), `initCommands`, number formats (`formatSetpoint`, `parse`), `groups` (one block per channel), `derive()` (flow and dispensed computed by the app). |
| [`safety.ts`](safety.ts) | Rules built in a loop, one per channel; one rule that watches any `stirrer`. |
| [`sim.ts`](sim.ts) | Its own transport (not the NAMUR simulator): the Ismatec replies, thinner tubing on channel 2. |
| [`reglo-icc.test.ts`](reglo-icc.test.ts) | Number formats against the manual's examples, the driver against the simulator, both safety rules. |

## Choices, and why

- **Channel addressing on** (`1~1`) first on every connect: without it, on RS-232, `2H` starts every channel (manual p. 17).
- **No unsolicited messages** (`1xE0`): they would be mistaken for replies.
- **Flow-rate mode on every channel**; the pump converts mL/min to rpm with the tubing ID set on the pump, so that setting must match the tubing.
- **No flow sensor**: "Flow" is the set rate while running, "Dispensed" the app's integral of it — an estimate until the channel is calibrated.
- **Direction is not changed by the app**; set it on the pump.
- **`provides: ['pump', 'dosing']`**.

## Safety rules

| Rule | Trips when | Default | Turns off |
| --- | --- | --- | --- |
| Ch *n* volume limit (one per channel) | that channel's dispensed volume reaches the maximum | off | that channel |
| Dose only while stirring *(with stirrer)* | a channel runs while nothing on the page is stirring, for N s | 5 s | all channels |

The volume limit uses the app's estimate; keep a margin until the channel is calibrated. Dosing a set
volume in the pump's own Volume mode (DESIGN §11) would also stop the pump if the Pi fails.
