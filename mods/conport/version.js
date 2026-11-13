// The versions the mod names in its footer. The modules of the mod use no Node API and no
// setTimeout: they run inside Herdr.

/** The version of the mod: a copy of `version` in mod.json (a module reads no files). */
export const MOD_VERSION = '0.2.0'

/** The conport CLI release the mod runs, as `npx -y conport@<CLI_VERSION>`: an exact version. */
export const CLI_VERSION = '0.11.0'
