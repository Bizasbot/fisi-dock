// Import this first (before anything that loads lib/palette.ts): it pins the shipped
// gentleman pink so a test never depends on the local palette on disk
// (themes/active-palette.json, Herdr preferences, themes/Fisi-Dock.json).
// Runtime is unchanged: without FISI_DOCK_PALETTE the palette still follows the disk.
process.env.FISI_DOCK_PALETTE = "default";
