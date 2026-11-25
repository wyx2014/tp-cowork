/**
 * 「AI 模型与对话上下文」卡（src/client/settings/model-card.ts）的契约测试。
 *
 * 两条契约：
 *   1. 只展示对话动作联动，切换回传的是对应配置字段名；
 *   2. 忙时全部控件禁用，模型选择器也拿到同一个 busy。
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { jsx } from 'react/jsx-runtime';

import { makeModelCard, type ChatFlagValues } from './model-card.ts';

interface Node {
  tag: string;
  props: Record<string, unknown>;
}

const h = ((tag: unknown, props: Record<string, unknown>) => ({ tag, props })) as unknown as typeof jsx;
/** 模型选择器替身：只把 props 原样挂出来，方便断言 busy 传到了。 */
const Picker = ((props: Record<string, unknown>) => ({ tag: 'select', props })) as never;
const ModelCard = makeModelCard({ h, t: (key: string) => key } as never, Picker);

function flatten(node: unknown): Node[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  const element = node as Node;
  return [element, ...flatten(element.props?.children)];
}

const allOff: ChatFlagValues = {
  whisperImageEnabled: false,
  chatImageEnabled: false,
  chatAnimationEnabled: false,
};

/** 对话动作联动的开关：数字输入的 props 里没有 checked，据此区分。 */
const toggles = (tree: unknown): Node[] =>
  flatten(tree).filter((node) => node.tag === 'input' && node.props.checked !== undefined);

/** 一张卡的完整输入；未覆盖的字段给固定值。 */
function props(values: ChatFlagValues, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    busy: false,
    catalog: null,
    failed: false,
    chatModel: { kind: 'follow' },
    onModelChange: () => {},
    chatMemory: 6,
    onChatMemoryChange: () => {},
    values,
    onFlagChange: () => {},
    ...over,
  };
}

describe('ModelCard —— 对话开关', () => {
  test('配图开关隐藏，动作联动的勾选态来自 values', () => {
    const tree = ModelCard(
      props({ whisperImageEnabled: true, chatImageEnabled: false, chatAnimationEnabled: true }) as never,
    );
    const found = toggles(tree);
    assert.equal(found.length, 1);
    assert.deepEqual(
      found.map((box) => box.props.checked),
      [true],
    );
  });

  test('每个开关回传自己的配置字段名', () => {
    const seen: Array<[string, boolean]> = [];
    const tree = ModelCard(
      props(allOff, { onFlagChange: (key: string, value: boolean) => seen.push([key, value]) }) as never,
    );
    for (const box of toggles(tree)) {
      (box.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    }
    assert.deepEqual(
      seen.map(([key]) => key),
      ['chatAnimationEnabled'],
    );
    assert.ok(
      seen.every(([, value]) => value === true),
      '回传的必须是布尔值，不是事件对象',
    );
  });

  test('忙时开关与选择器全部禁用', () => {
    const tree = ModelCard(props(allOff, { busy: true }) as never);
    for (const box of toggles(tree)) assert.equal(box.props.disabled, true);
    // 选择器本身是组件，h 不会展开它：按组件引用查找。
    const pickers = flatten(tree).filter((node) => (node.tag as unknown) === Picker);
    assert.equal(pickers.length, 1);
    for (const picker of pickers) assert.equal(picker.props.disabled, true);
  });
});
