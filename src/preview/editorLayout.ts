/*
 * The editor layout, as the `vscode.getEditorLayout` command returns it, and
 * the change that widens one editor group (the preview's) by taking room from
 * the groups beside it. No VS Code API: unit tested.
 * Copyright (c) 2026 Angelo Quartarone.
 *
 * A layout is a tree. With `orientation` 0 the top-level groups sit side by
 * side and their `size` is a width; with 1 they are stacked and `size` is a
 * height. Each level of nested `groups` turns the other way. Sizes are in
 * pixels. Groups are counted depth first, which is the order of ViewColumn.
 */

export interface GroupLayout {
  size?: number;
  groups?: GroupLayout[];
}

export interface EditorLayout {
  orientation: 0 | 1;
  groups: GroupLayout[];
}

interface Step {
  /** The groups of one level, and which of them leads to the group. */
  branch: GroupLayout[];
  index: number;
  /** Whether the groups of this level sit side by side (sizes are widths). */
  sideBySide: boolean;
}

const isBranch = (group: GroupLayout): boolean => !!group.groups?.length;

/** Every group of the layout (not the nested levels themselves). */
export function countGroups(layout: EditorLayout): number {
  const count = (groups: GroupLayout[]): number =>
    groups.reduce((sum, group) => sum + (isBranch(group) ? count(group.groups!) : 1), 0);
  return count(layout.groups);
}

/** The levels from the top of the layout down to group `column` (0-based). */
function pathTo(layout: EditorLayout, column: number): Step[] | undefined {
  let seen = 0;
  const walk = (branch: GroupLayout[], sideBySide: boolean, path: Step[]): Step[] | undefined => {
    for (let index = 0; index < branch.length; index++) {
      const here = [...path, { branch, index, sideBySide }];
      const group = branch[index];
      if (isBranch(group)) {
        const found = walk(group.groups!, !sideBySide, here);
        if (found) {
          return found;
        }
      } else if (seen++ === column) {
        return here;
      }
    }
    return undefined;
  };
  return walk(layout.groups, layout.orientation === 0, []);
}

export interface WidenOptions {
  /** The group's width as its content measures it: a check that it is the right group. */
  width: number;
  /** Grow by this much when the groups beside it can give it… */
  by: number;
  /** …but at least by this much, or not at all (a little wider would not help). */
  atLeast: number;
  /** Groups beside it keep at least this width. */
  neighbourMin: number;
}

/**
 * The layout with group `column` (0-based) wider, the room taken from the
 * nearest groups beside it first; undefined when it cannot grow enough, or
 * does not need to.
 */
export function widenGroup(layout: EditorLayout, column: number, options: WidenOptions): EditorLayout | undefined {
  if (!(options.atLeast > 0) || !(options.by >= options.atLeast)) {
    return undefined;
  }
  const copy = JSON.parse(JSON.stringify(layout)) as EditorLayout;
  // The nearest level where the group (or the stack it is in) has others beside it.
  const step = pathTo(copy, column)
    ?.reverse()
    .find((candidate) => candidate.sideBySide && candidate.branch.length > 1);
  if (!step) {
    return undefined;
  }
  const sizes = step.branch.map((group) => group.size);
  if (!sizes.every((size): size is number => typeof size === 'number' && Number.isFinite(size))) {
    return undefined;
  }
  if (Math.abs(sizes[step.index] - options.width) > 8) {
    return undefined; // not the group the preview is in
  }
  const others = sizes
    .map((_, index) => index)
    .filter((index) => index !== step.index)
    .sort((a, b) => Math.abs(a - step.index) - Math.abs(b - step.index) || a - b);
  const spare = (index: number) => Math.max(0, Math.floor(sizes[index] - options.neighbourMin));
  const capacity = others.reduce((sum, index) => sum + spare(index), 0);
  if (capacity < options.atLeast) {
    return undefined;
  }
  let wanted = Math.round(Math.min(options.by, capacity));
  for (const index of others) {
    const given = Math.min(wanted, spare(index));
    step.branch[index].size = sizes[index] - given;
    step.branch[step.index].size = step.branch[step.index].size! + given;
    wanted -= given;
  }
  return copy;
}

/** Whether two layouts have the same groups with the same sizes (± `tolerance` px). */
export function sameLayout(a: EditorLayout, b: EditorLayout, tolerance = 2): boolean {
  const same = (x: GroupLayout[], y: GroupLayout[]): boolean =>
    x.length === y.length &&
    x.every((group, index) => {
      const other = y[index];
      if (isBranch(group) !== isBranch(other)) {
        return false;
      }
      if (Math.abs((group.size ?? 0) - (other.size ?? 0)) > tolerance) {
        return false;
      }
      return !isBranch(group) || same(group.groups!, other.groups!);
    });
  return a.orientation === b.orientation && same(a.groups, b.groups);
}
