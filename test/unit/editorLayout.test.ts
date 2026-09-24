import * as assert from 'node:assert/strict';
import { EditorLayout, countGroups, sameLayout, widenGroup } from '../../src/preview/editorLayout';

const sizes = (layout: EditorLayout | undefined) => layout?.groups.map((group) => group.size);
const options = { width: 570, by: 274, atLeast: 270, neighbourMin: 260 };

describe('editor layout', () => {
  const sideBySide: EditorLayout = { orientation: 0, groups: [{ size: 570 }, { size: 570 }] };

  it('widens the preview beside the editor by the room it asks for', () => {
    assert.deepEqual(sizes(widenGroup(sideBySide, 1, options)), [296, 844]);
    assert.deepEqual(sideBySide.groups, [{ size: 570 }, { size: 570 }], 'the layout given is not changed');
  });

  it('takes less when the editor beside it would get too narrow, but never too little', () => {
    assert.deepEqual(sizes(widenGroup(sideBySide, 1, { ...options, by: 400 })), [260, 880]);
    const tight: EditorLayout = { orientation: 0, groups: [{ size: 500 }, { size: 570 }] };
    assert.equal(widenGroup(tight, 1, options), undefined, 'only 240 px to give, 270 needed');
  });

  it('does nothing when the preview is wide enough already', () => {
    assert.equal(widenGroup(sideBySide, 1, { ...options, atLeast: 0 }), undefined);
    assert.equal(widenGroup(sideBySide, 1, { ...options, atLeast: -40 }), undefined);
  });

  it('takes room from the nearest editors first', () => {
    const three: EditorLayout = { orientation: 0, groups: [{ size: 400 }, { size: 400 }, { size: 500 }] };
    assert.deepEqual(sizes(widenGroup(three, 2, { ...options, width: 500, by: 200, atLeast: 100 })), [340, 260, 700]);
    assert.deepEqual(sizes(widenGroup(three, 0, { ...options, width: 400, by: 100, atLeast: 50 })), [500, 300, 500]);
  });

  it('widens the whole column when the preview is stacked with another editor', () => {
    const grid: EditorLayout = {
      orientation: 0,
      groups: [{ size: 600 }, { size: 600, groups: [{ size: 400 }, { size: 400 }] }],
    };
    const wider = widenGroup(grid, 2, { ...options, width: 600 });
    assert.deepEqual(sizes(wider), [326, 874]);
    assert.deepEqual(wider?.groups[1].groups, [{ size: 400 }, { size: 400 }], 'heights stay');
  });

  it('widens within a row of a stacked layout', () => {
    const rows: EditorLayout = {
      orientation: 1,
      groups: [{ size: 500, groups: [{ size: 600 }, { size: 600 }] }, { size: 300 }],
    };
    const wider = widenGroup(rows, 1, { ...options, width: 600 });
    assert.deepEqual(wider?.groups[0].groups?.map((group) => group.size), [326, 874]);
    assert.deepEqual(sizes(wider), [500, 300]);
  });

  it('leaves alone what it cannot widen, or is not sure is the preview', () => {
    const stacked: EditorLayout = { orientation: 1, groups: [{ size: 400 }, { size: 400 }] };
    assert.equal(widenGroup(stacked, 1, options), undefined, 'already as wide as the editor area');
    assert.equal(widenGroup({ orientation: 0, groups: [{ size: 570 }] }, 0, options), undefined, 'a single group');
    assert.equal(widenGroup(sideBySide, 1, { ...options, width: 700 }), undefined, 'another width: another group');
    assert.equal(widenGroup(sideBySide, 5, options), undefined, 'no such group');
    assert.equal(widenGroup({ orientation: 0, groups: [{}, { size: 570 }] }, 1, options), undefined, 'unknown sizes');
  });

  it('counts groups and compares layouts', () => {
    const grid: EditorLayout = { orientation: 0, groups: [{ size: 600 }, { size: 600, groups: [{ size: 400 }, { size: 400 }] }] };
    assert.equal(countGroups(grid), 3);
    const moved: EditorLayout = JSON.parse(JSON.stringify(grid));
    moved.groups[0].size = 601;
    assert.ok(sameLayout(grid, moved), 'a pixel of rounding is the same layout');
    moved.groups[0].size = 640;
    assert.ok(!sameLayout(grid, moved));
    assert.ok(!sameLayout(grid, { ...grid, orientation: 1 }));
    assert.ok(!sameLayout(grid, { orientation: 0, groups: [{ size: 600 }, { size: 600 }] }));
  });
});
