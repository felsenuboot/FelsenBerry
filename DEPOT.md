# Community Depot Protocol

Shared resource depot for all Claude bots. Location: flat ground within ~3 blocks of the
crafting table at (-3, 111, 4). Exact chest coordinates are appended below by whoever
places them.

## Chests

| Chest | Category | Coordinates |
|-------|----------|-------------|
| A | Wood: logs, planks, sticks, saplings | (-5, 111, 1) |
| B | Minerals: cobblestone, ores, ingots, coal | (-5, 111, 3) |
| C | Food & misc: meat, wool, eggs, seeds, leather | (-3, 111, 1) |

## Rules (all driver agents follow these)

1. **Deposit excess**: keep your working set (tools + ~1 stack of what you actively use);
   deposit the rest whenever you pass the depot. A lumberjack carrying 30 logs keeps 8.
2. **Announce every transfer in chat** (English): `DEPOT +8 oak_log` after depositing,
   `DEPOT -4 oak_planks` after withdrawing. Chat is the shared ledger.
3. **Check the depot first**: before gathering materials you need for crafting, open the
   matching chest and withdraw instead of harvesting fresh.
4. **Don't drain**: leave at least 25% of a stack another bot announced depositing unless
   you announced needing it and nobody objected in chat.
5. **Mineflayer chest access** (via /eval): `const c = await bot.openContainer(bot.blockAt(new Vec3(x,y,z)));
   await c.deposit(bot.registry.itemsByName["oak_log"].id, null, count); c.close();`
   (withdraw: `c.withdraw(id, null, count)`).
6. **KackboonKevin limitation**: the MCP toolset has no chest-transfer tool. Kevin
   announces excess in chat (`EXCESS: 20 cobblestone`) instead; framework bots may
   arrange pickup. Long-term fix: chest support for Kevin or a framework successor.
7. Chests are OURS — never take from chests placed by other players/bots (zetbots,
   ZetOmega, Felsenuboot), and defend nothing: if someone raids ours, report in chat and
   to the orchestrator, don't retaliate.

## Placement log

(append lines here: `YYYY-MM-DD chest <A|B|C> placed at (x, y, z) by <botname>`)

2026-08-31 chest A placed at (-5, 111, 1) by FurzFriedrich
2026-08-31 chest B placed at (-5, 111, 3) by FurzFriedrich
2026-08-31 chest B found MISSING (spot empty, furnace now at (-3,111,3)); crafted + re-placed at (-5, 111, 3) by BuddelBernd
2026-08-31 chest C placed at (-3, 111, 1) by FurzFriedrich
2026-08-31 chest A found DESTROYED (empty air, floor block below gone too) by MettMarcel; backfilled + rebuilt at (-5, 111, 1) by FurzFriedrich, restocked +8 oak_log +17 birch_log +2 oak_planks +10 oak_sapling +6 birch_sapling
