/**
 * The schematic model: the circuit drawn from its netlist, kept in step with it both ways. Plain
 * TypeScript, no React, no CSS, no colours (decision 0013, docs/schematic.md). The visual styles
 * render `Schematic.scene`; the editor applies `EditResult.changes` to the netlist text.
 */
export { GROUND, circuitFromNetlist, nodeText, partByKey } from './circuit.ts';
export type { Circuit, CircuitNode, CircuitPart, CurrentControl, DotLine, HiddenRef, NotDrawnLine, NotDrawnReason, PartControl, PinRef, VoltageControl } from './circuit.ts';

export { DEFAULT_VALUES, EDIT_STRINGS, applyEdit, freshNodeName, freshPartName, insertLine, mergeChanges, pinDrawing, readsWords, wireRoute } from './edit.ts';
export type { EditOp, EditOptions, EditResult, WireEnd } from './edit.ts';

export { checkConnectivity, danglingEnds, drawnPins, findIslands, junctionPoints } from './connectivity.ts';
export type { ConnectivityProblem, DrawnPin, Islands } from './connectivity.ts';

export {
  LABEL_SIDES,
  MAX_VALUE_CHARS,
  NODE_SPOTS,
  cloneDrawing,
  controlText,
  emptyDrawing,
  functionWords,
  groundGeometry,
  isUpright,
  partGeometry,
  shorten,
  symbolGeometry,
  valueLabel,
  valueLines,
} from './drawing.ts';
export type { Drawing, GroundPlacement, LabelSide, NodeLabel, NodeSpot, PartPlacement, SymbolGeometry } from './drawing.ts';

export {
  COORD_LIMIT,
  DRAWING_HEADER,
  DRAWING_PREFIX,
  DRAWING_VERSION,
  MAX_DRAWING_LINES,
  MAX_WIRE_LENGTH,
  MAX_WIRE_POINTS,
  NEW_TITLE,
  applyChanges,
  newlineOf,
  drawingBlockChanges,
  isDrawingLine,
  parseDrawingLines,
  readDrawing,
  serializeDrawing,
  stripDrawing,
} from './format.ts';
export type { DrawingLines, DrawingProblem, DrawingProblemKind, LabelLine, PositionLine } from './format.ts';

export {
  DIRECTIONS,
  DIRECTION_VECTORS,
  OPPOSITE,
  ROTATIONS,
  boxesOverlap,
  inflate,
  nextRotation,
  pointOnSegment,
  pt,
  rotate,
  samePoint,
  segmentCrossesBox,
  segmentsOf,
  transform,
  transformBox,
  transformDirection,
  unionBoxes,
} from './geometry.ts';
export type { Box, Direction, Point, Rotation } from './geometry.ts';

export { autoLayout, chooseRail, layOut, placeParts } from './layout.ts';
export type { LayoutOptions } from './layout.ts';

export { NAVIGATE_STRINGS, connections, describeItem, describeNode, describePart, describeSchematic, itemPosition, neighbour, readingOrder } from './navigate.ts';
export type { NavItem } from './navigate.ts';

export { MAX_ROUTE_CELLS, ROUTE_COSTS, findRoute } from './route.ts';
export type { RouteBudget, RouteEnd, RouteWorld } from './route.ts';

export { INLINE_RESULT_GAP, SCENE_STRINGS, STUB_LENGTH, buildScene, defaultSide, findOverlaps, wireCrossings } from './scene.ts';
export type { Overlap, PlacedGround, PlacedNodeLabel, PlacedPart, PlacedPin, PlacedWire, Scene, SceneItem, SceneOptions, Stub, Terminal } from './scene.ts';

export { buildSchematic, placedPart, reconcile, schematicConnectivity } from './schematic.ts';
export type { Schematic, SchematicOptions } from './schematic.ts';

export { PART_LETTERS, PIN_SPACING, SYMBOLS, hasArrow, hasPolarity, isIndependentSource, isPartLetter } from './symbols.ts';
export type { PartLetter, PinRole, SymbolDef, SymbolKind, SymbolShape } from './symbols.ts';

export { TEXT, defaultMeasure, textWidth } from './text.ts';
export type { Measure, TextAlign, TextLine, TextRole } from './text.ts';

export { cutAt, normalizeWires, pruneDangling } from './wires.ts';
