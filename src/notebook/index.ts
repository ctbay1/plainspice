/**
 * The Notebook look (decision 0014): the circuit drawn on the Solved Circuits page from its
 * netlist (src/schematic), solved by ngspice (src/engine), with the results written on it. The
 * model (results, fit, settings, solve, measure) is plain TypeScript; NotebookCanvas only renders
 * (decision 0002). Import './notebook.css' once for the look and its fonts.
 */
export { NotebookCanvas, itemBox } from './NotebookCanvas.tsx';
export type { CanvasEditing, CanvasHandle, CanvasViewInfo, GhostKind, NotebookCanvasProps, PointerInfo, PressClaim } from './NotebookCanvas.tsx';
export { EditLayer } from './EditLayer.tsx';
export type { EditMarks } from './EditLayer.tsx';
export { Drawing, UNIT_PX, itemKey } from './Drawing.tsx';
export type { PenMarks } from './Drawing.tsx';
export { MIN_TEXT_PX, NO_INSETS, fitView, minUnitFor, toGrid, toScreen, zoomAt } from './fit.ts';
export type { Fit, FitOptions, Insets, Size, View } from './fit.ts';
export { ARROW_ICON, NODE_INLINE_ROOM, NODE_VOLTAGE_ROOM, TYPE, notebookMeasure, resultWidth, widthIn } from './measure.ts';
export type { TypeStyle } from './measure.ts';
export { CURRENT_ROOM, METER_ROOM, NO_RESULTS, POWER_ROOM, POWER_WORD_ROOM, inkBoxes, inlineValue, isAmmeter, isInline, markBox, markLayout, markText, markWidth, placeResults, resultRoom, roomOf } from './results.ts';
export type { DrawingResults, MarkLayout, NodeMarks, PartMarks, ResultMark, ResultTone } from './results.ts';
export { NOTEBOOK_OPTIONS, drawingLineIndexes, notebookSchematic, withDrawingBlock } from './schematic.ts';
export { RESULT_FONTS, RESULT_FONT_KEY, RESULT_FONT_STRINGS, createResultFontStore, readResultFont, writeResultFont } from './settings.ts';
export type { ResultFont, ResultFontStore, SettingStorage } from './settings.ts';
export { answers, liveSolver, solve } from './solve.ts';
export type { LiveSolver, Runner, Solution } from './solve.ts';
export { NOTEBOOK_STRINGS } from './strings.ts';
export { isWide, turnedQuarter, wireBends } from './turn.ts';
export { NOTE_LINE, NOTE_SIZE, NOTE_WIDTH, WAS_SCALE, nodeBox, noteWidth, partBox, placeNote, sceneRoom, wasMarks, wrapWords } from './notes.ts';
export type { NoteOptions, PenNote, WasMark } from './notes.ts';
export { MAX_LEADER, boxOnGrid, boxOnScreen, coverCost, crossesAnything, drawingRoom, inviteArrow, leaderFor, moveBy, placeBeside, placeCard, segmentsIntersect, symbolBoxes, wireSegments, wordBoxes } from './place.ts';
export type { BesideOptions, CardPlacement, CardRequest, Placement, Room, Side } from './place.ts';
export { ACROSS_STRINGS, RESULTS_POINTER, acrossWords, currentText, nodeWord, withoutResultsPointer } from './words.ts';
export type { AcrossInput, AcrossWords } from './words.ts';
export { ARROWHEAD, GROUND_INK, INK, currentArrow, markPath, toolIcon } from './symbols.ts';
export type { InkSymbol, ToolKind } from './symbols.ts';
